import os
import datetime
import pytest

os.environ.setdefault('ADMIN_SECRET', 'test-secret')

try:
    from backend.app import app, users_collection, tank_collection
    from backend.config import DATABASE_NAME
except ImportError:
    from app import app, users_collection, tank_collection
    from config import DATABASE_NAME


@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


def test_register_login_and_crud(client):
    username = 'test_user_api'
    password = 'password123'
    master_username = 'test_master_api'
    master_email = 'master@example.com'
    user_email = 'test_user_api@example.com'

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'username': master_username})
    users_collection.delete_many({'email': master_email})
    users_collection.delete_many({'email': user_email})

    # bootstrap a master account using the ADMIN_SECRET header
    rv = client.post('/register', json={
        'username': master_username,
        'email': master_email,
        'password': password,
        'role': 'master'
    }, headers={'X-Admin-Secret': 'test-secret'})
    assert rv.status_code == 201

    rv = client.post('/login', json={'username': master_username, 'password': password})
    assert rv.status_code == 200
    master_access = rv.json.get('access_token')
    assert master_access
    master_headers = {'Authorization': f'Bearer {master_access}'}

    # register a regular user and confirm that approval is required
    rv = client.post('/register', json={
        'username': username,
        'email': user_email,
        'password': password,
        'role': 'operator'
    })
    assert rv.status_code == 201
    assert rv.json.get('approved') is False

    rv = client.post('/login', json={'username': username, 'password': password})
    assert rv.status_code == 403

    rv = client.put(f'/api/users/{username}/approve', json={'approved': True}, headers=master_headers)
    assert rv.status_code == 200

    rv = client.post('/login', json={'username': username, 'password': password})
    assert rv.status_code == 200
    access = rv.json.get('access_token')
    refresh = rv.json.get('refresh_token')
    assert access and refresh

    headers = {'Authorization': f'Bearer {access}'}

    # create a tank reading
    rv = client.post('/api/tanks', json={'tank': 'TestTank', 'level': 42}, headers=headers)
    assert rv.status_code == 201
    tid = rv.json.get('id')
    assert tid

    # get by id
    rv = client.get(f'/api/tanks/{tid}', headers=headers)
    assert rv.status_code == 200
    assert rv.json['tank'] == 'TestTank'

    # update
    rv = client.put(f'/api/tanks/{tid}', json={'level': 55}, headers=headers)
    assert rv.status_code == 200

    rv = client.get(f'/api/tanks/{tid}', headers=headers)
    assert rv.status_code == 200
    assert rv.json['level'] == 55

    # delete
    rv = client.delete(f'/api/tanks/{tid}', headers=headers)
    assert rv.status_code == 200

    rv = client.get(f'/api/tanks/{tid}', headers=headers)
    assert rv.status_code == 404

    # cleanup accounts
    users_collection.delete_many({'username': username})
    users_collection.delete_many({'username': master_username})
    users_collection.delete_many({'email': master_email})
    users_collection.delete_many({'email': user_email})


def test_api_token_generation_and_third_party_relay(client):
    username = 'relay_user'
    email = 'relay_user@example.com'
    password = 'relay-pass-123'
    master_username = 'relay_master'
    master_email = 'relay_master@example.com'

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'username': master_username})
    users_collection.delete_many({'email': email})
    users_collection.delete_many({'email': master_email})

    rv = client.post('/register', json={
        'username': master_username,
        'email': master_email,
        'password': password,
        'role': 'master'
    }, headers={'X-Admin-Secret': 'test-secret'})
    assert rv.status_code == 201

    rv = client.post('/login', json={'username': master_username, 'password': password})
    assert rv.status_code == 200
    master_access = rv.json.get('access_token')
    assert master_access
    master_headers = {'Authorization': f'Bearer {master_access}'}

    rv = client.post('/register', json={
        'username': username,
        'email': email,
        'password': password,
        'role': 'operator'
    })
    assert rv.status_code == 201

    rv = client.put(f'/api/users/{username}/approve', json={'approved': True}, headers=master_headers)
    assert rv.status_code == 200

    rv = client.post(f'/api/users/{username}/token', json={'expires_in_hours': 24}, headers=master_headers)
    assert rv.status_code == 200
    api_token = rv.json.get('token')
    assert api_token
    assert 'expires_at' in rv.json

    token_headers = {'x-api-token': api_token}
    rv = client.post('/api/tanks', json={'tank': 'RelayTank', 'level': 35}, headers=token_headers)
    assert rv.status_code == 201
    assert rv.json.get('id')

    rv = client.post('/api/third-party/relay', json={'message': 'signal test'}, headers=token_headers)
    assert rv.status_code == 502
    assert 'No transmission endpoint configured' in rv.json.get('message', '')

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'username': master_username})
    users_collection.delete_many({'email': email})
    users_collection.delete_many({'email': master_email})


def test_forgot_password(client):
    username = 'forgot_user'
    email = 'forgot_user@example.com'
    password = 'initialpass1'
    new_password = 'newsecurepass1'

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'email': email})

    rv = client.post('/register', json={'username': username, 'email': email, 'password': password, 'role': 'viewer'})
    assert rv.status_code == 201

    rv = client.post('/forgot-password', json={
        'username': username,
        'email': email,
        'password': new_password,
        'confirm_password': new_password
    })
    assert rv.status_code == 200
    assert 'Password reset successfully' in rv.json.get('message', '')

    rv = client.post('/login', json={'username': username, 'password': new_password})
    assert rv.status_code == 200
    assert rv.json.get('access_token')

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'email': email})


def test_two_factor_setup_and_verify(client):
    username = 'twofactor_user'
    email = 'twofactor_user@example.com'
    password = '2fa-pass-123'

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'email': email})

    rv = client.post('/register', json={'username': username, 'email': email, 'password': password, 'role': 'viewer'})
    assert rv.status_code == 201

    rv = client.post('/login', json={'username': username, 'password': password})
    assert rv.status_code == 200
    access = rv.json.get('access_token')
    assert access

    rv = client.post('/api/profile/2fa/setup', headers={'Authorization': f'Bearer {access}'})
    assert rv.status_code == 200
    secret = rv.json.get('secret')
    assert secret
    # ensure provisioning URL is returned for QR generation
    otp_auth_url = rv.json.get('otp_auth_url')
    assert otp_auth_url and otp_auth_url.startswith('otpauth://')

    import pyotp
    otp = pyotp.TOTP(secret).now()

    rv = client.post('/api/profile/2fa/verify', json={'otp': otp}, headers={'Authorization': f'Bearer {access}'})
    assert rv.status_code == 200
    assert '2FA enabled' in rv.json.get('message', '')

    profile = client.get('/api/profile', headers={'Authorization': f'Bearer {access}'})
    assert profile.status_code == 200
    assert profile.json.get('two_factor_enabled') is True

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'email': email})


def test_export_tank_xml(client):
    username = 'export_user'
    email = 'export_user@example.com'
    password = 'export-pass-123'

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'email': email})

    rv = client.post('/register', json={'username': username, 'email': email, 'password': password, 'role': 'viewer'})
    assert rv.status_code == 201

    rv = client.post('/login', json={'username': username, 'password': password})
    assert rv.status_code == 200
    access = rv.json.get('access_token')
    assert access
    headers = {'Authorization': f'Bearer {access}'}

    tank_collection.insert_one({
        'tank': 'ExportTank',
        'level': 21,
        'temperature': 22.5,
        'pressure': 1.1,
        'volume': 480,
        'timestamp': datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
    })

    rv = client.get('/api/tanks/ExportTank/export', headers=headers)
    assert rv.status_code == 200
    assert rv.headers.get('Content-Type', '').startswith('application/xml')
    assert '<TankHistory' in rv.data.decode('utf-8')

    users_collection.delete_many({'username': username})
    users_collection.delete_many({'email': email})


def test_refresh_and_logout(client):
    username = 'test_refresh_user'
    email = 'refresh_user@example.com'
    password = 'refresh-pass-123'
    users_collection.delete_many({'username': username})
    users_collection.delete_many({'email': email})

    rv = client.post('/register', json={'username': username, 'email': email, 'password': password, 'role': 'viewer'})
    assert rv.status_code == 201

    rv = client.post('/login', json={'username': username, 'password': password})
    assert rv.status_code == 200
    access = rv.json.get('access_token')
    refresh = rv.json.get('refresh_token')
    assert access and refresh

    # use refresh to get new access
    rv = client.post('/token/refresh', json={'refresh_token': refresh})
    assert rv.status_code == 200
    new_access = rv.json.get('access_token')
    new_refresh = rv.json.get('refresh_token')
    assert new_access and new_refresh and new_refresh != refresh

    # old refresh should be invalid after rotation
    rv = client.post('/token/refresh', json={'refresh_token': refresh})
    assert rv.status_code == 401

    # logout with new refresh
    rv = client.post('/logout', json={'refresh_token': new_refresh})
    assert rv.status_code == 200

    # further refresh attempts fail
    rv = client.post('/token/refresh', json={'refresh_token': new_refresh})
    assert rv.status_code == 401

    users_collection.delete_many({'username': username})


def test_master_can_reset_totalizer(client):
    master_username = 'reset_master'
    master_email = 'reset_master@example.com'
    password = 'reset-pass-123'

    users_collection.delete_many({'username': master_username})
    users_collection.delete_many({'email': master_email})

    rv = client.post('/register', json={
        'username': master_username,
        'email': master_email,
        'password': password,
        'role': 'master'
    }, headers={'X-Admin-Secret': 'test-secret'})
    assert rv.status_code == 201

    rv = client.post('/login', json={'username': master_username, 'password': password})
    assert rv.status_code == 200

    access = rv.json.get('access_token')
    assert access
    headers = {'Authorization': f'Bearer {access}'}

    rv = client.post('/api/totalizer/reset', headers=headers)
    assert rv.status_code == 200
    assert rv.json.get('value') == 0.0

    users_collection.delete_many({'username': master_username})
    users_collection.delete_many({'email': master_email})
