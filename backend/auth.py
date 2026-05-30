import os
import sys
import jwt
import datetime
import hashlib
from functools import wraps
from typing import Optional
from urllib.parse import urlparse
from flask import request, jsonify, g
from pymongo import MongoClient
import secrets

# Ensure repo root is on sys.path for package imports
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.config import SECRET_KEY, MONGO_URI, DATABASE_NAME, API_KEY

client = MongoClient(MONGO_URI)
db = client[DATABASE_NAME]
users_collection = db['users']

ROLE_LEVELS = {
    'viewer': 1,
    'auditor': 2,
    'operator': 3,
    'master': 4,
    'administrator': 5
}


def get_role_level(role_name: str | None):
    if not role_name:
        return 0
    return ROLE_LEVELS.get(role_name, 0)


def generate_token(username, role: str = 'operator', hours_valid: int = 1, token_type: str = 'access', jti: str | None = None):
    now = datetime.datetime.now(datetime.UTC)
    payload = {
        'username': username,
        'role': role,
        'type': token_type,
        'iat': now,
        'exp': now + datetime.timedelta(hours=hours_valid)
    }
    if jti:
        payload['jti'] = jti

    token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')
    # PyJWT returns bytes on some versions; ensure string
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token


def hash_api_token(token: str):
    if not token:
        return None
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def find_user_by_api_token(token: Optional[str]):
    if not token:
        return None
    token_hash = hash_api_token(token)
    if not token_hash:
        return None
    user = users_collection.find_one({'api_token_hash': token_hash})
    if not user:
        return None
    if user.get('disabled', False):
        return None

    expires_at = user.get('api_token_expires_at')
    if isinstance(expires_at, datetime.datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
        if expires_at < datetime.datetime.now(datetime.timezone.utc):
            return None

    if user.get('role') != 'viewer' and not user.get('approved', False):
        return None
    return user


def api_key_valid(key: str | None):
    if not key or not API_KEY:
        return False
    return secrets.compare_digest(str(key).strip(), str(API_KEY).strip())


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None

        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ', 1)[1].strip()
        elif request.path == '/api/tanks/live':
            token = request.args.get('access_token', None)

        if not token:
            return jsonify({'message': 'Token missing'}), 401

        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            if payload.get('type') != 'access':
                return jsonify({'message': 'Invalid token type'}), 401

            username = payload.get('username')
            user = users_collection.find_one({'username': username})
            if not user:
                return jsonify({'message': 'Invalid token'}), 401
            if user.get('disabled', False):
                return jsonify({'message': 'Account disabled'}), 403
            if user.get('role') != 'viewer' and not user.get('approved', False):
                return jsonify({'message': 'Account pending approval by master'}), 403

            g.user = username
            g.role = user.get('role', 'viewer')
            g.role_level = get_role_level(g.role)
            users_collection.update_one({'username': username}, {'$set': {'last_seen': utc_now()}})
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401

        return f(*args, **kwargs)

    return decorated


def token_or_api_key_required(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        api_key = request.headers.get('x-api-key') or request.args.get('api_key') or request.args.get('apiKey')
        user_token = request.headers.get('x-api-token') or request.args.get('api_token') or request.args.get('apiToken')

        if api_key_valid(api_key):
            g.user = 'api_key_client'
            g.role = 'operator'
            g.role_level = get_role_level('operator')
            return f(*args, **kwargs)

        user = find_user_by_api_token(user_token)
        if user:
            g.user = user['username']
            g.role = user.get('role', 'viewer')
            g.role_level = get_role_level(g.role)
            g.user_token_auth = True
            return f(*args, **kwargs)

        return token_required(f)(*args, **kwargs)

    return wrapped


def role_required(role_name: str):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            # Ensure token_required ran and set g.role
            user_role = getattr(g, 'role', None)
            if user_role != role_name and user_role != 'master':
                return jsonify({'message': 'Forbidden'}), 403
            return f(*args, **kwargs)

        return wrapped

    return decorator


def min_role_required(min_role_name: str):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            if getattr(g, 'role_level', 0) < get_role_level(min_role_name):
                return jsonify({'message': 'Forbidden'}), 403
            return f(*args, **kwargs)

        return wrapped

    return decorator
