import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
import EventBus from '../utils/EventBus.js';

const LOOP_DURATION = 5000;

class ParallaxEngine {
  constructor(config = {}) {
    this.config = { container: '#ar-overlay', depthStrength: 0.12, ...config };
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.anchorGroup = null;
    this.storyGroup = null;
    this.imageMesh = null;
    this.frameMesh = null;
    this.particles = null;
    this.particleBase = null;
    this.texture = null;
    this.storyMaterial = null;
    this.animationFrame = null;
    this.isActive = false;
    this.isTargetVisible = false;
    this.previewMode = '3d';
    this.clockStart = performance.now();
    this.videoSize = null;
    this.boundResize = this.handleResize.bind(this);
  }

  async init() {
    this.container = document.querySelector(this.config.container);
    if (!this.container) throw new Error('No se encontró el contenedor 3D.');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
    this.camera.matrix.identity();
    this.camera.matrixWorld.identity();
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      throw new Error('El navegador no pudo iniciar WebGL. Activá la aceleración gráfica y recargá.');
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'three-parallax-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Contenido AR anclado al cuento');
    this.container.replaceChildren(this.renderer.domElement);

    this.anchorGroup = new THREE.Group();
    this.anchorGroup.matrixAutoUpdate = false;
    this.anchorGroup.visible = false;
    this.storyGroup = new THREE.Group();
    this.anchorGroup.add(this.storyGroup);
    this.scene.add(this.anchorGroup);

    window.addEventListener('resize', this.boundResize, { passive: true });
    this.handleResize();
    this.isActive = true;
    this.startAnimationLoop();
    EventBus.emit('parallax:initialized', { anchorMode: 'mindar-world-lock' });
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
    const contentRect = this.config.contentRect;
    const planeWidth = contentRect?.width || 1;
    const planeHeight = contentRect?.height && contentRect?.targetAspect
      ? contentRect.height * contentRect.targetAspect
      : 1 / aspect;

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 80, 60);
    this.storyMaterial = this.createDepthMaterial(texture);
    this.imageMesh = new THREE.Mesh(geometry, this.storyMaterial);
    this.imageMesh.position.z = 0.018;

    const frameGeometry = new THREE.PlaneGeometry(planeWidth * 1.025, planeHeight * 1.035);
    const frameMaterial = new THREE.MeshBasicMaterial({ color: 0x806cf5, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    this.frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
    this.frameMesh.position.z = -0.018;

    this.particles = this.createMagicParticles({ width: planeWidth, height: planeHeight });
    this.storyGroup.add(this.frameMesh, this.imageMesh, this.particles);
    const offsetX = contentRect ? contentRect.x + contentRect.width / 2 - 0.5 : 0;
    const offsetY = contentRect
      ? (0.5 - contentRect.y - contentRect.height / 2) * contentRect.targetAspect
      : 0;
    this.storyGroup.position.set(offsetX, offsetY, 0);
    this.storyGroup.rotation.set(0, 0, 0);
    this.storyGroup.scale.setScalar(1);
    this.anchorGroup.visible = false;
    this.isTargetVisible = false;
    this.clockStart = performance.now();
    this.container.classList.add('has-target');
    EventBus.emit('parallax:texture-ready', { width, height, anchorMode: 'mindar' });
  }

  createDepthMaterial(texture) {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTexture: { value: texture },
        uDepthStrength: { value: this.config.depthStrength },
        uTime: { value: 0 },
      },
      vertexShader: `
        uniform sampler2D uTexture;
        uniform float uDepthStrength;
        uniform float uTime;
        varying vec2 vUv;
        varying float vDepth;
        varying vec3 vViewDirection;

        float depthAt(vec2 coord) {
          vec3 color = texture2D(uTexture, coord).rgb;
          float luminance = dot(color, vec3(0.299, 0.587, 0.114));
          return smoothstep(0.12, 0.88, luminance);
        }

        void main() {
          vUv = uv;
          vDepth = depthAt(uv);
          vec3 displaced = position;
          float organic = sin((uv.x * 3.0 + uv.y * 2.0) * 6.28318 + uTime * 6.28318) * 0.004;
          displaced.z += (vDepth - 0.45) * uDepthStrength + organic * vDepth;
          vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
          vViewDirection = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying vec2 vUv;
        varying float vDepth;
        varying vec3 vViewDirection;

        void main() {
          float safeZ = max(abs(vViewDirection.z), 0.25);
          vec2 cameraParallax = (vViewDirection.xy / safeZ) * (vDepth - 0.5) * 0.018;
          vec2 sampleUv = clamp(vUv + cameraParallax, vec2(0.002), vec2(0.998));
          vec4 color = texture2D(uTexture, sampleUv);
          float light = 0.96 + vDepth * 0.07;
          gl_FragColor = vec4(color.rgb * light, color.a);
        }
      `,
    });
  }

  setProjectionMatrix(matrix) {
    if (!matrix || matrix.length !== 16) return;
    this.camera.projectionMatrix.fromArray(matrix);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  setVideoViewport({ videoWidth, videoHeight }) {
    this.videoSize = { videoWidth, videoHeight };
    this.handleResize();
  }

  updateWorldAnchor({ worldMatrix, dimensions }) {
    if (!worldMatrix || !dimensions || !this.anchorGroup) return;
    const [markerWidth, markerHeight] = dimensions;
    const tracked = new THREE.Matrix4().fromArray(worldMatrix);
    const position = new THREE.Vector3(markerWidth / 2, markerHeight / 2, 0);
    const scale = new THREE.Vector3(markerWidth, markerWidth, markerWidth);
    const postMatrix = new THREE.Matrix4().compose(position, new THREE.Quaternion(), scale);
    tracked.multiply(postMatrix);
    this.anchorGroup.matrix.copy(tracked);
    this.anchorGroup.matrixWorldNeedsUpdate = true;
  }

  onTargetFound() {
    this.isTargetVisible = true;
    this.anchorGroup.visible = this.previewMode === '3d' && Boolean(this.imageMesh);
    this.container.classList.add('target-found');
  }

  onTargetLost() {
    this.isTargetVisible = false;
    if (this.anchorGroup) this.anchorGroup.visible = false;
    this.container.classList.remove('target-found');
  }

  createMagicParticles(size) {
    const count = window.innerWidth < 680 ? 24 : 36;
    const positions = new Float32Array(count * 3);
    this.particleBase = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * size.width * 1.05;
      const y = (Math.random() - 0.5) * size.height * 1.05;
      const z = 0.06 + Math.random() * 0.12;
      positions.set([x, y, z], i * 3);
      this.particleBase.push({ x, y, z, phase: Math.random() * Math.PI * 2, radius: 0.008 + Math.random() * 0.014 });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffe9a8,
      size: 0.018,
      map: this.createSparkTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return new THREE.Points(geometry, material);
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
        base.z + Math.sin(angle + base.phase * 1.3) * 0.01,
      );
    });
    position.needsUpdate = true;
    this.particles.material.opacity = 0.58 + Math.sin(angle) * 0.22;
  }

  setPreviewMode(mode) {
    this.previewMode = mode === 'camera' ? 'camera' : '3d';
    if (this.anchorGroup) {
      this.anchorGroup.visible = this.previewMode === '3d' && this.isTargetVisible && Boolean(this.imageMesh);
    }
    this.container.classList.toggle('camera-only', this.previewMode === 'camera');
    EventBus.emit('parallax:mode-changed', { mode: this.previewMode });
  }

  startAnimationLoop() {
    if (this.animationFrame) return;
    const render = (now) => {
      if (!this.isActive) { this.animationFrame = null; return; }
      const loopPhase = ((now - this.clockStart) % LOOP_DURATION) / LOOP_DURATION;
      const angle = loopPhase * Math.PI * 2;
      if (this.anchorGroup?.visible) {
        const breathing = 1 + Math.sin(angle) * 0.008;
        this.storyGroup.scale.setScalar(breathing);
        if (this.storyMaterial) this.storyMaterial.uniforms.uTime.value = loopPhase;
        this.updateParticles(loopPhase);
      }
      this.renderer.render(this.scene, this.camera);
      this.animationFrame = requestAnimationFrame(render);
    };
    this.animationFrame = requestAnimationFrame(render);
  }

  handleResize() {
    if (!this.renderer || !this.container) return;
    const containerWidth = Math.max(1, this.container.clientWidth);
    const containerHeight = Math.max(1, this.container.clientHeight);
    if (!this.videoSize) {
      this.renderer.setSize(containerWidth, containerHeight, false);
      return;
    }
    const videoRatio = this.videoSize.videoWidth / this.videoSize.videoHeight;
    const containerRatio = containerWidth / containerHeight;
    let width;
    let height;
    if (videoRatio > containerRatio) {
      height = containerHeight;
      width = height * videoRatio;
    } else {
      width = containerWidth;
      height = width / videoRatio;
    }
    this.renderer.setSize(width, height, false);
    const canvas = this.renderer.domElement;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${(containerWidth - width) / 2}px`;
    canvas.style.top = `${(containerHeight - height) / 2}px`;
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
    window.removeEventListener('resize', this.boundResize);
    this.disposeTarget();
    this.renderer?.dispose();
  }
}

export default ParallaxEngine;
