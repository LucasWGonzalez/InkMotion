import MasterSheetGenerator, { DEFAULT_LAYOUT, normalizeLayout } from '../core/MasterSheetGenerator.js';
import { renderStoryQR } from '../utils/QRGenerator.js';

const STORAGE_KEY = 'inkmotion-layout-v2';
const PREVIEW_URL = 'https://ink-motion-pied.vercel.app/v/preview';
const clone = (value) => JSON.parse(JSON.stringify(value));
const generator = new MasterSheetGenerator();
let layout = normalizeLayout(DEFAULT_LAYOUT);
let previewRun = 0;
window.InkMotionLayoutConfig = clone(layout);

function el(id) { return document.getElementById(id); }
function pct(value) { return `${Math.round(value * 100)}%`; }

function ensureUi() {
  if (el('layout-studio')) return true;
  const form = el('publish-form');
  if (!form) return false;
  if (!document.querySelector('link[href="/css/layout-editor.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/layout-editor.css';
    document.head.append(link);
  }
  const section = document.createElement('section');
  section.id = 'layout-studio';
  section.className = 'card layout-studio';
  section.innerHTML = `
    <div class="layout-studio-head">
      <div><span class="eyebrow">2 · DISEÑO DE OBRA</span><h3>Elegí cómo querés imprimirla</h3><p>Por defecto InkMotion usa la Lámina Maestra clásica. La vista previa usa el mismo generador que el PDF final.</p></div>
      <button id="layout-reset" class="text-btn layout-reset" type="button">Volver al formato clásico</button>
    </div>
    <div class="layout-mode-switch">
      <button id="layout-mode-classic" class="layout-chip is-active" type="button">Clásico · recomendado</button>
      <button id="layout-mode-custom" class="layout-chip" type="button">Personalizar diseño</button>
    </div>
    <div class="layout-studio-grid">
      <div class="layout-preview-shell">
        <div id="layout-preview-stage" class="layout-preview-stage">
          <div id="layout-empty" class="layout-empty"><strong>Subí una imagen para ver la composición completa</strong><span>La vista previa mostrará exactamente la pieza que se imprimirá.</span></div>
          <div id="layout-sheet" class="layout-sheet" hidden>
            <div id="layout-artwork" class="layout-artwork">
              <canvas id="layout-preview-canvas" aria-label="Vista previa completa de la obra"></canvas>
              <div id="layout-frame-preview" class="layout-frame-preview" data-preset="minimal"></div>
              <div class="layout-tech-anchors" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
              <div id="layout-qr-handle" class="layout-qr-handle" data-background="white"><canvas id="layout-qr-canvas" width="256" height="256"></canvas></div>
            </div>
            <div id="layout-outside-band" class="layout-outside-band" hidden><div><strong>INKMOTION</strong><span>LÁMINA MAESTRA · EXPERIENCIA AR</span></div></div>
          </div>
        </div>
        <div class="layout-preview-note"><span id="layout-preview-label">Formato clásico InkMotion</span><span>Lo que ves es lo que se imprime</span></div>
      </div>
      <div id="layout-controls" class="layout-controls">
        <div class="layout-control-group"><h4>Código QR</h4>
          <div class="layout-control-row"><label for="layout-qr-placement">Ubicación</label><select id="layout-qr-placement"><option value="inside">Dentro de la obra</option><option value="outside">Banda exterior</option></select></div>
          <div class="layout-control-row"><label for="layout-qr-size">Tamaño</label><span id="layout-qr-size-value" class="layout-value">14%</span><input id="layout-qr-size" type="range" min="0.10" max="0.22" step="0.005"></div>
          <div class="layout-control-row"><label for="layout-qr-background">Fondo</label><select id="layout-qr-background"><option value="white">Blanco</option><option value="soft">Blanco suave</option><option value="none">Sin fondo extra</option></select></div>
          <div class="qr-positions"><button class="layout-chip" type="button" data-qr-position="tl">↖</button><button class="layout-chip" type="button" data-qr-position="tr">↗</button><button class="layout-chip" type="button" data-qr-position="bl">↙</button><button class="layout-chip" type="button" data-qr-position="br">↘</button></div>
        </div>
        <div class="layout-control-group"><h4>Marco visual</h4>
          <div class="frame-presets"><button class="layout-chip" type="button" data-frame-preset="none">Sin decorativo</button><button class="layout-chip" type="button" data-frame-preset="minimal">Minimal</button><button class="layout-chip" type="button" data-frame-preset="editorial">Editorial</button><button class="layout-chip" type="button" data-frame-preset="technical">Técnico</button><button class="layout-chip" type="button" data-frame-preset="integrated">Integrado</button></div>
          <div class="layout-control-row"><label for="layout-frame-color">Color</label><input id="layout-frame-color" type="color"></div>
          <label class="layout-auto"><input id="layout-frame-auto" type="checkbox"> Adaptar color a la obra</label>
          <div class="layout-control-row"><label for="layout-frame-width">Grosor</label><span id="layout-frame-width-value" class="layout-value"></span><input id="layout-frame-width" type="range" min="0.0045" max="0.018" step="0.0005"></div>
          <small class="layout-safety-note">La personalización conserva anclajes técnicos de alto contraste para proteger el tracking WebAR.</small>
        </div>
        <p id="layout-quality" class="layout-quality" data-state="good"></p>
      </div>
    </div>`;
  form.parentNode.insertBefore(section, form);
  return true;
}

function save() {
  window.InkMotionLayoutConfig = clone(layout);
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {}
  renderPreview();
  updateStatus();
  syncMode();
}

function activateCustom() {
  if (layout.page.mode !== 'artwork') {
    layout.page.mode = 'artwork';
    layout.qr.placement = 'inside';
    layout.frame.preset = 'minimal';
    layout.frame.width = Math.max(0.006, layout.frame.width);
  }
}

function activateClassic() {
  layout = normalizeLayout(DEFAULT_LAYOUT);
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  syncControls();
  save();
}

function setPreset(name) {
  activateCustom();
  layout.frame.preset = name;
  syncControls();
  save();
}

function syncControls() {
  if (!el('layout-qr-placement')) return;
  el('layout-qr-placement').value = layout.qr.placement;
  el('layout-qr-size').value = layout.qr.scale;
  el('layout-qr-size-value').textContent = pct(layout.qr.scale);
  el('layout-qr-background').value = layout.qr.background;
  el('layout-frame-color').value = layout.frame.color;
  el('layout-frame-width').value = Math.max(0.0045, layout.frame.width);
  el('layout-frame-width-value').textContent = `${(Math.max(0.0045, layout.frame.width) * 100).toFixed(1)}%`;
  el('layout-frame-auto').checked = layout.frame.autoColor;
  document.querySelectorAll('[data-frame-preset]').forEach((button) => {
    const active = layout.page.mode === 'artwork' && button.dataset.framePreset === layout.frame.preset;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function syncMode() {
  const custom = layout.page.mode === 'artwork';
  el('layout-mode-classic')?.classList.toggle('is-active', !custom);
  el('layout-mode-custom')?.classList.toggle('is-active', custom);
  if (el('layout-controls')) {
    el('layout-controls').style.opacity = custom ? '1' : '.48';
    el('layout-controls').style.pointerEvents = custom ? 'auto' : 'none';
  }
  if (el('layout-preview-label')) el('layout-preview-label').textContent = custom ? 'Diseño personalizado' : 'Formato clásico InkMotion';
}

async function drawQrPreview() {
  const canvas = el('layout-qr-canvas');
  if (!canvas || canvas.dataset.ready === 'true') return;
  await renderStoryQR(canvas, PREVIEW_URL, { width: 256, margin: 3, errorCorrectionLevel: 'H' });
  canvas.dataset.ready = 'true';
}

function drawCanvasSource(sourceCanvas) {
  const canvas = el('layout-preview-canvas');
  if (!canvas) return;
  const maxSide = 1100;
  const scale = Math.min(1, maxSide / Math.max(sourceCanvas.width, sourceCanvas.height));
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
}

function drawArtwork(source) {
  const canvas = el('layout-preview-canvas');
  const maxSide = 1100;
  const scale = Math.min(1, maxSide / Math.max(source.naturalWidth, source.naturalHeight));
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
}

async function renderPreview() {
  const run = ++previewRun;
  const source = el('author-preview');
  const sheet = el('layout-sheet');
  const empty = el('layout-empty');
  const qr = el('layout-qr-handle');
  const frame = el('layout-frame-preview');
  const band = el('layout-outside-band');
  const anchors = document.querySelector('.layout-tech-anchors');
  if (!source || !sheet || !empty || !qr || !frame) return;
  if (!source.complete || !source.naturalWidth || !source.naturalHeight || !source.src) {
    sheet.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  sheet.hidden = false;
  const classic = layout.page.mode !== 'artwork';
  sheet.classList.toggle('is-classic', classic);
  sheet.classList.toggle('is-custom', !classic);

  if (classic) {
    qr.hidden = true;
    frame.hidden = true;
    anchors?.classList.add('is-hidden');
    band.hidden = true;
    try {
      const title = el('story-title')?.value?.trim() || 'Vista previa';
      const legacy = await generator.composeLegacy({ illustrationUrl: source.src, publicUrl: PREVIEW_URL, title });
      if (run !== previewRun) { URL.revokeObjectURL(legacy.imageUrl); return; }
      drawCanvasSource(legacy.canvas);
      URL.revokeObjectURL(legacy.imageUrl);
    } catch (error) {
      console.warn('[InkMotion/Layout] No se pudo generar la vista clásica exacta.', error);
      drawArtwork(source);
    }
    return;
  }

  drawArtwork(source);
  qr.hidden = false;
  frame.hidden = false;
  anchors?.classList.remove('is-hidden');
  frame.dataset.preset = layout.frame.preset;
  frame.style.setProperty('--frame-color', layout.frame.autoColor ? 'currentColor' : layout.frame.color);
  frame.style.setProperty('--frame-width', `${Math.max(2, layout.frame.width * 500)}px`);
  frame.classList.toggle('is-auto', layout.frame.autoColor);
  qr.style.width = `${layout.qr.scale * 100}%`;
  qr.dataset.background = layout.qr.background;
  const outside = layout.qr.placement === 'outside';
  band.hidden = !outside;
  if (outside) {
    qr.style.left = 'auto';
    qr.style.top = 'auto';
    qr.style.right = '3.5%';
    qr.style.bottom = '-20%';
  } else {
    qr.style.removeProperty('right');
    qr.style.removeProperty('bottom');
    qr.style.left = `${layout.qr.x * 100}%`;
    qr.style.top = `${layout.qr.y * 100}%`;
  }
  try { await drawQrPreview(); } catch (error) { console.warn('[InkMotion/Layout] QR preview', error); }
}

function updateStatus() {
  const status = el('layout-quality');
  if (!status) return;
  if (layout.page.mode !== 'artwork') {
    status.dataset.state = 'good';
    status.textContent = 'Formato clásico activo · la vista usa exactamente el mismo generador que el PDF final.';
    return;
  }
  const okQr = layout.qr.scale >= 0.10;
  const okFrame = layout.frame.preset === 'none' || layout.frame.width >= 0.0045;
  status.dataset.state = okQr && okFrame ? 'good' : 'warning';
  status.textContent = !okQr ? 'Revisar · aumentá el tamaño del QR.' : !okFrame ? 'Revisar · el marco es demasiado fino.' : 'Personalización activa · los anclajes técnicos WebAR siguen protegidos.';
}

function bindDrag() {
  const qr = el('layout-qr-handle');
  const artwork = el('layout-artwork');
  let dragging = false;
  qr.addEventListener('pointerdown', (event) => {
    if (layout.page.mode !== 'artwork' || layout.qr.placement !== 'inside') return;
    dragging = true;
    qr.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  qr.addEventListener('pointermove', (event) => {
    if (!dragging || layout.qr.placement !== 'inside') return;
    const rect = artwork.getBoundingClientRect();
    const size = rect.width * layout.qr.scale;
    const x = Math.max(0, Math.min(rect.width - size, event.clientX - rect.left - size / 2));
    const y = Math.max(0, Math.min(rect.height - size, event.clientY - rect.top - size / 2));
    layout.qr.x = x / rect.width;
    layout.qr.y = y / rect.height;
    save();
  });
  ['pointerup', 'pointercancel'].forEach((name) => qr.addEventListener(name, () => { dragging = false; }));
}

function bindControls() {
  el('layout-mode-classic').addEventListener('click', activateClassic);
  el('layout-mode-custom').addEventListener('click', () => { activateCustom(); syncControls(); save(); });
  el('layout-qr-placement').addEventListener('change', (event) => { activateCustom(); layout.qr.placement = event.target.value; save(); });
  el('layout-qr-size').addEventListener('input', (event) => { activateCustom(); layout.qr.scale = Number(event.target.value); el('layout-qr-size-value').textContent = pct(layout.qr.scale); save(); });
  el('layout-qr-background').addEventListener('change', (event) => { activateCustom(); layout.qr.background = event.target.value; save(); });
  el('layout-frame-color').addEventListener('input', (event) => { activateCustom(); layout.frame.color = event.target.value; layout.frame.autoColor = false; el('layout-frame-auto').checked = false; save(); });
  el('layout-frame-width').addEventListener('input', (event) => { activateCustom(); layout.frame.width = Math.max(0.0045, Number(event.target.value)); event.target.value = layout.frame.width; el('layout-frame-width-value').textContent = `${(layout.frame.width * 100).toFixed(1)}%`; save(); });
  el('layout-frame-auto').addEventListener('change', (event) => { activateCustom(); layout.frame.autoColor = event.target.checked; save(); });
  document.querySelectorAll('[data-frame-preset]').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.framePreset)));
  document.querySelectorAll('[data-qr-position]').forEach((button) => button.addEventListener('click', () => {
    activateCustom();
    const positions = { tl: [0.035, 0.035], tr: [0.80, 0.035], bl: [0.035, 0.80], br: [0.80, 0.80] };
    [layout.qr.x, layout.qr.y] = positions[button.dataset.qrPosition];
    layout.qr.placement = 'inside';
    syncControls();
    save();
  }));
  el('layout-reset').addEventListener('click', activateClassic);
  el('story-title')?.addEventListener('input', () => { if (layout.page.mode !== 'artwork') renderPreview(); });
}

function observeArtwork() {
  const source = el('author-preview');
  if (!source) return;
  const refresh = () => renderPreview();
  new MutationObserver(() => {
    if (source.getAttribute('src')) {
      if (source.complete && source.naturalWidth) refresh();
      else source.addEventListener('load', refresh, { once: true });
    } else refresh();
  }).observe(source, { attributes: true, attributeFilter: ['src', 'hidden'] });
  source.addEventListener('load', refresh);
  window.addEventListener('resize', refresh);
}

function start() {
  if (!ensureUi()) return;
  syncControls();
  bindControls();
  bindDrag();
  observeArtwork();
  renderPreview();
  updateStatus();
  syncMode();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
