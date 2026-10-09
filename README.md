# WILDBOUND: POOL WARS — Multiplayer Prototype 0.2

This is a real, small client/server multiplayer prototype. Each browser connects to one Node.js server over WebSocket. The server is authoritative for player positions, gathering, resource inventory, pool deposits, reward selection, damage, monsters, deaths, and respawns.

## Requirements
- Node.js 18+ recommended
- Internet/LAN connection for multiple devices
- A modern browser

## Run on one computer
1. Extract the ZIP.
2. Open a terminal in the extracted `WILDBOUND_POOL_WARS` folder.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:8080` in your browser.
6. Open a second browser tab and join with another player name to test multiplayer.

## Connect phones/other computers on the same Wi-Fi
1. Start the server on your computer with `npm start`.
2. Find your computer's local IPv4 address (Windows: run `ipconfig`; look for IPv4 Address, e.g. `192.168.1.25`).
3. Allow Node.js / TCP port 8080 through your computer firewall on private networks.
4. On each phone connected to the same Wi-Fi, open `http://192.168.1.25:8080` (replace with your actual address).
5. Enter a different player name and join. Everyone must use the same host IP and port.

## Internet play (different networks)
A LAN address does not work across the public internet. Deploy this folder to a Node-capable host that supports persistent WebSocket connections, or run it on a public VPS. Open TCP port 8080 (or set `PORT` to the provider's port), configure firewall rules, and use the public host URL. For HTTPS pages, the browser requires `wss://`; deploy behind a TLS reverse proxy (for example Caddy or Nginx) or use a hosting provider that supports secure WebSockets. Do not expose an unprotected home computer directly to the internet.

## Controls
- Move: WASD / arrow keys; mobile uses on-screen direction pad
- Gather: E / Gather button
- Attack: Space / Attack button
- Ability: Q / Ability button (Storm Burst if selected)
- Deposit: click Deposit at Pool; R also attempts deposit

## Game loop
- Collect wood and stone from nodes.
- Approach the large central pool and deposit at least 3 resources.
- The pool offers 3 rewards; choose one.
- Fight other players and forest monsters.
- Knocked-out players respawn after 5 seconds and drop carried resources.
- Room cap: 8 players.

## Notes / known prototype limitations
- This is a functional prototype, not production-ready netcode.
- Movement is server-updated in fixed steps and sent as snapshots; no client prediction/interpolation yet.
- No persistent accounts, matchmaking, anti-cheat hardening, or durable world saves.
- Browser-based LAN testing is the easiest first multiplayer test.
