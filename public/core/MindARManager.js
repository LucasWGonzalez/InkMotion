/**
 * MindARManager.js
 * Gestiona la integración ligera de MindAR para image-target tracking
 * Inicializa cámara, detecta targets y emite eventos de tracking
 */

import EventBus from '../utils/EventBus.js';

class MindARManager {
  constructor(config = {}) {
    this.config = {
      video: config.video || '#video-stream',
      container: config.container || '#ar-container',
      maxTrack: config.maxTrack || 1,
      uiLoading: config.uiLoading || 'yes',
      imageTargets: config.imageTargets || [],
      ...config,
    };

    this.mindAR = null;
    this.controller = null;
    this.video = null;
    this.isRunning = false;
    this.trackedTargets = new Map();

    EventBus.on('image-processor:target-ready', (target) => {
      this.addImageTarget(target);
    });
  }

  /**
   * Inicializa MindAR y la cámara
   */
  async init() {
    try {
      console.log('🔧 Inicializando MindAR Manager...');

      // Esperar a que MindAR esté disponible (con timeout)
      let attempts = 0;
      while (typeof window.MINDAR === 'undefined' && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        attempts++;
      }

      if (typeof window.MINDAR === 'undefined') {
        console.warn('⚠️  MindAR SDK no disponible. Continuando en modo demo...');
        // Intentar iniciar cámara igual para demo
        await this.startCameraDemo();
        return true;
      }

      const { IMAGE } = window.MINDAR;
      this.mindAR = IMAGE;

      // Crear controlador de MindAR
      this.controller = new this.mindAR.Controller({
        maxTrack: this.config.maxTrack,
        uiLoading: this.config.uiLoading,
      });

      // Obtener elemento video
      this.video = document.querySelector(this.config.video);
      if (!this.video) {
        throw new Error(`Video element not found: ${this.config.video}`);
      }

      // Agregar targets iniciales si existen
      if (this.config.imageTargets.length > 0) {
        for (const target of this.config.imageTargets) {
          this.addImageTarget(target);
        }
      }

      // Compilar targets con MindAR
      await this.controller.dummyRun([this.video]);
      console.log('✅ MindAR compilado');

      // Iniciar stream de cámara
      await this.startCamera();

      this.isRunning = true;
      EventBus.emit('mindar:initialized');

      return true;
    } catch (error) {
      console.error('❌ Error en MindAR init:', error);
      EventBus.emit('mindar:error', error);
      // No lanzar error, permitir que app continúe
      return false;
    }
  }

  /**
   * Inicia el stream de cámara y detección
   */
  async startCamera() {
    try {
      console.log('📹 Iniciando cámara...');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
        audio: false,
      });

      this.video.srcObject = stream;

      // Esperar a que el video esté listo
      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => resolve();
      });

      // Iniciar loop de tracking
      this.startTracking();
      EventBus.emit('mindar:camera-ready');
    } catch (error) {
      console.error('❌ Error al acceder a cámara:', error);
      EventBus.emit('mindar:camera-error', error);
      throw error;
    }
  }

  /**
   * Loop continuo de tracking
   */
  startTracking() {
    const trackingLoop = async () => {
      if (!this.isRunning) return;

      try {
        const result = await this.controller.process(this.video);

        if (result) {
          this.handleTrackingResult(result);
        }
      } catch (error) {
        console.error('Error en tracking loop:', error);
      }

      requestAnimationFrame(trackingLoop);
    };

    trackingLoop();
  }

  /**
   * Procesa resultado de tracking
   */
  handleTrackingResult(result) {
    const { targetIndex, worldMatrix } = result;

    if (worldMatrix) {
      this.trackedTargets.set(targetIndex, {
        index: targetIndex,
        matrix: worldMatrix,
        timestamp: Date.now(),
        isTracking: true,
      });

      EventBus.emit('mindar:target-detected', {
        index: targetIndex,
        matrix: worldMatrix,
      });
    } else {
      if (this.trackedTargets.has(targetIndex)) {
        this.trackedTargets.delete(targetIndex);
        EventBus.emit('mindar:target-lost', { index: targetIndex });
      }
    }
  }

  /**
   * Agrega un nuevo image target
   */
  addImageTarget(targetData) {
    try {
      if (!this.controller) {
        throw new Error('MindAR controller no inicializado');
      }

      const { url, name } = targetData;

      if (!url) {
        throw new Error('Target debe tener URL de imagen');
      }

      // MindAR procesa targets en forma de URL
      this.controller.addImageTarget(url);
      console.log(`✅ Target agregado: ${name || 'unnamed'}`);

      EventBus.emit('mindar:target-added', { name, url });
    } catch (error) {
      console.error('❌ Error al agregar target:', error);
      EventBus.emit('mindar:target-error', error);
    }
  }

  /**
   * Obtiene datos de tracking actual
   */
  getTrackedTargets() {
    return Array.from(this.trackedTargets.values());
  }

  /**
   * Detiene tracking y cámara
   */
  stop() {
    this.isRunning = false;
    if (this.video && this.video.srcObject) {
      this.video.srcObject.getTracks().forEach((track) => track.stop());
    }
    EventBus.emit('mindar:stopped');
  }

  /**
   * Reinicia tracking
   */
  async reset() {
    this.trackedTargets.clear();
    EventBus.emit('mindar:reset');
  }

  /**
   * Modo demo: inicia solo la cámara sin tracking AR
   */
  async startCameraDemo() {
    try {
      console.log('📹 Iniciando cámara (modo demo)...');
      this.video = document.querySelector(this.config.video);
      if (!this.video) {
        throw new Error(`Video element not found: ${this.config.video}`);
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
        audio: false,
      });

      this.video.srcObject = stream;
      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => resolve();
      });

      this.isRunning = true;
      EventBus.emit('mindar:camera-ready');
      console.log('✅ Cámara iniciada (demo sin tracking)');
    } catch (error) {
      console.error('❌ Error al acceder a cámara:', error);
      EventBus.emit('mindar:camera-error', error);
    }
  }
}

export default MindARManager;
