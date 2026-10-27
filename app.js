/* ===== Size Converter – resize images and short videos to any size, entirely in the browser ===== */
(function () {
  'use strict';

  const C = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = Math.round;

  // ---- Constants ----
  const STATE_KEY = 'sizeconv_state_v1';
  const PRESETS_KEY = 'sizeconv_presets_v1';
  const FREE_DL = 10;                 // "Download all" files per click on the free tier
  const FREE_VIDEO_SEC = 30, PRO_VIDEO_SEC = 300;
  const FREE_VIDEO_MAX = { long: 1280, short: 720 };   // 720p
  const PRO_VIDEO_MAX = { long: 3840, short: 2160 };   // 4K
  const IMG_CONCURRENCY = 3;
  const MAX_SIDE = 16384;
  const PREVIEW_MAX = 2048;
  const ENCODABLE = ['image/jpeg', 'image/png', 'image/webp'];
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/webm': 'webm' };
  const LABEL = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'video/webm': 'WebM' };
  const ANCHOR = { tl: [0, 0], t: [.5, 0], tr: [1, 0], l: [0, .5], c: [.5, .5], r: [1, .5], bl: [0, 1], b: [.5, 1], br: [1, 1] };
  const PRESETS = {
    'ig-square': { w: 1080, h: 1080, label: 'Instagram square' },
    'ig-portrait': { w: 1080, h: 1350, label: 'Instagram portrait' },
    'story': { w: 1080, h: 1920, label: 'Story / Reel' },
    'yt-thumb': { w: 1280, h: 720, label: 'YouTube thumbnail' },
    'x-header': { w: 1500, h: 500, label: 'X header' },
    'li-banner': { w: 1584, h: 396, label: 'LinkedIn banner' },
    'web-1920': { longest: 1920, label: 'Full HD' },
    'web-1600': { longest: 1600, label: 'Large' },
    'web-1200': { longest: 1200, label: 'Blog' },
    'web-800': { longest: 800, label: 'Medium' },
    'web-400': { longest: 400, label: 'Thumbnail' },
    'a4': { w: 2480, h: 3508, label: 'A4 300 dpi' },
    'letter': { w: 2550, h: 3300, label: 'Letter 300 dpi' },
    'av-512': { w: 512, h: 512, label: 'Avatar' },
    'av-256': { w: 256, h: 256, label: 'Avatar' },
    'av-128': { w: 128, h: 128, label: 'Icon' },
    'av-64': { w: 64, h: 64, label: 'Icon' },
    'av-32': { w: 32, h: 32, label: 'Favicon' }
  };

  const DEF = {
    mode: 'exact', w: 1080, h: 1080, lock: true, percent: 50, longest: 1920, preset: 'ig-square',
    noUpscale: true, supersample: false,
    fit: 'contain', anchor: 'c', padColor: '#ffffff', padTransparent: false,
    format: 'keep', quality: 90, pattern: '{name}-{w}x{h}'
  };
  const S = Studio.restore(STATE_KEY, DEF);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // Validates state restored from localStorage and saved presets (untrusted): types, enums, ranges.
  function sanitizeS(o) {
    Object.keys(DEF).forEach((k) => { if (typeof o[k] !== typeof DEF[k]) o[k] = DEF[k]; });
    if (!['exact', 'percent', 'longest', 'preset'].includes(o.mode)) o.mode = 'exact';
    if (!['contain', 'cover', 'stretch', 'pad'].includes(o.fit)) o.fit = 'contain';
    if (!own(ANCHOR, o.anchor)) o.anchor = 'c';
    if (!own(PRESETS, o.preset)) o.preset = 'ig-square';
    if (!['keep', 'image/jpeg', 'image/png', 'image/webp'].includes(o.format)) o.format = 'keep';
    o.w = clamp(round(o.w) || 1080, 1, MAX_SIDE); o.h = clamp(round(o.h) || 1080, 1, MAX_SIDE);
    o.percent = clamp(round(o.percent) || 50, 1, 400); o.longest = clamp(round(o.longest) || 1920, 1, MAX_SIDE);
    o.quality = clamp(round(o.quality) || 90, 10, 100);
    if (!/^#[0-9a-f]{6}$/i.test(o.padColor)) o.padColor = '#ffffff';
    o.pattern = String(o.pattern || DEF.pattern).slice(0, 80);
    return o;
  }
  sanitizeS(S);

  // ---- Elements ----
  const el = {};
  ['stage', 'preview', 'drop', 'sampleBtn', 'stageInfo', 'freeInfo', 'listCard', 'countPill', 'rerunBtn', 'clearBtn',
    'progress', 'progressBar', 'fileList', 'downloadAllBtn', 'zipBtn', 'downloadHint',
    'modeSeg', 'exactRow', 'wIn', 'lockBtn', 'hIn', 'exactHint', 'percentRow', 'pct', 'pctV', 'pctChips',
    'longestRow', 'longest', 'longestChips', 'presetRow', 'presetSel', 'presetHint', 'noUpscale', 'ssRow', 'supersample',
    'presetName', 'savePreset', 'presetList', 'savedHint',
    'fitSeg', 'fitHint', 'anchorRow', 'anchorGrid', 'padRow', 'padColor', 'padTransparent',
    'formatSeg', 'qualityRow', 'quality', 'qualityV', 'formatHint', 'pattern', 'videoLimits', 'recorderSupport', 'proPrice'
  ].forEach((id) => { el[id] = $(id); });
  const pctx = el.preview.getContext('2d');

  // ---- State ----
  let items = [];          // { id, kind, file, name, size, origUrl, w, h, duration, src, poster, thumb, status, outBlob, outW, outH, outType, note, error, progress, el }
  let nextId = 1;
  let activeImg = 0, activeVid = 0;
  let rerunTimer = null;
  let savedPresets = loadPresets();
  const videoSupported = !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);

  // ---- Helpers ----
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtBytes(b) {
    if (!isFinite(b) || b == null) return '–';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10 * 1024 ? 1 : 0) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function fmtTime(sec) { sec = round(sec || 0); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function baseName(name) { return (name || 'file').replace(/\.[^.]+$/, '') || 'file'; }
  function extOf(name) { const m = /\.([a-z0-9]{1,8})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function isImageFile(f) { return !!f && ((f.type && f.type.startsWith('image/')) || /\.(jpe?g|png|webp|gif|bmp|avif|svg|heic|heif|tiff?)$/i.test(f.name || '')); }
  function isVideoFile(f) { return !!f && ((f.type && f.type.startsWith('video/')) || /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(f.name || '')); }
  function even(n) { n = Math.max(2, round(n)); return n % 2 ? n - 1 : n; }
  function persist() { Studio.persist(STATE_KEY, S); }
  function stamp() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'); }
  function referenceItem() { return items.find((i) => i.w && i.h) || null; }

  // ---- Size plan: source (sw × sh) + settings -> output canvas + draw rectangle ----
  function computePlan(sw, sh, s, kind) {
    s = s || S;
    let bw, bh, fit = s.fit, scaleMode = false; // scaleMode: output is derived from the source size, fit is irrelevant
    if (s.mode === 'exact') { bw = s.w; bh = s.h; }
    else if (s.mode === 'percent') { const p = s.percent / 100; bw = sw * p; bh = sh * p; scaleMode = true; }
    else if (s.mode === 'longest') { let r = s.longest / Math.max(sw, sh); if (s.noUpscale) r = Math.min(r, 1); bw = sw * r; bh = sh * r; scaleMode = true; }
    else {
      const p = PRESETS[s.preset] || PRESETS['ig-square'];
      if (p.longest) { let r = p.longest / Math.max(sw, sh); if (s.noUpscale) r = Math.min(r, 1); bw = sw * r; bh = sh * r; scaleMode = true; }
      else { bw = p.w; bh = p.h; }
    }
    bw = clamp(round(bw), 1, MAX_SIDE); bh = clamp(round(bh), 1, MAX_SIDE);
    if (scaleMode) fit = 'stretch';
    const [ax, ay] = ANCHOR[s.anchor] || ANCHOR.c;
    let out, draw, bg = null;
    if (fit === 'contain') {
      let r = Math.min(bw / sw, bh / sh); if (s.noUpscale) r = Math.min(r, 1);
      out = { w: Math.max(1, round(sw * r)), h: Math.max(1, round(sh * r)) };
      draw = { sx: 0, sy: 0, sw, sh, dx: 0, dy: 0, dw: out.w, dh: out.h };
    } else if (fit === 'cover') {
      const r = Math.max(bw / sw, bh / sh);
      out = { w: bw, h: bh };
      const cw = Math.min(sw, bw / r), ch = Math.min(sh, bh / r);
      draw = { sx: (sw - cw) * ax, sy: (sh - ch) * ay, sw: cw, sh: ch, dx: 0, dy: 0, dw: bw, dh: bh };
    } else if (fit === 'pad') {
      let r = Math.min(bw / sw, bh / sh); if (s.noUpscale) r = Math.min(r, 1);
      const dw = Math.max(1, round(sw * r)), dh = Math.max(1, round(sh * r));
      out = { w: bw, h: bh };
      draw = { sx: 0, sy: 0, sw, sh, dx: round((bw - dw) * ax), dy: round((bh - dh) * ay), dw, dh };
      bg = s.padTransparent ? null : s.padColor;
    } else { // stretch
      out = { w: bw, h: bh };
      draw = { sx: 0, sy: 0, sw, sh, dx: 0, dy: 0, dw: bw, dh: bh };
    }
    if (kind === 'video') { // encoders want even dimensions
      const ow = out.w, oh = out.h;
      out = { w: even(ow), h: even(oh) };
      const kx = out.w / ow, ky = out.h / oh;
      draw.dx *= kx; draw.dw *= kx; draw.dy *= ky; draw.dh *= ky;
    }
    const scale = draw.dw / draw.sw;
    return { w: out.w, h: out.h, draw, bg, scale, upscale: scale > 1.001, scaleMode, fit };
  }
  // Scale a plan down so the longest/shortest side stays inside a cap (videos)
  function capPlan(plan, cap) {
    const long = Math.max(plan.w, plan.h), short = Math.min(plan.w, plan.h);
    const k = Math.min(1, cap.long / long, cap.short / short);
    if (k >= 1) return plan;
    const d = plan.draw;
    const p = Object.assign({}, plan, { w: even(plan.w * k), h: even(plan.h * k), capped: true });
    p.draw = { sx: d.sx, sy: d.sy, sw: d.sw, sh: d.sh, dx: d.dx * k, dy: d.dy * k, dw: d.dw * k, dh: d.dh * k };
    p.scale = p.draw.dw / p.draw.sw; p.upscale = p.scale > 1.001;
    return p;
  }

  // ---- Drawing: step-down resampling for big reductions, optional 2x supersampling for enlargements ----
  function drawPlan(ctx, src, plan, opts) {
    opts = opts || {};
    const d = plan.draw;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (plan.bg) { ctx.fillStyle = plan.bg; ctx.fillRect(0, 0, plan.w, plan.h); }
    else if (opts.opaque) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, plan.w, plan.h); }
    if (!(d.dw > 0 && d.dh > 0 && d.sw > 0 && d.sh > 0)) return;
    const ratio = d.dw / d.sw;
    if (ratio < 0.5 && !opts.fast) {
      // halve repeatedly until within 2x of the target, then one final resample
      let cur = src, cx = d.sx, cy = d.sy, cw = d.sw, ch = d.sh;
      while (cw / 2 > d.dw && ch / 2 > d.dh) {
        const nw = Math.max(1, Math.floor(cw / 2)), nh = Math.max(1, Math.floor(ch / 2));
        const t = document.createElement('canvas'); t.width = nw; t.height = nh;
        const tc = t.getContext('2d'); tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
        tc.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
        cur = t; cx = 0; cy = 0; cw = nw; ch = nh;
      }
      ctx.drawImage(cur, cx, cy, cw, ch, d.dx, d.dy, d.dw, d.dh);
    } else if (ratio > 1.001 && opts.supersample) {
      const t = document.createElement('canvas'); t.width = Math.max(1, round(d.dw * 2)); t.height = Math.max(1, round(d.dh * 2));
      const tc = t.getContext('2d'); tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
      tc.drawImage(src, d.sx, d.sy, d.sw, d.sh, 0, 0, t.width, t.height);
      ctx.drawImage(t, 0, 0, t.width, t.height, d.dx, d.dy, d.dw, d.dh);
    } else {
      ctx.drawImage(src, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
    }
  }
  function wantsSupersample() { return !!(S.supersample && isPro()); }

  // ---- Decoding ----
  async function decodeImage(file) {
    const name = file.name || '';
    if (/^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(name)) throw new Error('HEIC/HEIF photos cannot be opened by browsers. Export as JPEG first (iPhone: Settings → Camera → Formats → Most Compatible).');
    if (typeof createImageBitmap === 'function' && !/svg/i.test(file.type)) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back to <img> */ }
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); if (!img.naturalWidth) reject(new Error('This image has no size (an SVG needs width/height or a viewBox).')); else resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode this file. It may be corrupted or in an unsupported format.')); };
      img.src = url;
    });
  }
  function loadVideoMeta(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.playsInline = true;
      const fail = () => reject(new Error('This video cannot be decoded by your browser (unsupported codec or container).'));
      v.onerror = fail;
      v.onloadedmetadata = () => {
        if (!v.videoWidth || !v.videoHeight) return fail();
        const meta = { w: v.videoWidth, h: v.videoHeight, duration: isFinite(v.duration) ? v.duration : 0 };
        const t = isFinite(v.duration) ? Math.min(0.1, v.duration / 2) : 0;
        let done = false;
        const finish = () => {
          if (done) return; done = true;
          try {
            const pw = Math.min(1280, v.videoWidth), ph = round(pw * v.videoHeight / v.videoWidth);
            const poster = document.createElement('canvas'); poster.width = pw; poster.height = ph;
            poster.getContext('2d').drawImage(v, 0, 0, pw, ph);
            meta.poster = poster;
          } catch (e) { /* no poster */ }
          v.src = ''; resolve(meta);
        };
        v.onseeked = finish;
        setTimeout(finish, 1500);
        try { v.currentTime = t; } catch (e) { finish(); }
      };
      v.src = url;
    });
  }

  // ---- Items ----
  function addFiles(list) {
    const files = Array.from(list || []);
    const media = files.filter((f) => isImageFile(f) || isVideoFile(f));
    if (!media.length) { toast('Drop images (PNG, JPG, WebP…) or videos (MP4, WebM, MOV)'); return; }
    const skippedVideo = media.filter((f) => isVideoFile(f) && !videoSupported);
    media.forEach((f) => {
      if (isVideoFile(f) && !videoSupported) return;
      const it = {
        id: nextId++, kind: isVideoFile(f) ? 'video' : 'image', file: f, name: f.name || (isVideoFile(f) ? 'video' : 'image'),
        size: f.size, origUrl: URL.createObjectURL(f), status: 'queued', note: '', error: '', progress: 0, el: null
      };
      items.push(it);
      renderItem(it);
    });
    if (skippedVideo.length) toast('This browser cannot record video (MediaRecorder missing). Images still work.');
    releaseSources();
    updateStage();
    updateSummary();
    pump();
    track('add_files', { count: media.length, videos: media.filter(isVideoFile).length });
  }
  // keep the decoded bitmap only while a single file is loaded (live preview)
  function releaseSources() {
    if (items.length === 1) return;
    items.forEach((it) => { if (it.src) { try { if (it.src.close) it.src.close(); } catch (e) { /* noop */ } it.src = null; } });
  }
  function removeItem(it) {
    it.removed = true;
    if (it.abort) it.abort();
    if (it.src && it.src.close) { try { it.src.close(); } catch (e) { /* noop */ } }
    if (it.origUrl) URL.revokeObjectURL(it.origUrl);
    if (it.outUrl) URL.revokeObjectURL(it.outUrl);
    items = items.filter((i) => i !== it);
    if (it.el) it.el.remove();
    updateStage(); updateSummary(); drawPreview();
  }
  function clearAll() { items.slice().forEach(removeItem); el.fileList.innerHTML = ''; toast('Cleared'); }

  // ---- Queue ----
  function pump() {
    items.forEach((it) => {
      if (it.removed || it.status !== 'queued') return;
      if (it.kind === 'image' && activeImg < IMG_CONCURRENCY) { activeImg++; run(it, processImage, () => activeImg--); }
      else if (it.kind === 'video' && activeVid < 1) { activeVid++; run(it, processVideo, () => activeVid--); }
    });
    updateSummary();
  }
  function run(it, fn, release) {
    fn(it).catch((e) => { it.status = 'error'; it.error = (e && e.message) || 'Could not process this file.'; })
      .then(() => {
        release();
        if (!it.removed) {
          if (it.rerun) { it.rerun = false; resetOutput(it); it.status = 'queued'; }
          renderItem(it);
        }
        updateSummary();
        pump();
      });
  }
  function resetOutput(it) {
    if (it.outUrl) { URL.revokeObjectURL(it.outUrl); it.outUrl = null; }
    it.outBlob = null; it.outW = it.outH = 0; it.note = ''; it.error = ''; it.progress = 0;
  }
  function requeue(it, opts) {
    if (it.removed) return;
    if (it.status === 'processing') { it.rerun = true; if (it.kind === 'video' && it.abort) it.abort(); return; }
    resetOutput(it);
    if (it.kind === 'video' && !(opts && opts.auto)) { it.status = 'ready'; it.note = 'Settings changed – convert again'; }
    else it.status = 'queued';
    renderItem(it);
  }
  function scheduleRerun() {
    clearTimeout(rerunTimer);
    rerunTimer = setTimeout(() => {
      items.forEach((it) => { if (it.kind === 'image' || it.outBlob || it.status === 'blocked') requeue(it); });
      pump();
    }, 350);
  }
  function rerunAll() { items.forEach((it) => requeue(it, { auto: true })); pump(); }

  // ---- Image processing ----
  async function processImage(it) {
    it.status = 'processing'; renderItem(it);
    let src = it.src;
    if (!src) src = await decodeImage(it.file);
    it.w = src.width || src.naturalWidth; it.h = src.height || src.naturalHeight;
    if (!it.w || !it.h) throw new Error('Image has no dimensions.');
    if (items.length === 1) { it.src = src; drawPreview(); } else it.src = null;
    syncExactFromReference();
    const plan = computePlan(it.w, it.h, S, 'image');
    let outType = S.format === 'keep' ? (ENCODABLE.includes(it.file.type) ? it.file.type : 'image/png') : S.format;
    let note = '';
    if (S.format === 'keep' && !ENCODABLE.includes(it.file.type)) note = (extOf(it.name) || 'file').toUpperCase() + ' saved as PNG' + (/gif/i.test(it.file.type) ? ' (first frame)' : '');
    if (plan.upscale) note = (note ? note + ' · ' : '') + 'upscaled ' + plan.scale.toFixed(2) + 'x' + (wantsSupersample() ? ' (supersampled)' : '');
    if (plan.bg === null && S.fit === 'pad' && !plan.scaleMode && outType === 'image/jpeg') note = (note ? note + ' · ' : '') + 'JPG has no transparency – padded white';
    const lossy = outType !== 'image/png';
    const ss = wantsSupersample();
    const blob = await Studio.exportPNG((ctx, w, h) => { drawPlan(ctx, src, plan, { opaque: outType === 'image/jpeg', supersample: ss }); }, plan.w, plan.h, {
      type: outType, quality: lossy ? S.quality / 100 : undefined, download: false, watermark: true
    });
    if (!it.src && src.close) { try { src.close(); } catch (e) { /* noop */ } }
    if (it.removed) return;
    if (blob.type && blob.type !== outType) { note = (note ? note + ' · ' : '') + (LABEL[outType] || outType) + ' not supported here – saved as ' + (LABEL[blob.type] || blob.type); outType = blob.type; }
    it.outBlob = blob; it.outType = outType; it.outW = plan.w; it.outH = plan.h; it.note = note; it.status = 'done';
    if (it.outUrl) URL.revokeObjectURL(it.outUrl);
    it.outUrl = URL.createObjectURL(blob);
  }

  // ---- Video processing (decode with <video>, redraw each frame, record with MediaRecorder) ----
  function pickMime() {
    const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
    return list.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
  }
  async function processVideo(it) {
    it.status = 'processing'; it.progress = 0; renderItem(it);
    if (!it.w) {
      const meta = await loadVideoMeta(it.origUrl);
      it.w = meta.w; it.h = meta.h; it.duration = meta.duration; it.poster = meta.poster;
      if (items.length === 1) drawPreview();
      syncExactFromReference();
    }
    const pro = isPro();
    let plan = computePlan(it.w, it.h, S, 'video');
    const cap = pro ? PRO_VIDEO_MAX : FREE_VIDEO_MAX;
    const maxSec = pro ? PRO_VIDEO_SEC : FREE_VIDEO_SEC;
    const tooBig = Math.max(plan.w, plan.h) > cap.long || Math.min(plan.w, plan.h) > cap.short;
    const tooLong = it.duration > maxSec + 0.5;
    if (!pro && (tooBig || tooLong) && !it.capFree) {
      it.status = 'blocked';
      it.note = (tooLong ? 'Longer than the free ' + FREE_VIDEO_SEC + ' s limit' : 'Output ' + plan.w + '×' + plan.h + ' is above the free 720p limit') + ' – Pro allows 5 min at 1080p/4K';
      Studio.gate('video');
      return;
    }
    if (tooBig) plan = capPlan(plan, cap);
    const limitSec = (tooLong || !it.duration) ? maxSec : 0; // unknown duration (e.g. recorded WebM): stop at the tier limit
    let note = plan.capped ? 'Capped to ' + plan.w + '×' + plan.h + (pro ? ' (4K max)' : ' (free limit)') : '';
    if (tooLong) note = (note ? note + ' · ' : '') + 'First ' + maxSec + ' s only (free limit)';
    if (plan.upscale) note = (note ? note + ' · ' : '') + 'upscaled ' + plan.scale.toFixed(2) + 'x';

    const video = document.createElement('video');
    video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
    video.src = it.origUrl;
    await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error('Could not decode this video.')); });

    const canvas = document.createElement('canvas'); canvas.width = plan.w; canvas.height = plan.h;
    const ctx = canvas.getContext('2d', { alpha: false });
    const stream = canvas.captureStream(30);
    let actx = null, audio = 'copied';
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      const srcNode = actx.createMediaElementSource(video);
      const dest = actx.createMediaStreamDestination();
      srcNode.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      if (actx.state === 'suspended') await actx.resume().catch(() => {});
    } catch (e) { audio = 'none'; }
    const mime = pickMime();
    const bps = clamp(round(plan.w * plan.h * 30 * 0.09), 800e3, 24e6);
    const rec = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: bps, audioBitsPerSecond: 128e3 }, mime ? { mimeType: mime } : {}));
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    let resolveStopped;
    const stopped = new Promise((res) => { resolveStopped = res; });
    rec.onstop = () => resolveStopped();
    rec.onerror = () => resolveStopped();

    let finished = false, aborted = false, rafId = 0, lastUi = 0;
    const draw = () => {
      drawPlan(ctx, video, plan, { fast: true, opaque: true });
      Studio.watermark(ctx, plan.w, plan.h); // no-op for Pro
    };
    const loop = () => {
      if (finished) return;
      draw();
      if (limitSec && video.currentTime >= limitSec) { finish(); return; }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop); else rafId = requestAnimationFrame(loop);
    };
    const onProgress = () => {
      const d = limitSec || it.duration || video.duration || 1;
      it.progress = clamp(video.currentTime / d, 0, 1);
      const now = Date.now(); if (now - lastUi > 250) { lastUi = now; renderItem(it); }
    };
    const finish = () => {
      if (finished) return; finished = true;
      cancelAnimationFrame(rafId);
      try { video.pause(); } catch (e) { /* noop */ }
      if (rec.state !== 'inactive') { try { rec.stop(); } catch (e) { resolveStopped(); } } else resolveStopped();
    };
    it.abort = () => { aborted = true; finish(); };
    video.addEventListener('timeupdate', onProgress);
    video.addEventListener('ended', finish);

    rec.start(250);
    try { await video.play(); }
    catch (e) {
      video.muted = true; audio = 'none';
      try { await video.play(); } catch (e2) { finish(); throw new Error('Playback was blocked by the browser. Click the file\'s Convert button to try again.'); }
    }
    if (audio === 'copied' && actx && actx.state !== 'running') audio = 'silent';
    loop();
    await stopped;
    if (rec.state !== 'inactive') { try { rec.stop(); } catch (e) { /* noop */ } }
    video.removeEventListener('timeupdate', onProgress);
    stream.getTracks().forEach((t) => t.stop());
    if (actx) { try { actx.close(); } catch (e) { /* noop */ } }
    video.src = ''; video.load();
    it.abort = null;
    if (it.removed || aborted) return;
    const blob = new Blob(chunks, { type: 'video/webm' });
    if (!blob.size) throw new Error('Recording produced no data. Try a shorter clip or another browser.');
    if (audio === 'none') note = (note ? note + ' · ' : '') + 'audio not captured';
    else if (audio === 'silent') note = (note ? note + ' · ' : '') + 'audio may be silent (browser blocked the audio context – click Convert to retry)';
    it.outBlob = blob; it.outType = 'video/webm'; it.outW = plan.w; it.outH = plan.h; it.note = note; it.status = 'done'; it.progress = 1;
    if (it.outUrl) URL.revokeObjectURL(it.outUrl);
    it.outUrl = URL.createObjectURL(blob);
    track('generate', { kind: 'video', w: plan.w, h: plan.h, sec: round(it.duration || 0) });
  }

  // ---- Live preview (single file) ----
  const drawPreview = Studio.raf(function () {
    const it = items.length === 1 ? items[0] : null;
    const src = it ? (it.kind === 'image' ? it.src : it.poster) : null;
    if (!it || !src || !it.w) { el.preview.classList.add('hidden'); updateStage(); return; }
    const plan = computePlan(it.w, it.h, S, it.kind);
    if (it.kind === 'video') {
      const cap = isPro() ? PRO_VIDEO_MAX : FREE_VIDEO_MAX;
      if (Math.max(plan.w, plan.h) > cap.long || Math.min(plan.w, plan.h) > cap.short) {
        if (isPro() || it.capFree) Object.assign(plan, capPlan(plan, cap));
      }
    }
    const ps = Math.min(1, PREVIEW_MAX / Math.max(plan.w, plan.h));
    const pw = Math.max(1, round(plan.w * ps)), ph = Math.max(1, round(plan.h * ps));
    if (el.preview.width !== pw) el.preview.width = pw;
    if (el.preview.height !== ph) el.preview.height = ph;
    pctx.setTransform(1, 0, 0, 1, 0, 0); pctx.clearRect(0, 0, pw, ph);
    // poster frames are already downscaled: translate the plan's source rect
    let p = plan;
    if (src !== it.src || src.width !== it.w) {
      const k = src.width / it.w, d = plan.draw;
      p = Object.assign({}, plan, { draw: { sx: d.sx * k, sy: d.sy * k, sw: d.sw * k, sh: d.sh * k, dx: d.dx, dy: d.dy, dw: d.dw, dh: d.dh } });
    }
    pctx.scale(ps, ps);
    const outType = S.format === 'keep' ? (ENCODABLE.includes(it.file.type) ? it.file.type : 'image/png') : S.format;
    drawPlan(pctx, src, p, { opaque: it.kind === 'video' || outType === 'image/jpeg', supersample: wantsSupersample(), fast: ps < 1 });
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    Studio.watermark(pctx, pw, ph);
    el.preview.classList.remove('hidden');
    el.stageInfo.innerHTML = 'Output: <b>' + plan.w + ' × ' + plan.h + '</b>' + (plan.upscale ? ' · upscaled' : '') + (!isPro() ? ' · badge on free exports' : '');
    updateStage();
  });

  function updateStage() {
    const has = items.length > 0;
    const single = items.length === 1 && !!(items[0].kind === 'image' ? items[0].src : items[0].poster);
    el.drop.classList.toggle('has-files', single);
    el.stage.classList.toggle('compact', has && !single);
    if (!single) el.preview.classList.add('hidden');
    const b = el.drop.querySelector('b'), sm = el.drop.querySelector('small');
    if (b) b.textContent = has ? 'Drop more files or click to add' : 'Drop images or videos, or click to upload';
    if (sm) sm.textContent = has ? 'Settings apply to every file · nothing is uploaded' : 'PNG, JPG, WebP, GIF, BMP, SVG · MP4, WebM, MOV · paste with Ctrl+V · nothing is uploaded';
    if (!has) el.stageInfo.innerHTML = 'Output: <b>—</b>';
    else if (!single) {
      const ref = referenceItem();
      if (ref) { const p = computePlan(ref.w, ref.h, S, ref.kind); el.stageInfo.innerHTML = 'Output: <b>' + p.w + ' × ' + p.h + '</b> for ' + esc(ref.name) + (items.length > 1 ? ' · ' + items.length + ' files' : ''); }
    }
  }

  // ---- File list rendering ----
  function renderItem(it) {
    if (it.removed) return;
    if (!it.el) { const li = document.createElement('li'); li.dataset.id = it.id; el.fileList.appendChild(li); it.el = li; }
    const li = it.el;
    li.className = 'file status-' + it.status;
    const thumb = it.kind === 'video'
      ? (it.poster ? '<img class="thumb" src="' + it.poster.toDataURL('image/jpeg', 0.6) + '" alt="">' : '<div class="thumb video" aria-hidden="true">🎬</div>')
      : '<img class="thumb" src="' + esc(/^blob:/.test(String(it.outUrl || it.origUrl || '')) ? (it.outUrl || it.origUrl) : '') + '" alt="" loading="lazy" decoding="async">';
    const dims = it.w ? '<span class="dims">' + it.w + '×' + it.h + '</span>' : '';
    let state = '';
    if (it.status === 'queued') state = '<span class="st queued">Waiting…</span>';
    else if (it.status === 'processing') state = it.kind === 'video'
      ? '<span class="st processing"><i class="spinner"></i> Converting ' + round(it.progress * 100) + '%</span>'
      : '<span class="st processing"><i class="spinner"></i> Resizing…</span>';
    else if (it.status === 'ready') state = '<span class="st ready">Ready to convert</span>';
    else if (it.status === 'blocked') state = '<span class="st ready">Needs Pro</span>';
    else if (it.status === 'error') state = '<span class="st error">Failed</span>';
    else state = '<span class="st done">Done</span>';
    const out = it.status === 'done' ? '<span class="arrow">→</span><span class="out">' + it.outW + '×' + it.outH + '</span><span>' + (LABEL[it.outType] || '') + ' · ' + fmtBytes(it.outBlob.size) + '</span>' : '';
    const dur = it.kind === 'video' && it.duration ? '<span>' + fmtTime(it.duration) + '</span>' : '';
    const meta = '<div class="f-meta">' + dims + dur + '<span>' + fmtBytes(it.size) + '</span>' + out + state + (it.note ? '<span class="note">' + esc(it.note) + '</span>' : '') + '</div>' +
      (it.status === 'processing' && it.kind === 'video' ? '<div class="vprog"><i style="width:' + round(it.progress * 100) + '%"></i></div>' : '') +
      (it.error ? '<div class="f-error">' + esc(it.error) + '</div>' : '');
    let actions = '';
    if (it.status === 'done') actions += '<button type="button" class="btn btn-sm btn-primary" data-action="download" aria-label="Download ' + esc(it.name) + '">⬇ Download</button>';
    else if (it.status === 'ready' || it.status === 'error') actions += '<button type="button" class="btn btn-sm" data-action="convert">↻ Convert</button>';
    else if (it.status === 'blocked') actions += '<button type="button" class="btn btn-sm" data-action="capfree" title="Convert the first 30 s at up to 720p">Convert at 720p</button><button type="button" class="btn btn-sm btn-primary" data-action="pro">Pro</button>';
    else if (it.status === 'processing' && it.kind === 'video') actions += '<button type="button" class="btn btn-sm" data-action="stop">Stop</button>';
    actions += '<button type="button" class="btn btn-sm icon-btn" data-action="remove" aria-label="Remove ' + esc(it.name) + '">✕</button>';
    li.innerHTML = thumb + '<div class="f-main"><div class="f-name" title="' + esc(it.name) + '">' + esc(it.name) + '</div>' + meta + '</div><div class="f-actions">' + actions + '</div>';
  }

  function updateSummary() {
    const total = items.length;
    el.countPill.textContent = total;
    el.listCard.classList.toggle('hidden', total === 0);
    const done = items.filter((i) => i.status === 'done');
    const pending = items.filter((i) => i.status === 'queued' || i.status === 'processing').length;
    el.progress.classList.toggle('hidden', pending === 0);
    if (pending) el.progressBar.style.width = round(((total - pending) / total) * 100) + '%';
    el.downloadAllBtn.disabled = !done.length;
    el.zipBtn.disabled = !done.length;
    el.rerunBtn.disabled = !total;
    el.downloadHint.textContent = !total ? 'Drop files to start.'
      : pending ? 'Processing ' + pending + ' of ' + total + '…'
      : done.length === 1 ? '1 file ready' : done.length + ' files ready' + (!isPro() && done.length > FREE_DL ? ' · free: ' + FREE_DL + ' per Download all' : '');
  }

  // ---- Downloads ----
  function outputName(it, index) {
    const ext = EXT[it.outType] || extOf(it.name) || 'png';
    let name = (S.pattern || DEF.pattern)
      .replace(/\{name\}/g, () => baseName(it.name)).replace(/\{w\}/g, () => it.outW).replace(/\{h\}/g, () => it.outH).replace(/\{index\}/g, () => String(index + 1));
    // no path separators / control chars in downloaded names
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!name) name = baseName(it.name) + '-' + it.outW + 'x' + it.outH;
    return name + '.' + ext;
  }
  function downloadItem(it) {
    if (!it.outBlob) return;
    Studio.download(it.outBlob, outputName(it, items.indexOf(it)));
    track('download_click', { kind: it.kind, format: it.outType });
  }
  async function downloadAll() {
    let done = items.filter((i) => i.status === 'done');
    if (!done.length) return;
    let limited = false;
    if (!isPro() && done.length > FREE_DL) { limited = true; done = done.slice(0, FREE_DL); }
    el.downloadAllBtn.disabled = true;
    for (let i = 0; i < done.length; i++) {
      Studio.download(done[i].outBlob, outputName(done[i], items.indexOf(done[i])));
      if (i < done.length - 1) await new Promise((r) => setTimeout(r, 350));
    }
    el.downloadAllBtn.disabled = false;
    track('download_all', { count: done.length });
    if (limited) { toast('Free: Download all saves ' + FREE_DL + ' files at a time. Pro has no limit and adds ZIP.'); Studio.gate('batch'); }
    else toast(done.length + ' file' + (done.length > 1 ? 's' : '') + ' downloaded');
  }
  async function downloadZip() {
    if (!Studio.gate('zip')) return;
    const done = items.filter((i) => i.status === 'done');
    if (!done.length) return;
    el.zipBtn.disabled = true; toast('Building ZIP…');
    try {
      const used = new Set();
      const files = done.map((it, i) => {
        let name = outputName(it, items.indexOf(it)), base = name, n = 2;
        while (used.has(name)) { name = base.replace(/(\.[^.]+)$/, '-' + (n++) + '$1'); }
        used.add(name);
        return { name, blob: it.outBlob };
      });
      await Studio.zip(files, 'size-converter-' + stamp());
      track('download_zip', { count: files.length });
      toast('ZIP downloaded');
    } catch (e) { toast('Could not build the ZIP. Check your connection and try again.'); }
    el.zipBtn.disabled = false;
  }

  // ---- Sample image ----
  async function makeSample() {
    const w = 2000, h = 1200, c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1e3a8a'); g.addColorStop(0.55, '#7c3aed'); g.addColorStop(1, '#f97316');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i < 12; i++) { x.beginPath(); x.arc(200 + i * 160, 300 + Math.sin(i) * 180, 120, 0, Math.PI * 2); x.fill(); }
    x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 3;
    for (let i = 0; i <= w; i += 100) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
    for (let j = 0; j <= h; j += 100) { x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
    x.fillStyle = '#fff'; x.textAlign = 'center';
    x.font = '800 150px Inter, system-ui, sans-serif'; x.fillText('2000 × 1200', w / 2, h / 2 + 50);
    x.font = '600 48px Inter, system-ui, sans-serif'; x.fillText('Sample image · resize me', w / 2, h / 2 + 140);
    x.fillStyle = '#f97316'; Studio.roundRect(x, 60, 60, 260, 260, 40); x.fill();
    x.fillStyle = '#22c55e'; Studio.roundRect(x, w - 320, h - 320, 260, 260, 40); x.fill();
    const blob = await Studio.toBlob(c, 'image/png');
    return new File([blob], 'sample-2000x1200.png', { type: 'image/png' });
  }

  // ---- Saved size presets ----
  function loadPresets() {
    const p = Studio.safeParse(localStorage.getItem(PRESETS_KEY) || '[]', []);
    if (!Array.isArray(p)) return [];
    const KEYS = ['mode', 'w', 'h', 'percent', 'longest', 'preset', 'fit', 'anchor', 'noUpscale', 'padColor', 'padTransparent'];
    return p.filter((x) => x && typeof x === 'object').slice(0, 200).map((x) => {
      const o = sanitizeS(Studio.safeAssign({}, DEF, x)), out = { name: String(x.name == null ? '' : x.name).slice(0, 60) };
      KEYS.forEach((k) => { out[k] = o[k]; });
      return out;
    });
  }
  function storePresets() { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(savedPresets)); } catch (e) { /* noop */ } }
  function presetSummary(p) {
    if (p.mode === 'exact') return p.w + '×' + p.h;
    if (p.mode === 'percent') return p.percent + '%';
    if (p.mode === 'longest') return 'longest ' + p.longest;
    const d = PRESETS[p.preset]; return d ? (d.longest ? d.longest + ' px' : d.w + '×' + d.h) : p.preset;
  }
  function renderPresets() {
    if (!savedPresets.length) { el.presetList.innerHTML = '<p class="preset-empty">No saved presets yet. Set a size and fit, then save it for one-click reuse.</p>'; }
    else el.presetList.innerHTML = savedPresets.map((p, i) =>
      '<div class="preset-item"><span class="name" data-apply="' + i + '" role="button" tabindex="0" title="Apply">' + esc(p.name) + '<small>' + esc(presetSummary(p)) + ' · ' + esc(p.fit) + '</small></span>' +
      '<button type="button" class="btn btn-ghost" data-del="' + i + '" aria-label="Delete preset ' + esc(p.name) + '">✕</button></div>').join('');
    el.savedHint.textContent = isPro() ? 'Pro: unlimited saved presets' : 'Free: 1 saved preset · Pro: unlimited';
  }
  function savePreset() {
    const name = (el.presetName.value || '').trim().slice(0, 60) || ('Preset ' + (savedPresets.length + 1));
    if (!isPro() && savedPresets.length >= 1) { openPro('presets'); return; }
    savedPresets.push({ name, mode: S.mode, w: S.w, h: S.h, percent: S.percent, longest: S.longest, preset: S.preset, fit: S.fit, anchor: S.anchor, noUpscale: S.noUpscale, padColor: S.padColor, padTransparent: S.padTransparent });
    storePresets(); renderPresets(); el.presetName.value = ''; toast('Preset saved'); track('preset_save', {});
  }
  function applyPreset(p) {
    ['mode', 'w', 'h', 'percent', 'longest', 'preset', 'fit', 'anchor', 'noUpscale', 'padColor', 'padTransparent'].forEach((k) => { if (p[k] !== undefined) S[k] = p[k]; });
    sanitizeS(S);
    applyToUI(); onChange(); toast('Preset "' + p.name + '" applied'); track('preset_apply', {});
  }

  // ---- UI wiring ----
  let modeSeg, fitSeg, formatSeg;
  function syncExactFromReference() {
    const ref = referenceItem();
    el.exactHint.textContent = ref
      ? 'Lock on: typing one side computes the other from ' + ref.w + '×' + ref.h + ' (' + ref.name + ').'
      : 'With the lock on, typing one side computes the other from the first loaded file.';
  }
  function applyToUI() {
    modeSeg.set(S.mode); fitSeg.set(S.fit); formatSeg.set(S.format);
    el.wIn.value = S.w; el.hIn.value = S.h;
    el.lockBtn.classList.toggle('active', S.lock); el.lockBtn.setAttribute('aria-pressed', String(S.lock));
    el.pct.value = S.percent; el.pctV.textContent = S.percent + '%';
    el.longest.value = S.longest;
    el.presetSel.value = S.preset;
    el.noUpscale.checked = S.noUpscale;
    el.supersample.checked = S.supersample && isPro();
    el.anchorGrid.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === S.anchor));
    el.padColor.value = S.padColor; el.padTransparent.checked = S.padTransparent;
    el.quality.value = S.quality; el.qualityV.textContent = S.quality;
    el.pattern.value = S.pattern;
    updateHints();
  }
  function updateHints() {
    ['exact', 'percent', 'longest', 'preset'].forEach((m) => el[m + 'Row'].classList.toggle('hidden', S.mode !== m));
    const scaleMode = S.mode === 'percent' || S.mode === 'longest' || (S.mode === 'preset' && !!(PRESETS[S.preset] || {}).longest);
    const fh = {
      contain: 'Fits inside the box and keeps the aspect ratio – the result can be smaller than the box on one side.',
      cover: 'Fills the exact box and trims whatever does not fit. Use the anchor to choose which part to keep.',
      stretch: 'Forces the exact box without cropping – the image is distorted if the shapes differ.',
      pad: 'Keeps the whole image and fills the remaining space with a color or transparency.'
    };
    el.fitHint.textContent = scaleMode ? 'The output keeps the source shape in this mode, so Fit does not apply.' : fh[S.fit];
    el.anchorRow.classList.toggle('hidden', scaleMode || (S.fit !== 'cover' && S.fit !== 'pad'));
    el.padRow.classList.toggle('hidden', scaleMode || S.fit !== 'pad');
    el.fitSeg.querySelectorAll('button').forEach((b) => { b.disabled = scaleMode; });
    const p = PRESETS[S.preset];
    el.presetHint.textContent = p ? (p.longest ? p.label + ': longest side limited to ' + p.longest + ' px, ratio preserved.' : p.label + ': ' + p.w + ' × ' + p.h + ' px. Pick a Fit mode for images with a different shape.') : '';
    const fmtH = {
      keep: 'Each image keeps its format (GIF, BMP and SVG become PNG). Videos are always WebM.',
      'image/jpeg': 'Smallest files for photos. No transparency – padding becomes white.',
      'image/png': 'Lossless, keeps transparency. Best for logos, screenshots and icons.',
      'image/webp': 'About 30% smaller than JPG at the same quality, keeps transparency.'
    };
    el.formatHint.textContent = fmtH[S.format];
    el.qualityRow.classList.toggle('hidden', S.format === 'image/png');
    el.ssRow.classList.toggle('hidden', false);
    el.freeInfo.textContent = isPro() ? 'Pro: no badge · unlimited batch + ZIP · video ≤ 5 min, 4K' : 'Free: small badge on exports · Download all 10 at a time · video ≤ 30 s, 720p';
    el.videoLimits.innerHTML = isPro()
      ? '<li>Pro active: up to <b>5 min</b>, <b>1080p / 4K</b> output, no badge</li>'
      : '<li>Free: up to <b>30 s</b>, max <b>720p</b> output</li><li>Pro: up to <b>5 min</b>, <b>1080p / 4K</b> output</li>';
  }
  function onChange() {
    persist(); updateHints(); updateStage(); drawPreview(); scheduleRerun();
  }
  function setExact(side, val) {
    val = clamp(round(Number(val)) || 0, 1, MAX_SIDE);
    const ref = referenceItem();
    const ratio = ref ? ref.w / ref.h : (S.w / S.h || 1);
    if (side === 'w') { S.w = val; if (S.lock) { S.h = clamp(round(val / ratio), 1, MAX_SIDE); el.hIn.value = S.h; } }
    else { S.h = val; if (S.lock) { S.w = clamp(round(val * ratio), 1, MAX_SIDE); el.wIn.value = S.w; } }
  }

  function bind() {
    modeSeg = Studio.seg(el.modeSeg, (v) => { S.mode = v; onChange(); });
    fitSeg = Studio.seg(el.fitSeg, (v) => { S.fit = v; onChange(); });
    formatSeg = Studio.seg(el.formatSeg, (v) => { S.format = v; onChange(); });

    el.wIn.addEventListener('input', () => { if (el.wIn.value !== '') { setExact('w', el.wIn.value); onChange(); } });
    el.hIn.addEventListener('input', () => { if (el.hIn.value !== '') { setExact('h', el.hIn.value); onChange(); } });
    [el.wIn, el.hIn].forEach((i) => i.addEventListener('blur', () => { i.value = i === el.wIn ? S.w : S.h; }));
    el.lockBtn.addEventListener('click', () => { S.lock = !S.lock; el.lockBtn.classList.toggle('active', S.lock); el.lockBtn.setAttribute('aria-pressed', String(S.lock)); persist(); });

    el.pct.addEventListener('input', () => { S.percent = clamp(round(Number(el.pct.value)) || 1, 1, 400); el.pctV.textContent = S.percent + '%'; onChange(); });
    el.pctChips.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; S.percent = Number(b.dataset.value); el.pct.value = S.percent; el.pctV.textContent = S.percent + '%'; onChange(); });
    el.longest.addEventListener('input', () => { if (el.longest.value !== '') { S.longest = clamp(round(Number(el.longest.value)) || 1, 1, MAX_SIDE); onChange(); } });
    el.longest.addEventListener('blur', () => { el.longest.value = S.longest; });
    el.longestChips.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; S.longest = Number(b.dataset.value); el.longest.value = S.longest; onChange(); });
    el.presetSel.addEventListener('change', () => { S.preset = PRESETS[el.presetSel.value] ? el.presetSel.value : 'ig-square'; onChange(); });
    el.noUpscale.addEventListener('change', () => { S.noUpscale = el.noUpscale.checked; onChange(); });
    el.supersample.addEventListener('change', () => {
      if (el.supersample.checked && !isPro()) { el.supersample.checked = false; openPro('supersample'); return; }
      S.supersample = el.supersample.checked; onChange();
    });

    el.anchorGrid.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      S.anchor = b.dataset.value; el.anchorGrid.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); onChange();
    });
    el.padColor.addEventListener('input', () => { S.padColor = el.padColor.value; onChange(); });
    el.padTransparent.addEventListener('change', () => { S.padTransparent = el.padTransparent.checked; onChange(); });
    el.quality.addEventListener('input', () => { S.quality = clamp(round(Number(el.quality.value)) || 90, 10, 100); el.qualityV.textContent = S.quality; onChange(); });
    el.pattern.addEventListener('input', () => { S.pattern = el.pattern.value.slice(0, 80) || DEF.pattern; persist(); });

    el.savePreset.addEventListener('click', savePreset);
    el.presetName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); savePreset(); } });
    el.presetList.addEventListener('click', (e) => {
      const a = e.target.closest('[data-apply]'), d = e.target.closest('[data-del]');
      if (a) applyPreset(savedPresets[Number(a.dataset.apply)]);
      else if (d) { savedPresets.splice(Number(d.dataset.del), 1); storePresets(); renderPresets(); }
    });
    el.presetList.addEventListener('keydown', (e) => { const a = e.target.closest('[data-apply]'); if (a && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); applyPreset(savedPresets[Number(a.dataset.apply)]); } });

    // files
    Studio.dropzone(el.stage, addFiles, { accept: 'image/*,video/*,.mp4,.webm,.mov,.m4v', multiple: true, clickTarget: '.studio-drop' });
    el.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.stage.querySelector('input[type=file]').click(); } });
    el.sampleBtn.addEventListener('click', async (e) => { e.stopPropagation(); el.sampleBtn.disabled = true; try { addFiles([await makeSample()]); track('sample', {}); } finally { el.sampleBtn.disabled = false; } });
    el.fileList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const li = btn.closest('li'); const it = items.find((i) => String(i.id) === li.dataset.id); if (!it) return;
      const a = btn.dataset.action;
      if (a === 'download') downloadItem(it);
      else if (a === 'remove') removeItem(it);
      else if (a === 'convert') { it.capFree = false; requeue(it, { auto: true }); pump(); }
      else if (a === 'capfree') { it.capFree = true; requeue(it, { auto: true }); pump(); }
      else if (a === 'pro') openPro('video');
      else if (a === 'stop') { if (it.abort) it.abort(); it.status = 'ready'; it.note = 'Stopped'; }
    });
    el.rerunBtn.addEventListener('click', rerunAll);
    el.clearBtn.addEventListener('click', clearAll);
    el.downloadAllBtn.addEventListener('click', downloadAll);
    el.zipBtn.addEventListener('click', downloadZip);

    document.addEventListener('pro:changed', () => { if (!isPro()) S.supersample = false; applyToUI(); renderPresets(); updateSummary(); drawPreview(); items.forEach((it) => { if (it.status === 'blocked') requeue(it, { auto: true }); else if (it.outBlob || it.kind === 'image') requeue(it); }); pump(); });
    window.addEventListener('beforeunload', () => { items.forEach((it) => { if (it.abort) it.abort(); }); });
  }

  function init() {
    const price = C.PRO_PRICE || '$9';
    if (el.proPrice) el.proPrice.textContent = price;
    document.querySelectorAll('[data-pro-price]').forEach((n) => { n.textContent = price; });
    bind();
    applyToUI();
    renderPresets();
    syncExactFromReference();
    updateStage(); updateSummary();
    el.recorderSupport.textContent = videoSupported
      ? 'This browser records ' + (pickMime() || 'WebM') + '.'
      : 'This browser cannot record video (no MediaRecorder). Use Chrome, Edge or Firefox for video resizing.';
    el.preview.classList.add('hidden');
  }

  // small debug/test surface
  window.SizeConverter = { addFiles, computePlan, items: () => items, settings: S, makeSample, downloadAll, downloadZip };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
