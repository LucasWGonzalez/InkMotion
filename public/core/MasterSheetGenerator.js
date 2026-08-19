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
  const arm = frameWidth * 4.2;
  const thickness = Math.max(3, frameWidth * 0.8);
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
    const sideMargin = Math.round(shortest * 0.06);
    const topMargin = sideMargin;
    const qrSize = Math.round(Math.min(420, Math.max(180, shortest * 0.135)));
    const bottomMargin = Math.max(Math.round(shortest * 0.18), qrSize + Math.round(unit * 3));
    const frameWidth = Math.max(5, Math.round(shortest * 0.006));
    const qrCanvas = document.createElement('canvas');
    await renderStoryQR(qrCanvas, publicUrl, { width: qrSize, margin: 3, errorCorrectionLevel: 'M' });

    const canvas = document.createElement('canvas');
    canvas.width = output.width + sideMargin * 2;
    canvas.height = output.height + topMargin + bottomMargin;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#f8f8f6';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const content = {
      x: sideMargin,
      y: topMargin,
      width: output.width,
      height: output.height,
    };
    context.fillStyle = '#fff';
    context.fillRect(content.x, content.y, content.width, content.height);
    context.drawImage(illustration, content.x, content.y, content.width, content.height);

    // Reserve enough paspartú for the complete L arms: technical marks never touch the artwork.
    const frameGap = Math.max(frameWidth * 7, unit * 0.55);
    const frame = {
      x: content.x - frameGap,
      y: content.y - frameGap,
      width: content.width + frameGap * 2,
      height: content.height + frameGap * 2,
    };
    context.strokeStyle = '#08080d';
    context.lineWidth = frameWidth;
    context.strokeRect(frame.x, frame.y, frame.width, frame.height);
    context.fillStyle = '#08080d';
    const fiducialOffset = frameWidth * 1.4;
    const left = frame.x + frameWidth / 2 + fiducialOffset;
    const right = frame.x + frame.width - frameWidth / 2 - fiducialOffset;
    const top = frame.y + frameWidth / 2 + fiducialOffset;
    const bottom = frame.y + frame.height - frameWidth / 2 - fiducialOffset;
    drawFiducialCorner(context, left, top, 1, 1, frameWidth);
    drawFiducialCorner(context, right, top, -1, 1, frameWidth);
    drawFiducialCorner(context, left, bottom, 1, -1, frameWidth);
    drawFiducialCorner(context, right, bottom, -1, -1, frameWidth);

    const panelPadding = unit * 0.7;
    const brandFont = Math.max(26, Math.round(unit * 1.35));
    const detailFont = Math.max(15, Math.round(unit * 0.72));
    const titleFont = Math.max(17, Math.round(unit * 0.82));
    const footerTop = content.y + content.height;
    const brandX = sideMargin;
    const brandY = footerTop + panelPadding;
    const textWidth = Math.max(unit * 18, canvas.width - sideMargin * 2 - qrSize - unit * 3);
    context.fillStyle = '#08080d';
    context.font = `800 ${brandFont}px Arial, sans-serif`;
    context.fillText('INKMOTION', brandX, brandY + unit * 1.45, textWidth);
    context.fillStyle = '#7657ed';
    context.font = `700 ${detailFont}px Arial, sans-serif`;
    context.fillText('LÁMINA MAESTRA · EXPERIENCIA AR', brandX, brandY + unit * 2.8, textWidth);
    context.fillStyle = '#34343d';
    context.font = `500 ${titleFont}px Arial, sans-serif`;
    const safeTitle = `${title}`.slice(0, 72);
    context.fillText(safeTitle, brandX, brandY + unit * 4.35, textWidth);

    const qr = {
      x: canvas.width - sideMargin - qrSize,
      y: footerTop + Math.max(unit, (bottomMargin - qrSize) / 2),
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
