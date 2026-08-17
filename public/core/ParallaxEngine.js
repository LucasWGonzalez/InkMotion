import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
import EventBus from '../utils/EventBus.js';
import DeviceMotionListener from '../utils/DeviceMotionListener.js';

class ParallaxEngine {
  constructor(config = {}) {
    this.config = {
      container: '#ar-overlay',
      rotationSensitivity: 0.018,
      enableDeviceMotion: true,
      ...config,
    };
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.group = null;
    this.imageMesh = null;
    this.frameMesh = null;
    this.texture = null;
    this.deviceMotion = null;
    this.animationFrame = null;
    this.isActive = false;
    this.targetRotation = { x: 0, y: 0 };
    this.pointerRotation = { x: 0, y: 0 };
    this.boundResize = this.handleResize.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
  }

  async init() {
    this.container = document.querySelector(this.config.container);
    if (!this.container) throw new Error('No se encontró el contenedor 3D.');

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0, 5);

    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch (error) {
      throw new Error('El navegador no pudo iniciar WebGL. Activá la aceleración gráfica y recargá.');
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'three-parallax-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.container.replaceChildren(this.renderer.domElement);

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    if (this.config.enableDeviceMotion) {
      this.deviceMotion = new DeviceMotionListener();
      await this.deviceMotion.init();
    }

    window.addEventListener('resize', this.boundResize, { passive: true });
    window.addEventListener('pointermove', this.boundPointerMove, { passive: true });
    this.handleResize();
    this.isActive = true;
    this.startAnimationLoop();
    EventBus.emit('parallax:initialized');
  }

  async requestMotionPermission() {
    if (!this.deviceMotion) return false;
    try {
      const enabled = await this.deviceMotion.init({ requestPermission: true });
      if (enabled) this.deviceMotion.recalibrate();
      return enabled;
    } catch (error) {
      console.warn('Movimiento no autorizado:', error);
      return false;
    }
  }

  async setTargetImage(url) {
    const texture = await new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, () => reject(new Error('No se pudo cargar la textura 3D.')));
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    this.disposeTarget();
    this.texture = texture;
    const image = texture.image;
    const aspect = Math.max(0.2, Math.min(5, image.naturalWidth / image.naturalHeight));
    const size = this.getPlaneSize(aspect);

    const geometry = new THREE.PlaneGeometry(size.width, size.height, 24, 18);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    this.imageMesh = new THREE.Mesh(geometry, material);
    this.imageMesh.position.z = 0.08;

    const frameGeometry = new THREE.PlaneGeometry(size.width * 1.035, size.height * 1.045);
    const frameMaterial = new THREE.MeshBasicMaterial({ color: 0x6957d8, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    this.frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
    this.frameMesh.position.z = -0.03;

    this.group.add(this.frameMesh, this.imageMesh);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(0.92);
    this.group.visible = true;
    this.container.classList.add('has-target');
    this.deviceMotion?.recalibrate();
    EventBus.emit('parallax:texture-ready', { width: image.naturalWidth, height: image.naturalHeight });
  }

  getPlaneSize(aspect) {
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    const visibleWidth = visibleHeight * this.camera.aspect;
    let height = visibleHeight * (window.innerWidth < 680 ? 0.52 : 0.62);
    let width = height * aspect;
    if (width > visibleWidth * 0.84) {
      width = visibleWidth * 0.84;
      height = width / aspect;
    }
    return { width, height };
  }

  startAnimationLoop() {
    if (this.animationFrame) return;
    const render = () => {
      if (!this.isActive) {
        this.animationFrame = null;
        return;
      }
      const tilt = this.deviceMotion?.getTilt() || { beta: 0, gamma: 0 };
      const hasMotion = this.deviceMotion?.isListening && this.deviceMotion?.hasReading;
      const targetX = hasMotion
        ? THREE.MathUtils.clamp(-tilt.beta * this.config.rotationSensitivity, -0.22, 0.22)
        : this.pointerRotation.x;
      const targetY = hasMotion
        ? THREE.MathUtils.clamp(tilt.gamma * this.config.rotationSensitivity, -0.28, 0.28)
        : this.pointerRotation.y;
      this.targetRotation.x += (targetX - this.targetRotation.x) * 0.09;
      this.targetRotation.y += (targetY - this.targetRotation.y) * 0.09;

      if (this.group?.visible) {
        this.group.rotation.x = this.targetRotation.x;
        this.group.rotation.y = this.targetRotation.y;
        this.group.position.x += (this.targetRotation.y * 0.42 - this.group.position.x) * 0.08;
        this.group.position.y += (-this.targetRotation.x * 0.32 - this.group.position.y) * 0.08;
        const pulse = 1 + Math.sin(performance.now() * 0.0014) * 0.004;
        const scale = this.group.scale.x + (pulse - this.group.scale.x) * 0.05;
        this.group.scale.setScalar(scale);
      }
      this.renderer.render(this.scene, this.camera);
      this.animationFrame = requestAnimationFrame(render);
    };
    this.animationFrame = requestAnimationFrame(render);
  }

  handlePointerMove(event) {
    const x = event.clientX / Math.max(1, window.innerWidth) - 0.5;
    const y = event.clientY / Math.max(1, window.innerHeight) - 0.5;
    this.pointerRotation = { x: -y * 0.18, y: x * 0.24 };
  }

  handleResize() {
    if (!this.renderer || !this.camera || !this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animateRotation(x = 0, y = 0) {
    this.targetRotation = { x: THREE.MathUtils.degToRad(x), y: THREE.MathUtils.degToRad(y) };
    this.deviceMotion?.recalibrate();
  }

  disposeTarget() {
    for (const mesh of [this.imageMesh, this.frameMesh]) {
      if (!mesh) continue;
      this.group?.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
    this.texture?.dispose();
    this.imageMesh = null;
    this.frameMesh = null;
    this.texture = null;
  }

  stop() {
    this.isActive = false;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.deviceMotion?.stop();
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('pointermove', this.boundPointerMove);
    this.disposeTarget();
    this.renderer?.dispose();
  }
}

export default ParallaxEngine;
