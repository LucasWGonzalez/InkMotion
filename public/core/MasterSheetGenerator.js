import { renderStoryQR } from '../utils/QRGenerator.js';

const SHEET = Object.freeze({ width: 2480, height: 3508, dpi: 300 });
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

function drawCorner(context, x, y, horizontal, vertical) {
  const length = 132;
  context.beginPath();
  context.moveTo(x + horizontal * length, y);
  context.lineTo(x, y);
  context.lineTo(x, y + vertical * length);
  context.stroke();
  context.fillStyle = '#7657ed';
  context.fillRect(x - 17, y - 17, 34, 34);
  context.fillStyle = '#08080d';
  context.fillRect(x - 8, y - 8, 16, 16);
}

export default class MasterSheetGenerator {
  async compose({ illustrationUrl, publicUrl, title = 'InkMotion' }) {
    const [illustration] = await Promise.all([loadImage(illustrationUrl)]);
    const qrCanvas = document.createElement('canvas');
    await renderStoryQR(qrCanvas, publicUrl, { width: 300, margin: 2 });

    const canvas = document.createElement('canvas');
    canvas.width = SHEET.width;
    canvas.height = SHEET.height;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const frame = { x: 126, y: 126, width: 2228, height: 3256 };
    context.strokeStyle = '#08080d';
    context.lineWidth = 14;
    context.strokeRect(frame.x, frame.y, frame.width, frame.height);
    context.strokeStyle = '#7657ed';
    context.lineWidth = 5;
    context.strokeRect(frame.x + 28, frame.y + 28, frame.width - 56, frame.height - 56);
    context.strokeStyle = '#08080d';
    context.lineWidth = 30;
    drawCorner(context, frame.x, frame.y, 1, 1);
    drawCorner(context, frame.x + frame.width, frame.y, -1, 1);
    drawCorner(context, frame.x, frame.y + frame.height, 1, -1);
    drawCorner(context, frame.x + frame.width, frame.y + frame.height, -1, -1);

    const area = { x: 236, y: 260, width: 2008, height: 2722 };
    const sourceWidth = illustration.naturalWidth || illustration.width;
    const sourceHeight = illustration.naturalHeight || illustration.height;
    const scale = Math.min(area.width / sourceWidth, area.height / sourceHeight);
    const content = {
      x: Math.round(area.x + (area.width - sourceWidth * scale) / 2),
      y: Math.round(area.y + (area.height - sourceHeight * scale) / 2),
      width: Math.round(sourceWidth * scale),
      height: Math.round(sourceHeight * scale),
    };
    context.fillStyle = '#f5f4f8';
    context.fillRect(area.x - 12, area.y - 12, area.width + 24, area.height + 24);
    context.drawImage(illustration, content.x, content.y, content.width, content.height);

    const footerY = 3032;
    context.fillStyle = '#08080d';
    context.font = '800 42px Arial, sans-serif';
    context.fillText('INKMOTION', 236, footerY + 56);
    context.fillStyle = '#7657ed';
    context.font = '700 22px Arial, sans-serif';
    context.fillText('LÁMINA MAESTRA · EXPERIENCIA AR', 236, footerY + 94);
    context.fillStyle = '#34343d';
    context.font = '500 25px Arial, sans-serif';
    const safeTitle = `${title}`.slice(0, 72);
    context.fillText(safeTitle, 236, footerY + 142, 1380);

    const qr = { x: 1950, y: 3026, size: 300 };
    context.fillStyle = '#fff';
    context.fillRect(qr.x - 18, qr.y - 18, qr.size + 36, qr.size + 36);
    context.drawImage(qrCanvas, qr.x, qr.y, qr.size, qr.size);

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96);
    const imageBlob = await canvasToBlob(canvas, 'image/jpeg', 0.96);
    return {
      canvas,
      imageBlob,
      imageUrl: URL.createObjectURL(imageBlob),
      jpegDataUrl,
      dpi: SHEET.dpi,
      contentRect: {
        x: content.x / SHEET.width,
        y: content.y / SHEET.height,
        width: content.width / SHEET.width,
        height: content.height / SHEET.height,
        targetAspect: SHEET.height / SHEET.width,
      },
    };
  }

  async createPdf(jpegDataUrl) {
    const jsPDF = await loadPdfLibrary();
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    return pdf.output('blob');
  }
}
