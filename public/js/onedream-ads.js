// Sponsored slot for the public website pages. Fills every
// <div data-onedream-ad="home|shop|search|category"></div> with one ad from
// /api/ads/serve (paid campaigns and One Dream's own house ads, the same
// rules as the app) and reports impressions and clicks to /api/ads/event.
// Renders nothing when no ad is live, and never breaks the page.
(function () {
  var PLACEMENTS = { home: 1, shop: 1, search: 1, category: 1 };
  var KEY = 'onedream_ad_viewer_v1';

  function viewerId() {
    try {
      var id = localStorage.getItem(KEY);
      if (id && id.length >= 16) return id;
      id = '';
      var bytes = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) id += ('0' + bytes[i].toString(16)).slice(-2);
      localStorage.setItem(KEY, id);
      return id;
    } catch (e) {
      return '';
    }
  }

  function track(adId, kind, placement) {
    try {
      fetch('/api/ads/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ad-Viewer': viewerId() },
        body: JSON.stringify({ campaign_id: adId, kind: kind, placement: placement }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function href(ad) {
    var d = ad.destination || {};
    if (d.type === 'listing' && d.listing_id) return '/app/catalogue/item/' + encodeURIComponent(d.listing_id);
    if (d.type === 'profile' && d.username) return '/app/catalogue/' + encodeURIComponent(d.username);
    if (d.type === 'external' && /^https:\/\//i.test(d.url || '')) return d.url;
    return null;
  }

  function el(tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text) node.textContent = text;
    return node;
  }

  function render(slot, ad, placement) {
    var link = href(ad);
    if (!link) return;
    var external = ad.destination.type === 'external';
    var card = el('a', 'display:block;max-width:720px;margin:24px auto;border:1px solid rgba(148,163,184,.35);border-radius:18px;overflow:hidden;text-decoration:none;color:inherit;background:rgba(15,23,42,.04);font-family:inherit');
    card.href = link;
    if (external) { card.target = '_blank'; card.rel = 'noopener noreferrer sponsored'; }
    card.setAttribute('aria-label', (ad.house ? 'From One Dream: ' : 'Sponsored: ') + ad.title);

    var media = (ad.media || [])[0];
    if (media) {
      var wrap = el('div', 'position:relative;aspect-ratio:16/9;background:#e2e8f0');
      var img = el('img', 'width:100%;height:100%;object-fit:cover;display:block');
      img.src = media.type === 'video' ? (media.poster || media.url) : media.url;
      img.alt = '';
      img.loading = 'lazy';
      wrap.appendChild(img);
      if (media.type === 'video') wrap.appendChild(el('span', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:48px;height:48px;border-radius:24px;background:rgba(15,23,42,.7);color:#fff;font-size:20px;line-height:48px;text-align:center', '▶'));
      wrap.appendChild(el('span', 'position:absolute;left:10px;top:10px;border-radius:999px;padding:3px 9px;background:rgba(15,23,42,.72);color:#fff;font-size:11px;font-weight:700', ad.house ? 'From One Dream' : 'Sponsored'));
      card.appendChild(wrap);
    }
    var copy = el('div', 'padding:14px 16px');
    copy.appendChild(el('div', 'font-weight:700;font-size:15px;margin-bottom:4px', ad.title));
    if (ad.body) copy.appendChild(el('div', 'font-size:13px;opacity:.75;margin-bottom:8px', ad.body));
    copy.appendChild(el('span', 'display:inline-block;border-radius:999px;padding:6px 12px;background:#dbeafe;color:#1e40af;font-size:13px;font-weight:700', (ad.cta_label || 'View') + (external ? ' ↗' : ' ›')));
    card.appendChild(copy);
    card.addEventListener('click', function () { track(ad.id, 'click', placement); });

    slot.innerHTML = '';
    slot.appendChild(card);
    track(ad.id, 'impression', placement);
  }

  function fill(slot) {
    var placement = slot.getAttribute('data-onedream-ad');
    if (!PLACEMENTS[placement]) return;
    fetch('/api/ads/serve?placement=' + placement + '&ads=1&boosts=0', { headers: { 'X-Ad-Viewer': viewerId() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && data.ads && data.ads[0]) render(slot, data.ads[0], placement); })
      .catch(function () {});
  }

  function start() {
    var slots = document.querySelectorAll('[data-onedream-ad]');
    for (var i = 0; i < slots.length; i++) fill(slots[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
