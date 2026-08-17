/**
 * app.js
 * Orquestador principal de WebAR Storyteller
 * Coordina: MindARManager + ParallaxEngine + ImageProcessor + UI
 */

import MindARManager from './core/MindARManager.js';
import ParallaxEngine from './core/ParallaxEngine.js';
import ImageProcessor from './core/ImageProcessor.js';
import EventBus from './utils/EventBus.js';

class WebARStoryteller {
  constructor() {
    this.mindAR = null;
    this.parallax = null;
    this.imageProcessor = null;

    this.initializeApp();
  }

  /**
   * Inicializa la aplicación
   */
  async initializeApp() {
    try {
      console.log('🚀 Inicializando WebAR Storyteller...\n');

      // Esperar a que el DOM esté listo
      if (document.readyState === 'loading') {
        await new Promise((resolve) => {
          document.addEventListener('DOMContentLoaded', resolve);
        });
      }

      // 1. Inicializar módulos core
      console.log('\n--- INICIALIZANDO MÓDULOS CORE ---');
      await this.initializeCore();

      // 2. Configurar escuchadores de eventos
      console.log('\n--- CONFIGURANDO EVENTOS ---');
      this.setupEventListeners();

      // 3. Inicializar UI
      console.log('\n--- INICIALIZANDO UI ---');
      this.setupUI();

      console.log('\n✅ WebAR Storyteller listo\n');
      this.updateStatus('Sistema listo. Sube una imagen target.');
    } catch (error) {
      console.error('❌ Error fatal al inicializar:', error);
      this.updateStatus(`Error: ${error.message}`);
    }
  }

  /**
   * Inicializa los módulos core
   */
  async initializeCore() {
    try {
      // Inicializar ImageProcessor (sin dependencias)
      this.imageProcessor = new ImageProcessor({
        maxFileSize: 2 * 1024 * 1024,
        targetQuality: 0.85,
      });
      console.log('✅ ImageProcessor inicializado');

      // Inicializar ParallaxEngine
      this.parallax = new ParallaxEngine({
        container: '#ar-overlay',
        depthScale: 0.05,
        enableDeviceMotion: true,
      });
      await this.parallax.init();
      console.log('✅ ParallaxEngine inicializado');

      // Crear capas parallax de demostración
      this.createDemoLayers();

      // Inicializar MindARManager
      this.mindAR = new MindARManager({
        video: '#video-stream',
        container: '#ar-container',
        maxTrack: 1,
      });
      const mindARReady = await this.mindAR.init();
      if (mindARReady) {
        console.log('✅ MindARManager inicializado');
      } else {
        console.log('⚠️  MindARManager (modo demo)');
      }
    } catch (error) {
      console.error('Error en initializeCore:', error);
      // Continuar incluso con errores
    }
  }

  /**
   * Crea capas parallax de demostración
   */
  createDemoLayers() {
    // Capa de fondo (lejana)
    this.parallax.createLayer({
      id: 'layer-bg',
      depth: 0.2,
      scale: 1,
      className: 'demo-layer demo-bg',
      content: `
        <div style="width: 100%; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 20px;"></div>
      `,
    });

    // Capa intermedia
    this.parallax.createLayer({
      id: 'layer-mid',
      depth: 0.5,
      scale: 0.8,
      className: 'demo-layer demo-mid',
      content: `
        <div style="width: 100%; height: 100%; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 15px; display: flex; align-items: center; justify-content: center; font-size: 24px; color: white; font-weight: bold;">Parallax Layer</div>
      `,
    });

    // Capa frontal (cercana)
    this.parallax.createLayer({
      id: 'layer-front',
      depth: 0.8,
      scale: 0.6,
      className: 'demo-layer demo-front',
      content: `
        <div style="width: 100%; height: 100%; background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: white; font-weight: bold;">3D Depth</div>
      `,
    });
  }

  /**
   * Configura escuchadores de eventos
   */
  setupEventListeners() {
    // Eventos de MindAR
    EventBus.on('mindar:initialized', () => {
      console.log('📍 MindAR inicializado');
    });

    EventBus.on('mindar:camera-ready', () => {
      this.updateStatus('Cámara lista. Busca un target...');
    });

    EventBus.on('mindar:target-detected', (data) => {
      console.log('🎯 Target detectado:', data.index);
      this.updateStatus(`Target ${data.index} detectado`);
      this.handleTargetDetected(data);
    });

    EventBus.on('mindar:target-lost', (data) => {
      console.log('❌ Target perdido:', data.index);
      this.updateStatus('Target fuera de vista');
    });

    // Eventos de ImageProcessor
    EventBus.on('image-processor:processed', (processed) => {
      console.log('📸 Imagen procesada:', processed.name);
      console.log(`  Tamaño original: ${(processed.originalSize / 1024).toFixed(2)}KB`);
      console.log(`  Tamaño optimizado: ${(processed.optimizedSize / 1024).toFixed(2)}KB`);
      console.log(`  Dimensiones: ${processed.dimensions.width}x${processed.dimensions.height}`);

      this.updateStatus('Imagen procesada. Agregando a tracking...');

      // Agregar como target AR automáticamente
      this.imageProcessor.emitAsTarget(processed.name);
    });

    EventBus.on('image-processor:error', (error) => {
      console.error('❌ Error en ImageProcessor:', error);
      this.updateStatus(`Error: ${error.message}`);
    });

    // Eventos de ParallaxEngine
    EventBus.on('parallax:initialized', () => {
      console.log('🎭 ParallaxEngine listo');
    });
  }

  /**
   * Configura elementos UI
   */
  setupUI() {
    const btnUpload = document.getElementById('btn-upload-target');
    const btnReset = document.getElementById('btn-reset-tracking');

    if (btnUpload) {
      // Crear input file invisible
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';

      fileInput.addEventListener('change', (e) => {
        this.handleImageUpload(e);
      });

      document.body.appendChild(fileInput);

      // Click en botón abre file input
      btnUpload.addEventListener('click', () => {
        fileInput.click();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.resetTracking();
      });
    }
  }

  /**
   * Maneja subida de imagen
   */
  async handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      this.updateStatus('Procesando imagen...');

      const processed = await this.imageProcessor.processImageFile(
        file,
        `target-${Date.now()}`
      );

      this.updateStatus('Imagen lista para tracking');
    } catch (error) {
      this.updateStatus(`Error: ${error.message}`);
    }

    // Limpiar input
    event.target.value = '';
  }

  /**
   * Maneja detección de target
   */
  handleTargetDetected(data) {
    const { index, matrix } = data;

    // Convertir matriz AR a posición 2D
    const position = this.extractPositionFromMatrix(matrix);

    // Animar parallax al target
    this.parallax.animateToTarget(position, 200);
  }

  /**
   * Extrae posición 2D de matriz de transformación 4x4
   */
  extractPositionFromMatrix(matrix) {
    // Matriz 4x4 AR: [cols 0,1,2,3 = x; cols 4,5,6,7 = y; cols 8,9,10,11 = z; cols 12,13,14,15 = pos]
    // Normalizar a rango 0-1
    const x = (matrix[12] + 1) / 2; // Rango AR típico: -1 a 1
    const y = (matrix[13] + 1) / 2;

    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  /**
   * Reinicia tracking
   */
  async resetTracking() {
    this.updateStatus('Resiniciando...');
    await this.mindAR.reset();
    this.parallax.animateRotation(0, 0, 300);
    this.updateStatus('Listo. Busca un target...');
  }

  /**
   * Actualiza UI de estado
   */
  updateStatus(message) {
    const statusDisplay = document.getElementById('status-display');
    if (statusDisplay) {
      statusDisplay.textContent = message;
    }
  }
}

// Iniciar aplicación cuando el script se carga
const app = new WebARStoryteller();
