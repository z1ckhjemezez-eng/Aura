# AuraTok Cloud Worker

Keeps TikTok LIVE connections open for every creator who entered their username on AuraTok
(under **Connections**), and forwards events to the AuraTok API:

- chat, gifts, likes, follows, shares
- battles: start, end, real team scores, opponent name/picture and contributors (`/api/public/battle`)
- league fragments when TikTok sends them (`/api/public/league`)

Because battles are read here, a cloud connection needs **no** extra program on a PC.
The local Battle Helper (`/aurapath-battle-helper.zip`) still works and can run at the same time —
AuraTok ignores duplicate battle data.

## Deploy on Render

1. Create a new **Node** service (worker or web service) from this folder.
2. Build command: `npm install` · Start command: `npm start`.
3. Environment variables:
   - `WORKER_SECRET` — at least 16 characters, must match `CLOUD_WORKER_SECRET` in AuraTok.
   - `AURATOK_URL` — `https://auratok.com` (or your preview URL while testing).
   - `SIGN_API_KEY` — optional.
4. Deploy. The worker polls AuraTok every 20 seconds and reports each connection's status.

A health endpoint answers on `$PORT` so the service also works as a Render web service.

## Files

- `worker.js` — connection pool, event forwarding, status reporting.
- `battle.js` — battle and league tracking (pure logic, no network calls).
- `battle.test.ts` — run from the project root: `bunx vitest run auratok-cloud-worker/battle.test.ts`.

## New version

The download at `public/auratok-cloud-worker.zip` is packed from this folder:

```bash
rm -f public/auratok-cloud-worker.zip
zip -r -X public/auratok-cloud-worker.zip auratok-cloud-worker -x 'auratok-cloud-worker/battle.test.ts'
```
