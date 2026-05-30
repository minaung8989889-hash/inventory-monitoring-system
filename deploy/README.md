# Deployment Guide

This directory contains helper code for deploying the inventory monitoring project to an Ubuntu server.

## Files

- `ubuntu-deploy.sh` - automated deployment script for Ubuntu servers.
- `nginx-site.conf` - example nginx reverse proxy configuration.

## Recommended deployment flow

1. Create an Ubuntu server and point your domain DNS to the server's public IP.
2. Upload or clone this repository onto the server.
3. Run:
   ```bash
   bash deploy/ubuntu-deploy.sh yourdomain.com https://github.com/username/inventory_monitoring_project.git
   ```
4. Edit `backend/.env` after the script creates it.
   - Set secure values for `SECRET_KEY`, `ADMIN_SECRET`, and `API_KEY`.
   - Confirm `ALLOWED_ORIGINS=https://yourdomain.com`.
5. Ensure nginx is running and certificate issuance completed.

## Notes

- The script installs Docker, Docker Compose, nginx, and Certbot.
- It uses Docker Compose to build and start the backend and MongoDB containers.
- It configures nginx to proxy traffic to `http://127.0.0.1:5000`.
- It obtains an HTTPS certificate from Let's Encrypt automatically.

## If you want a managed host instead

Use Render, Fly.io, or Railway and configure the backend service with the same `.env` settings.
