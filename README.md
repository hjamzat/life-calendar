# Life Calendar

Lock-screen wallpapers that show progress through the **Hijri (Umm al-Qura)** or
**Gregorian** year, quarter, or towards a goal — one dot per day, regenerated
daily by an iOS Shortcut or Android automation.

```text
site/            static site (GitHub Pages): configurator + live preview
  lib/calendar.js  calendar math (Intl islamic-umalqura), shared with the worker
  lib/render.js    layout + SVG, shared with the worker
  fonts/           Inter (SIL OFL)
worker/          Cloudflare Worker that renders PNGs on request
  raster.js        palette rasterizer (dots drawn directly, text via resvg)
  deflate.js       run-length zlib encoder (keeps CPU under the free-plan 10ms)
test/            node --test
```

## Wallpaper URL

```text
https://<worker>/wallpaper.png?view=year&cal=hijri&w=1179&h=2556&tz=Asia/Riyadh&theme=dark
```

| param | values | default |
|---|---|---|
| `view` | `year`, `quarter`, `goal` | `year` |
| `cal` | `hijri`, `gregory` | `hijri` |
| `layout` | `grid` (one block of dots), `months` (a calendar block per month), `quarters` (a block per quarter; year view only) | `grid` |
| `ws` | first weekday for block layouts: `0` Sunday … `6` Saturday | `0` |
| `w`, `h` | 200–4000 px | 1179×2556 |
| `tz` | IANA zone; "today" flips at local midnight | `UTC` |
| `theme` | `dark`, `black`, `light` | `dark` |
| `accent` | hex colour for today's dot, e.g. `d9a441` | theme |
| `top`, `bottom` | % of height kept free for clock / buttons | 33 / 14 |
| `start`, `end`, `title` | goal only; ISO dates (`end` required) | start = today |

`/wallpaper.svg` returns the same image as SVG for debugging.

## Develop

```sh
npm install
npm test
npm run dev:worker                         # http://localhost:8787
python3 -m http.server 5173 -d site        # http://localhost:5173 (uses the local worker)
```

## Deploy

1. **Worker** — create a Cloudflare API token (template "Edit Cloudflare Workers").
   In the GitHub repo: *Settings → Secrets and variables → Actions*:
   - secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - variable `SITE_URL` = your Pages URL (optional; `/` on the worker redirects there)

   Push to `main` → `worker.yml` tests and runs `wrangler deploy`.
   (Or locally: `npx wrangler login && npm run deploy:worker`.)
2. **Site** — set variable `WORKER_URL` = `https://life-calendar.<subdomain>.workers.dev`,
   then *Settings → Pages → Source: GitHub Actions*. Push → `pages.yml` deploys `site/`.

Rendered images are cached at the edge per parameter set and local date, so each
distinct wallpaper is rendered at most once per day per Cloudflare location.
