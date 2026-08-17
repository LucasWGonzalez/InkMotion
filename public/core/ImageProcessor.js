import EventBus from '../utils/EventBus.js';

class ImageProcessor {
  constructor(config = {}) {
    this.config = {
      maxFileSize: 25 * 1024 * 1024,
      minWidth: 200,
      minHeight: 200,
      maxWidth: 1920,
      maxHeight: 1920,
      targetQuality: 0.82,
      supportedFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
      ...config,
    };
    this.processedImages = new Map();
  }

  validateFile(file) {
    const errors = [];
    if (!file || !file.type.startsWith('image/')) errors.push('Seleccioná un archivo de imagen válido.');
    if (file && file.size > this.config.maxFileSize) {
      errors.push(`La imagen pesa ${(file.size / 1024 / 1024).toFixed(2)} MB. El máximo es ${Math.round(this.config.maxFileSize / 1024 / 1024)} MB.`);
    }
    return { isValid: errors.length === 0, errors };
  }

  async processImageFile(file, imageName = 'target') {
    let sourceUrl;
    try {
      const validation = this.validateFile(file);
      if (!validation.isValid) throw new Error(validation.errors.join(' '));

      sourceUrl = URL.createObjectURL(file);
      const img = await this.loadImage(sourceUrl);
      if (img.width < this.config.minWidth || img.height < this.config.minHeight) {
        throw new Error(`La imagen debe medir al menos ${this.config.minWidth} × ${this.config.minHeight} px.`);
      }

      const canvas = this.resizeImage(img);
      const blob = await this.canvasToBlob(canvas);
      const processedUrl = URL.createObjectURL(blob);
      const processed = {
        name: imageName,
        url: processedUrl,
        blob,
        originalSize: file.size,
        optimizedSize: blob.size,
        dimensions: { width: canvas.width, height: canvas.height },
        format: 'jpeg',
        timestamp: Date.now(),
      };

      this.processedImages.set(imageName, processed);
      EventBus.emit('image-processor:processed', processed);
      return processed;
    } catch (error) {
      EventBus.emit('image-processor:error', error);
      throw error;
    } finally {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    }
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo abrir la imagen. Probá convertirla a JPG o PNG.'));
      img.src = url;
    });
  }

  resizeImage(img) {
    const ratio = Math.min(1, this.config.maxWidth / img.width, this.config.maxHeight / img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * ratio));
    canvas.height = Math.max(1, Math.round(img.height * ratio));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('El navegador no pudo preparar la imagen.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.')), 'image/jpeg', this.config.targetQuality);
    });
  }

  getProcessed(imageName) { return this.processedImages.get(imageName); }
  listProcessed() { return Array.from(this.processedImages.values()); }
  clear() {
    this.processedImages.forEach(({ url }) => URL.revokeObjectURL(url));
    this.processedImages.clear();
  }
}

export default ImageProcessor;
