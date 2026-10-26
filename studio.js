/* ===== Shared "Studio" helpers for creative tools (canvas import/export, drop zones, ZIP) =====
 * Exposes window.Studio. Depends on monetize.js (isPro, toast, track, openPro).
 */
(function () {
  const C = window.APP_CONFIG || {};
  const S = {};

  // ---- files & images ----
  S.readImage = function (file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !/^image\//.test(file.type)) return reject(new Error('Not an image'));
      if ('createImageBitmap' in window && !/svg/.test(file.type)) {
        createImageBitmap(file, { imageOrientation: 'from-image' }).then(resolve).catch(() => {
          const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = URL.createObjectURL(file);
        });
      } else {
        const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = URL.createObjectURL(file);
      }
    });
  };
  S.readImageFromURL = function (url) {
    return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
  };
  // Wire a drop zone: element gets .dragover, calls onFiles(FileList). Also clipboard paste on document.
  S.dropzone = function (el, onFiles, opts) {
    opts = opts || {};
    const input = document.createElement('input'); input.type = 'file'; input.accept = opts.accept || 'image/*'; input.multiple = !!opts.multiple; input.style.display = 'none';
    el.appendChild(input);
    input.addEventListener('change', () => { if (input.files.length) onFiles(input.files); input.value = ''; });
    el.addEventListener('click', e => { if (opts.clickTarget && !e.target.closest(opts.clickTarget)) return; input.click(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.remove('dragover'); }));
    el.addEventListener('drop', e => { if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
    if (opts.paste !== false) document.addEventListener('paste', e => {
      const files = [...(e.clipboardData.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
      if (files.length) onFiles(files);
    });
    return { open: () => input.click() };
  };

  // ---- geometry ----
  S.fit = function (w, h, maxW, maxH) { const r = Math.min(maxW / w, maxH / h, 1); return { w: Math.round(w * r), h: Math.round(h * r), r }; };
  S.cover = function (sw, sh, dw, dh) { const r = Math.max(dw / sw, dh / sh); const w = sw * r, h = sh * r; return { sx: (w - dw) / 2 / r, sy: (h - dh) / 2 / r, sw: dw / r, sh: dh / r }; };
  S.roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };
  // Wrap text into lines that fit maxWidth
  S.wrapText = function (ctx, text, maxWidth) {
    const out = [];
    String(text).split('\n').forEach(par => {
      const words = par.split(' '); let line = '';
      words.forEach(w => { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxWidth && line) { out.push(line); line = w; } else line = t; });
      out.push(line);
    });
    return out;
  };
  S.hexToRgba = function (hex, a) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a == null ? 1 : a})`; };

  // ---- watermark (free tier) ----
  S.watermark = function (ctx, w, h, text) {
    if (window.isPro && isPro()) return;
    text = text || ((C.APP_NAME || 'Be Management Tools') + ' · free');
    ctx.save();
    const fs = Math.max(12, Math.round(Math.min(w, h) * 0.022));
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'bottom'; ctx.textAlign = 'right';
    const pad = Math.round(fs * 0.9), tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; S.roundRect(ctx, w - tw - pad * 2.2, h - fs - pad * 1.9, tw + pad * 1.6, fs + pad * 1.1, fs); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText(text, w - pad * 1.4, h - pad * 1.35);
    ctx.restore();
  };

  // ---- export ----
  S.toBlob = (canvas, type, quality) => new Promise(res => canvas.toBlob(res, type || 'image/png', quality));
  S.download = function (blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  S.safeName = s => String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
  // Render at scale using a draw(ctx, w, h) callback; applies watermark when not Pro; downloads.
  S.exportPNG = async function (draw, w, h, opts) {
    opts = opts || {};
    const scale = opts.scale || 1;
    const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d'); ctx.scale(scale, scale);
    await draw(ctx, w, h);
    if (opts.watermark !== false) { ctx.setTransform(1, 0, 0, 1, 0, 0); S.watermark(ctx, c.width, c.height, opts.watermarkText); }
    const blob = await S.toBlob(c, opts.type || 'image/png', opts.quality);
    if (opts.download !== false) S.download(blob, (opts.name || S.safeName(C.APP_NAME)) + (opts.type === 'image/jpeg' ? '.jpg' : opts.type === 'image/webp' ? '.webp' : '.png'));
    if (window.track) track('download', { format: opts.type || 'png', scale });
    return blob;
  };
  S.copyCanvas = async function (canvas) {
    try {
      const blob = await S.toBlob(canvas, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied to clipboard'); track('copy', {}); return true;
    } catch (e) { toast('Clipboard not available here. Use Download instead.'); return false; }
  };
  // Lazy JSZip
  S.zip = async function (files, name) {
    if (!window.JSZip) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const z = new JSZip(); files.forEach(f => z.file(f.name, f.blob));
    const blob = await z.generateAsync({ type: 'blob' }); S.download(blob, (name || 'export') + '.zip'); return blob;
  };

  // ---- small UI helpers ----
  S.seg = function (el, onChange) { // segmented control: buttons with data-value
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); onChange(b.dataset.value, b); }));
    return { set(v) { el.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.value === v)); }, get() { return (el.querySelector('button.active') || {}).dataset?.value; } };
  };
  S.bindRange = function (input, out, fmt) { const f = () => { if (out) out.textContent = fmt ? fmt(input.value) : input.value; }; input.addEventListener('input', f); f(); };
  S.debounce = function (fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms || 120); }; };
  S.raf = function (fn) { let p = false; return () => { if (p) return; p = true; requestAnimationFrame(() => { p = false; fn(); }); }; };
  S.persist = function (key, state) { try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {} };
  S.restore = function (key, fallback) { try { return Object.assign({}, fallback, JSON.parse(localStorage.getItem(key) || '{}')); } catch (e) { return Object.assign({}, fallback); } };
  // Pro gate helper: returns true if allowed, else opens the Pro modal
  S.gate = function (feature) { if (window.isPro && isPro()) return true; openPro(feature); return false; };

  window.Studio = S;
})();
