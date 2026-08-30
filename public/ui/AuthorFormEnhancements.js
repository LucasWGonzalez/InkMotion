import { installLiquidInkBackground } from '../core/LiquidInkBackground.js';

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

function stepHeader(number, label, title, description) {
  const header = document.createElement('div');
  header.className = 'flow-section-heading';
  header.innerHTML = `<span class="flow-step">${number}</span><div><span class="flow-kicker">${label}</span><h3>${title}</h3><p>${description}</p></div>`;
  return header;
}

function installStepHierarchy() {
  const upload = document.querySelector('.upload-card');
  const oldHeading = document.querySelector('.creator-grid')?.previousElementSibling;
  if (upload && oldHeading?.classList.contains('flow-section-heading')) {
    oldHeading.replaceWith(stepHeader('01', 'PASO 1 · ARCHIVOS', 'Uní la obra con su animación', 'Cargá la imagen que se imprimirá y el video que aparecerá sobre ella.'));
    upload.prepend(document.querySelector('.creator-grid')?.previousElementSibling);
  }

  const uploadLabels = upload?.querySelectorAll('.drop-icon');
  if (uploadLabels?.[0]) uploadLabels[0].textContent = 'IMG';
  if (uploadLabels?.[1]) uploadLabels[1].textContent = 'MP4';

  const publish = document.querySelector('.publish-card');
  if (publish && !publish.querySelector('.flow-section-heading')) {
    publish.prepend(stepHeader('03', 'PASO 3 · PUBLICAR', 'Dale un nombre y creá la obra', 'Revisá los archivos y generá la Lámina Maestra junto con su experiencia AR.'));
  }
}

function start() {
  installLiquidInkBackground();
  installVersionedDownloads();
  ensurePublishedPreview();
  installStepHierarchy();
  if (el('btn-view-projects')) el('btn-view-projects').textContent = 'Ver Mis obras';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
