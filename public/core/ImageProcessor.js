/**
 * ImageProcessor.js
 * Procesa imágenes en cliente con Canvas 2D nativo
 * Valida, redimensiona y optimiza images para targets AR
 */

import EventBus from '../utils/EventBus.js';

class ImageProcessor {
  constructor(config = {}) {
    this.config = {
      maxFileSize: config.maxFileSize || 2 * 1024 * 1024, // 2MB
      minWidth: config.minWidth || 200,
      minHeight: config.minHeight || 200,
      maxWidth: config.maxWidth || 1920,
      maxHeight: config.maxHeight || 1920,
      targetQuality: config.targetQuality || 0.85,
      supportedFormats: config.supportedFormats || ['image/jpeg', 'image/png', 'image/webp'],
      ...config,
    };

    this.processedImages = new Map();
  }

  /**
   * Valida archivo de imagen
   */
  validateFile(file) {
    const errors = [];

    if (!this.config.supportedFormats.includes(file.type)) {
      errors.push(`Formato no soportado: ${file.type}`);
    }

    if (file.size > this.config.maxFileSize) {
      errors.push(`Archivo muy grande: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Procesa imagen desde File input
   */
  async processImageFile(file, imageName = 'target') {
    try {
      console.log(`📸 Procesando imagen: ${file.name}`);

      // Validar archivo
      const validation = this.validateFile(file);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      // Leer archivo como blob URL
      const blobUrl = URL.createObjectURL(file);

      // Cargar imagen
      const img = await this.loadImage(blobUrl);

      console.log(`Original: ${img.width}x${img.height}`);

      // Validar dimensiones
      if (img.width < this.config.minWidth || img.height < this.config.minHeight) {
        throw new Error(
          `Imagen muy pequeña. Mínimo: ${this.config.minWidth}x${this.config.minHeight}px`
        );
      }

      // Redimensionar si es necesario
      const resized = this.resizeImage(img);
      console.log(`Redimensionada: ${resized.width}x${resized.height}`);

      // Optimizar compresión
      const canvas = resized;
      const optimized = this.optimizeImage(canvas);
      console.log(`Optimizada: ${optimized.size} bytes`);

      // Crear blob URL de la imagen procesada
      const processedUrl = canvas.toDataURL('image/jpeg', this.config.targetQuality);

      const processed = {
        name: imageName,
        url: processedUrl,
        blobUrl: blobUrl,
        originalSize: file.size,
        optimizedSize: optimized.size,
        dimensions: {
          width: resized.width,
          height: resized.height,
        },
        format: 'jpeg',
        timestamp: Date.now(),
      };

      // Guardar en cache
      this.processedImages.set(imageName, processed);

      EventBus.emit('image-processor:processed', processed);

      return processed;
    } catch (error) {
      console.error('❌ Error procesando imagen:', error);
      EventBus.emit('image-processor:error', error);
      throw error;
    }
  }

  /**
   * Carga una imagen desde URL
   */
  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        resolve(img);
      };

      img.onerror = () => {
        reject(new Error('No se pudo cargar la imagen'));
      };

      img.src = url;
    });
  }

  /**
   * Redimensiona imagen a dimensiones óptimas
   */
  resizeImage(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let { width, height } = img;

    // Reducir si excede máximo
    if (width > this.config.maxWidth || height > this.config.maxHeight) {
      const ratio = Math.min(
        this.config.maxWidth / width,
        this.config.maxHeight / height
      );
      width = Math.floor(width * ratio);
      height = Math.floor(height * ratio);
    }

    canvas.width = width;
    canvas.height = height;

    // Dibujar imagen redimensionada
    ctx.drawImage(img, 0, 0, width, height);

    return canvas;
  }

  /**
   * Optimiza imagen con compresión
   */
  optimizeImage(canvas) {
    // Aplicar filtros para mejor compresión
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Reducir ruido ligeramente para mejor compresión
    this.denoise(imageData.data, canvas.width, canvas.height);

    ctx.putImageData(imageData, 0, 0);

    // Convertir a JPEG comprimido
    const dataUrl = canvas.toDataURL('image/jpeg', this.config.targetQuality);
    const size = this.dataUrlToByteSize(dataUrl);

    return { canvas, size };
  }

  /**
   * Algoritmo simple de reducción de ruido
   */
  denoise(data, width, height) {
    // Reducir ruido gaussiano mínimo
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    const factor = 16;

    for (let i = 1; i < height - 1; i++) {
      for (let j = 1; j < width - 1; j++) {
        const idx = (i * width + j) * 4;

        // Aplicar kernel en canales RGB
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let kIdx = 0;

          for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
              const nIdx = ((i + di) * width + (j + dj)) * 4 + c;
              sum += data[nIdx] * kernel[kIdx];
              kIdx++;
            }
          }

          data[idx + c] = Math.round(sum / factor);
        }
      }
    }
  }

  /**
   * Obtiene tamaño en bytes desde data URL
   */
  dataUrlToByteSize(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    return Math.round((base64.length * 3) / 4);
  }

  /**
   * Emite imagen procesada como target AR
   */
  emitAsTarget(imageName) {
    const processed = this.processedImages.get(imageName);
    if (!processed) {
      throw new Error(`Imagen no encontrada: ${imageName}`);
    }

    EventBus.emit('image-processor:target-ready', {
      url: processed.url,
      name: imageName,
      dimensions: processed.dimensions,
    });
  }

  /**
   * Obtiene imagen procesada
   */
  getProcessed(imageName) {
    return this.processedImages.get(imageName);
  }

  /**
   * Lista todas las imágenes procesadas
   */
  listProcessed() {
    return Array.from(this.processedImages.values());
  }

  /**
   * Limpia cache de imágenes
   */
  clear() {
    this.processedImages.forEach((processed) => {
      URL.revokeObjectURL(processed.blobUrl);
    });
    this.processedImages.clear();
  }
}

export default ImageProcessor;
