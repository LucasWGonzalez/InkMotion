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
      this.parallax = new ParallaxEngine({ container: '#ar-overlay', enableDeviceMotion: true });
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
    EventBus.on('image-processor:error', (error) => console.warn('ImageProcessor:', error));
  }

  setupUI() {
    const uploadButton = document.getElementById('btn-upload-target');
    const resetButton = document.getElementById('btn-reset-tracking');
    this.uploadInput = document.createElement('input');
    this.uploadInput.type = 'file';
    this.uploadInput.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
    this.uploadInput.hidden = true;
    this.uploadInput.addEventListener('change', (event) => this.handleImageUpload(event));
    document.body.appendChild(this.uploadInput);

    uploadButton?.addEventListener('click', async () => {
      await this.parallax?.requestMotionPermission();
      this.uploadInput.click();
    });
    resetButton?.addEventListener('click', () => this.resetTracking());
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
      this.updateStatus('Creando plano y textura 3D…');
      await this.parallax.setTargetImage(processed.url);
      const saved = Math.max(0, 100 - (processed.optimizedSize / processed.originalSize) * 100);
      this.updateStatus(`Plano 3D activo · incliná el celular · ${saved.toFixed(0)}% optimizada`);
    } catch (error) {
      console.error(error);
      this.updateStatus(error.message || 'No se pudo procesar la imagen.');
    } finally {
      button?.classList.remove('loading');
      if (button) button.disabled = false;
      event.target.value = '';
    }
  }

  async resetTracking() {
    const button = document.getElementById('btn-reset-tracking');
    if (button) button.disabled = true;
    try {
      this.updateStatus('Reiniciando…');
      await this.mindAR?.reset();
      this.parallax?.animateRotation(0, 0, 300);
      this.updateStatus('Listo. Podés cargar otra imagen.');
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
