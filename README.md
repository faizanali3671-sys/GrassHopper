# HopLine

A virtual business number app. Sign up, get a unique number, set up call forwarding and voicemail, and simulate incoming calls.

## Features

- Signup and login (bcrypt password hashing, JWT in an httpOnly cookie)
- A unique virtual number for every user (format `+92 51 XXXX XXXX`)
- Call forwarding with a number, on/off switch and ring time
- Voicemail with greeting, message length, and an inbox (play, mark as read, delete)
- Call simulator that shows `Call forwarded to [03027475322]` step by step
- Call log with stats

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000

Needs Node.js 18 or newer. Data is stored in `data/db.json` (created on first run, ignored by git).

## Important

Calls here are simulated. Real phone calls need a telephony provider such as Twilio, which can issue numbers and forward calls through its API. The database layer, auth, and settings in this project are ready to connect to one.

## Deploy

Works on Render, Railway or any Node host. Set `NODE_ENV=production` and a `JWT_SECRET` environment variable. The JSON file database needs a persistent disk, or swap `db.js` for Postgres or SQLite.

## Structure

```
server.js        Express API
db.js            JSON file storage
public/          index.html, styles.css, app.js
```
