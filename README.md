# Industrial Inventory Monitoring System

## Features
- 10 Tank Monitoring
- Modbus Simulation
- Node-RED Integration
- MongoDB Database
- Flask API
- Token Authentication
- Real-time Dashboard

## Run

### Install packages
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt

### Start local MongoDB
The project uses `D:\HMA\IIOT\inventory_monitoring_project\data\db` as the local MongoDB data path when started from the repo root.

If you start MongoDB manually, use:

```powershell
mongod --dbpath D:\HMA\IIOT\inventory_monitoring_project\data\db
```

### Start Flask backend
cd backend
python app.py

### Open browser
http://127.0.0.1:5000

### Master account and registration
- Create a `.env` file in the `backend` folder with:

```powershell
SECRET_KEY=your_secret_key_here
ADMIN_SECRET=your_master_creation_secret
MONGO_URI=mongodb://localhost:27017/
DATABASE_NAME=IIOT_SCADA
```

- The first master account must be created with the `X-Admin-Secret` header on `/register`.
- Viewer accounts are approved immediately and can sign in right away.
- Auditor/operator/master registrations still require approval by a master user.

Example curl to create the master account:

```powershell
curl -X POST http://127.0.0.1:5000/register \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: your_master_creation_secret" \
  -d '{"username":"master","email":"master@example.com","password":"StrongPass123","role":"master"}'
```

### Run tests
From the repo root, run:

```powershell
python -m pytest backend/tests -q
```

### Build web packages (user / developer)
You can produce two static web packages: `user` (v1) and `developer` (v3). Run from the repo root:

```powershell
# User build (v1)
.\scripts\build-web.ps1 -Profile user

# Developer build (v3)
.\scripts\build-web.ps1 -Profile developer
```

Each build is output under `build\<profile>-v<version>` and includes a `static/js/version.json` file the frontend reads.

### Start everything locally (recommended)
From the repo root, run:

```powershell
.\start-local.ps1
```

This script launches MongoDB (if `mongod` is available), the Flask backend, and Node-RED.

### One-PC public/internal demo
If you want to show a customer and run both LAN and public access from the same PC,
use `scripts\start-demo.ps1` and configure both local and public origins in `ALLOWED_ORIGINS`.

From the repo root, run:

```powershell
.\scripts\start-demo.ps1 -Profile local
```

For a public/internal demo on one machine:

```powershell
.\scripts\start-demo.ps1 -Profile remote -MongoUri 'mongodb://localhost:27017/' -AllowedOrigins 'http://localhost:5000,http://192.168.1.10:5000,https://your-public-domain.com' -Environment production -ForceHttps -NonInteractive
```

### Public/Internal router guide
1. Assign a fixed LAN IP to your PC, for example `192.168.1.10`.
2. Set `ALLOWED_ORIGINS` to include your local host, LAN host, and public domain.
3. Forward router ports to the PC:
   - `80 -> 192.168.1.10:5000`
   - `443 -> 192.168.1.10:5000`
4. Use HTTPS for public access and keep MongoDB private on localhost.
5. Do not expose MongoDB directly to the internet.

If you want Node-RED only on LAN, do not forward `1881`; keep it local.

### Node-RED flow import
1. Open Node-RED at `http://127.0.0.1:1881`.
2. Open the menu, select `Import`, and paste the JSON from `node_red/sample_http_relay_flow.json`.
3. Replace `YOUR_API_KEY_HERE` with the value from `backend/.env`.
4. Deploy the flow.

### Optional: Node-RED
Start Node-RED in the `node_red` directory:

```bash
dd ..\node_red && npx node-red --userDir . -p 1881
```

Then open:

http://127.0.0.1:1881

A sample HTTP relay flow is available for import at `node_red/sample_http_relay_flow.json`.
See `node_red/README.md` for Node-RED startup and flow import instructions.

### Switch backend environment
Use the helper script to create or update `backend/.env` for local, remote, or ngrok profiles.
From the repo root, run:

```powershell
.\scripts\switch-env.ps1 -Profile local
.\scripts\switch-env.ps1 -Profile remote -MongoUri 'mongodb://db.example.com:27017/' -AllowedOrigins 'https://app.example.com' -Environment production -ForceHttps
.\scripts\switch-env.ps1 -Profile ngrok -UseNgrok
```
