import EventBus from '../utils/EventBus.js';

class MindARManager {
  constructor(config = {}) {
    this.config = {
      video: '#video-stream',
      warmupTolerance: 3,
      missTolerance: 8,
      filterMinCF: 0.002,
      filterBeta: 20,
      ...config,
    };
    this.video = null;
    this.stream = null;
    this.controller = null;
    this.isRunning = false;
    this.isTargetVisible = false;
    this.targetDimensions = null;
  }

  async init() {
    this.video = document.querySelector(this.config.video);
    if (!this.video) throw new Error('No se encontró el elemento de cámara.');
    if (!navigator.mediaDevices?.getUserMedia) {
      const error = new Error('Este navegador no permite usar la cámara. Abrí el sitio por HTTPS.');
      EventBus.emit('mindar:camera-error', error);
      return false;
    }
    if (!window.MINDAR?.Compiler || !window.MINDAR?.Controller) {
      const error = new Error('No se pudo cargar el motor MindAR.');
      EventBus.emit('mindar:error', error);
      return false;
    }
    return this.startCamera();
  }

  async startCamera() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!this.video.videoWidth) {
        await new Promise((resolve) => this.video.addEventListener('loadedmetadata', resolve, { once: true }));
      }
      this.isRunning = true;
      EventBus.emit('mindar:video-ready', {
        videoWidth: this.video.videoWidth,
        videoHeight: this.video.videoHeight,
      });
      EventBus.emit('mindar:camera-ready', { mode: 'image-tracking' });
      return true;
    } catch (error) {
      const friendly = error?.name === 'NotAllowedError'
        ? new Error('Permiso de cámara denegado. Habilitalo y recargá la página.')
        : new Error('No se pudo iniciar la cámara. Cerrá otras aplicaciones que la estén usando.');
      EventBus.emit('mindar:camera-error', friendly);
      return false;
    }
  }

  async setImageTarget(imageUrl) {
    if (!this.isRunning) throw new Error('La cámara todavía no está disponible.');
    this.disposeController();
    this.setTargetVisible(false);
    EventBus.emit('mindar:compilation-start');

    const image = await this.loadImage(imageUrl);
    const compiler = new window.MINDAR.Compiler();
    await compiler.compileImageTargets([image], (progress) => {
      const normalized = progress > 1 ? progress : progress * 100;
      EventBus.emit('mindar:compilation-progress', { progress: Math.round(normalized) });
    });
    const targetBuffer = await compiler.exportData();

    this.controller = new window.MINDAR.Controller({
      inputWidth: this.video.videoWidth,
      inputHeight: this.video.videoHeight,
      maxTrack: 1,
      warmupTolerance: this.config.warmupTolerance,
      missTolerance: this.config.missTolerance,
      filterMinCF: this.config.filterMinCF,
      filterBeta: this.config.filterBeta,
      onUpdate: (data) => this.handleControllerUpdate(data),
    });

    const { dimensions } = this.controller.addImageTargetsFromBuffer(targetBuffer);
    this.targetDimensions = dimensions[0];
    EventBus.emit('mindar:projection-ready', {
      projectionMatrix: this.controller.getProjectionMatrix(),
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
    });
    await this.controller.dummyRun(this.video);
    this.controller.processVideo(this.video);
    EventBus.emit('mindar:target-ready', { dimensions: this.targetDimensions });
    return { dimensions: this.targetDimensions };
  }

  handleControllerUpdate(data) {
    if (data.type !== 'updateMatrix' || data.targetIndex !== 0) return;
    if (data.worldMatrix) {
      if (!this.isTargetVisible) {
        this.setTargetVisible(true);
        EventBus.emit('mindar:target-found', { index: 0 });
      }
      EventBus.emit('mindar:target-update', {
        index: 0,
        worldMatrix: data.worldMatrix,
        dimensions: this.targetDimensions,
      });
    } else if (this.isTargetVisible) {
      this.setTargetVisible(false);
      EventBus.emit('mindar:target-lost', { index: 0 });
    }
  }

  setTargetVisible(visible) {
    this.isTargetVisible = visible;
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No se pudo preparar la imagen para tracking.'));
      image.src = url;
    });
  }

  async reset() {
    this.setTargetVisible(false);
    EventBus.emit('mindar:target-lost', { index: 0 });
    EventBus.emit('mindar:reset');
    return true;
  }

  disposeController() {
    if (!this.controller) return;
    this.controller.stopProcessVideo?.();
    this.controller.dispose?.();
    this.controller = null;
  }

  stop() {
    this.disposeController();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.video) this.video.srcObject = null;
    this.isRunning = false;
    EventBus.emit('mindar:stopped');
  }
}

export default MindARManager;
