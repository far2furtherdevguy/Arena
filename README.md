# Neon Arena v3 (Solara Port)

Single-player modes work offline: open `public/index.html` in a browser.
Online modes (1v1 and Battle Royale, first to 11 kills) need this server.

## Run locally
    npm install
    npm start
Open http://localhost:3000 in two browser windows and press Online 1v1.

## Deploy on Render
1. Push this folder to a GitHub repo.
2. On render.com choose New > Blueprint (it reads render.yaml) or New > Web Service with
   Build Command `npm install` and Start Command `npm start`.
3. Open your `https://<name>.onrender.com` URL. The game is served from the same address,
   so leave the Server URL box empty. If you open the HTML file from elsewhere, paste that URL.

Notes: the free Render plan sleeps when idle, so the first connection can take about a minute.
Hit detection is client-side and the server validates fire rate, damage, range and health, which is
fine for friends but not cheat-proof. Battle Royale starts 15 seconds after the second player joins,
or immediately at 8 players.
