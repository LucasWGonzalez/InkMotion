import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
import EventBus from '../utils/EventBus.js';
import DeviceMotionListener from '../utils/DeviceMotionListener.js';

const LOOP_DURATION = 5000;

class ParallaxEngine {
  constructor(config = {}) {
    this.config = { container: '#ar-overlay', rotationSensitivity: 0.018, enableDeviceMotion: true, depthStrength: 0.34, ...config };
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.storyGroup = null;
    this.imageMesh = null;
    this.frameMesh = null;
    this.particles = null;
    this.particleBase = null;
    this.texture = null;
    this.storyMaterial = null;
    this.deviceMotion = null;
    this.animationFrame = null;
    this.isActive = false;
    this.previewMode = '3d';
    this.targetRotation = { x: 0, y: 0 };
    this.pointerRotation = { x: 0, y: 0 };
    this.clockStart = performance.now();
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
    } catch {
      throw new Error('El navegador no pudo iniciar WebGL. Activá la aceleración gráfica y recargá.');
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'three-parallax-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Vista previa tridimensional del cuento');
    this.container.replaceChildren(this.renderer.domElement);

    this.storyGroup = new THREE.Group();
    this.storyGroup.visible = false;
    this.scene.add(this.storyGroup);
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
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

    this.disposeTarget();
    this.texture = texture;
    const image = texture.image;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const aspect = THREE.MathUtils.clamp(width / height, 0.2, 5);
    const size = this.getPlaneSize(aspect);

    // Malla densamente subdividida: la luminancia de la ilustración actúa como
    // mapa de relieve y desplaza vértices + UV en el shader.
    const geometry = new THREE.PlaneGeometry(size.width, size.height, 80, 60);
    this.storyMaterial = this.createDepthMaterial(texture);
    this.imageMesh = new THREE.Mesh(geometry, this.storyMaterial);
    this.imageMesh.position.z = 0.08;

    const frameGeometry = new THREE.PlaneGeometry(size.width * 1.035, size.height * 1.045);
    const frameMaterial = new THREE.MeshBasicMaterial({ color: 0x806cf5, transparent: true, opacity: 0.48, side: THREE.DoubleSide });
    this.frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
    this.frameMesh.position.z = -0.09;

    this.particles = this.createMagicParticles(size);
    this.storyGroup.add(this.frameMesh, this.imageMesh, this.particles);
    this.storyGroup.rotation.set(0, 0, 0);
    this.storyGroup.position.set(0, 0, 0);
    this.storyGroup.scale.setScalar(0.96);
    this.storyGroup.visible = this.previewMode === '3d';
    this.clockStart = performance.now();
    this.container.classList.add('has-target');
    this.deviceMotion?.recalibrate();
    EventBus.emit('parallax:texture-ready', { width, height, depthMode: 'luminance-displacement', loopDuration: LOOP_DURATION });
  }

  createDepthMaterial(texture) {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTexture: { value: texture },
        uDepthStrength: { value: this.config.depthStrength },
        uTilt: { value: new THREE.Vector2() },
        uTime: { value: 0 },
      },
      vertexShader: `
        uniform sampler2D uTexture;
        uniform float uDepthStrength;
        uniform float uTime;
        varying vec2 vUv;
        varying float vDepth;

        float depthAt(vec2 coord) {
          vec3 color = texture2D(uTexture, coord).rgb;
          float luminance = dot(color, vec3(0.299, 0.587, 0.114));
          return smoothstep(0.12, 0.88, luminance);
        }

        void main() {
          vUv = uv;
          vDepth = depthAt(uv);
          vec3 displaced = position;
          float organic = sin((uv.x * 3.0 + uv.y * 2.0) * 6.28318 + uTime * 6.28318) * 0.012;
          displaced.z += (vDepth - 0.45) * uDepthStrength + organic * vDepth;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform vec2 uTilt;
        varying vec2 vUv;
        varying float vDepth;

        void main() {
          vec2 uvOffset = uTilt * (vDepth - 0.5) * 0.045;
          vec2 sampleUv = clamp(vUv + uvOffset, vec2(0.002), vec2(0.998));
          vec4 color = texture2D(uTexture, sampleUv);
          float light = 0.96 + vDepth * 0.07;
          gl_FragColor = vec4(color.rgb * light, color.a);
        }
      `,
    });
  }

  createMagicParticles(size) {
    const count = window.innerWidth < 680 ? 28 : 42;
    const positions = new Float32Array(count * 3);
    this.particleBase = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * size.width * 1.08;
      const y = (Math.random() - 0.5) * size.height * 1.08;
      const z = 0.25 + Math.random() * 0.45;
      positions.set([x, y, z], i * 3);
      this.particleBase.push({ x, y, z, phase: Math.random() * Math.PI * 2, radius: 0.025 + Math.random() * 0.055 });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffe9a8,
      size: window.innerWidth < 680 ? 0.055 : 0.065,
      map: this.createSparkTexture(),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 4;
    return points;
  }

  createSparkTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.18, 'rgba(255,235,155,.95)');
    gradient.addColorStop(1, 'rgba(255,210,90,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  updateParticles(loopPhase) {
    if (!this.particles || !this.particleBase) return;
    const position = this.particles.geometry.attributes.position;
    const angle = loopPhase * Math.PI * 2;
    this.particleBase.forEach((base, i) => {
      position.setXYZ(
        i,
        base.x + Math.sin(angle + base.phase) * base.radius,
        base.y + Math.cos(angle + base.phase * 0.7) * base.radius * 1.8,
        base.z + Math.sin(angle + base.phase * 1.3) * 0.04,
      );
    });
    position.needsUpdate = true;
    this.particles.material.opacity = 0.58 + Math.sin(angle) * 0.22;
  }

  setPreviewMode(mode) {
    this.previewMode = mode === 'camera' ? 'camera' : '3d';
    if (this.storyGroup) this.storyGroup.visible = this.previewMode === '3d' && Boolean(this.imageMesh);
    this.container.classList.toggle('camera-only', this.previewMode === 'camera');
    EventBus.emit('parallax:mode-changed', { mode: this.previewMode });
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
    const render = (now) => {
      if (!this.isActive) { this.animationFrame = null; return; }
      const loopPhase = ((now - this.clockStart) % LOOP_DURATION) / LOOP_DURATION;
      const angle = loopPhase * Math.PI * 2;
      const tilt = this.deviceMotion?.getTilt() || { beta: 0, gamma: 0 };
      const hasMotion = this.deviceMotion?.isListening && this.deviceMotion?.hasReading;
      const targetX = hasMotion ? THREE.MathUtils.clamp(-tilt.beta * this.config.rotationSensitivity, -0.22, 0.22) : this.pointerRotation.x;
      const targetY = hasMotion ? THREE.MathUtils.clamp(tilt.gamma * this.config.rotationSensitivity, -0.28, 0.28) : this.pointerRotation.y;
      this.targetRotation.x += (targetX - this.targetRotation.x) * 0.09;
      this.targetRotation.y += (targetY - this.targetRotation.y) * 0.09;

      if (this.storyGroup?.visible) {
        this.storyGroup.rotation.x = this.targetRotation.x;
        this.storyGroup.rotation.y = this.targetRotation.y;
        this.storyGroup.position.x += (this.targetRotation.y * 0.42 - this.storyGroup.position.x) * 0.08;
        this.storyGroup.position.y += (-this.targetRotation.x * 0.32 - this.storyGroup.position.y) * 0.08;
        const breathing = 1 + Math.sin(angle) * 0.018;
        const scale = this.storyGroup.scale.x + (breathing - this.storyGroup.scale.x) * 0.08;
        this.storyGroup.scale.setScalar(scale);
        if (this.storyMaterial) {
          this.storyMaterial.uniforms.uTime.value = loopPhase;
          this.storyMaterial.uniforms.uTilt.value.set(this.targetRotation.y, -this.targetRotation.x);
        }
        this.updateParticles(loopPhase);
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

  animateRotation() {
    this.targetRotation = { x: 0, y: 0 };
    this.deviceMotion?.recalibrate();
  }

  disposeTarget() {
    for (const object of [this.imageMesh, this.frameMesh, this.particles]) {
      if (!object) continue;
      this.storyGroup?.remove(object);
      object.geometry?.dispose();
      if (object.material?.map && object !== this.imageMesh) object.material.map.dispose();
      object.material?.dispose();
    }
    this.texture?.dispose();
    this.imageMesh = this.frameMesh = this.particles = null;
    this.particleBase = null;
    this.texture = null;
    this.storyMaterial = null;
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
