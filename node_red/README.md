# Node-RED for Inventory Monitoring

This folder contains the Node-RED runtime, sample flows, and configuration for the inventory monitoring demo.

## Start Node-RED
From the repository root:

```powershell
cd node_red
npx node-red --userDir . -p 1881
```

Then open:

http://127.0.0.1:1881

## Import the sample relay flow
1. Open the Node-RED menu in the top right.
2. Click `Import` > `Clipboard`.
3. Open `node_red/sample_http_relay_flow.json` in a text editor.
4. Copy the JSON content and paste it into the import area.
5. Replace `YOUR_API_KEY_HERE` with the `API_KEY` value from `backend/.env`.
6. Click `Import` and then `Deploy`.

## What the flow does
- Simulates an HTTP data payload from a remote device.
- Sends the payload to the backend's tank API.
- Relays the response to the Node-RED debug panel.

## Notes for one-PC demos
- Keep Node-RED local if you only need internal demo traffic.
- Do not forward port `1881` publicly unless you explicitly want Node-RED web access.
- The backend API should be the only service exposed to the router when running a public/internal demo.
