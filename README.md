# Emberly

Emberly is a social habit tracker and classroom reading tracker. The frontend is React/Vite; the backend is a local Node.js API using SQLite. The browser talks only to the API, never directly to the database.

## Run locally

1. Install Node.js 20 or newer.
2. In the project folder, run `npm install`.
3. Run `npm run dev`. Vite serves the app and starts the Express API; SQLite creates `data/emberly.sqlite` automatically.
4. Open the local URL Vite prints (usually `http://localhost:5173`).

No Supabase account, hosted database, API key, or SQL server is needed. The first account registered is the local admin. To promote another account, use `npm run make-admin -- user@example.com`.

## Production

Copy `.env.example` to `.env`, set a long random `EMBERLY_SESSION_SECRET`, run `npm run build`, then start the API with `npm run server`. The Express server serves the built frontend and API on the same port. Keep the `data` directory persistent and back up the SQLite file. Do not expose the SQLite file or database directory over HTTP.

## Local-mode limitations

Passwords are hashed before storage and sessions are signed by the API. Email verification, password-reset email delivery, Google sign-in, and cross-device account sync need external mail/OAuth services; they are not enabled in local-only mode. Platform admins can set an account password from the Admin panel and share it with the account owner through a secure channel. `npm run make-admin -- user@example.com` grants platform admin access.

The SQL migration under `supabase/migrations` is for the former hosted Supabase setup. The current local SQLite app does not run it.
