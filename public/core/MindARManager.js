import EventBus from '../utils/EventBus.js';

class MindARManager {
  constructor(config = {}) {
    this.config = { video: '#video-stream', container: '#ar-container', imageTargetSrc: null, ...config };
    this.video = null;
    this.stream = null;
    this.isRunning = false;
    this.mode = this.config.imageTargetSrc ? 'mindar' : 'demo';
  }

  async init() {
    this.video = document.querySelector(this.config.video);
    if (!this.video) throw new Error('No se encontró el elemento de cámara.');
    if (!navigator.mediaDevices?.getUserMedia) {
      const error = new Error('Este navegador no permite usar la cámara. Abrí el sitio por HTTPS.');
      EventBus.emit('mindar:camera-error', error);
      return false;
    }

    // Sin un .mind compilado no se intenta tracking inválido: se usa cámara + Parallax.
    if (this.mode === 'mindar') {
      console.info('Target .mind configurado; el flujo de tracking puede inicializarse aquí.');
    }
    return this.startCameraDemo();
  }

  async startCameraDemo() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.isRunning = true;
      EventBus.emit('mindar:initialized', { mode: 'demo' });
      EventBus.emit('mindar:camera-ready', { mode: 'demo' });
      return true;
    } catch (error) {
      const friendly = error?.name === 'NotAllowedError'
        ? new Error('Permiso de cámara denegado. Habilitalo en el navegador y recargá la página.')
        : new Error('No se pudo iniciar la cámara. Cerrá otras aplicaciones que la estén usando y reintentá.');
      EventBus.emit('mindar:camera-error', friendly);
      return false;
    }
  }

  async reset() {
    if (!this.isRunning) return this.startCameraDemo();
    EventBus.emit('mindar:reset');
    return true;
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.video && (this.video.srcObject = null);
    this.isRunning = false;
    EventBus.emit('mindar:stopped');
  }
}

export default MindARManager;
