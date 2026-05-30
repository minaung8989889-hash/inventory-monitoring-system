import logging
import os
import re
import sys
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from flask import Flask, jsonify, request, render_template, Response, stream_with_context, g, redirect, url_for
from flask_cors import CORS
from pymongo import MongoClient
from werkzeug.security import generate_password_hash, check_password_hash
from bson.objectid import ObjectId
from bson.errors import InvalidId
import secrets
import uuid
import hashlib
import datetime
import json
import time
import xml.etree.ElementTree as ET

# Ensure repo root is available when running python backend/app.py
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import jwt
import pyotp
from backend.auth import generate_token, token_required, token_or_api_key_required, min_role_required, role_required
from backend.config import (
    MONGO_URI,
    DATABASE_NAME,
    ADMIN_SECRET,
    SECRET_KEY,
    API_KEY,
    ALLOWED_ORIGINS,
    MAX_LOGIN_ATTEMPTS,
    LOGIN_LOCKOUT_MINUTES,
    API_TOKEN_EXPIRATION_HOURS,
    ENVIRONMENT,
    FORCE_HTTPS,
    APP_VERSION,
    BUILD_PROFILE
)

# Some Flask installations may ship a broken ConfigAttribute for secret_key.
# Ensure the descriptor maps to the real 'SECRET_KEY' config key before app creation.
try:
    if hasattr(Flask.secret_key, '__name__') and Flask.secret_key.__name__ != 'SECRET_KEY':
        Flask.secret_key.__name__ = 'SECRET_KEY'
except Exception:
    pass

app = Flask(
    __name__,
    template_folder='templates',
    static_folder='../static'
)

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(asctime)s %(message)s')
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}})

# Harden session cookies
app.config['SECRET_KEY'] = SECRET_KEY
app.secret_key = SECRET_KEY
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = bool(FORCE_HTTPS and not app.debug)
app.config['PREFERRED_URL_SCHEME'] = 'https' if FORCE_HTTPS else 'http'

if not SECRET_KEY or SECRET_KEY == 'Online_Monitoring_System_Key_007':
    logging.warning('Using default Flask SECRET_KEY. Replace it with a secure secret in production.')
if not ADMIN_SECRET:
    logging.warning('ADMIN_SECRET is not set. Master registration is disabled until it is configured.')

@app.after_request
def apply_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=(), gyroscope=()'
    response.headers['X-Permitted-Cross-Domain-Policies'] = 'none'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload' if not app.debug else ''
    csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: ws: wss:;"
    response.headers['Content-Security-Policy'] = csp
    return response


@app.route('/api/version', methods=['GET'])
def api_version():
    """Return application version and build profile."""
    return jsonify({
        'version': APP_VERSION,
        'profile': BUILD_PROFILE,
        'environment': ENVIRONMENT
    })

client = MongoClient(MONGO_URI)
db = client[DATABASE_NAME]

users_collection = db['users']
tank_collection = db['tank_data']
refresh_collection = db['refresh_tokens']
# Automatically expire old refresh token records from the database.
try:
    refresh_collection.create_index('exp', expireAfterSeconds=0)
except Exception:
    pass

event_collection = db['event_log']

ALLOWED_ROLES = ['viewer', 'auditor', 'operator', 'master', 'administrator']
APPROVAL_REQUIRED_ROLES = ['auditor', 'operator', 'master', 'administrator']
ROLE_LEVELS = {
    'viewer': 1,
    'auditor': 2,
    'operator': 3,
    'master': 4,
    'administrator': 5
}

def get_role_level(role_name):
    return ROLE_LEVELS.get(role_name, 0)

def requires_approval(role_name):
    return role_name in APPROVAL_REQUIRED_ROLES


def validate_environment():
    if not MONGO_URI:
        raise RuntimeError('MONGO_URI must be configured')
    if ENVIRONMENT not in {'development', 'staging', 'production'}:
        raise RuntimeError('ENVIRONMENT must be development, staging, or production')
    if ENVIRONMENT != 'development':
        if not SECRET_KEY or SECRET_KEY == 'Online_Monitoring_System_Key_007':
            raise RuntimeError('A secure SECRET_KEY must be configured for non-development environments')
        if not ADMIN_SECRET:
            raise RuntimeError('ADMIN_SECRET must be configured for non-development environments')
        if not ALLOWED_ORIGINS:
            raise RuntimeError('ALLOWED_ORIGINS must be configured for non-development environments')
    if FORCE_HTTPS and app.debug:
        logging.warning('FORCE_HTTPS is enabled while debug is active; secure cookies will remain disabled until debug is off.')


validate_environment()


def is_account_locked(user):
    locked_until = user.get('locked_until')
    if not locked_until:
        return False
    if isinstance(locked_until, datetime.datetime):
        return locked_until > datetime.datetime.now(datetime.timezone.utc)
    return False


def get_lockout_remaining_seconds(user):
    locked_until = user.get('locked_until')
    if not locked_until or not isinstance(locked_until, datetime.datetime):
        return 0
    remaining = (locked_until - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
    return max(0, int(remaining))


def reset_login_attempts(username):
    users_collection.update_one(
        {'username': username},
        {'$unset': {'failed_login_attempts': '', 'locked_until': ''}}
    )


def increment_login_attempt(user):
    username = user['username']
    failed_attempts = int(user.get('failed_login_attempts', 0)) + 1
    update_fields = {'failed_login_attempts': failed_attempts}

    if failed_attempts >= MAX_LOGIN_ATTEMPTS:
        lock_until = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        update_fields['locked_until'] = lock_until

    users_collection.update_one({'username': username}, {'$set': update_fields})
    return failed_attempts


def hash_api_token(token):
    if not token:
        return None
    return hashlib.sha256(str(token).encode('utf-8')).hexdigest()


def generate_user_api_token(username, expires_in_hours: int = API_TOKEN_EXPIRATION_HOURS):
    token = secrets.token_urlsafe(36)
    created_at = datetime.datetime.now(datetime.UTC)
    expires_at = created_at + datetime.timedelta(hours=expires_in_hours)
    users_collection.update_one(
        {'username': username},
        {'$set': {
            'api_token_hash': hash_api_token(token),
            'api_token_created_at': created_at,
            'api_token_expires_at': expires_at
        }}
    )
    return token


def load_dev_settings():
    settings = db['app_settings'].find_one({'key': 'dev_settings'}) or {}
    return {
        'public_ip': settings.get('public_ip', ''),
        'public_domain': settings.get('public_domain', ''),
        'public_host': settings.get('public_host', ''),
        'mqtt_broker': settings.get('mqtt_broker', ''),
        'node_red_host': settings.get('node_red_host', ''),
        'api_key': settings.get('api_key', API_KEY),
        'data_transmit_mode': settings.get('data_transmit_mode', 'https'),
        'data_transmission_target': settings.get('data_transmission_target', 'cloud'),
        'cloud_host': settings.get('cloud_host', ''),
        'internal_host': settings.get('internal_host', ''),
        'encryption_required': bool(settings.get('encryption_required', True)),
        'force_secure_transport': bool(settings.get('force_secure_transport', True)),
        'transmit_interval_sec': settings.get('transmit_interval_sec', 60)
    }


def validate_url(value, allowed_schemes=('http', 'https')):
    if not value:
        return False
    parsed = urlparse(value)
    return parsed.scheme in allowed_schemes and parsed.netloc != ''


def validate_host(value):
    if not value:
        return True
    if re.match(r'^[a-zA-Z0-9.-]+$', value) and '..' not in value:
        return True
    if re.match(r'^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$', value):
        return True
    return False


def validate_dev_settings(data):
    errors = []
    if 'public_ip' in data and data['public_ip']:
        if not validate_host(str(data['public_ip']).strip()):
            errors.append('public_ip must be a valid IP or hostname')
    if 'public_domain' in data and data['public_domain']:
        if not validate_host(str(data['public_domain']).strip()):
            errors.append('public_domain must be a valid domain name')
    if 'public_host' in data and data['public_host']:
        if not validate_url(str(data['public_host']).strip()):
            errors.append('public_host must be a valid http or https URL')
    if 'mqtt_broker' in data and data['mqtt_broker']:
        if not validate_url(str(data['mqtt_broker']).strip(), allowed_schemes=('http', 'https', 'mqtt', 'mqtts', 'ws', 'wss', 'tcp')):
            errors.append('mqtt_broker must be a valid broker URL (http/https/mqtt/mqtts/ws/wss/tcp)')
    if 'node_red_host' in data and data['node_red_host']:
        if not validate_url(str(data['node_red_host']).strip(), allowed_schemes=('http', 'https', 'ws', 'wss')):
            errors.append('node_red_host must be a valid http, https, ws, or wss URL')
    target = 'cloud'
    if 'data_transmission_target' in data and data['data_transmission_target']:
        target = str(data['data_transmission_target']).strip().lower()
        if target not in {'cloud', 'internal'}:
            errors.append('data_transmission_target must be either cloud or internal')

    if 'cloud_host' in data and data['cloud_host']:
        if not validate_url(str(data['cloud_host']).strip(), allowed_schemes=('http', 'https')):
            errors.append('cloud_host must be a valid http or https URL')
    if 'internal_host' in data and data['internal_host']:
        if not validate_url(str(data['internal_host']).strip(), allowed_schemes=('http', 'https')):
            errors.append('internal_host must be a valid http or https URL')

    if target == 'cloud':
        if not str(data.get('cloud_host', '')).strip() and not str(data.get('public_host', '')).strip():
            errors.append('cloud_host or public_host must be set when transmission target is cloud')
    elif target == 'internal':
        if not str(data.get('internal_host', '')).strip():
            errors.append('internal_host is required when transmission target is internal')

    if 'data_transmit_mode' in data and data['data_transmit_mode']:
        allowed_modes = {'http', 'https', 'mqtt', 'mqtts', 'ws', 'wss'}
        selected_mode = str(data['data_transmit_mode']).strip().lower()
        if selected_mode not in allowed_modes:
            errors.append('data_transmit_mode must be one of http, https, mqtt, mqtts, ws, wss')
        elif data.get('encryption_required') and selected_mode in {'http', 'ws', 'mqtt'}:
            errors.append('encryption_required requires https, wss, or mqtts mode')
        elif bool(data.get('force_secure_transport')) and selected_mode not in {'https', 'wss', 'mqtts'}:
            errors.append('force_secure_transport requires https, wss, or mqtts mode')
    if 'transmit_interval_sec' in data and data['transmit_interval_sec'] != '':
        try:
            interval = int(data['transmit_interval_sec'])
            if interval < 10 or interval > 3600:
                errors.append('transmit_interval_sec must be between 10 and 3600')
        except (ValueError, TypeError):
            errors.append('transmit_interval_sec must be a valid integer')
    if 'api_key' in data and data['api_key']:
        if len(str(data['api_key']).strip()) < 16:
            errors.append('api_key must be at least 16 characters')
    return errors


def store_dev_settings(data):
    sanitized = {
        'public_ip': str(data.get('public_ip', '')).strip(),
        'public_domain': str(data.get('public_domain', '')).strip(),
        'public_host': str(data.get('public_host', '')).strip(),
        'mqtt_broker': str(data.get('mqtt_broker', '')).strip(),
        'node_red_host': str(data.get('node_red_host', '')).strip(),
        'api_key': str(data.get('api_key', '')).strip(),
        'data_transmit_mode': str(data.get('data_transmit_mode', 'https')).strip().lower(),
        'data_transmission_target': str(data.get('data_transmission_target', 'cloud')).strip().lower(),
        'cloud_host': str(data.get('cloud_host', '')).strip(),
        'internal_host': str(data.get('internal_host', '')).strip(),
        'encryption_required': bool(data.get('encryption_required', True)),
        'force_secure_transport': bool(data.get('force_secure_transport', True)),
        'transmit_interval_sec': int(data.get('transmit_interval_sec') or 60)
    }
    db['app_settings'].update_one({'key': 'dev_settings'}, {'$set': sanitized}, upsert=True)
    return sanitized


def get_tank_meta(tank_name):
    meta = db['tank_meta'].find_one({'tank': tank_name}) or {}
    return {
        'display_name': str(meta.get('display_name', '')).strip(),
        'ma_low': float(meta.get('ma_low', 4.0)),
        'ma_high': float(meta.get('ma_high', 20.0)),
        'level_min': float(meta.get('level_min', 0.0)),
        'level_max': float(meta.get('level_max', 100.0))
    }


def calculate_ma_from_level(level, meta):
    try:
        lv = float(level)
    except (TypeError, ValueError):
        return None
    ma_low = float(meta.get('ma_low', 4.0))
    ma_high = float(meta.get('ma_high', 20.0))
    level_min = float(meta.get('level_min', 0.0))
    level_max = float(meta.get('level_max', 100.0))

    if ma_high <= ma_low:
        ma_high = ma_low + 16.0
    if level_max <= level_min:
        level_max = level_min + 100.0

    if lv <= level_min:
        fraction = 0.0
    elif lv >= level_max:
        fraction = 1.0
    else:
        fraction = (lv - level_min) / (level_max - level_min)

    return round(ma_low + fraction * (ma_high - ma_low), 2)


def get_transmission_endpoint(settings):
    target = str(settings.get('data_transmission_target', 'cloud')).strip().lower()
    if target == 'internal':
        endpoint = str(settings.get('internal_host', '')).strip()
    else:
        endpoint = str(settings.get('cloud_host', '') or settings.get('public_host', '')).strip()
    return endpoint or None


def transmit_to_configured_destination(payload, settings):
    endpoint = get_transmission_endpoint(settings)
    if not endpoint:
        return {'success': False, 'message': 'No transmission endpoint configured for the selected target.'}
    parsed = urlparse(endpoint)
    if parsed.scheme not in ('http', 'https'):
        return {'success': False, 'message': 'Transmission endpoint must use http or https.'}
    mode = str(settings.get('data_transmit_mode', 'https')).strip().lower()
    if mode not in {'http', 'https'}:
        return {
            'success': False,
            'message': f'Transmission mode {mode} is configured, but test transmission only supports HTTP/HTTPS at this time.'
        }
    if settings.get('encryption_required') and parsed.scheme != 'https':
        return {'success': False, 'message': 'Encryption is required but endpoint is not HTTPS.'}

    payload_body = json.dumps({
        'payload': payload,
        'target': settings.get('data_transmission_target', 'cloud'),
        'transmit_mode': mode,
        'timestamp': datetime.datetime.now(datetime.UTC).isoformat() + 'Z'
    }).encode('utf-8')

    headers = {
        'Content-Type': 'application/json'
    }
    api_key = settings.get('api_key')
    if api_key:
        headers['X-Developer-API-Key'] = api_key

    request_obj = Request(endpoint, data=payload_body, headers=headers, method='POST')
    try:
        with urlopen(request_obj, timeout=20) as response:
            response_text = response.read().decode('utf-8', errors='ignore')
            return {
                'success': True,
                'endpoint': endpoint,
                'status': response.status,
                'response_body': response_text
            }
    except Exception as exc:
        return {
            'success': False,
            'message': f'Transmission failed: {exc}',
            'endpoint': endpoint
        }


def relay_payload_to_third_party(payload, source='signal_relay'):
    settings = load_dev_settings()
    result = transmit_to_configured_destination(payload, settings)
    record_event(
        'third_party_relay',
        'Relayed tank signal to configured third-party endpoint',
        source=source,
        metadata={
            'success': bool(result.get('success')),
            'endpoint': result.get('endpoint'),
            'payload': payload
        }
    )
    return result


def normalize_tank_payload(data):
    if not isinstance(data, dict):
        return {}
    normalized = dict(data)
    if 'tank' not in normalized and 'name' in normalized:
        normalized['tank'] = normalized.pop('name')
    return normalized


def normalize_tank_doc(doc):
    if not isinstance(doc, dict):
        return doc
    if 'tank' not in doc and 'name' in doc:
        doc['tank'] = doc['name']
    return doc


def make_profile(user):
    return {
        'username': user['username'],
        'email': user.get('email', ''),
        'role': user.get('role', 'viewer'),
        'role_level': get_role_level(user.get('role', 'viewer')),
        'approved': bool(user.get('approved', False)),
        'two_factor_enabled': bool(user.get('two_factor_enabled', False))
    }


def record_event(event_type, message, source='backend', actor=None, metadata=None):
    event = {
        'type': event_type,
        'message': message,
        'source': source,
        'actor': actor or getattr(g, 'user', None),
        'role': getattr(g, 'role', None),
        'timestamp': datetime.datetime.now(datetime.UTC),
        'metadata': metadata or {}
    }
    event_collection.insert_one(event)
    return event


def get_totalizer_value():
    doc = db['app_meta'].find_one({'key': 'totalizer'}) or {}
    return {
        'value': float(doc.get('value', 0.0)),
        'updated_at': doc.get('updated_at')
    }


def set_totalizer_value(value=0.0):
    record = {
        'value': float(value),
        'updated_at': datetime.datetime.now(datetime.UTC)
    }
    db['app_meta'].update_one({'key': 'totalizer'}, {'$set': record}, upsert=True)
    return record

@app.route('/')
def home():
    return redirect(url_for('login_page'))

@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')

@app.route('/profile')
def profile_page():
    return render_template('profile.html')

@app.route('/settings')
def settings_page():
    return render_template('settings.html')

@app.route('/developer')
def developer_page():
    return render_template('developer_panel.html')

@app.route('/user-management')
def user_management_page():
    return render_template('user_management.html')

@app.route('/privacy')
def privacy_page():
    return render_template('privacy.html')

@app.route('/security')
def security_page():
    return render_template('security.html')

@app.route('/pos-management')
def pos_management_page():
    return render_template('pos_management.html')

@app.route('/api/tanks/pos-report', methods=['GET'])
@token_required
def pos_report():
    tank_name = request.args.get('tank')
    month = request.args.get('month')
    query = {}
    now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
    cutoff = now - datetime.timedelta(days=3)

    if month:
        try:
            start = datetime.datetime.strptime(month, '%Y-%m')
        except ValueError:
            return jsonify({'message': 'Invalid month format. Use YYYY-MM'}), 400
        if start < cutoff:
            return jsonify({'message': 'History is limited to the last 72 hours.'}), 403
        end = min((start + datetime.timedelta(days=32)).replace(day=1), now)
        query['timestamp'] = {'$gte': start, '$lt': end}
    else:
        query['timestamp'] = {'$gte': cutoff}

    if tank_name:
        query['tank'] = tank_name

    docs = tank_collection.find(query).sort('timestamp', 1)
    results = []
    for d in docs:
        d['id'] = str(d.pop('_id'))
        results.append(normalize_tank_doc(d))
    return jsonify(results)

@app.route('/register', methods=['GET', 'POST'])
def register_page():
    if request.method == 'GET':
        return render_template('register.html')

    data = request.json or {}
    username = str(data.get('username', '')).strip()
    email = str(data.get('email', '')).strip().lower()
    password_raw = data.get('password')

    if not username or not email or not password_raw:
        return jsonify({'message': 'username, email and password required'}), 400

    if users_collection.find_one({'$or': [{'username': username}, {'email': email}]}) is not None:
        return jsonify({'message': 'Username or email already exists'}), 409

    if len(password_raw) < 8:
        return jsonify({'message': 'Password must be at least 8 characters'}), 400

    role = str(data.get('role', 'viewer')).strip().lower()
    if role == 'admin':
        role = 'administrator'
    if role not in ALLOWED_ROLES:
        return jsonify({'message': 'Invalid role specified'}), 400

    # viewers are auto-approved; other roles require master/administrator approval
    approved = not requires_approval(role)
    if role in {'master', 'administrator'}:
        admin_secret = request.headers.get('X-Admin-Secret', '')
        if not ADMIN_SECRET or admin_secret != ADMIN_SECRET:
            return jsonify({'message': f'Not allowed to create {role} user'}), 403
        approved = True

    password = generate_password_hash(password_raw)
    user = {
        'username': username,
        'email': email,
        'password': password,
        'role': role,
        'approved': approved,
        'disabled': False,
        'two_factor_enabled': False,
        'two_factor_secret': None,
        'failed_login_attempts': 0,
        'locked_until': None
    }

    users_collection.insert_one(user)

    message = 'Master user created' if role == 'master' else (
        'Registration complete. Viewer access is active immediately.' if approved else 'Registration complete. Your account is pending approval by a master user.'
    )
    return jsonify({'message': message, 'approved': approved}), 201

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if request.method == 'GET':
        return render_template('login.html')

    data = request.json or {}
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'message': 'username and password required'}), 400

    user = users_collection.find_one({'username': username})

    if not user:
        return jsonify({'message': 'Invalid username or password'}), 401

    if user.get('disabled', False):
        return jsonify({'message': 'Account disabled'}), 403

    if user.get('role') not in ['viewer'] and not user.get('approved', False):
        return jsonify({'message': 'Account pending approval by master'}), 403

    if is_account_locked(user):
        remaining = get_lockout_remaining_seconds(user)
        minutes = max(1, int((remaining + 59) // 60))
        return jsonify({'message': f'Account temporarily locked. Try again in {minutes} minute(s).'}), 403

    if check_password_hash(user['password'], password):
        if user.get('two_factor_enabled', False):
            otp = data.get('otp')
            if not otp:
                increment_login_attempt(user)
                return jsonify({'message': '2FA code required'}), 401
            if not user.get('two_factor_secret') or not pyotp.TOTP(user['two_factor_secret']).verify(str(otp).strip(), valid_window=1):
                increment_login_attempt(user)
                return jsonify({'message': 'Invalid 2FA code'}), 401

        reset_login_attempts(user['username'])
        access_token = generate_token(user['username'], role=user.get('role', 'viewer'), hours_valid=1)

        # create JWT refresh token with a jti, store jti for rotation/revocation
        token_id = uuid.uuid4().hex
        refresh_expires = datetime.datetime.now(datetime.UTC).replace(tzinfo=None) + datetime.timedelta(days=7)
        refresh_token = generate_token(
            user['username'],
            role=user.get('role', 'viewer'),
            hours_valid=24 * 7,
            token_type='refresh',
            jti=token_id,
        )

        refresh_collection.insert_one({
            'jti': token_id,
            'username': user['username'],
            'exp': refresh_expires
        })

        return jsonify({
            'access_token': access_token,
            'refresh_token': refresh_token
        })

    increment_login_attempt(user)
    return jsonify({'message': 'Invalid username or password'}), 401


@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.json or {}
    username = str(data.get('username', '')).strip()
    email = str(data.get('email', '')).strip().lower()
    password = data.get('password')
    confirm_password = data.get('confirm_password')

    if not username or not email or not password or not confirm_password:
        return jsonify({'message': 'username, email, password and confirm_password are required'}), 400
    if password != confirm_password:
        return jsonify({'message': 'Passwords do not match'}), 400
    if len(password) < 8:
        return jsonify({'message': 'Password must be at least 8 characters'}), 400

    user = users_collection.find_one({'username': username, 'email': email})
    if not user:
        return jsonify({'message': 'User not found with provided username and email'}), 404

    users_collection.update_one({'username': username}, {'$set': {'password': generate_password_hash(password)}})
    return jsonify({'message': 'Password reset successfully. Please sign in with your new password.'})


@app.route('/public/user-2fa-status', methods=['GET'])
def public_user_2fa_status():
    username = request.args.get('username', '')
    if not username:
        return jsonify({'message': 'username required'}), 400
    user = users_collection.find_one({'username': username})
    if not user:
        return jsonify({'two_factor_enabled': False}), 200
    return jsonify({'two_factor_enabled': bool(user.get('two_factor_enabled', False))}), 200


@app.route('/token/refresh', methods=['POST'])
def refresh_token():
    data = request.json or {}
    full = data.get('refresh_token')
    if not full:
        return jsonify({'message': 'refresh_token required'}), 400

    try:
        payload = jwt.decode(full, SECRET_KEY, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return jsonify({'message': 'Refresh token expired'}), 401
    except jwt.InvalidTokenError:
        return jsonify({'message': 'Invalid refresh token'}), 401

    if payload.get('type') != 'refresh':
        return jsonify({'message': 'Invalid token type'}), 401

    jti = payload.get('jti')
    if not jti:
        return jsonify({'message': 'Invalid refresh token'}), 401

    rec = refresh_collection.find_one({'jti': jti})
    if not rec:
        return jsonify({'message': 'Invalid refresh token'}), 401

    now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
    if rec.get('exp') and rec['exp'] < now:
        refresh_collection.delete_one({'jti': jti})
        return jsonify({'message': 'Refresh token expired'}), 401

    username = rec['username']
    user = users_collection.find_one({'username': username})
    if not user or user.get('disabled', False):
        refresh_collection.delete_one({'jti': jti})
        return jsonify({'message': 'Invalid refresh token'}), 401
    if user.get('role') not in ['viewer'] and not user.get('approved', False):
        return jsonify({'message': 'Account not approved'}), 403

    # rotate: remove old jti and create new one
    refresh_collection.delete_one({'jti': jti})
    new_jti = uuid.uuid4().hex
    new_exp = datetime.datetime.now(datetime.UTC).replace(tzinfo=None) + datetime.timedelta(days=7)
    new_refresh = generate_token(username, hours_valid=24 * 7, token_type='refresh', jti=new_jti)
    refresh_collection.insert_one({'jti': new_jti, 'username': username, 'exp': new_exp})

    new_access = generate_token(username)

    return jsonify({'access_token': new_access, 'refresh_token': new_refresh})


@app.route('/logout', methods=['POST'])
def logout():
    data = request.json or {}
    full = data.get('refresh_token')
    if not full:
        return jsonify({'message': 'refresh_token required'}), 400

    try:
        payload = jwt.decode(full, SECRET_KEY, algorithms=['HS256'])
    except jwt.InvalidTokenError:
        return jsonify({'message': 'Invalid refresh token'}), 400

    jti = payload.get('jti')
    if not jti:
        return jsonify({'message': 'Invalid refresh token'}), 400

    res = refresh_collection.delete_one({'jti': jti})
    if res.deleted_count == 0:
        return jsonify({'message': 'Not found'}), 404

    return jsonify({'message': 'Logged out'})

@app.route('/api/tanks', methods=['GET'])
@token_required
def get_tanks():
    """Return the latest reading for each tank."""
    pipeline = [
        {'$sort': {'timestamp': -1}},
        {'$group': {'_id': '$tank', 'doc': {'$first': '$$ROOT'}}},
        {'$replaceRoot': {'newRoot': '$doc'}}
    ]
    docs = tank_collection.aggregate(pipeline)

    tanks = []
    for d in docs:
        d['id'] = str(d.pop('_id'))
        meta = get_tank_meta(d.get('tank'))
        if meta.get('display_name'):
            d['display_name'] = meta.get('display_name')
        d['ma_low'] = meta['ma_low']
        d['ma_high'] = meta['ma_high']
        d['level_min'] = meta['level_min']
        d['level_max'] = meta['level_max']
        d['control_signal_ma'] = calculate_ma_from_level(d.get('level'), meta)
        tanks.append(normalize_tank_doc(d))

    return jsonify(tanks)


@app.route('/api/tanks/<tank_name>/settings', methods=['GET'])
@token_required
def get_tank_settings(tank_name):
    meta = get_tank_meta(tank_name)
    return jsonify({'tank': tank_name, 'display_name': meta.get('display_name') or tank_name, **meta})


@app.route('/api/tanks/<tank_name>/settings', methods=['PUT'])
@token_required
@min_role_required('operator')
def save_tank_settings(tank_name):
    data = request.json or {}
    update_fields = {}
    if 'display_name' in data:
        update_fields['display_name'] = str(data.get('display_name', '')).strip()
    if 'ma_low' in data:
        try:
            ma_low = float(data['ma_low'])
            if ma_low < 0 or ma_low > 50:
                raise ValueError
            update_fields['ma_low'] = ma_low
        except (TypeError, ValueError):
            return jsonify({'message': 'ma_low must be a valid number between 0 and 50'}), 400
    if 'ma_high' in data:
        try:
            ma_high = float(data['ma_high'])
            if ma_high < 0 or ma_high > 50:
                raise ValueError
            update_fields['ma_high'] = ma_high
        except (TypeError, ValueError):
            return jsonify({'message': 'ma_high must be a valid number between 0 and 50'}), 400
    if 'level_min' in data:
        try:
            level_min = float(data['level_min'])
            if level_min < 0 or level_min > 100:
                raise ValueError
            update_fields['level_min'] = level_min
        except (TypeError, ValueError):
            return jsonify({'message': 'level_min must be a valid number between 0 and 100'}), 400
    if 'level_max' in data:
        try:
            level_max = float(data['level_max'])
            if level_max < 0 or level_max > 100:
                raise ValueError
            update_fields['level_max'] = level_max
        except (TypeError, ValueError):
            return jsonify({'message': 'level_max must be a valid number between 0 and 100'}), 400

    if 'ma_low' in update_fields and 'ma_high' in update_fields and update_fields['ma_high'] <= update_fields['ma_low']:
        return jsonify({'message': 'ma_high must be greater than ma_low'}), 400
    if 'level_min' in update_fields and 'level_max' in update_fields and update_fields['level_max'] <= update_fields['level_min']:
        return jsonify({'message': 'level_max must be greater than level_min'}), 400

    if not update_fields:
        return jsonify({'message': 'No calibration changes provided'}), 400

    db['tank_meta'].update_one({'tank': tank_name}, {'$set': update_fields}, upsert=True)
    saved = get_tank_meta(tank_name)
    record_event(
        'tank_settings_update',
        f'Tank calibration settings updated for {tank_name}',
        source='tank_modal',
        metadata={'tank': tank_name, 'changes': update_fields}
    )
    return jsonify({'message': 'Tank calibration saved', 'settings': {'tank': tank_name, 'display_name': saved.get('display_name') or tank_name, **saved}})


@app.route('/api/tanks/history/<tank_name>', methods=['GET'])
@token_required
def tank_history(tank_name):
    limit = int(request.args.get('limit', 20))
    cutoff = datetime.datetime.now(datetime.UTC).replace(tzinfo=None) - datetime.timedelta(days=3)
    meta = get_tank_meta(tank_name)
    docs = tank_collection.find({'tank': tank_name, 'timestamp': {'$gte': cutoff}}).sort('timestamp', -1).limit(limit)
    results = []
    for d in docs:
        d['id'] = str(d.pop('_id'))
        d['display_name'] = meta.get('display_name') or tank_name
        d['ma_low'] = meta['ma_low']
        d['ma_high'] = meta['ma_high']
        d['level_min'] = meta['level_min']
        d['level_max'] = meta['level_max']
        d['control_signal_ma'] = calculate_ma_from_level(d.get('level'), meta)
        results.append(normalize_tank_doc(d))
    return jsonify(results)


@app.route('/api/tanks/live')
@token_required
def tanks_live():
    def event_stream():
        last_ts = datetime.datetime.now(datetime.UTC).replace(tzinfo=None) - datetime.timedelta(seconds=1)
        while True:
            docs = list(tank_collection.find({'timestamp': {'$gt': last_ts}}).sort('timestamp', 1))
            if docs:
                for d in docs:
                    last_ts = d['timestamp'] if d.get('timestamp') else last_ts
                    d['id'] = str(d.pop('_id'))
                    meta = get_tank_meta(d.get('tank'))
                    d['display_name'] = meta.get('display_name') or d.get('tank')
                    d['ma_low'] = meta['ma_low']
                    d['ma_high'] = meta['ma_high']
                    d['level_min'] = meta['level_min']
                    d['level_max'] = meta['level_max']
                    d['control_signal_ma'] = calculate_ma_from_level(d.get('level'), meta)
                    yield f"data: {json.dumps(normalize_tank_doc(d), default=str)}\n\n"
            time.sleep(1)
    return Response(stream_with_context(event_stream()), content_type='text/event-stream')


@app.route('/api/profile')
@token_required
def user_profile():
    user = users_collection.find_one({'username': g.user})
    if not user:
        return jsonify({'message': 'User not found'}), 404
    return jsonify(make_profile(user))


@app.route('/api/profile', methods=['PUT'])
@token_required
def update_profile():
    data = request.json or {}
    update_fields = {}
    if 'password' in data:
        if len(data['password']) < 8:
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        update_fields['password'] = generate_password_hash(data['password'])
    if 'role' in data:
        if get_role_level(g.role) < get_role_level('master'):
            return jsonify({'message': 'Forbidden to change role'}), 403
        new_role = data['role']
        if new_role == 'admin':
            new_role = 'master'
        if new_role not in ALLOWED_ROLES:
            return jsonify({'message': 'Invalid role specified'}), 400
        update_fields['role'] = new_role
    if not update_fields:
        return jsonify({'message': 'No changes provided'}), 400
    users_collection.update_one({'username': g.user}, {'$set': update_fields})
    return jsonify({'message': 'Profile updated'})


@app.route('/api/users', methods=['GET'])
@token_required
@min_role_required('master')
def list_users():
    docs = users_collection.find({}, {'password': 0, 'two_factor_secret': 0})
    users = []
    for user in docs:
        users.append({
            'username': user['username'],
            'email': user.get('email', ''),
            'role': user.get('role', 'viewer'),
            'approved': bool(user.get('approved', False)),
            'disabled': bool(user.get('disabled', False)),
            'last_seen': user.get('last_seen').isoformat() if user.get('last_seen') else None,
            'two_factor_enabled': bool(user.get('two_factor_enabled', False)),
            'has_api_token': bool(user.get('api_token_hash')),
            'api_token_created_at': user.get('api_token_created_at').isoformat() if user.get('api_token_created_at') else None,
            'api_token_expires_at': user.get('api_token_expires_at').isoformat() if user.get('api_token_expires_at') else None
        })
    return jsonify(users)


@app.route('/api/users/<username>/approve', methods=['PUT'])
@token_required
@min_role_required('master')
def approve_user(username):
    data = request.json or {}
    approved = data.get('approved', True)
    if isinstance(approved, str):
        approved = approved.lower() in ['true', '1', 'yes']

    role = data.get('role')
    if role:
        role = str(role).strip().lower()
        if role == 'admin':
            role = 'master'
        if role not in ALLOWED_ROLES:
            return jsonify({'message': 'Invalid role specified'}), 400

    user = users_collection.find_one({'username': username})
    if not user:
        return jsonify({'message': 'User not found'}), 404

    update_fields = {'approved': bool(approved)}
    if role:
        update_fields['role'] = role # type: ignore

    users_collection.update_one({'username': username}, {'$set': update_fields})
    return jsonify({'message': 'User approval updated', 'approved': bool(approved)})


@app.route('/api/users/<username>/disable', methods=['PUT'])
@token_required
@min_role_required('master')
def disable_user(username):
    data = request.json or {}
    disabled = data.get('disabled', True)
    if isinstance(disabled, str):
        disabled = disabled.lower() in ['true', '1', 'yes']

    user = users_collection.find_one({'username': username})
    if not user:
        return jsonify({'message': 'User not found'}), 404

    # Keep approval separate from disable state.
    users_collection.update_one({'username': username}, {'$set': {'disabled': bool(disabled)}})
    return jsonify({'message': 'User disabled state updated', 'disabled': bool(disabled)})


@app.route('/api/users/<username>/token', methods=['POST'])
@token_required
@min_role_required('master')
def create_user_token(username):
    user = users_collection.find_one({'username': username})
    if not user:
        return jsonify({'message': 'User not found'}), 404

    data = request.json or {}
    expires_in_hours = data.get('expires_in_hours', API_TOKEN_EXPIRATION_HOURS)
    try:
        expires_in_hours = int(expires_in_hours)
    except (TypeError, ValueError):
        return jsonify({'message': 'expires_in_hours must be an integer'}), 400

    if expires_in_hours <= 0 or expires_in_hours > 168:
        return jsonify({'message': 'expires_in_hours must be between 1 and 168'}), 400

    token = generate_user_api_token(username, expires_in_hours=expires_in_hours)
    expires_at = users_collection.find_one({'username': username}).get('api_token_expires_at')
    return jsonify({
        'message': 'API token generated',
        'token': token,
        'expires_at': expires_at.isoformat() if expires_at else None
    })


@app.route('/api/users/<username>/token', methods=['DELETE'])
@token_required
@min_role_required('master')
def revoke_user_token(username):
    user = users_collection.find_one({'username': username})
    if not user:
        return jsonify({'message': 'User not found'}), 404
    users_collection.update_one(
        {'username': username},
        {'$unset': {'api_token_hash': '', 'api_token_created_at': '', 'api_token_expires_at': ''}}
    )
    return jsonify({'message': 'API token revoked'})


@app.route('/api/tanks/<tank_name>/tag', methods=['PUT'])
@token_required
def set_tank_tag(tank_name):
    """Set a display tag/name for a tank. Only operators and masters may edit tags."""
    if g.role not in ['operator', 'master']:
        return jsonify({'message': 'Forbidden'}), 403
    data = request.json or {}
    display_name = data.get('display_name')
    if display_name is None:
        return jsonify({'message': 'display_name required'}), 400
    db['tank_meta'].update_one({'tank': tank_name}, {'$set': {'display_name': str(display_name)}}, upsert=True)
    return jsonify({'message': 'Tank display name updated', 'tank': tank_name, 'display_name': display_name})


@app.route('/api/dev-settings', methods=['GET'])
@token_required
@min_role_required('operator')
def get_dev_settings_route():
    settings = load_dev_settings()
    if settings.get('api_key'):
        settings['api_key'] = '*****'
        settings['api_key_set'] = True
    else:
        settings['api_key_set'] = False
    return jsonify(settings)


@app.route('/api/dev-settings', methods=['PUT'])
@token_required
@min_role_required('operator')
def put_dev_settings():
    data = request.json or {}
    errors = validate_dev_settings(data)
    if errors:
        return jsonify({'message': 'Validation failed', 'errors': errors}), 400
    saved = store_dev_settings(data)
    record_event(
        'developer_settings_update',
        'Developer settings updated',
        source='developer_panel',
        metadata={'changes': data}
    )
    response = { 'message': 'Developer settings updated', 'settings': saved }
    if saved.get('api_key'):
        response['settings']['api_key'] = '*****'
        response['settings']['api_key_set'] = True
    else:
        response['settings']['api_key_set'] = False
    return jsonify(response)


@app.route('/api/dev-settings/transmit', methods=['POST'])
@token_required
@min_role_required('operator')
def transmit_dev_data():
    payload = request.json or {}
    if not payload:
        payload = {
            'source': 'developer_panel',
            'message': 'Developer transmission test payload',
            'timestamp': datetime.datetime.now(datetime.UTC).isoformat() + 'Z'
        }

    settings = load_dev_settings()
    result = transmit_to_configured_destination(payload, settings)
    record_event(
        'developer_transmit_test',
        'Developer transmission test executed',
        source='developer_panel',
        metadata={'success': bool(result.get('success')), 'endpoint': result.get('endpoint'), 'payload': payload}
    )
    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 502


@app.route('/api/third-party/relay', methods=['POST'])
@token_or_api_key_required
@min_role_required('operator')
def third_party_relay():
    payload = request.json or {}
    if not payload:
        return jsonify({'message': 'Payload required'}), 400

    result = relay_payload_to_third_party(payload, source='third_party_relay_api')
    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 502


@app.route('/api/totalizer', methods=['GET'])
@token_required
@min_role_required('operator')
def get_totalizer_route():
    totalizer = get_totalizer_value()
    return jsonify({
        'value': totalizer['value'],
        'updated_at': totalizer['updated_at'].isoformat() if totalizer['updated_at'] else None
    })


@app.route('/api/totalizer/reset', methods=['POST'])
@token_required
@min_role_required('master')
def reset_totalizer_route():
    current = get_totalizer_value()
    set_totalizer_value(0.0)
    record_event(
        'totalizer_reset',
        'System totalizer reset by master',
        source='master_panel',
        metadata={'previous_value': current['value']}
    )
    return jsonify({
        'message': 'Totalizer reset successfully',
        'previous_value': current['value'],
        'value': 0.0
    })


@app.route('/api/events', methods=['GET'])
@token_required
def get_events():
    docs = event_collection.find().sort('timestamp', -1).limit(100)
    events = []
    for doc in docs:
        events.append({
            'id': str(doc.get('_id')),
            'type': doc.get('type'),
            'message': doc.get('message'),
            'source': doc.get('source'),
            'actor': doc.get('actor'),
            'role': doc.get('role'),
            'timestamp': doc.get('timestamp').isoformat() if doc.get('timestamp') else None,
            'metadata': doc.get('metadata', {})
        })
    return jsonify(events)


@app.route('/api/notice', methods=['GET'])
@token_required
@min_role_required('master')
def get_notice():
    doc = db['app_meta'].find_one({'key': 'notice'})
    if not doc:
        return jsonify({'active': False, 'message': ''})
    return jsonify({'active': bool(doc.get('active', False)), 'message': doc.get('message', '')})


@app.route('/api/notice', methods=['PUT'])
@token_required
@min_role_required('master')
def set_notice():
    data = request.json or {}
    active = data.get('active', False)
    message = data.get('message', '')
    if isinstance(active, str):
        active = active.lower() in ['true', '1', 'yes']
    db['app_meta'].update_one({'key': 'notice'}, {'$set': {'active': bool(active), 'message': str(message)}}, upsert=True)
    return jsonify({'message': 'Notice updated', 'active': bool(active), 'message_text': message})


@app.route('/api/users/<username>/role', methods=['PUT'])
@token_required
@min_role_required('master')
def update_user_role(username):
    data = request.json or {}
    new_role = str(data.get('role', '')).strip()
    if new_role == 'admin':
        new_role = 'master'
    if new_role not in ALLOWED_ROLES:
        return jsonify({'message': 'Invalid role specified'}), 400
    if not users_collection.find_one({'username': username}):
        return jsonify({'message': 'User not found'}), 404
    # viewers are always approved; other roles require approval
    approved_val = True if new_role == 'viewer' else False
    users_collection.update_one({'username': username}, {'$set': {'role': new_role, 'approved': approved_val}})
    return jsonify({'message': 'Role updated', 'approved': approved_val})


@app.route('/api/profile/2fa/setup', methods=['POST'])
@token_required
def setup_two_factor():
    user = users_collection.find_one({'username': g.user})
    if not user:
        return jsonify({'message': 'User not found'}), 404
    secret = user.get('two_factor_secret') or pyotp.random_base32()
    users_collection.update_one({'username': g.user}, {'$set': {'two_factor_secret': secret}})
    otp_uri = pyotp.TOTP(secret).provisioning_uri(g.user, issuer_name='Inventory Monitoring')
    return jsonify({'secret': secret, 'otp_auth_url': otp_uri, 'two_factor_enabled': bool(user.get('two_factor_enabled', False))})


@app.route('/api/profile/2fa/verify', methods=['POST'])
@token_required
def verify_two_factor():
    data = request.json or {}
    otp = str(data.get('otp', '')).strip()
    if not otp:
        return jsonify({'message': 'OTP code required'}), 400
    user = users_collection.find_one({'username': g.user})
    if not user:
        return jsonify({'message': 'User not found'}), 404
    secret = user.get('two_factor_secret')
    if not secret:
        return jsonify({'message': '2FA is not configured'}), 400
    totp = pyotp.TOTP(secret)
    if not totp.verify(otp, valid_window=1):
        return jsonify({'message': 'Invalid 2FA code'}), 401
    users_collection.update_one({'username': g.user}, {'$set': {'two_factor_enabled': True}})
    return jsonify({'message': '2FA enabled'})


@app.route('/api/profile/2fa/disable', methods=['POST'])
@token_required
def disable_two_factor():
    users_collection.update_one({'username': g.user}, {'$set': {'two_factor_enabled': False}, '$unset': {'two_factor_secret': ''}})
    return jsonify({'message': '2FA disabled'})


@app.route('/api/tanks/<tank_name>/export', methods=['GET'])
@token_required
def export_tank_xml(tank_name):
    limit = int(request.args.get('limit', 20))
    cutoff = datetime.datetime.now(datetime.UTC).replace(tzinfo=None) - datetime.timedelta(days=3)
    docs = tank_collection.find({'tank': tank_name, 'timestamp': {'$gte': cutoff}}).sort('timestamp', -1).limit(limit)
    root = ET.Element('TankHistory', name=tank_name)
    for d in docs:
        reading = ET.SubElement(root, 'Reading')
        ET.SubElement(reading, 'Timestamp').text = str(d.get('timestamp', ''))
        ET.SubElement(reading, 'Level').text = str(d.get('level', ''))
        ET.SubElement(reading, 'Temperature').text = str(d.get('temperature', ''))
        ET.SubElement(reading, 'Pressure').text = str(d.get('pressure', ''))
        ET.SubElement(reading, 'Volume').text = str(d.get('volume', ''))
    xml = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    return Response(xml, mimetype='application/xml')


@app.route('/openapi.json')
def openapi():
    host = request.host
    spec = {
        'openapi': '3.0.0',
        'info': {
            'title': 'Inventory Monitoring API',
            'version': '1.0.0'
        },
        'servers': [{'url': f'http://{host}'}],
        'paths': {
            '/register': {
                'post': {
                    'summary': 'Create user',
                    'requestBody': {'content': {'application/json': {'schema': {'type': 'object'}}}},
                    'responses': {'201': {'description': 'Created'}}
                }
            },
            '/login': {
                'post': {
                    'summary': 'Authenticate',
                    'responses': {'200': {'description': 'OK'}}
                }
            },
            '/api/tanks': {
                'get': {'summary': 'List tanks'},
                'post': {'summary': 'Create tank'}
            },
            '/api/tanks/{id}': {
                'get': {'summary': 'Get tank'},
                'put': {'summary': 'Update tank'},
                'delete': {'summary': 'Delete tank'}
            },
            '/api/third-party/relay': {
                'post': {'summary': 'Relay signal to third-party endpoint'}
            },
            '/api/users/{username}/token': {
                'post': {'summary': 'Generate user API token'},
                'delete': {'summary': 'Revoke user API token'}
            },
            '/api/dev-settings': {
                'get': {'summary': 'Read transmission and relay settings'},
                'put': {'summary': 'Update transmission and relay settings'}
            }
        }
    }
    return jsonify(spec)


@app.route('/docs')
def docs():
    return render_template('docs.html')


@app.route('/api/server-info', methods=['GET'])
def server_info():
    return jsonify({
        'status': 'ok',
        'environment': ENVIRONMENT,
        'api_root': request.url_root.rstrip('/'),
        'allowed_origins': ALLOWED_ORIGINS
    }), 200


@app.route('/api/tanks', methods=['POST'])
@token_or_api_key_required
@min_role_required('operator')
def create_tank():
    data = normalize_tank_payload(request.json or {})
    # expected fields: tank, level, timestamp (optional)
    tank_name = data.get('tank')
    if not tank_name or 'level' not in data:
        return jsonify({'message': 'tank and level required'}), 400

    device_id = str(data.get('device_id', '')).strip() or None
    level_value = data['level']
    temperature_value = data.get('temperature')
    pressure_value = data.get('pressure')
    volume_value = data.get('volume')
    timestamp_value = data.get('timestamp') or datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

    alarm_state = False
    alarm_reason = None
    try:
        if temperature_value is not None and float(temperature_value) > 80:
            alarm_state = True
            alarm_reason = 'High temperature threshold exceeded'
        if level_value is not None and (float(level_value) < 15 or float(level_value) > 95):
            alarm_state = True
            alarm_reason = 'Fill level outside safe range'
    except (TypeError, ValueError):
        pass

    doc = {
        'tank': tank_name,
        'device_id': device_id,
        'level': level_value,
        'temperature': temperature_value,
        'pressure': pressure_value,
        'volume': volume_value,
        'timestamp': timestamp_value,
        'alarm': alarm_state,
        'alarm_reason': alarm_reason
    }

    res = tank_collection.insert_one(doc)
    relay_result = relay_payload_to_third_party(doc)

    response = {
        'id': str(res.inserted_id),
        'alarm': alarm_state,
        'alarm_reason': alarm_reason,
        'relay_success': bool(relay_result.get('success')),
        'relay_message': relay_result.get('message')
    }
    if relay_result.get('endpoint'):
        response['relay_endpoint'] = relay_result.get('endpoint')

    return jsonify(response), 201


@app.route('/api/tanks/<id>', methods=['GET'])
@token_required
def get_tank(id):
    try:
        oid = ObjectId(id)
    except InvalidId:
        return jsonify({'message': 'Invalid id'}), 400

    doc = tank_collection.find_one({'_id': oid})
    if not doc:
        return jsonify({'message': 'Not found'}), 404

    doc['id'] = str(doc.pop('_id'))
    return jsonify(doc)


@app.route('/api/tanks/<id>', methods=['PUT'])
@token_required
@min_role_required('operator')
def update_tank(id):
    try:
        oid = ObjectId(id)
    except InvalidId:
        return jsonify({'message': 'Invalid id'}), 400

    data = normalize_tank_payload(request.json or {})
    update_fields = {}
    if 'tank' in data:
        update_fields['tank'] = data['tank']
    for k in ('level', 'temperature', 'pressure', 'volume', 'timestamp'):
        if k in data:
            update_fields[k] = data[k]

    if not update_fields:
        return jsonify({'message': 'No fields to update'}), 400

    res = tank_collection.update_one({'_id': oid}, {'$set': update_fields})
    if res.matched_count == 0:
        return jsonify({'message': 'Not found'}), 404

    return jsonify({'message': 'Updated'})


@app.route('/api/tanks/<id>', methods=['DELETE'])
@token_required
@min_role_required('operator')
def delete_tank(id):
    try:
        oid = ObjectId(id)
    except InvalidId:
        return jsonify({'message': 'Invalid id'}), 400

    res = tank_collection.delete_one({'_id': oid})
    if res.deleted_count == 0:
        return jsonify({'message': 'Not found'}), 404

    return jsonify({'message': 'Deleted'})

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'environment': ENVIRONMENT}), 200


if __name__ == '__main__':
    debug_mode = os.environ.get('FLASK_DEBUG', '1').lower() in ('1', 'true', 'yes')
    app.run(host='0.0.0.0', debug=debug_mode)
