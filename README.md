# Size Converter – Resize Images and Short Videos to Any Size

Resize images (PNG, JPG, WebP, GIF first frame, BMP, SVG) and short videos (MP4, WebM, MOV – whatever the browser decodes) to an exact pixel size, a percentage, a longest-side limit or a social/web/print/avatar preset. Keep ratio, crop to fill (9-point anchor), stretch or pad. Everything runs on a `<canvas>` (images) or `<video>` + `MediaRecorder` (videos) in the user's browser; nothing is uploaded.

**Live:** https://sizeconverter-tool.vercel.app/ (placeholder – replaced after deploy)

## Features

**Free**
- Drop / pick / paste multiple files; live preview when a single file is loaded; file list with original → new dimensions, size, status and per-file download
- Output size: Exact W × H (aspect lock), Percent 1–400 %, Longest side, 18 presets (IG square/portrait, Story, YouTube thumb, X header, LinkedIn banner, web 1920/1600/1200/800/400, A4 / Letter 300 dpi, avatars 512 → 32); "No upscaling" switch
- Fit: Keep ratio, Crop to fill (anchor grid), Stretch, Pad (color or transparent)
- Format: Keep / JPG / PNG / WebP with quality slider; filename pattern `{name}-{w}x{h}` (`{index}` too)
- Images: step-down resampling (halving) for big reductions, 3 in parallel; "Download all" saves 10 files at a time
- Videos: up to 30 s and 720p output, `.webm` (VP9 or VP8 + Opus), audio copied via `AudioContext`; over-limit files get a "Convert at 720p / first 30 s" fallback
- Free exports carry a small "Size Converter · free" badge (`Studio.watermark`), also drawn on every video frame
- 1 saved size preset; all settings persisted in `localStorage`

**Pro (one-time, price from `config.js`)**
- No watermark on images or video
- Unlimited batch + ZIP download (JSZip loaded lazily from jsDelivr)
- Videos up to 5 min at 1080p / 4K output
- 2x supersampled upscaling
- Unlimited saved size presets

Gates are enforced in `app.js` via `isPro()` / `Studio.gate()`; the UI listens to `pro:changed`.

## Files

```
index.html     tool page + SEO content + FAQ (JSON-LD WebApplication + FAQPage)
styles.css     _shared/base.css + app styles
app.js         resize engine (images + video) + UI (vanilla JS, no build step)
studio.js      shared canvas / drop zone / export / ZIP helpers (copy of _shared/studio.js)
monetize.js    shared theme / toast / analytics / AdSense / Pro license helpers
config.js      window.APP_CONFIG (site URL, AdSense, GA, checkout URL, price, LICENSE, NEWSLETTER)
privacy.html   privacy policy (required for AdSense)
terms.html     terms of use
robots.txt, sitemap.xml, vercel.json, favicon.svg, .gitignore
```

## Run locally

```bash
npx serve .
```

No build step. Open the printed URL. `window.SizeConverter` exposes `addFiles`, `computePlan`, `items()` and `makeSample()` for testing in the console.

## Deploy

Deploy the folder as a static site on Vercel (`vercel --prod`). After the first deploy, replace the placeholder everywhere:

```bash
sed -i 's/sizeconverter-tool.vercel.app/your-app.vercel.app/g' index.html privacy.html terms.html robots.txt sitemap.xml config.js README.md
```

Then run `node _shared/apply-brand.js size-converter` from the repo root to inject the shared header, hero, footer and lead card.

## Monetization setup

1. **AdSense** – set `ADSENSE_CLIENT: "ca-pub-XXXXXXXXXXXXXXXX"` in `config.js`. Slots: `sidebar-1`, `below-tool`. `privacy.html` already discloses advertising cookies.
2. **Analytics** – set `GA_ID: "G-XXXXXXX"`. Events: `add_files`, `sample`, `download` (from `Studio.exportPNG`), `download_click`, `download_all`, `download_zip`, `generate` (video), `preset_save`, `preset_apply`, `pro_click`, `begin_checkout`, `license_activated`.
3. **Pro checkout + licenses** – create a one-time product on Lemon Squeezy with license keys enabled, set `PRO_CHECKOUT_URL`, `PRO_PRICE` and `LICENSE.store_id` / `product_id`. Until those are set, real keys are refused and only `LICENSE.test_keys` work locally.
4. **Newsletter** – set `NEWSLETTER.url` (Formspree / ConvertKit / Beehiiv) to show the lead card that `apply-brand.js` injects.

## Notes

- Output is capped at 16384 px per side; the live preview renders at up to 2048 px (the export is full size).
- Video conversion runs in real time (a 20 s clip takes ~20 s) and the tab should stay in the foreground; the output is WebM only because browsers do not expose an MP4/H.264 encoder to MediaRecorder. WebM files recorded by Chrome lack a duration header, so some players show "live" until playback ends; re-muxing (ffmpeg/HandBrake) fixes that.
- Audio is captured with `AudioContext.createMediaElementSource`; if the browser blocks the audio context (no user gesture yet) the track may be silent and the row says so.
- The only external requests are Google Fonts, optional GA/AdSense, the Lemon Squeezy license API when a key is entered, and JSZip on ZIP export.
