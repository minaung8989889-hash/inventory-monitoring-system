#!/bin/bash
set -euo pipefail

# Usage:
#   bash ubuntu-deploy.sh <your-domain> <github-repo-url>
# Example:
#   bash ubuntu-deploy.sh example.com https://github.com/username/inventory_monitoring_project.git

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <your-domain> <github-repo-url>"
  exit 1
fi

DOMAIN="$1"
REPO_URL="$2"
PROJECT_DIR="/opt/inventory_monitoring_project"

echo "Installing system dependencies..."
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release software-properties-common

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io
  sudo systemctl enable docker
fi

if ! command -v docker-compose >/dev/null 2>&1; then
  echo "Installing Docker Compose..."
  DOCKER_COMPOSE_VERSION="v2.24.1"
  sudo curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "Installing nginx..."
  sudo apt install -y nginx
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "Installing Certbot..."
  sudo apt install -y certbot python3-certbot-nginx
fi

echo "Cloning or updating project repository..."
if [ ! -d "$PROJECT_DIR" ]; then
  sudo git clone "$REPO_URL" "$PROJECT_DIR"
  sudo chown -R "$USER":"$USER" "$PROJECT_DIR"
else
  cd "$PROJECT_DIR"
  git pull origin main || true
fi

cd "$PROJECT_DIR"

echo "Creating backend .env for production..."
if [ ! -f backend/.env ]; then
  cat > backend/.env <<'EOF'
MONGO_URI=mongodb://mongo:27017/
DATABASE_NAME=IIOT_SCADA
SECRET_KEY=ReplaceWithAStrongSecretValue
ADMIN_SECRET=ReplaceWithAdminSecretValue
API_KEY=ReplaceWithSecureDeveloperApiKey
ALLOWED_ORIGINS=https://$DOMAIN
MAX_LOGIN_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
ENVIRONMENT=production
FORCE_HTTPS=true
EOF
  echo "backend/.env created. Edit values before use."
fi

echo "Starting Docker Compose services..."
sudo docker compose up -d --build

echo "Writing nginx site configuration..."
NGINX_CONF="/etc/nginx/sites-available/inventory_monitoring_project"
sudo tee "$NGINX_CONF" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/inventory_monitoring_project
sudo nginx -t
sudo systemctl reload nginx

echo "Requesting TLS certificate from Let's Encrypt..."
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --email admin@$DOMAIN

echo "Deployment completed."
echo "Open https://$DOMAIN to view the application."
