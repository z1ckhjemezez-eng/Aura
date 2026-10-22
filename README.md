# AuraTok Cloud Worker

Keeps TikTok LIVE connections open for every creator who entered their username on AuraTok
(under **Connections**), and forwards events to the AuraTok API:

- chat, gifts, likes, follows, shares
- battles: start, end, real team scores, opponent name/picture and contributors (`/api/public/battle`)
- league fragments when TikTok sends them (`/api/public/league`)
- Booster Collection: item-card notices, separate awards/use events, unknown battle power-ups and gap/heartbeat tracking (`/api/public/boosters`). No types are LIVE-verified yet.

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
   - `BOOSTER_SPOOL_DIR` — optional persistent disk folder; without a mounted disk pending retries survive reconnects/process restarts on the same filesystem only, not a Render replacement/deploy. Sessions always start incomplete because observation can begin mid-LIVE.
4. Deploy. The worker polls AuraTok every 20 seconds and reports each connection's status.

A health endpoint answers on `$PORT` so the service also works as a Render web service.

## Files

- `worker.js` — connection pool, event forwarding, status reporting.
- `connection-status.js` — open-socket and exact room-username verification. Offline is only confirmed by a typed offline error plus matching account identity; other lookup failures remain unverified, never connected.
- `battle.js` — battle and league tracking (pure logic, no network calls).
- `boosters.js` — existing-connection observer and disk-backed retry spool; no gift-ID detection. Admin mappings are evidence-gated. Top2/Top3 cards are not treated as x2/x3 multipliers; expiry stays unknown unless actual events establish it.
- `battle.test.ts` — run from the project root: `bunx vitest run auratok-cloud-worker/battle.test.ts`.

## New version

Battle MVP gifts now carry the sender's TikTok ID and the battle ID. Battle start, received gifts and end are delivered in order so the final ceremony includes the MVP's largest completed gift from that battle. Update AuraTok before redeploying this version.

Update your existing Render service with **all** files, including `connection-status.js`, and redeploy. Publish the matching AuraTok update as well: status reports now include the saved username and request revision, and reports from older workers are intentionally ignored rather than showing an unverified connection.

The download at `public/auratok-cloud-worker.zip` is packed from this folder (excluding tests):

```bash
rm -f public/auratok-cloud-worker.zip
zip -r -X public/auratok-cloud-worker.zip auratok-cloud-worker -x '*.test.ts' '*/node_modules/*' '*/.env*'
```
