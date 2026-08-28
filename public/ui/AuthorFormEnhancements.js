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

function mediaReady() {
  return el('image-validation')?.dataset.state === 'ready'
    && el('video-validation')?.dataset.state === 'ready';
}

function titleReady() {
  return Boolean(el('story-title')?.value?.trim());
}

function syncPublishButton() {
  const button = el('btn-publish');
  const title = el('story-title');
  if (!button || !title) return;
  // Only gate author readiness here. app.js owns the temporary disabled state while publishing.
  button.disabled = !(titleReady() && mediaReady());
  button.setAttribute('aria-disabled', String(button.disabled));
  title.setAttribute('aria-required', 'true');
}

function showTitleRequirement() {
  const title = el('story-title');
  const build = el('build-status');
  const label = el('build-label');
  if (!title || titleReady()) return false;
  if (build) build.dataset.state = 'warning';
  if (label) label.textContent = 'Escribí un título para crear la obra aumentada.';
  title.focus();
  title.reportValidity();
  return true;
}

function installTitleGuard() {
  const title = el('story-title');
  const form = el('publish-form');
  const button = el('btn-publish');
  if (!title || !form || !button) return;

  title.required = true;
  title.addEventListener('input', syncPublishButton);
  title.addEventListener('change', syncPublishButton);

  form.addEventListener('submit', (event) => {
    if (!showTitleRequirement()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    syncPublishButton();
  }, true);

  button.addEventListener('click', () => {
    if (!titleReady() || !mediaReady()) return;
    const label = el('build-label');
    if (label) label.textContent = 'Iniciando publicación…';
  }, true);

  ['image-validation', 'video-validation'].forEach((id) => {
    const node = el(id);
    if (!node) return;
    new MutationObserver(syncPublishButton).observe(node, {
      attributes: true,
      attributeFilter: ['data-state'],
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  syncPublishButton();
}

function ensurePublishedPreview() {
  const result = el('publish-result');
  if (!result) return;
  const sync = () => {
    if (result.hidden) return;
    const canvas = el('story-qr');
    const wrap = el('qr-canvas-wrap');
    const download = el('btn-download-sheet');
    if (canvas?.width && canvas?.height) {
      canvas.hidden = false;
      if (wrap) wrap.hidden = false;
      if (download) download.disabled = false;
    }
  };
  new MutationObserver(sync).observe(result, { attributes: true, attributeFilter: ['hidden'] });
  sync();
}

function start() {
  installVersionedDownloads();
  installTitleGuard();
  ensurePublishedPreview();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
