/* ===== Shared monetization + theme helpers (v2). Reads window.APP_CONFIG from config.js =====
 * - Theme toggle, toast, GA4, AdSense slots
 * - Pro licensing with real Lemon Squeezy License API validation (activate / validate / deactivate)
 * - Newsletter / lead capture (any form endpoint: Formspree, ConvertKit, Beehiiv, custom)
 */
(function () {
  const C = window.APP_CONFIG || {};

  // ---- Theme ----
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  else if (matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.setAttribute('data-theme', 'light');
  window.toggleTheme = function () {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', cur);
    localStorage.setItem('theme', cur);
  };

  // ---- Toast ----
  let toastEl = null;
  window.toast = function (msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._h); toastEl._h = setTimeout(() => toastEl.classList.remove('show'), 2600);
  };

  // ---- Analytics (GA4) – only if configured ----
  if (C.GA_ID) {
    const s = document.createElement('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + C.GA_ID; document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date()); gtag('config', C.GA_ID);
  }
  window.track = function (ev, params) { if (window.gtag) gtag('event', ev, params || {}); };

  // ---- AdSense – only if configured; otherwise slots show a placeholder ----
  function mountAds() {
    if (!C.ADSENSE_CLIENT) return;
    const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + C.ADSENSE_CLIENT;
    document.head.appendChild(s);
    document.querySelectorAll('.ad-slot').forEach(el => {
      const ins = document.createElement('ins'); ins.className = 'adsbygoogle'; ins.style.display = 'block';
      ins.setAttribute('data-ad-client', C.ADSENSE_CLIENT);
      ins.setAttribute('data-ad-slot', el.dataset.slot || '');
      ins.setAttribute('data-ad-format', 'auto'); ins.setAttribute('data-full-width-responsive', 'true');
      el.appendChild(ins); (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  // ---- Pro licensing (Lemon Squeezy License API) ----
  const LIC = Object.assign({ provider: 'lemonsqueezy', store_id: '', product_id: '', variant_id: '', recheck_days: 7, test_keys: [] }, C.LICENSE || {});
  const K = { flag: 'pro_license', key: 'pro_license_key', inst: 'pro_instance_id', at: 'pro_checked_at' };
  const LS_API = 'https://api.lemonsqueezy.com/v1/licenses/';

  window.isPro = function () { return localStorage.getItem(K.flag) === '1'; };
  function licenseConfigured() { return !!(LIC.product_id || LIC.store_id || LIC.variant_id); }
  function setPro(on, key, instanceId) {
    if (on) {
      localStorage.setItem(K.flag, '1');
      if (key) localStorage.setItem(K.key, key);
      if (instanceId) localStorage.setItem(K.inst, instanceId);
      localStorage.setItem(K.at, String(Date.now()));
    } else {
      Object.values(K).forEach(k => localStorage.removeItem(k));
    }
    document.dispatchEvent(new Event('pro:changed'));
    renderProStatus();
  }
  async function lsPost(path, body) {
    const r = await fetch(LS_API + path, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    });
    let data = null; try { data = await r.json(); } catch (e) { data = {}; }
    return data || {};
  }
  function matchesProduct(meta) {
    if (!meta) return false;
    if (LIC.product_id && String(meta.product_id) !== String(LIC.product_id)) return false;
    if (LIC.store_id && String(meta.store_id) !== String(LIC.store_id)) return false;
    if (LIC.variant_id && String(meta.variant_id) !== String(LIC.variant_id)) return false;
    return true;
  }
  function friendlyError(res) {
    const e = (res && res.error) ? String(res.error) : '';
    if (/activation limit/i.test(e)) return 'This key has reached its device limit. Deactivate it on another device first.';
    if (/expired/i.test(e)) return 'This license has expired.';
    if (/disabled|not found|invalid/i.test(e)) return 'Invalid license key.';
    return e || 'Could not validate the license. Please try again.';
  }

  window.activateLicense = async function (key) {
    key = (key || '').trim();
    if (!key) { toast('Enter your license key'); return false; }
    // Local test keys (owner testing only – set LICENSE.test_keys in config.js)
    if (Array.isArray(LIC.test_keys) && LIC.test_keys.includes(key)) {
      setPro(true, key, 'test'); toast('Pro activated (test key) 🎉'); closePro(); return true;
    }
    if (!licenseConfigured()) { toast('License validation is not set up yet. Contact support.'); return false; }
    toast('Checking license…');
    try {
      const instanceName = (C.APP_NAME || 'app') + ' · ' + (navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || 'web');
      const res = await lsPost('activate', { license_key: key, instance_name: instanceName });
      if (res.activated && matchesProduct(res.meta)) {
        setPro(true, key, res.instance && res.instance.id);
        track('license_activated', {});
        toast('Pro activated 🎉'); closePro(); return true;
      }
      if (res.activated && !matchesProduct(res.meta)) {
        // key is for another product – release the activation we just consumed
        try { await lsPost('deactivate', { license_key: key, instance_id: res.instance && res.instance.id }); } catch (e) {}
        toast('This key belongs to a different product.'); return false;
      }
      toast(friendlyError(res)); return false;
    } catch (e) {
      toast('Network error while checking the license. Try again.'); return false;
    }
  };

  window.deactivateLicense = async function () {
    const key = localStorage.getItem(K.key), inst = localStorage.getItem(K.inst);
    if (key && inst && inst !== 'test' && licenseConfigured()) {
      try { await lsPost('deactivate', { license_key: key, instance_id: inst }); } catch (e) {}
    }
    setPro(false); toast('Pro deactivated on this device');
  };

  async function recheckLicense() {
    if (!isPro()) return;
    const key = localStorage.getItem(K.key), inst = localStorage.getItem(K.inst);
    if (!key || inst === 'test' || !licenseConfigured()) return;
    const at = Number(localStorage.getItem(K.at) || 0);
    if (Date.now() - at < (LIC.recheck_days || 7) * 864e5) return;
    try {
      const res = await lsPost('validate', { license_key: key, instance_id: inst || '' });
      if (res.valid === true && matchesProduct(res.meta)) { localStorage.setItem(K.at, String(Date.now())); }
      else if (res.valid === false) { setPro(false); toast('Your Pro license is no longer valid.'); }
    } catch (e) { /* offline: keep Pro until next check */ }
  }

  function renderProStatus() {
    const modal = document.getElementById('proModal'); if (!modal) return;
    let st = modal.querySelector('.pro-status');
    if (!st) { st = document.createElement('p'); st.className = 'hint pro-status'; modal.querySelector('.card').appendChild(st); }
    if (isPro()) {
      const key = localStorage.getItem(K.key) || '';
      st.innerHTML = '✅ Pro is active on this device' + (key ? ' (key …' + key.slice(-6) + ')' : '') +
        ' · <a href="#" onclick="deactivateLicense();return false;">Deactivate</a>';
    } else st.innerHTML = '';
  }

  window.openPro = function (source) {
    track('pro_click', { source: source || 'unknown' });
    const m = document.getElementById('proModal');
    if (m) { m.classList.add('open'); renderProStatus(); const i = m.querySelector('#licenseKey'); return; }
    if (C.PRO_CHECKOUT_URL) window.open(C.PRO_CHECKOUT_URL, '_blank');
  };
  window.closePro = function () { const m = document.getElementById('proModal'); if (m) m.classList.remove('open'); };
  window.goCheckout = function () {
    track('begin_checkout', {});
    if (C.PRO_CHECKOUT_URL) window.open(C.PRO_CHECKOUT_URL, '_blank');
    else toast('Checkout is not available yet. Set PRO_CHECKOUT_URL in config.js');
  };

  // ---- Newsletter / lead capture ----
  const NL = Object.assign({ url: '', field: 'email' }, C.NEWSLETTER || {});
  function mountLead() {
    const card = document.getElementById('leadCard'); if (!card) return;
    if (!NL.url || localStorage.getItem('newsletter_subscribed') === '1') { card.remove(); return; }
    card.hidden = false;
    const input = card.querySelector('input[type=email]'); if (input && NL.field) input.name = NL.field;
  }
  window.subscribeNewsletter = async function (ev) {
    ev.preventDefault();
    const form = ev.target, btn = form.querySelector('button'), email = (form.querySelector('input[type=email]') || {}).value || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email'); return false; }
    btn.disabled = true;
    try {
      const fd = new FormData(form); fd.append('source', (C.APP_NAME || '') + ' ' + location.pathname);
      const r = await fetch(NL.url, { method: 'POST', headers: { 'Accept': 'application/json' }, body: fd, mode: 'cors' });
      if (r.ok || r.type === 'opaque') {
        localStorage.setItem('newsletter_subscribed', '1'); track('newsletter_signup', {});
        form.closest('.lead-card').innerHTML = '<h3>You\'re in 🎉</h3><p class="hint">Check your inbox to confirm your email.</p>';
      } else { toast('Could not subscribe. Please try again.'); btn.disabled = false; }
    } catch (e) { toast('Could not subscribe. Please try again.'); btn.disabled = false; }
    return false;
  };

  document.addEventListener('DOMContentLoaded', () => {
    mountAds(); mountLead(); renderProStatus(); recheckLicense();
    document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closePro(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePro(); });
    const lk = document.getElementById('licenseKey');
    if (lk) lk.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); activateLicense(lk.value); } });
  });
})();
