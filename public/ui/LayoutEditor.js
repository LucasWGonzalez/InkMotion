import { renderStoryQR } from '../utils/QRGenerator.js';
import { DEFAULT_LAYOUT, normalizeLayout } from '../core/MasterSheetGenerator.js';

const STORAGE_KEY = 'inkmotion-layout-v1';
const clone = (value) => JSON.parse(JSON.stringify(value));
let layout = normalizeLayout(loadSaved() || DEFAULT_LAYOUT);
window.InkMotionLayoutConfig = clone(layout);

function loadSaved() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { return null; }
}

function save() {
  window.InkMotionLayoutConfig = clone(layout);
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {}
  renderPreview();
  updateStatus();
}

function el(id) { return document.getElementById(id); }
function pct(value) { return `${Math.round(value * 100)}%`; }

function setPreset(name) {
  layout.frame.preset = name;
  document.querySelectorAll('[data-frame-preset]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.framePreset === name);
    button.setAttribute('aria-pressed', button.dataset.framePreset === name ? 'true' : 'false');
  });
  save();
}

function syncControls() {
  el('layout-qr-placement').value = layout.qr.placement;
  el('layout-qr-size').value = layout.qr.scale;
  el('layout-qr-size-value').textContent = pct(layout.qr.scale);
  el('layout-qr-background').value = layout.qr.background;
  el('layout-frame-color').value = layout.frame.color;
  el('layout-frame-width').value = layout.frame.width;
  el('layout-frame-width-value').textContent = `${(layout.frame.width * 100).toFixed(1)}%`;
  el('layout-frame-auto').checked = layout.frame.autoColor;
  setPreset(layout.frame.preset);
}

async function drawQrPreview() {
  const canvas = el('layout-qr-canvas');
  if (!canvas || canvas.dataset.ready === 'true') return;
  try {
    await renderStoryQR(canvas, 'https://ink-motion-pied.vercel.app/v/preview', { width: 256, margin: 3, errorCorrectionLevel: 'H' });
    canvas.dataset.ready = 'true';
  } catch (error) {
    console.warn('[InkMotion/Layout] No se pudo dibujar el QR de preview.', error);
  }
}

function renderPreview() {
  const source = el('author-preview');
  const previewImage = el('layout-preview-image');
  const stage = el('layout-preview-stage');
  const qr = el('layout-qr-handle');
  const frame = el('layout-frame-preview');
  const outsideBand = el('layout-outside-band');
  if (!source || !previewImage || !stage || !qr || !frame) return;
  if (source.src) {
    previewImage.src = source.src;
    stage.classList.add('has-image');
  }
  frame.dataset.preset = layout.frame.preset;
  frame.style.setProperty('--frame-color', layout.frame.autoColor ? 'currentColor' : layout.frame.color);
  frame.style.setProperty('--frame-width', `${Math.max(1, layout.frame.width * 500)}px`);
  frame.classList.toggle('is-auto', layout.frame.autoColor);
  qr.style.width = `${layout.qr.scale * 100}%`;
  qr.style.left = `${layout.qr.x * 100}%`;
  qr.style.top = `${layout.qr.y * 100}%`;
  qr.dataset.background = layout.qr.background;
  const outside = layout.qr.placement === 'outside';
  stage.classList.toggle('qr-outside', outside);
  outsideBand.hidden = !outside;
  qr.classList.toggle('is-outside', outside);
  qr.setAttribute('aria-label', outside ? 'QR en banda exterior' : 'Arrastrá para ubicar el QR dentro de la obra');
  if (outside) {
    qr.style.left = 'auto';
    qr.style.top = 'auto';
    qr.style.right = '4%';
    qr.style.bottom = '-23%';
  } else {
    qr.style.removeProperty('right');
    qr.style.removeProperty('bottom');
  }
  drawQrPreview();
}

function updateStatus() {
  const status = el('layout-quality');
  if (!status) return;
  const qrSafe = layout.qr.placement === 'outside' || layout.qr.scale >= 0.105;
  const frameSafe = layout.frame.preset === 'none' || layout.frame.width >= 0.0035;
  const message = !qrSafe
    ? 'Revisar · aumentá el tamaño del QR para una lectura más confiable.'
    : !frameSafe
      ? 'Revisar · el marco es demasiado fino para impresión.'
      : 'Diseño listo · InkMotion hará la validación final del tracking al publicar.';
  status.dataset.state = qrSafe && frameSafe ? 'good' : 'warning';
  status.textContent = message;
}

function bindDrag() {
  const qr = el('layout-qr-handle');
  const art = el('layout-artwork');
  if (!qr || !art) return;
  let dragging = false;
  const move = (event) => {
    if (!dragging || layout.qr.placement !== 'inside') return;
    const rect = art.getBoundingClientRect();
    const sizePx = Math.min(rect.width, rect.height) * layout.qr.scale;
    const x = Math.max(0, Math.min(rect.width - sizePx, event.clientX - rect.left - sizePx / 2));
    const y = Math.max(0, Math.min(rect.height - sizePx, event.clientY - rect.top - sizePx / 2));
    layout.qr.x = x / rect.width;
    layout.qr.y = y / rect.height;
    save();
  };
  qr.addEventListener('pointerdown', (event) => {
    if (layout.qr.placement !== 'inside') return;
    dragging = true;
    qr.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  qr.addEventListener('pointermove', move);
  qr.addEventListener('pointerup', () => { dragging = false; });
  qr.addEventListener('pointercancel', () => { dragging = false; });
}

function bindControls() {
  el('layout-qr-placement').addEventListener('change', (event) => { layout.qr.placement = event.target.value; save(); });
  el('layout-qr-size').addEventListener('input', (event) => {
    layout.qr.scale = Number(event.target.value);
    el('layout-qr-size-value').textContent = pct(layout.qr.scale);
    save();
  });
  el('layout-qr-background').addEventListener('change', (event) => { layout.qr.background = event.target.value; save(); });
  el('layout-frame-color').addEventListener('input', (event) => { layout.frame.color = event.target.value; layout.frame.autoColor = false; el('layout-frame-auto').checked = false; save(); });
  el('layout-frame-width').addEventListener('input', (event) => {
    layout.frame.width = Number(event.target.value);
    el('layout-frame-width-value').textContent = `${(layout.frame.width * 100).toFixed(1)}%`;
    save();
  });
  el('layout-frame-auto').addEventListener('change', (event) => { layout.frame.autoColor = event.target.checked; save(); });
  document.querySelectorAll('[data-frame-preset]').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.framePreset)));
  document.querySelectorAll('[data-qr-position]').forEach((button) => button.addEventListener('click', () => {
    const positions = { tl: [0.035, 0.035], tr: [0.82, 0.035], bl: [0.035, 0.82], br: [0.82, 0.82] };
    [layout.qr.x, layout.qr.y] = positions[button.dataset.qrPosition] || positions.br;
    layout.qr.placement = 'inside';
    el('layout-qr-placement').value = 'inside';
    save();
  }));
  el('layout-reset').addEventListener('click', () => {
    layout = normalizeLayout(DEFAULT_LAYOUT);
    syncControls();
    save();
  });
}

function observeArtwork() {
  const source = el('author-preview');
  if (!source) return;
  const observer = new MutationObserver(renderPreview);
  observer.observe(source, { attributes: true, attributeFilter: ['src', 'hidden'] });
  source.addEventListener('load', renderPreview);
}

function start() {
  if (!el('layout-studio')) return;
  syncControls();
  bindControls();
  bindDrag();
  observeArtwork();
  renderPreview();
  updateStatus();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
