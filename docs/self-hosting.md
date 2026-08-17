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

Back up the complete data directory. It contains `index.json`, `profile.json`, one JSON and (when published) one SVG file per save, plus `palette-cities.json` for local colour palettes. Writes use a temporary file followed by an atomic rename and are serialized by the server. The service
does not provide account recovery; losing the password prevents access to the
saves, so keep it in your server's secret manager.

## Behaviour and limits

- The password is sent using HTTP Basic authentication and is kept only in the
  browser session. HTTPS is mandatory outside a trusted local network.
- Autosave waits two seconds after a canvas change. Opening a save obtains a
  45-second editing lease which is renewed while the tab remains active. A
  second device cannot open the same save for editing until the lease is
  released or expires. Revision checks remain in place as a second guard; a
  conflict offers reload or saving the local work as a copy.
- Saves can be duplicated and placed in named groups. Deleting a group leaves
  its saves intact and moves them to the ungrouped list.
- Each save retains its three most recent replaced versions. Open **Version
  history** for the active save to restore one; the version being replaced is
  retained first, so restoring is itself reversible while it remains in the
  three-version window. Deleting a save also deletes its retained history.
- The selected interface language is cached in the browser and synchronized in
  `profile.json` after connecting to the self-hosted save service.
- The active save can publish a public SVG. Its unguessable `/share/<token>.svg`
  URL exposes only the rendered SVG, never the editable save JSON. Use
  **Disable** to revoke it; publishing again updates the SVG at the same URL.
  The server strips executable SVG content and sends a restrictive static-content
  policy. Shared SVGs embed a small Noto Sans Latin Extended fallback font,
  including macrons used in Japanese romanisation, while Japanese labels use
  the viewer's system fallback to keep files small. The embedded font is a
  57 KB subset; its SIL Open Font License is included at
  `public/fonts/OFL-NotoSans.txt`. Use **Check font** next to a published SVG
  to diagnose the current browser without remote DevTools.
  Public SVGs may still reference external images that were already present in
  the map.
- Local colour palettes define cities and their line-colour lists. Use **Manage
  local palettes** within the normal colour picker, then choose the new city
  from that same picker. The city list is intentionally available to the
  unauthenticated palette iframe; editing it requires the save-service password.
- Uploaded local images are bundled into the cloud-save JSON. Images hosted by
  the original Rail Map service remain external references.
- This mode removes RMP's dependency on the original subscription endpoint, but
  gallery, share, translation, random-name, and server-image features still
  point at their existing upstream endpoints unless separately removed.
- The server proxies the companion palette app at `/rmg-palette/`, which is
  required by RMP's colour picker. It also proxies the companion paths used by
  upstream RMP (`/styles/`, `/fonts/`, `/rmg/`, and `/rmp-gallery/`). A fully
  offline deployment must host compatible copies of those apps instead.

## Manually migrating legacy saves

The grouped-save format is an explicit migration, never an automatic one. Stop
the service first, then run a validation-only dry run:

```bash
npm run selfhost:migrate
```

If it reports no validation errors, apply it:

```bash
pm2 stop rmp-selfhost
npm run selfhost:migrate -- --apply
pm2 start rmp-selfhost
```

The command makes a timestamped `index.legacy-*.json` backup, preserves every
save file and revision, and places all migrated saves in **Ungrouped**.

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
