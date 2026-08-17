import EventBus from '../utils/EventBus.js';
import DeviceMotionListener from '../utils/DeviceMotionListener.js';

class ParallaxEngine {
  constructor(config = {}) {
    this.config = { container: '#ar-overlay', rotationSensitivity: 0.35, enableDeviceMotion: true, ...config };
    this.layers = new Map();
    this.container = null;
    this.deviceMotion = null;
    this.currentRotation = { x: 0, y: 0 };
    this.isActive = false;
    this.motionFrame = null;
  }

  async init() {
    this.container = document.querySelector(this.config.container);
    if (!this.container) throw new Error(`Container no encontrado: ${this.config.container}`);
    this.container.style.perspective = '1200px';
    this.container.style.perspectiveOrigin = '50% 50%';
    this.isActive = true;
    if (this.config.enableDeviceMotion) {
      this.deviceMotion = new DeviceMotionListener();
      await this.deviceMotion.init();
      this.startMotionTracking();
    }
    EventBus.emit('parallax:initialized');
  }

  async requestMotionPermission() {
    if (!this.deviceMotion) return false;
    try {
      const enabled = await this.deviceMotion.init({ requestPermission: true });
      if (enabled) this.startMotionTracking();
      return enabled;
    } catch (error) {
      console.warn('Permiso de movimiento no disponible:', error);
      return false;
    }
  }

  createLayer({ id, depth = 0.5, scale = 1, opacity = 1, content = '', className = '' }) {
    if (!id) throw new Error('Layer debe tener un ID');
    const old = this.layers.get(id);
    if (old) old.element.remove();
    const layer = document.createElement('div');
    layer.id = id;
    layer.className = `parallax-layer ${className}`;
    layer.innerHTML = content;
    layer.dataset.depth = String(depth);
    layer.dataset.scale = String(scale);
    layer.style.opacity = String(opacity);
    this.container.appendChild(layer);
    this.layers.set(id, { element: layer, depth, scale, opacity });
    this.updateLayerTransform(layer, this.currentRotation.x, this.currentRotation.y);
    return layer;
  }

  setTargetImage(url) {
    const layer = this.layers.get('layer-target')?.element;
    if (!layer) return;
    layer.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Imagen target seleccionada';
    img.className = 'target-preview';
    layer.appendChild(img);
    this.container.classList.add('has-target');
  }

  updateLayerTransform(layer, rotX, rotY) {
    const depth = Number(layer.dataset.depth || 0.5);
    const scale = Number(layer.dataset.scale || 1);
    const x = rotY * depth;
    const y = -rotX * depth;
    layer.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), ${depth * 80}px) rotateX(${rotX * depth}deg) rotateY(${rotY * depth}deg) scale(${scale})`;
  }

  startMotionTracking() {
    if (this.motionFrame) return;
    const loop = () => {
      if (!this.isActive) { this.motionFrame = null; return; }
      const { beta, gamma } = this.deviceMotion?.getOrientation() || { beta: 0, gamma: 0 };
      const rotX = Math.max(-12, Math.min(12, beta * this.config.rotationSensitivity));
      const rotY = Math.max(-12, Math.min(12, gamma * this.config.rotationSensitivity));
      this.currentRotation = { x: rotX, y: rotY };
      this.layers.forEach(({ element }) => this.updateLayerTransform(element, rotX, rotY));
      this.motionFrame = requestAnimationFrame(loop);
    };
    this.motionFrame = requestAnimationFrame(loop);
  }

  animateRotation(targetX, targetY, duration = 300) {
    const start = performance.now();
    const origin = { ...this.currentRotation };
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = origin.x + (targetX - origin.x) * eased;
      const y = origin.y + (targetY - origin.y) * eased;
      this.layers.forEach(({ element }) => this.updateLayerTransform(element, x, y));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  animateToTarget({ x, y }, duration = 300) { this.animateRotation((y - 0.5) * 24, (x - 0.5) * 24, duration); }
  stop() {
    this.isActive = false;
    if (this.motionFrame) cancelAnimationFrame(this.motionFrame);
    this.motionFrame = null;
    this.deviceMotion?.stop();
  }
}

export default ParallaxEngine;
