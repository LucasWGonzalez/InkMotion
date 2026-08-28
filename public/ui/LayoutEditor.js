import MasterSheetGenerator, { DEFAULT_LAYOUT, normalizeLayout } from '../core/MasterSheetGenerator.js';

const STORAGE_KEY = 'inkmotion-layout-v4';
const PREVIEW_URL = 'https://ink-motion-pied.vercel.app/v/preview';
const clone = (value) => JSON.parse(JSON.stringify(value));
const generator = new MasterSheetGenerator();
let layout = normalizeLayout(DEFAULT_LAYOUT);
let previewRun = 0;
let renderTimer = null;
window.InkMotionLayoutConfig = clone(layout);

function el(id) { return document.getElementById(id); }
function isCustom() { return layout.page.mode === 'artwork'; }

function ensureUi() {
  const existing = el('layout-studio');
  if (existing) existing.remove();
  const form = el('publish-form');
  if (!form) return false;
  const oldCss = document.querySelector('link[href^="/css/layout-editor.css"]');
  if (oldCss) oldCss.remove();
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/layout-editor.css?v=4';
  document.head.append(link);
  const section = document.createElement('section');
  section.id = 'layout-studio'; section.className = 'card layout-studio';
  section.innerHTML = `
    <div class="layout-studio-head"><div><span class="eyebrow">2 · DISEÑO DE OBRA</span><h3>Elegí cómo querés imprimirla</h3><p>InkMotion protege la lectura del QR y el tracking WebAR. La vista previa se genera con el mismo motor que crea el PDF final.</p></div><button id="layout-reset" class="text-btn layout-reset" type="button">Restablecer</button></div>
    <div class="layout-mode-switch" role="group" aria-label="Modo de diseño"><button id="layout-mode-classic" class="layout-mode-card is-active" type="button"><strong>Clásico</strong><span>Recomendado · máxima compatibilidad</span></button><button id="layout-mode-custom" class="layout-mode-card" type="button"><strong>Personalizado</strong><span>Integra QR y marco a la pieza</span></button></div>
    <div class="layout-studio-grid">
      <div class="layout-preview-shell"><div id="layout-preview-stage" class="layout-preview-stage"><div id="layout-empty" class="layout-empty"><strong>Subí una imagen para ver el diseño final</strong><span>La vista previa será la misma composición que se imprimirá y compilará para WebAR.</span></div><canvas id="layout-preview-canvas" class="layout-final-canvas" hidden aria-label="Vista previa final de la lámina"></canvas><div id="layout-preview-loading" class="layout-preview-loading" hidden>Actualizando diseño…</div></div><div class="layout-preview-note"><span id="layout-preview-label">Formato clásico InkMotion</span><span>Preview = PDF = target AR</span></div></div>
      <div id="layout-classic-info" class="layout-classic-info"><strong>Formato clásico activo</strong><p>InkMotion mantiene el paspartú, el marco técnico y el QR exterior en la composición ya validada para impresión y tracking.</p><div class="layout-benefits"><span>✓ QR con área blanca segura</span><span>✓ Marco técnico estable</span><span>✓ Máxima compatibilidad WebAR</span></div><button id="layout-start-custom" class="btn btn-secondary" type="button">Personalizar diseño</button></div>
      <div id="layout-controls" class="layout-controls" hidden>
        <section class="layout-control-group"><div class="layout-group-head"><div><span class="layout-step">1</span><h4>Código QR</h4></div><small>Elegí una ubicación segura</small></div>
          <label class="layout-field-label">Ubicación</label><div class="layout-segmented" role="group" aria-label="Ubicación del QR"><button type="button" data-qr-placement="inside">Dentro de la obra</button><button type="button" data-qr-placement="outside">Fuera de la obra</button></div>
          <div id="qr-position-section"><label class="layout-field-label">Posición</label><div class="position-grid"><button type="button" data-qr-position="top-left"><span class="position-preview"><i class="qr-dot tl"></i></span><b>Arriba izq.</b></button><button type="button" data-qr-position="top-right"><span class="position-preview"><i class="qr-dot tr"></i></span><b>Arriba der.</b></button><button type="button" data-qr-position="center"><span class="position-preview"><i class="qr-dot cc"></i></span><b>Centro</b></button><button type="button" data-qr-position="bottom-left"><span class="position-preview"><i class="qr-dot bl"></i></span><b>Abajo izq.</b></button><button type="button" data-qr-position="bottom-right"><span class="position-preview"><i class="qr-dot br"></i></span><b>Abajo der.</b></button></div></div>
          <label class="layout-field-label">Tamaño</label><div class="layout-choice-row" role="group" aria-label="Tamaño del QR"><button type="button" data-qr-size="discreet"><strong>Discreto</strong><small>Ocupa menos espacio</small></button><button type="button" data-qr-size="balanced"><strong>Equilibrado</strong><small>Recomendado</small></button><button type="button" data-qr-size="scan"><strong>Más visible</strong><small>Más fácil de escanear</small></button></div>
          <label class="layout-field-label">Área detrás del QR</label><div class="layout-choice-row two" role="group" aria-label="Área detrás del QR"><button type="button" data-qr-style="protected"><strong>Blanco sólido</strong><small>Recomendado · máxima lectura</small></button><button type="button" data-qr-style="integrated"><strong>Blanco suave</strong><small>Más discreto visualmente</small></button></div><small class="layout-safety-note">Ambas opciones conservan una zona clara alrededor del código para que la cámara pueda leerlo. La diferencia es únicamente visual.</small>
        </section>
        <section class="layout-control-group"><div class="layout-group-head"><div><span class="layout-step">2</span><h4>Marco</h4></div><small>La capa técnica AR se conserva siempre</small></div>
          <label class="layout-field-label">Ubicación del marco</label><div class="layout-choice-row two" role="group" aria-label="Ubicación del marco"><button type="button" data-frame-placement="outside"><strong>Exterior</strong><small>No invade la obra</small></button><button type="button" data-frame-placement="inside"><strong>Sobre la obra</strong><small>Más integrado</small></button></div>
          <label class="layout-field-label">Estilo</label><div class="layout-choice-row" role="group" aria-label="Estilo del marco"><button type="button" data-frame-style="technical"><strong>Técnico</strong><small>Esquinas</small></button><button type="button" data-frame-style="minimal"><strong>Minimal</strong><small>Línea limpia</small></button><button type="button" data-frame-style="integrated"><strong>Integrado</strong><small>Línea segmentada</small></button></div>
          <label class="layout-field-label">Grosor</label><div class="layout-choice-row" role="group" aria-label="Grosor del marco"><button type="button" data-frame-weight="thin"><strong>Fino</strong></button><button type="button" data-frame-weight="medium"><strong>Medio</strong></button><button type="button" data-frame-weight="strong"><strong>Fuerte</strong></button></div>
          <label class="layout-field-label">Color</label><div class="layout-choice-row" role="group" aria-label="Color del marco"><button type="button" data-frame-color-mode="safe"><strong>Negro seguro</strong><small>Mayor contraste</small></button><button type="button" data-frame-color-mode="adaptive"><strong>Adaptar</strong><small>Toma color de la obra</small></button><button type="button" data-frame-color-mode="custom"><strong>Elegir color</strong><small>Personalizado</small></button></div><div id="layout-custom-color-wrap" class="layout-custom-color" hidden><label for="layout-custom-color">Color personalizado</label><input id="layout-custom-color" type="color" value="#17171f"></div>
        </section>
        <div id="layout-quality" class="layout-quality" data-state="good"><strong>Compatibilidad WebAR: Óptima</strong><span>La estructura técnica de tracking permanece protegida.</span></div>
      </div>
    </div>`;
  form.parentNode.insertBefore(section, form); return true;
}

function storeLayout() { window.InkMotionLayoutConfig = clone(layout); try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {} }
function setCustomDefaults() { layout = normalizeLayout({ version: 3, page: { mode: 'artwork' }, qr: { placement: 'inside', position: 'bottom-right', size: 'balanced', style: 'protected' }, frame: { placement: 'outside', style: 'technical', weight: 'medium', colorMode: 'safe', color: '#17171f' } }); }
function activateClassic() { layout = normalizeLayout(DEFAULT_LAYOUT); try { sessionStorage.removeItem(STORAGE_KEY); } catch {} storeLayout(); syncUi(); schedulePreview(); }
function activateCustom() { if (!isCustom()) setCustomDefaults(); storeLayout(); syncUi(); schedulePreview(); }

function mark(attribute, value) { document.querySelectorAll(`[${attribute}]`).forEach((button) => button.classList.toggle('is-active', button.getAttribute(attribute) === value)); }

function syncUi() {
  const custom = isCustom();
  el('layout-mode-classic')?.classList.toggle('is-active', !custom); el('layout-mode-custom')?.classList.toggle('is-active', custom);
  el('layout-classic-info').hidden = custom; el('layout-controls').hidden = !custom;
  el('layout-preview-label').textContent = custom ? 'Diseño personalizado' : 'Formato clásico InkMotion';
  if (!custom) return;
  mark('data-qr-placement', layout.qr.placement); mark('data-qr-position', layout.qr.position); mark('data-qr-size', layout.qr.size); mark('data-qr-style', layout.qr.style);
  mark('data-frame-placement', layout.frame.placement); mark('data-frame-style', layout.frame.style); mark('data-frame-weight', layout.frame.weight); mark('data-frame-color-mode', layout.frame.colorMode);
  el('qr-position-section').hidden = layout.qr.placement === 'outside'; el('layout-custom-color-wrap').hidden = layout.frame.colorMode !== 'custom'; el('layout-custom-color').value = layout.frame.color || '#17171f'; updateQuality();
}

function updateQuality() {
  const box = el('layout-quality'); if (!box || !isCustom()) return;
  let state = 'good', title = 'Compatibilidad WebAR: Óptima', message = 'La estructura técnica de tracking permanece protegida.';
  if (layout.qr.placement === 'inside' && layout.qr.position === 'center') { state = 'warning'; title = 'Compatibilidad WebAR: Buena'; message = 'El QR central es legible, pero puede tapar contenido importante de la obra.'; }
  else if (layout.frame.colorMode === 'adaptive' || layout.frame.colorMode === 'custom') message = 'El marco decorativo cambia de color, pero los anclajes técnicos mantienen alto contraste.';
  box.dataset.state = state; box.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
}

function drawCanvas(sourceCanvas) {
  const canvas = el('layout-preview-canvas'), maxSide = 1150, scale = Math.min(1, maxSide / Math.max(sourceCanvas.width, sourceCanvas.height));
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale)); canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
}

async function renderPreview() {
  const run = ++previewRun, source = el('author-preview'), canvas = el('layout-preview-canvas'), empty = el('layout-empty'), loading = el('layout-preview-loading');
  if (!source || !canvas || !empty || !loading) return;
  if (!source.src || !source.complete || !source.naturalWidth) { canvas.hidden = true; empty.hidden = false; loading.hidden = true; return; }
  empty.hidden = true; loading.hidden = false;
  try {
    const title = el('story-title')?.value?.trim() || 'Vista previa';
    const sheet = await generator.compose({ illustrationUrl: source.src, publicUrl: PREVIEW_URL, title, layout });
    if (run !== previewRun) { URL.revokeObjectURL(sheet.imageUrl); return; }
    drawCanvas(sheet.canvas); canvas.hidden = false; URL.revokeObjectURL(sheet.imageUrl);
  } catch (error) {
    console.warn('[InkMotion/Layout] No se pudo generar la preview.', error); empty.hidden = false; canvas.hidden = true;
    empty.querySelector('strong').textContent = 'No pudimos actualizar la vista previa'; empty.querySelector('span').textContent = 'Probá volver al formato clásico o recargar la imagen.';
  } finally { if (run === previewRun) loading.hidden = true; }
}

function schedulePreview() { window.clearTimeout(renderTimer); renderTimer = window.setTimeout(renderPreview, 80); }
function commitChange(mutator) { if (!isCustom()) setCustomDefaults(); mutator(); layout = normalizeLayout(layout); storeLayout(); syncUi(); schedulePreview(); }

function bindControls() {
  el('layout-mode-classic').addEventListener('click', activateClassic); el('layout-mode-custom').addEventListener('click', activateCustom); el('layout-start-custom').addEventListener('click', activateCustom); el('layout-reset').addEventListener('click', activateClassic);
  document.querySelectorAll('[data-qr-placement]').forEach((button) => button.addEventListener('click', () => commitChange(() => { layout.qr.placement = button.dataset.qrPlacement; })));
  document.querySelectorAll('[data-qr-position]').forEach((button) => button.addEventListener('click', () => commitChange(() => { layout.qr.placement = 'inside'; layout.qr.position = button.dataset.qrPosition; })));
  document.querySelectorAll('[data-qr-size]').forEach((button) => button.addEventListener('click', () => commitChange(() => { layout.qr.size = button.dataset.qrSize; })));
  document.querySelectorAll('[data-qr-style]').forEach((button) => button.addEventListener('click', () => commitChange(() => { layout.qr.style = button.dataset.qrStyle; })));
  document.querySelectorAll('[data-frame-placement]').forEach((button) => button.addEventListener('click', () => commitChange(() => { layout.frame.placement = button.dataset.framePlacement; })));
  document.querySelectorAll('[data-frame-style]').forEach((button) => button.addEventListener('click', () => commitChange(() => { layout.frame.style = button.dataset.frameStyle; })));
  document.querySelectorAll('[data-frame-weight]').forEach((button) => button.addEventListener('click', () => commitChange(() => { layout.frame.weight = button.dataset.frameWeight; })));
  document.querySelectorAll('[data-frame-color-mode]').forEach((button) => button.addEventListener('click', () => commitChange(() => { layout.frame.colorMode = button.dataset.frameColorMode; })));
  el('layout-custom-color').addEventListener('input', (event) => commitChange(() => { layout.frame.colorMode = 'custom'; layout.frame.color = event.target.value; }));
  el('story-title')?.addEventListener('input', schedulePreview);
}

function observeArtwork() { const source = el('author-preview'); if (!source) return; const refresh = () => schedulePreview(); new MutationObserver(refresh).observe(source, { attributes: true, attributeFilter: ['src', 'hidden'] }); source.addEventListener('load', refresh); }
function start() { if (!ensureUi()) return; bindControls(); observeArtwork(); syncUi(); schedulePreview(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
