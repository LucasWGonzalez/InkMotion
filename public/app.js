import MindARManager from './core/MindARManager.js';
import ParallaxEngine from './core/ParallaxEngine.js';
import ImageProcessor from './core/ImageProcessor.js';
import EventBus from './utils/EventBus.js';

class InkMotionApp {
  constructor() {
    this.mindAR = null;
    this.parallax = null;
    this.imageProcessor = null;
    this.uploadInput = null;
    this.initializeApp();
  }

  async initializeApp() {
    if (document.readyState === 'loading') {
      await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    this.setupEvents();
    this.setupUI();
    try {
      this.imageProcessor = new ImageProcessor({ maxFileSize: 25 * 1024 * 1024, targetQuality: 0.82 });
      this.parallax = new ParallaxEngine({ container: '#ar-overlay' });
      await this.parallax.init();
      this.mindAR = new MindARManager({ video: '#video-stream', container: '#ar-container' });
      this.updateStatus('Iniciando cámara…');
      const ready = await this.mindAR.init();
      if (!ready) this.updateStatus('Cámara no disponible. Podés cargar una imagen para probar el efecto.');
    } catch (error) {
      console.error(error);
      this.updateStatus(`No se pudo iniciar: ${error.message}`);
    }
  }

  setupEvents() {
    EventBus.on('mindar:camera-ready', () => this.updateStatus('Cámara lista. Subí una imagen target.'));
    EventBus.on('mindar:camera-error', (error) => this.updateStatus(error.message));
    EventBus.on('mindar:error', (error) => this.updateStatus(error.message));
    EventBus.on('mindar:video-ready', (data) => this.parallax?.setVideoViewport(data));
    EventBus.on('mindar:projection-ready', (data) => {
      this.parallax?.setProjectionMatrix(data.projectionMatrix);
      this.parallax?.setVideoViewport(data);
    });
    EventBus.on('mindar:compilation-start', () => this.updateStatus('Analizando puntos visuales del cuento…'));
    EventBus.on('mindar:compilation-progress', ({ progress }) => {
      this.updateStatus(`Preparando marcador AR… ${Math.min(100, progress)}%`);
    });
    EventBus.on('mindar:target-ready', () => {
      this.updateStatus('Marcador listo · apuntá la cámara hacia la ilustración física');
    });
    EventBus.on('mindar:target-update', (data) => this.parallax?.updateWorldAnchor(data));
    EventBus.on('mindar:target-found', () => {
      this.parallax?.onTargetFound();
      this.updateStatus('Cuento detectado · anclaje espacial activo');
    });
    EventBus.on('mindar:target-lost', () => {
      this.parallax?.onTargetLost();
      this.updateStatus('Buscando la ilustración… mantenela completa dentro de cámara');
    });
    EventBus.on('image-processor:error', (error) => console.warn('ImageProcessor:', error));
  }

  setupUI() {
    const uploadButton = document.getElementById('btn-upload-target');
    const resetButton = document.getElementById('btn-reset-tracking');
    const mode3D = document.getElementById('btn-mode-3d');
    const modeCamera = document.getElementById('btn-mode-camera');
    this.uploadInput = document.createElement('input');
    this.uploadInput.type = 'file';
    this.uploadInput.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
    this.uploadInput.hidden = true;
    this.uploadInput.addEventListener('change', (event) => this.handleImageUpload(event));
    document.body.appendChild(this.uploadInput);

    uploadButton?.addEventListener('click', () => this.uploadInput.click());
    resetButton?.addEventListener('click', () => this.resetTracking());
    mode3D?.addEventListener('click', () => this.selectPreviewMode('3d'));
    modeCamera?.addEventListener('click', () => this.selectPreviewMode('camera'));
  }

  async handleImageUpload(event) {
    const file = event.target.files?.[0];
    const button = document.getElementById('btn-upload-target');
    if (!file || !this.imageProcessor) return;
    button?.classList.add('loading');
    if (button) button.disabled = true;
    try {
      this.updateStatus(`Optimizando ${(file.size / 1024 / 1024).toFixed(2)} MB…`);
      const processed = await this.imageProcessor.processImageFile(file, `target-${Date.now()}`);
      this.updateStatus('Creando relieve y textura 3D…');
      await this.parallax.setTargetImage(processed.url);
      await this.mindAR.setImageTarget(processed.url);
      document.getElementById('preview-panel')?.removeAttribute('hidden');
      this.selectPreviewMode('3d');
      this.updateStatus('Target preparado · ahora apuntá la cámara a la ilustración sobre el papel');
    } catch (error) {
      console.error(error);
      this.updateStatus(error.message || 'No se pudo procesar la imagen.');
    } finally {
      button?.classList.remove('loading');
      if (button) button.disabled = false;
      event.target.value = '';
    }
  }

  selectPreviewMode(mode) {
    const selected = mode === 'camera' ? 'camera' : '3d';
    this.parallax?.setPreviewMode(selected);
    const mode3D = document.getElementById('btn-mode-3d');
    const modeCamera = document.getElementById('btn-mode-camera');
    mode3D?.classList.toggle('is-active', selected === '3d');
    modeCamera?.classList.toggle('is-active', selected === 'camera');
    mode3D?.setAttribute('aria-pressed', String(selected === '3d'));
    modeCamera?.setAttribute('aria-pressed', String(selected === 'camera'));
    this.updateStatus(selected === '3d'
      ? 'Efecto 3D activo · buscá la ilustración física con la cámara'
      : 'Modo cámara activo · el contenido AR está oculto');
  }

  async resetTracking() {
    const button = document.getElementById('btn-reset-tracking');
    if (button) button.disabled = true;
    try {
      this.updateStatus('Reiniciando…');
      await this.mindAR?.reset();
      this.updateStatus('Buscando nuevamente la ilustración…');
    } finally {
      if (button) button.disabled = false;
    }
  }

  updateStatus(message) {
    const status = document.getElementById('status-display');
    if (status) { status.textContent = message; status.title = message; }
  }
}

new InkMotionApp();
