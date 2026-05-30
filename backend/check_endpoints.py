import urllib.request
import urllib.error
import json
import time

BASE = 'http://127.0.0.1:5000'

def req(method, path, data=None, headers=None):
    url = BASE + path
    data_bytes = None
    if data is not None:
        data_bytes = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=data_bytes, method=method)
    req.add_header('Content-Type', 'application/json')
    if headers:
        for k,v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode('utf-8')
            status = resp.getcode()
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = body
            return status, parsed
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = body
        return e.code, parsed
    except Exception as e:
        return None, str(e)

if __name__ == '__main__':
    print('Waiting 1s for server...')
    time.sleep(1)

    # check home
    s, b = req('GET', '/')
    print('GET / ->', s)

    # get tanks without auth
    s, b = req('GET', '/api/tanks')
    print('GET /api/tanks without auth ->', s, b)

    # register
    username = 'cli_test_user'
    password = 'cli-pass-123'
    email = 'cli_test_user@example.com'
    s, b = req('POST', '/register', data={'username': username, 'email': email, 'password': password, 'role': 'viewer'})
    print('POST /register ->', s, b)

    # login (will require approval before login if master user exists)
    s, b = req('POST', '/login', data={'username': username, 'password': password})
    print('POST /login ->', s, b)
    token = None
    if isinstance(b, dict):
        token = b.get('token')

    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    # create tank
    s, b = req('POST', '/api/tanks', data={'tank': 'CLI Tank', 'level': 77}, headers=headers)
    print('POST /api/tanks ->', s, b)
    tid = None
    if isinstance(b, dict):
        tid = b.get('id')

    # get tanks list
    s, b = req('GET', '/api/tanks', headers=headers)
    print('GET /api/tanks ->', s, b)

    if tid:
        s, b = req('GET', f'/api/tanks/{tid}', headers=headers)
        print(f'GET /api/tanks/{tid} ->', s, b)

        s, b = req('PUT', f'/api/tanks/{tid}', data={'level': 88}, headers=headers)
        print(f'PUT /api/tanks/{tid} ->', s, b)

        s, b = req('GET', f'/api/tanks/{tid}', headers=headers)
        print(f'GET /api/tanks/{tid} after update ->', s, b)

        s, b = req('DELETE', f'/api/tanks/{tid}', headers=headers)
        print(f'DELETE /api/tanks/{tid} ->', s, b)

    print('Checks complete')
