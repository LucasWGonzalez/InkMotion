class VideoProcessor {
  constructor({ maxFileSize = 15 * 1024 * 1024, minDuration = 3, maxDuration = 8, maxDimension = 1920 } = {}) {
    this.maxFileSize = maxFileSize;
    this.minDuration = minDuration;
    this.maxDuration = maxDuration;
    this.maxDimension = maxDimension;
  }

  async inspect(file) {
    if (!(file instanceof File) || !/\.mp4$/i.test(file.name) || (file.type && file.type !== 'video/mp4')) {
      throw new Error('La animación debe ser un archivo MP4 compatible con celulares.');
    }
    if (file.size > this.maxFileSize) {
      throw new Error(`El video pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo permitido es 15 MB.`);
    }
    const url = URL.createObjectURL(file);
    try {
      const metadata = await new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        const cleanup = () => { video.removeAttribute('src'); video.load(); };
        video.onloadedmetadata = () => {
          const result = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
          cleanup();
          resolve(result);
        };
        video.onerror = () => { cleanup(); reject(new Error('No pudimos leer este MP4. Exportalo como H.264 e intentá nuevamente.')); };
        video.src = url;
      });
      if (!Number.isFinite(metadata.duration) || metadata.duration < this.minDuration || metadata.duration > this.maxDuration + 0.05) {
        throw new Error('El video debe durar entre 3 y 8 segundos. Recomendamos un loop de 5 segundos.');
      }
      if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > this.maxDimension) {
        throw new Error('El video debe tener una resolución máxima de 1920 píxeles por lado.');
      }
      return { ...metadata, blob: file, url };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  validateAspect(image, video) {
    const imageAspect = image.width / image.height;
    const videoAspect = video.width / video.height;
    const difference = Math.abs(imageAspect - videoAspect) / imageAspect;
    if (difference > 0.025) {
      throw new Error('La imagen y el video deben tener la misma proporción para alinearse correctamente en AR.');
    }
  }
}

export default VideoProcessor;
