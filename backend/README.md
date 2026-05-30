# Backend for Inventory Monitoring

This Flask backend provides authentication and CRUD APIs for tank data.

Quick start (local):

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `backend/` with:

```text
MONGO_URI=mongodb://localhost:27017/
DATABASE_NAME=IIOT_SCADA
SECRET_KEY=your_secret_key_here
ADMIN_SECRET=your_admin_secret_here
```

Start the local MongoDB server first, then run:

```bash
set FLASK_APP=app.py
set FLASK_ENV=development
python app.py
```

Or use the bundled startup script from the repo root:

```powershell
.\start-local.ps1
```

### One-click demo startup
From the repo root, use the demo script to generate `backend/.env` and launch the backend + Node-RED:

```powershell
.\scripts\start-demo.ps1 -Profile local
```

For the same PC hosting both LAN and public demo access:

```powershell
.\scripts\start-demo.ps1 -Profile remote -MongoUri 'mongodb://localhost:27017/' -AllowedOrigins 'http://localhost:5000,http://192.168.1.10:5000,https://your-public-domain.com' -Environment production -ForceHttps -NonInteractive
```

### Public/Internal router guide
- Assign a fixed local IP to the PC, for example `192.168.1.10`.
- Forward router ports:
  - `80 -> 192.168.1.10:5000`
  - `443 -> 192.168.1.10:5000`
- Keep MongoDB listening on `localhost` only.
- Only expose the Flask backend publicly, not the MongoDB port.
- If Node-RED is only for internal use, do not forward its port `1881`.

### Node-RED import instructions
A sample flow is available at `node_red/sample_http_relay_flow.json`.
To import it in Node-RED:
1. Open `http://127.0.0.1:1881`.
2. Select the menu > `Import` > `Clipboard`.
3. Paste the JSON from `node_red/sample_http_relay_flow.json`.
4. Replace `YOUR_API_KEY_HERE` with your `API_KEY` from `backend/.env`.
5. Deploy the flow and verify the backend response in the debug panel.

### Build a packaged static web build
From the repo root you can create packaged web builds (user/developer):

```powershell
.\scripts\build-web.ps1 -Profile user
.\scripts\build-web.ps1 -Profile developer
```

The builds are placed under `build\` and include a `static/js/version.json` file that the frontend will display.

### Switch backend environment profiles
Create or update `backend/.env` from the repo root using `scripts\switch-env.ps1`.
Examples:

```powershell
.\scripts\switch-env.ps1 -Profile local
.\scripts\switch-env.ps1 -Profile remote -MongoUri 'mongodb://db.example.com:27017/' -AllowedOrigins 'https://app.example.com' -Environment production -ForceHttps
.\scripts\switch-env.ps1 -Profile ngrok -UseNgrok
```

Seed sample data:

```bash
python seed_data.py
```

Run tests:

```bash
pytest -q
```

Docker:

```bash
docker build -t inventory-backend:latest .
docker run -p 5000:5000 --env MONGO_URI="mongodb://host.docker.internal:27017/" inventory-backend:latest
```

A sample Node-RED relay flow is available at `node_red/sample_http_relay_flow.json`.
See `node_red/README.md` for Node-RED startup and flow import instructions.

With Docker Compose (recommended for local development):

```bash
docker compose up --build
```

API docs are available at `/docs` when the backend is running.

Live monitoring is available from the dashboard at `/`.

Public monitoring endpoints:
- `GET /api/tanks` — latest reading for each tank
- `GET /api/tanks/history/<tank_name>` — recent history for a specific tank
- `GET /api/tanks/live` — Server-Sent Events live feed for new tank readings
