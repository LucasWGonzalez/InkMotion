import EventBus from '../utils/EventBus.js';
import { ensureMindAR } from './MindARLoader.js';

class MindARManager {
  constructor(config = {}) {
    this.config = {
      video: '#video-stream',
      warmupTolerance: 2,
      missTolerance: 18,
      filterMinCF: 0.0005,
      filterBeta: 8,
      scanFeedbackDelay: 12000,
      ...config,
    };
    this.video = null;
    this.stream = null;
    this.controller = null;
    this.isRunning = false;
    this.isTargetVisible = false;
    this.targetDimensions = null;
    this.scanTimer = null;
  }

  async init() {
    this.video = document.querySelector(this.config.video);
    if (!this.video) throw new Error('No se encontró el elemento de cámara.');
    if (!navigator.mediaDevices?.getUserMedia) {
      const error = new Error('Este navegador no permite usar la cámara. Abrí el sitio por HTTPS.');
      EventBus.emit('mindar:camera-error', error);
      return false;
    }
    let mindar;
    try { mindar = await this.ensureEngine(); }
    catch (error) { EventBus.emit('mindar:error', error); return false; }
    this.mindar = mindar;
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

    try {
      const image = await this.loadImage(imageUrl);
      const visualQuality = this.measureVisualQuality(image);
      if (visualQuality.contrast < 17 || visualQuality.edgeRatio < 0.012) {
        throw new Error('Imagen con bajo contraste para tracking. Elegí una ilustración con más detalles, bordes y variación de colores.');
      }
      const mindar = this.mindar || await this.ensureEngine();
      const compiler = new mindar.Compiler();
      const compiledData = await compiler.compileImageTargets([image], (progress) => {
        const normalized = progress > 1 ? progress : progress * 100;
        EventBus.emit('mindar:compilation-progress', { progress: Math.round(normalized) });
      });
      const featureCount = this.countCompiledFeatures(compiledData);
      if (featureCount < 35) {
        throw new Error('La imagen tiene pocos puntos reconocibles. Probá otra con personajes definidos, texturas y menos áreas lisas.');
      }
      const quality = featureCount < 90 ? 'limited' : 'good';
      EventBus.emit('mindar:target-quality', {
        quality,
        featureCount,
        contrast: Math.round(visualQuality.contrast),
      });
      const targetBuffer = await compiler.exportData();

      this.controller = new mindar.Controller({
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
      this.startScanFeedbackTimer();
      return { dimensions: this.targetDimensions, featureCount };
    } catch (error) {
      this.disposeController();
      const friendly = error instanceof Error
        ? error
        : new Error('No se pudo compilar el marcador AR en este dispositivo.');
      EventBus.emit('mindar:compilation-error', friendly);
      throw friendly;
    }
  }

  async compileTarget(imageUrl) {
    const mindar = this.mindar || await this.ensureEngine();
    this.mindar = mindar;
    EventBus.emit('mindar:compilation-start');
    try {
      const image = await this.loadImage(imageUrl);
      const visualQuality = this.measureVisualQuality(image);
      if (visualQuality.contrast < 17 || visualQuality.edgeRatio < 0.012) {
        throw new Error('Imagen con bajo contraste para tracking. Elegí una ilustración con más detalles, bordes y variación de colores.');
      }
      const compiler = new mindar.Compiler();
      const compiledData = await compiler.compileImageTargets([image], (progress) => {
        const normalized = progress > 1 ? progress : progress * 100;
        EventBus.emit('mindar:compilation-progress', { progress: Math.round(normalized) });
      });
      const featureCount = this.countCompiledFeatures(compiledData);
      if (featureCount < 35) throw new Error('La imagen tiene pocos puntos reconocibles. Probá otra con más detalles y menos áreas lisas.');
      EventBus.emit('mindar:target-quality', { quality: featureCount < 90 ? 'limited' : 'good', featureCount, contrast: Math.round(visualQuality.contrast) });
      const buffer = await compiler.exportData();
      return { buffer, blob: new Blob([buffer], { type: 'application/octet-stream' }), featureCount };
    } catch (error) {
      const friendly = error instanceof Error ? error : new Error('No se pudo compilar el marcador AR.');
      EventBus.emit('mindar:compilation-error', friendly);
      throw friendly;
    }
  }

  async setCompiledTarget(targetUrl) {
    if (!this.isRunning) throw new Error('La cámara todavía no está disponible.');
    this.disposeController();
    this.setTargetVisible(false);
    const response = await fetch(targetUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo descargar el marcador AR del cuento.');
    const targetBuffer = await response.arrayBuffer();
    const mindar = this.mindar || await this.ensureEngine();
    this.mindar = mindar;
    this.controller = new mindar.Controller({
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
    EventBus.emit('mindar:projection-ready', { projectionMatrix: this.controller.getProjectionMatrix(), videoWidth: this.video.videoWidth, videoHeight: this.video.videoHeight });
    await this.controller.dummyRun(this.video);
    this.controller.processVideo(this.video);
    EventBus.emit('mindar:target-ready', { dimensions: this.targetDimensions });
    this.startScanFeedbackTimer();
  }

  handleControllerUpdate(data) {
    if (data.type !== 'updateMatrix' || data.targetIndex !== 0) return;
    if (data.worldMatrix) {
      if (!this.isTargetVisible) {
        this.clearScanFeedbackTimer();
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
      this.startScanFeedbackTimer();
    }
  }

  ensureEngine() {
    return ensureMindAR((detail) => EventBus.emit('mindar:engine-state', detail));
  }

  setTargetVisible(visible) {
    this.isTargetVisible = visible;
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No se pudo preparar la imagen para tracking.'));
      image.src = url;
    });
  }

  measureVisualQuality(image) {
    const maxSide = 256;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const grey = new Float32Array(canvas.width * canvas.height);
    let sum = 0;
    for (let i = 0; i < grey.length; i++) {
      const offset = i * 4;
      const value = rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114;
      grey[i] = value;
      sum += value;
    }
    const mean = sum / grey.length;
    let variance = 0;
    let edges = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const index = y * canvas.width + x;
        const difference = grey[index] - mean;
        variance += difference * difference;
        if (x > 0 && Math.abs(grey[index] - grey[index - 1]) > 20) edges++;
        if (y > 0 && Math.abs(grey[index] - grey[index - canvas.width]) > 20) edges++;
      }
    }
    return {
      contrast: Math.sqrt(variance / grey.length),
      edgeRatio: edges / Math.max(1, grey.length * 2),
    };
  }

  countCompiledFeatures(compiledData) {
    const keyframes = compiledData?.[0]?.matchingData || [];
    return keyframes.reduce((maximum, keyframe) => {
      const count = (keyframe.maximaPoints?.length || 0) + (keyframe.minimaPoints?.length || 0);
      return Math.max(maximum, count);
    }, 0);
  }

  startScanFeedbackTimer() {
    this.clearScanFeedbackTimer();
    this.scanTimer = window.setTimeout(() => {
      if (!this.isTargetVisible && this.controller) {
        EventBus.emit('mindar:scan-timeout', {
          message: 'Todavía no se reconoce. Mejorá la luz, evitá reflejos y acercá el cuento hasta ocupar gran parte de la pantalla.',
        });
      }
    }, this.config.scanFeedbackDelay);
  }

  clearScanFeedbackTimer() {
    if (this.scanTimer) window.clearTimeout(this.scanTimer);
    this.scanTimer = null;
  }

  async reset() {
    this.setTargetVisible(false);
    EventBus.emit('mindar:target-lost', { index: 0 });
    EventBus.emit('mindar:reset');
    if (this.controller) this.startScanFeedbackTimer();
    return true;
  }

  disposeController() {
    this.clearScanFeedbackTimer();
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
