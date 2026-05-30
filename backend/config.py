import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/')
DATABASE_NAME = os.environ.get('DATABASE_NAME', 'IIOT_SCADA')
# Use a longer secret in production. Local default is only for development.
SECRET_KEY = os.environ.get('SECRET_KEY', 'Online_Monitoring_System_Key_007')
ADMIN_SECRET = os.environ.get('ADMIN_SECRET', os.environ.get('ADMIN_SECRET_VAULT007', ''))
API_KEY = os.environ.get('API_KEY', '')
MAX_LOGIN_ATTEMPTS = int(os.environ.get('MAX_LOGIN_ATTEMPTS', '5'))
LOGIN_LOCKOUT_MINUTES = int(os.environ.get('LOGIN_LOCKOUT_MINUTES', '15'))
API_TOKEN_EXPIRATION_HOURS = int(os.environ.get('API_TOKEN_EXPIRATION_HOURS', '72'))
ALLOWED_ORIGINS = [origin.strip() for origin in os.environ.get('ALLOWED_ORIGINS', 'http://localhost:5000').split(',') if origin.strip()]
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'development').strip().lower()
FORCE_HTTPS = os.environ.get('FORCE_HTTPS', 'true').strip().lower() in ('1', 'true', 'yes')
# Application versioning and build profile
# Use APP_VERSION and BUILD_PROFILE env vars to control releases/builds.
APP_VERSION = os.environ.get('APP_VERSION', '1.0.0')
# BUILD_PROFILE: 'user' for v1 user builds, 'developer' for v3 developer builds
BUILD_PROFILE = os.environ.get('BUILD_PROFILE', 'user').strip().lower()
