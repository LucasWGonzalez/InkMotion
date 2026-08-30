const VERSION_FALLBACK = 3;

function el(id) { return document.getElementById(id); }

function layoutVersion() {
  const value = Number(window.InkMotionLayoutConfig?.version);
  return Number.isFinite(value) && value > 0 ? value : VERSION_FALLBACK;
}

function timestamp() {
  const now = new Date();
  const two = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

function slug(value) {
  return String(value || 'Lamina')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'Lamina';
}

function pdfFilename() {
  const title = el('story-title')?.value?.trim() || 'Lamina';
  return `InkMotion_${slug(title)}_v${layoutVersion()}_${timestamp()}.pdf`;
}

function installVersionedDownloads() {
  if (window.__inkmotionVersionedDownloadsInstalled) return;
  window.__inkmotionVersionedDownloadsInstalled = true;
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedInkMotionDownload() {
    if (this.download === 'InkMotion_Lamina_Final.pdf') this.download = pdfFilename();
    return nativeClick.call(this);
  };
}

function ensurePublishedPreview() {
  const result = el('publish-result');
  if (!result) return;
  const sync = () => {
    if (result.hidden) return;
    const preview = el('story-sheet-preview');
    const wrap = el('qr-canvas-wrap');
    const download = el('btn-download-sheet');
    if (preview?.src) {
      preview.hidden = false;
      if (wrap) wrap.hidden = false;
      if (download) download.disabled = false;
    }
  };
  new MutationObserver(sync).observe(result, { attributes: true, attributeFilter: ['hidden'] });
  sync();
}

function start() {
  installVersionedDownloads();
  ensurePublishedPreview();
  if (el('btn-view-projects')) el('btn-view-projects').textContent = 'Ver Mis obras';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
