/**
 * ParallaxEngine.js
 * Motor Parallax 2.5D usando CSS transforms y DeviceMotion
 * Genera efecto de profundidad sin WebGL/Three.js
 */

import EventBus from '../utils/EventBus.js';
import DeviceMotionListener from '../utils/DeviceMotionListener.js';

class ParallaxEngine {
  constructor(config = {}) {
    this.config = {
      container: config.container || '#ar-overlay',
      depthScale: config.depthScale || 0.05,
      rotationSensitivity: config.rotationSensitivity || 0.8,
      baseZoom: config.baseZoom || 1,
      enableDeviceMotion: config.enableDeviceMotion !== false,
      ...config,
    };

    this.layers = new Map();
    this.container = null;
    this.deviceMotion = null;
    this.currentRotation = { x: 0, y: 0 };
    this.isActive = false;
  }

  /**
   * Inicializa el motor parallax
   */
  async init() {
    try {
      console.log('🎭 Inicializando ParallaxEngine...');

      this.container = document.querySelector(this.config.container);
      if (!this.container) {
        throw new Error(`Container no encontrado: ${this.config.container}`);
      }

      // Configurar perspectiva 3D en el contenedor
      this.container.style.perspective = '1200px';
      this.container.style.perspectiveOrigin = '50% 50%';

      // Inicializar DeviceMotion si está habilitado
      if (this.config.enableDeviceMotion) {
        this.deviceMotion = new DeviceMotionListener();
        await this.deviceMotion.init();
        this.startMotionTracking();
      }

      this.isActive = true;
      EventBus.emit('parallax:initialized');
      console.log('✅ ParallaxEngine listo');
    } catch (error) {
      console.error('❌ Error en ParallaxEngine init:', error);
      EventBus.emit('parallax:error', error);
      throw error;
    }
  }

  /**
   * Crea una capa parallax
   */
  createLayer(layerConfig) {
    const {
      id,
      depth = 0.5, // 0-1, donde 0 es trasero y 1 es frente
      scale = 1,
      opacity = 1,
      content = '',
      className = '',
    } = layerConfig;

    if (!id) throw new Error('Layer debe tener un ID');

    const layer = document.createElement('div');
    layer.id = id;
    layer.className = `parallax-layer ${className}`;
    layer.innerHTML = content;

    // Aplicar estilos base
    Object.assign(layer.style, {
      position: 'absolute',
      width: '100%',
      height: '100%',
      transformStyle: 'preserve-3d',
      opacity: opacity,
      willChange: 'transform',
      pointerEvents: 'none',
    });

    // Inicializar transform
    layer.setAttribute('data-depth', depth);
    layer.setAttribute('data-scale', scale);
    this.updateLayerTransform(layer, 0, 0);

    this.container.appendChild(layer);
    this.layers.set(id, {
      element: layer,
      depth,
      scale,
      opacity,
      rotation: { x: 0, y: 0 },
    });

    return layer;
  }

  /**
   * Actualiza transform de una capa basado en rotación
   */
  updateLayerTransform(layerElement, rotX, rotY) {
    const depth = parseFloat(layerElement.getAttribute('data-depth'));
    const scale = parseFloat(layerElement.getAttribute('data-scale'));

    // Calcular perspectiva basada en profundidad
    const zOffset = depth * 200 - 100; // Rango: -100 a 100px
    const scaleFactor = 1 + depth * 0.3; // Escala aumenta con profundidad aparente

    // Transform: rotación + escala + traslación Z
    const transform = `
      perspective(1000px)
      rotateX(${rotX * depth}deg)
      rotateY(${rotY * depth}deg)
      scale(${scale * scaleFactor})
      translateZ(${zOffset}px)
    `;

    layerElement.style.transform = transform.trim();
  }

  /**
   * Inicia tracking de movimiento del dispositivo
   */
  startMotionTracking() {
    const motionLoop = () => {
      if (!this.isActive) return;

      const { beta, gamma } = this.deviceMotion.getOrientation();

      // Convertir a rotación X, Y (limitado)
      const rotX = Math.max(-15, Math.min(15, beta * this.config.rotationSensitivity));
      const rotY = Math.max(-15, Math.min(15, gamma * this.config.rotationSensitivity));

      this.currentRotation = { x: rotX, y: rotY };

      // Actualizar todas las capas
      this.layers.forEach((layerData) => {
        this.updateLayerTransform(layerData.element, rotX, rotY);
      });

      requestAnimationFrame(motionLoop);
    };

    motionLoop();
  }

  /**
   * Anima parallax basado en punto target (para AR)
   */
  animateToTarget(targetPosition, duration = 300) {
    const { x, y } = targetPosition;

    // Mapear posición AR a rotación parallax
    const rotX = (y - 0.5) * 30; // Rango: -15 a 15
    const rotY = (x - 0.5) * 30;

    this.animateRotation(rotX, rotY, duration);
  }

  /**
   * Anima suavemente la rotación
   */
  animateRotation(targetRotX, targetRotY, duration = 300) {
    const startTime = Date.now();
    const startRotX = this.currentRotation.x;
    const startRotY = this.currentRotation.y;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing: ease-out-cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      const rotX = startRotX + (targetRotX - startRotX) * easeProgress;
      const rotY = startRotY + (targetRotY - startRotY) * easeProgress;

      this.layers.forEach((layerData) => {
        this.updateLayerTransform(layerData.element, rotX, rotY);
      });

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  /**
   * Obtiene configuración de una capa
   */
  getLayer(id) {
    return this.layers.get(id);
  }

  /**
   * Actualiza profundidad de una capa
   */
  updateLayerDepth(id, newDepth) {
    const layerData = this.layers.get(id);
    if (layerData) {
      layerData.depth = newDepth;
      layerData.element.setAttribute('data-depth', newDepth);
      this.updateLayerTransform(layerData.element, this.currentRotation.x, this.currentRotation.y);
    }
  }

  /**
   * Detiene el motor
   */
  stop() {
    this.isActive = false;
    if (this.deviceMotion) {
      this.deviceMotion.stop();
    }
  }

  /**
   * Limpia todas las capas
   */
  clear() {
    this.layers.forEach((layerData) => {
      layerData.element.remove();
    });
    this.layers.clear();
  }
}

export default ParallaxEngine;
