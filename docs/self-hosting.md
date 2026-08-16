# Self-hosted RMP

This optional mode serves only Rail Map Painter at `/rmp/`, enables the RMP
subscription features locally, and adds password-protected named saves that can
be opened from any device.

## Build and run

1. Copy `rmp-selfhost.config.example.json` to `rmp-selfhost.config.json` and set a long, unique password.
2. Run `npm ci` and `npm run build:selfhost`.
3. Run `npm run selfhost:server`.
4. Put the process behind an HTTPS reverse proxy and visit `/rmp/`.

The companion process serves the built `dist` directory and its API from the
same origin. Its defaults are deliberately small:

`public/info.json` is included specifically for this mode. The RMG runtime
requires it at `/rmp/info.json`; do not remove it from a deployment.

- Port: `4173`
- Data directory: `./rmp-data`
- Build directory: `./dist`

These values, including the password, are set in `rmp-selfhost.config.json`; no environment variables are required. Keep that file out of Git and limit it to the service account (`chmod 600 rmp-selfhost.config.json` on Linux).

Back up the complete data directory. It contains `index.json` and one JSON file
per save. Writes use a temporary file followed by an atomic rename. The service
does not provide account recovery; losing the password prevents access to the
saves, so keep it in your server's secret manager.

## Behaviour and limits

- The password is sent using HTTP Basic authentication and is kept only in the
  browser session. HTTPS is mandatory outside a trusted local network.
- Autosave waits two seconds after a canvas change. Every save has a revision;
  a save changed on another device is rejected instead of silently overwritten.
- Uploaded local images are bundled into the cloud-save JSON. Images hosted by
  the original Rail Map service remain external references.
- This mode removes RMP's dependency on the original subscription endpoint, but
  gallery, share, translation, random-name, and server-image features still
  point at their existing upstream endpoints unless separately removed.
- The server proxies the companion palette app at `/rmg-palette/`, which is
  required by RMP's colour picker. It also proxies the companion paths used by
  upstream RMP (`/styles/`, `/fonts/`, `/rmg/`, and `/rmp-gallery/`). A fully
  offline deployment must host compatible copies of those apps instead.

## Updating from upstream

Keep the storage service and all `src/selfhost/` files as local commits. The
only upstream integration points are `src/redux/init.ts` and
`src/components/page-header/window-header.tsx`, making rebases small. Add the
canonical repository once:

```powershell
git remote add upstream git@github.com:railmapgen/rmp.git
git fetch upstream
git switch selfhost
git rebase upstream/main
```

The project is GPL-3.0. If this modified web application is made available to
others, preserve its notices and make the corresponding source available.
