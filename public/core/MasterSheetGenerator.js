import { renderStoryQR } from '../utils/QRGenerator.js';

const PRINT_DPI = 300;
const MIN_PRINT_SIDE = 2400;
const MAX_PRINT_SIDE = 5000;
const PDF_SOURCES = ['https://esm.sh/jspdf@2.5.2', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'];

const QR_SIZES = Object.freeze({ discreet: 0.10, balanced: 0.135, scan: 0.17 });
const QR_POSITIONS = Object.freeze({
  'top-left': [0.035, 0.035],
  'top-right': [0.965, 0.035],
  center: [0.5, 0.5],
  'bottom-left': [0.035, 0.965],
  'bottom-right': [0.965, 0.965],
});
const FRAME_WEIGHTS = Object.freeze({ thin: 0.005, medium: 0.008, strong: 0.012 });
const FRAME_STYLES = new Set(['technical', 'minimal', 'integrated']);
const FRAME_PLACEMENTS = new Set(['outside', 'inside']);
const QR_STYLES = new Set(['protected', 'integrated']);
let pdfLibraryPromise;

export const DEFAULT_LAYOUT = Object.freeze({
  version: 3,
  page: { mode: 'legacy' },
  qr: { placement: 'outside', position: 'bottom-right', size: 'balanced', style: 'protected' },
  frame: { placement: 'outside', style: 'technical', weight: 'medium', colorMode: 'safe', color: '#08080d' },
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const nearest = (value, entries) => entries.reduce((best, entry) => Math.abs(entry[1] - value) < Math.abs(best[1] - value) ? entry : best)[0];

function legacyPosition(qr = {}) {
  if (qr.position && QR_POSITIONS[qr.position]) return qr.position;
  if (Number.isFinite(Number(qr.x)) && Number.isFinite(Number(qr.y))) {
    const x = Number(qr.x), y = Number(qr.y);
    if (Math.abs(x - 0.5) < 0.18 && Math.abs(y - 0.5) < 0.18) return 'center';
    return `${y < 0.5 ? 'top' : 'bottom'}-${x < 0.5 ? 'left' : 'right'}`;
  }
  return 'bottom-right';
}

export function normalizeLayout(input) {
  const base = clone(DEFAULT_LAYOUT);
  if (!input || typeof input !== 'object') return base;
  const qr = input.qr || {}, frame = input.frame || {}, page = input.page || {};
  base.page.mode = page.mode === 'artwork' ? 'artwork' : 'legacy';
  if (base.page.mode === 'legacy') return base;

  base.qr.placement = qr.placement === 'outside' ? 'outside' : 'inside';
  base.qr.position = legacyPosition(qr);
  if (QR_SIZES[qr.size]) base.qr.size = qr.size;
  else if (Number.isFinite(Number(qr.scale))) base.qr.size = nearest(Number(qr.scale), Object.entries(QR_SIZES));
  base.qr.style = QR_STYLES.has(qr.style) ? qr.style : (qr.background === 'soft' ? 'integrated' : 'protected');

  base.frame.placement = FRAME_PLACEMENTS.has(frame.placement) ? frame.placement : 'inside';
  const legacyStyle = frame.preset === 'technical' ? 'technical' : frame.preset === 'integrated' ? 'integrated' : 'minimal';
  base.frame.style = FRAME_STYLES.has(frame.style) ? frame.style : legacyStyle;
  if (FRAME_WEIGHTS[frame.weight]) base.frame.weight = frame.weight;
  else if (Number.isFinite(Number(frame.width))) base.frame.weight = nearest(Number(frame.width), Object.entries(FRAME_WEIGHTS));
  base.frame.colorMode = ['safe', 'adaptive', 'custom'].includes(frame.colorMode)
    ? frame.colorMode
    : (frame.autoColor ? 'adaptive' : (/^#[0-9a-f]{6}$/i.test(frame.color || '') && frame.color.toLowerCase() !== '#08080d' ? 'custom' : 'safe'));
  base.frame.color = /^#[0-9a-f]{6}$/i.test(frame.color || '') ? frame.color : '#08080d';
  return base;
}

async function loadPdfLibrary() {
  if (!pdfLibraryPromise) {
    pdfLibraryPromise = (async () => {
      let lastError;
      for (const source of PDF_SOURCES) {
        try {
          const module = await import(source);
          const jsPDF = module.jsPDF || module.default?.jsPDF || module.default;
          if (typeof jsPDF !== 'function') throw new Error('API PDF no disponible.');
          return jsPDF;
        } catch (error) { lastError = error; }
      }
      throw new Error(`No se pudo cargar el generador PDF. ${lastError?.message || ''}`.trim());
    })().catch((error) => { pdfLibraryPromise = null; throw error; });
  }
  return pdfLibraryPromise;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo cargar la ilustración para crear la lámina.'));
    image.src = source;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo exportar la lámina.')), type, quality));
}

function calculateOutputSize(width, height) {
  const shortest = Math.min(width, height), longest = Math.max(width, height);
  const scale = Math.min(MAX_PRINT_SIDE / longest, Math.max(1, MIN_PRINT_SIDE / shortest));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function drawFiducialCorner(context, x, y, horizontal, vertical, frameWidth) {
  const arm = frameWidth * 4.2, thickness = Math.max(3, frameWidth * 0.8);
  context.fillRect(horizontal > 0 ? x : x - arm, vertical > 0 ? y : y - thickness, arm, thickness);
  context.fillRect(horizontal > 0 ? x : x - thickness, vertical > 0 ? y : y - arm, thickness, arm);
}

function luminance(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function edgeAverageColor(context, rect) {
  try {
    const points = [];
    for (let i = 0; i < 24; i++) {
      const t = (i + 0.5) / 24;
      points.push([rect.x + rect.width * t, rect.y + 2], [rect.x + rect.width * t, rect.y + rect.height - 3], [rect.x + 2, rect.y + rect.height * t], [rect.x + rect.width - 3, rect.y + rect.height * t]);
    }
    const sum = points.reduce((acc, [x, y]) => {
      const d = context.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), 1, 1).data;
      acc[0] += d[0]; acc[1] += d[1]; acc[2] += d[2]; return acc;
    }, [0, 0, 0]);
    const rgb = sum.map((value) => Math.round(value / points.length));
    const factor = luminance(...rgb) > 125 ? 0.42 : 1.7;
    return `rgb(${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value * factor)))).join(',')})`;
  } catch { return '#17171f'; }
}

function frameColor(context, content, frame) {
  if (frame.colorMode === 'adaptive') return edgeAverageColor(context, content);
  if (frame.colorMode === 'custom') return frame.color;
  return '#08080d';
}

function drawDecorativeFrame(context, rect, shortest, frame) {
  const width = Math.max(5, Math.round(shortest * FRAME_WEIGHTS[frame.weight]));
  const color = frameColor(context, rect, frame);
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  if (frame.style === 'minimal') {
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  } else if (frame.style === 'integrated') {
    context.setLineDash([width * 6, width * 2.8]);
    context.lineCap = 'round';
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  } else {
    const arm = Math.max(shortest * 0.07, width * 7);
    [[rect.x, rect.y, 1, 1], [rect.x + rect.width, rect.y, -1, 1], [rect.x, rect.y + rect.height, 1, -1], [rect.x + rect.width, rect.y + rect.height, -1, -1]].forEach(([x, y, hx, vy]) => {
      context.beginPath(); context.moveTo(x, y + vy * arm); context.lineTo(x, y); context.lineTo(x + hx * arm, y); context.stroke();
    });
  }
  context.restore();
}

function drawTrackingSafetyCorners(context, rect, shortest) {
  const width = Math.max(5, Math.round(shortest * 0.0055));
  const inset = Math.max(width * 2.5, Math.round(shortest * 0.014));
  const arm = Math.max(width * 5.5, Math.round(shortest * 0.038));
  const x1 = rect.x + inset, y1 = rect.y + inset, x2 = rect.x + rect.width - inset, y2 = rect.y + rect.height - inset;
  context.save(); context.fillStyle = '#08080d';
  const corner = (x, y, h, v) => {
    context.fillRect(h > 0 ? x : x - arm, v > 0 ? y : y - width, arm, width);
    context.fillRect(h > 0 ? x : x - width, v > 0 ? y : y - arm, width, arm);
  };
  corner(x1, y1, 1, 1); corner(x2, y1, -1, 1); corner(x1, y2, 1, -1); corner(x2, y2, -1, -1);
  context.restore();
}

function resolveQrPosition(content, qrSize, position) {
  const [px, py] = QR_POSITIONS[position] || QR_POSITIONS['bottom-right'];
  if (position === 'center') return { x: content.x + (content.width - qrSize) / 2, y: content.y + (content.height - qrSize) / 2 };
  const margin = Math.max(8, Math.round(Math.min(content.width, content.height) * 0.03));
  const x = px < 0.5 ? content.x + margin : content.x + content.width - qrSize - margin;
  const y = py < 0.5 ? content.y + margin : content.y + content.height - qrSize - margin;
  return { x, y };
}

function resolveLayout(illustrationUrl, explicit) {
  if (explicit) return normalizeLayout(explicit);
  const saved = window.__INKMOTION_LAYOUTS_BY_IMAGE?.[illustrationUrl];
  if (saved) return normalizeLayout(saved);
  const current = document.getElementById('author-preview')?.src;
  if (current && current === illustrationUrl && window.InkMotionLayoutConfig) return normalizeLayout(window.InkMotionLayoutConfig);
  return normalizeLayout(DEFAULT_LAYOUT);
}

export default class MasterSheetGenerator {
  async compose({ illustrationUrl, publicUrl, title = 'InkMotion', layout }) {
    const resolved = resolveLayout(illustrationUrl, layout);
    if (resolved.page.mode !== 'artwork') return this.composeLegacy({ illustrationUrl, publicUrl, title });
    return this.composeDesigned({ illustrationUrl, publicUrl, title, layout: resolved });
  }

  async composeDesigned({ illustrationUrl, publicUrl, title, layout }) {
    const illustration = await loadImage(illustrationUrl);
    const output = calculateOutputSize(illustration.naturalWidth || illustration.width, illustration.naturalHeight || illustration.height);
    const shortest = Math.min(output.width, output.height);
    const externalFrame = layout.frame.placement === 'outside';
    const frameMargin = externalFrame ? Math.round(shortest * 0.06) : 0;
    const qrSize = Math.round(shortest * QR_SIZES[layout.qr.size]);
    const qrOutside = layout.qr.placement === 'outside';
    const band = qrOutside ? Math.max(Math.round(shortest * 0.18), qrSize + Math.round(shortest * 0.035)) : 0;
    const canvas = document.createElement('canvas');
    canvas.width = output.width + frameMargin * 2;
    canvas.height = output.height + frameMargin * 2 + band;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: layout.frame.colorMode === 'adaptive' });
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.fillStyle = '#f8f8f6'; context.fillRect(0, 0, canvas.width, canvas.height);

    const content = { x: frameMargin, y: frameMargin, width: output.width, height: output.height };
    context.fillStyle = '#fff'; context.fillRect(content.x, content.y, content.width, content.height);
    context.drawImage(illustration, content.x, content.y, content.width, content.height);

    const decorative = externalFrame
      ? { x: Math.max(4, frameMargin * 0.35), y: Math.max(4, frameMargin * 0.35), width: canvas.width - Math.max(8, frameMargin * 0.7), height: output.height + frameMargin * 1.3 }
      : { x: content.x + shortest * 0.018, y: content.y + shortest * 0.018, width: content.width - shortest * 0.036, height: content.height - shortest * 0.036 };
    drawDecorativeFrame(context, decorative, shortest, layout.frame);

    const safety = externalFrame
      ? { x: Math.max(2, frameMargin * 0.2), y: Math.max(2, frameMargin * 0.2), width: canvas.width - Math.max(4, frameMargin * 0.4), height: output.height + frameMargin * 1.6 }
      : content;
    drawTrackingSafetyCorners(context, safety, shortest);

    const qrCanvas = document.createElement('canvas');
    await renderStoryQR(qrCanvas, publicUrl, { width: qrSize, margin: 3, errorCorrectionLevel: 'H' });
    let qrX, qrY;
    if (qrOutside) {
      qrX = canvas.width - qrSize - Math.round(shortest * 0.035);
      qrY = frameMargin * 2 + output.height + Math.max(8, Math.round((band - qrSize) / 2));
      context.fillStyle = '#111118';
      context.font = `700 ${Math.max(18, Math.round(shortest * 0.018))}px Arial, sans-serif`;
      context.fillText('INKMOTION · EXPERIENCIA AR', Math.round(shortest * 0.035), frameMargin * 2 + output.height + Math.round(band * 0.44), canvas.width - qrSize - Math.round(shortest * 0.1));
      context.font = `500 ${Math.max(13, Math.round(shortest * 0.012))}px Arial, sans-serif`;
      context.fillStyle = '#4b4b55';
      context.fillText(`${title}`.slice(0, 72), Math.round(shortest * 0.035), frameMargin * 2 + output.height + Math.round(band * 0.64), canvas.width - qrSize - Math.round(shortest * 0.1));
    } else {
      const position = resolveQrPosition(content, qrSize, layout.qr.position);
      qrX = position.x; qrY = position.y;
      const pad = Math.max(6, Math.round(qrSize * 0.06));
      context.fillStyle = layout.qr.style === 'integrated' ? 'rgba(255,255,255,0.92)' : '#fff';
      context.fillRect(qrX - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2);
    }
    context.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96);
    const imageBlob = await canvasToBlob(canvas, 'image/jpeg', 0.96);
    return {
      canvas, imageBlob, imageUrl: URL.createObjectURL(imageBlob), jpegDataUrl, dpi: PRINT_DPI, layout,
      pageSizeMm: { width: canvas.width / PRINT_DPI * 25.4, height: canvas.height / PRINT_DPI * 25.4 },
      contentRect: { x: content.x / canvas.width, y: content.y / canvas.height, width: content.width / canvas.width, height: content.height / canvas.height, targetAspect: canvas.height / canvas.width },
    };
  }

  async composeLegacy({ illustrationUrl, publicUrl, title = 'InkMotion' }) {
    const illustration = await loadImage(illustrationUrl), output = calculateOutputSize(illustration.naturalWidth || illustration.width, illustration.naturalHeight || illustration.height), shortest = Math.min(output.width, output.height), unit = shortest / 80, sideMargin = Math.round(shortest * 0.06), topMargin = sideMargin, qrSize = Math.round(Math.min(420, Math.max(180, shortest * 0.135))), frameWidth = Math.max(5, Math.round(shortest * 0.006)), frameGap = Math.max(frameWidth * 7, unit * 0.55), technicalBandHeight = Math.max(Math.round(shortest * 0.18), qrSize + Math.round(unit * 3)), bottomMargin = Math.ceil(frameGap + technicalBandHeight), qrCanvas = document.createElement('canvas');
    await renderStoryQR(qrCanvas, publicUrl, { width: qrSize, margin: 3, errorCorrectionLevel: 'M' });
    const canvas = document.createElement('canvas'); canvas.width = output.width + sideMargin * 2; canvas.height = output.height + topMargin + bottomMargin;
    const context = canvas.getContext('2d', { alpha: false }); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.fillStyle = '#f8f8f6'; context.fillRect(0, 0, canvas.width, canvas.height);
    const content = { x: sideMargin, y: topMargin, width: output.width, height: output.height }; context.fillStyle = '#fff'; context.fillRect(content.x, content.y, content.width, content.height); context.drawImage(illustration, content.x, content.y, content.width, content.height);
    const frame = { x: content.x - frameGap, y: content.y - frameGap, width: content.width + frameGap * 2, height: content.height + frameGap * 2 }; context.strokeStyle = '#08080d'; context.lineWidth = frameWidth; context.strokeRect(frame.x, frame.y, frame.width, frame.height); context.fillStyle = '#08080d';
    const fo = frameWidth * 1.4, left = frame.x + frameWidth / 2 + fo, right = frame.x + frame.width - frameWidth / 2 - fo, top = frame.y + frameWidth / 2 + fo, bottom = frame.y + frame.height - frameWidth / 2 - fo;
    drawFiducialCorner(context, left, top, 1, 1, frameWidth); drawFiducialCorner(context, right, top, -1, 1, frameWidth); drawFiducialCorner(context, left, bottom, 1, -1, frameWidth); drawFiducialCorner(context, right, bottom, -1, -1, frameWidth);
    const footerTop = content.y + content.height + frameGap + frameWidth / 2, brandY = footerTop + unit * 1.05, textWidth = Math.max(unit * 18, canvas.width - sideMargin * 2 - qrSize - unit * 3);
    context.fillStyle = '#08080d'; context.font = `800 ${Math.max(26, Math.round(unit * 1.35))}px Arial, sans-serif`; context.fillText('INKMOTION', sideMargin, brandY + unit * 1.45, textWidth);
    context.fillStyle = '#7657ed'; context.font = `700 ${Math.max(15, Math.round(unit * 0.72))}px Arial, sans-serif`; context.fillText('LÁMINA MAESTRA · EXPERIENCIA AR', sideMargin, brandY + unit * 2.8, textWidth);
    context.fillStyle = '#34343d'; context.font = `500 ${Math.max(17, Math.round(unit * 0.82))}px Arial, sans-serif`; context.fillText(`${title}`.slice(0, 72), sideMargin, brandY + unit * 4.35, textWidth);
    const qr = { x: canvas.width - sideMargin - qrSize, y: footerTop + Math.max(unit, (technicalBandHeight - qrSize) / 2), size: qrSize }; context.fillStyle = '#fff'; context.fillRect(qr.x - unit * 0.55, qr.y - unit * 0.55, qr.size + unit * 1.1, qr.size + unit * 1.1); context.drawImage(qrCanvas, qr.x, qr.y, qr.size, qr.size);
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96), imageBlob = await canvasToBlob(canvas, 'image/jpeg', 0.96);
    return { canvas, imageBlob, imageUrl: URL.createObjectURL(imageBlob), jpegDataUrl, dpi: PRINT_DPI, layout: normalizeLayout(DEFAULT_LAYOUT), pageSizeMm: { width: canvas.width / PRINT_DPI * 25.4, height: canvas.height / PRINT_DPI * 25.4 }, contentRect: { x: content.x / canvas.width, y: content.y / canvas.height, width: content.width / canvas.width, height: content.height / canvas.height, targetAspect: canvas.height / canvas.width } };
  }

  async createPdf(jpegDataUrl, pageSizeMm) {
    const jsPDF = await loadPdfLibrary(), orientation = pageSizeMm.width > pageSizeMm.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: [pageSizeMm.width, pageSizeMm.height], compress: true });
    pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, pageSizeMm.width, pageSizeMm.height, undefined, 'FAST');
    return pdf.output('blob');
  }
}
