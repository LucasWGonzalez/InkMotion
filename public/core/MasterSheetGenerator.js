import { renderStoryQR } from '../utils/QRGenerator.js';

const PRINT_DPI = 300;
const MIN_PRINT_SIDE = 2400;
const MAX_PRINT_SIDE = 5000;
const PDF_SOURCES = [
  'https://esm.sh/jspdf@2.5.2',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm',
];

let pdfLibraryPromise;

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
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo cargar la ilustración para crear la lámina.'));
    image.src = source;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('No se pudo exportar la lámina.')),
    type,
    quality,
  ));
}

function drawFiducialCorner(context, x, y, horizontal, vertical, frameWidth) {
  const arm = frameWidth * 1.65;
  const thickness = frameWidth * 0.55;
  const horizontalX = horizontal > 0 ? x : x - arm;
  const horizontalY = vertical > 0 ? y : y - thickness;
  const verticalX = horizontal > 0 ? x : x - thickness;
  const verticalY = vertical > 0 ? y : y - arm;
  context.fillRect(horizontalX, horizontalY, arm, thickness);
  context.fillRect(verticalX, verticalY, thickness, arm);
}

function calculateOutputSize(width, height) {
  const shortest = Math.min(width, height);
  const longest = Math.max(width, height);
  const scale = Math.min(MAX_PRINT_SIDE / longest, Math.max(1, MIN_PRINT_SIDE / shortest));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export default class MasterSheetGenerator {
  async compose({ illustrationUrl, publicUrl, title = 'InkMotion' }) {
    const [illustration] = await Promise.all([loadImage(illustrationUrl)]);
    const sourceWidth = illustration.naturalWidth || illustration.width;
    const sourceHeight = illustration.naturalHeight || illustration.height;
    const output = calculateOutputSize(sourceWidth, sourceHeight);
    const shortest = Math.min(output.width, output.height);
    const unit = shortest / 80;
    const frameWidth = Math.max(12, Math.round(output.width * 0.04));
    const quietX = Math.round(output.width * 0.055);
    const quietY = Math.round(output.height * 0.055);
    const artInsetX = Math.round(output.width * 0.16);
    const artInsetY = Math.round(output.height * 0.16);
    const qrSize = Math.round(Math.min(420, Math.max(180, shortest * 0.135)));
    const qrCanvas = document.createElement('canvas');
    await renderStoryQR(qrCanvas, publicUrl, { width: qrSize, margin: 3, errorCorrectionLevel: 'M' });

    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const frame = { x: quietX, y: quietY, width: canvas.width - quietX * 2, height: canvas.height - quietY * 2 };
    context.strokeStyle = '#08080d';
    context.lineWidth = frameWidth;
    context.strokeRect(frame.x, frame.y, frame.width, frame.height);
    context.fillStyle = '#08080d';
    const fiducialOffset = frameWidth * 0.45;
    const left = frame.x + frameWidth / 2 + fiducialOffset;
    const right = frame.x + frame.width - frameWidth / 2 - fiducialOffset;
    const top = frame.y + frameWidth / 2 + fiducialOffset;
    const bottom = frame.y + frame.height - frameWidth / 2 - fiducialOffset;
    drawFiducialCorner(context, left, top, 1, 1, frameWidth);
    drawFiducialCorner(context, right, top, -1, 1, frameWidth);
    drawFiducialCorner(context, left, bottom, 1, -1, frameWidth);
    drawFiducialCorner(context, right, bottom, -1, -1, frameWidth);

    const area = { x: artInsetX, y: artInsetY, width: canvas.width - artInsetX * 2, height: canvas.height - artInsetY * 2 };
    const scale = Math.min(area.width / sourceWidth, area.height / sourceHeight);
    const content = {
      x: Math.round(area.x + (area.width - sourceWidth * scale) / 2),
      y: Math.round(area.y + (area.height - sourceHeight * scale) / 2),
      width: Math.round(sourceWidth * scale),
      height: Math.round(sourceHeight * scale),
    };
    context.fillStyle = '#f5f4f8';
    context.fillRect(area.x - unit * 0.4, area.y - unit * 0.4, area.width + unit * 0.8, area.height + unit * 0.8);
    context.drawImage(illustration, content.x, content.y, content.width, content.height);

    const panelPadding = unit * 0.62;
    const brandFont = Math.max(26, Math.round(unit * 1.35));
    const detailFont = Math.max(15, Math.round(unit * 0.72));
    const titleFont = Math.max(17, Math.round(unit * 0.82));
    const brandPanelWidth = Math.min(content.width * 0.58, unit * 42);
    const brandPanelHeight = unit * 5.8;
    const brandX = content.x + unit * 0.7;
    const brandY = content.y + content.height - brandPanelHeight - unit * 0.7;
    context.fillStyle = 'rgba(255,255,255,.94)';
    context.fillRect(brandX, brandY, brandPanelWidth, brandPanelHeight);
    context.fillStyle = '#08080d';
    context.font = `800 ${brandFont}px Arial, sans-serif`;
    context.fillText('INKMOTION', brandX + panelPadding, brandY + unit * 1.9);
    context.fillStyle = '#7657ed';
    context.font = `700 ${detailFont}px Arial, sans-serif`;
    context.fillText('LÁMINA MAESTRA · EXPERIENCIA AR', brandX + panelPadding, brandY + unit * 3.15, brandPanelWidth - panelPadding * 2);
    context.fillStyle = '#34343d';
    context.font = `500 ${titleFont}px Arial, sans-serif`;
    const safeTitle = `${title}`.slice(0, 72);
    context.fillText(safeTitle, brandX + panelPadding, brandY + unit * 4.65, brandPanelWidth - panelPadding * 2);

    const qr = {
      x: content.x + content.width - qrSize - unit * 0.7,
      y: content.y + content.height - qrSize - unit * 0.7,
      size: qrSize,
    };
    context.fillStyle = '#fff';
    context.fillRect(qr.x - unit * 0.55, qr.y - unit * 0.55, qr.size + unit * 1.1, qr.size + unit * 1.1);
    context.drawImage(qrCanvas, qr.x, qr.y, qr.size, qr.size);

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96);
    const imageBlob = await canvasToBlob(canvas, 'image/jpeg', 0.96);
    return {
      canvas,
      imageBlob,
      imageUrl: URL.createObjectURL(imageBlob),
      jpegDataUrl,
      dpi: PRINT_DPI,
      pageSizeMm: {
        width: canvas.width / PRINT_DPI * 25.4,
        height: canvas.height / PRINT_DPI * 25.4,
      },
      contentRect: {
        x: content.x / canvas.width,
        y: content.y / canvas.height,
        width: content.width / canvas.width,
        height: content.height / canvas.height,
        targetAspect: canvas.height / canvas.width,
      },
    };
  }

  async createPdf(jpegDataUrl, pageSizeMm) {
    const jsPDF = await loadPdfLibrary();
    const orientation = pageSizeMm.width > pageSizeMm.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: [pageSizeMm.width, pageSizeMm.height], compress: true });
    pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, pageSizeMm.width, pageSizeMm.height, undefined, 'FAST');
    return pdf.output('blob');
  }
}
