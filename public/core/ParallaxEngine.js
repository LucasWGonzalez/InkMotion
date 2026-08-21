import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
import EventBus from '../utils/EventBus.js';

const LOOP_DURATION = 5000;

class ParallaxEngine {
  constructor(config = {}) {
    this.config = { container: '#ar-overlay', anchorSmoothing: 0.18, ...config };
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.anchorGroup = null;
    this.storyGroup = null;
    this.videoMesh = null;
    this.shadowMesh = null;
    this.particles = null;
    this.particleBase = null;
    this.videoElement = null;
    this.videoTexture = null;
    this.storyMaterial = null;
    this.animationFrame = null;
    this.isActive = false;
    this.isTargetVisible = false;
    this.previewMode = '3d';
    this.clockStart = performance.now();
    this.videoSize = null;
    this.anchorTargetPosition = new THREE.Vector3();
    this.anchorTargetQuaternion = new THREE.Quaternion();
    this.anchorTargetScale = new THREE.Vector3(1, 1, 1);
    this.anchorCurrentPosition = new THREE.Vector3();
    this.anchorCurrentQuaternion = new THREE.Quaternion();
    this.anchorCurrentScale = new THREE.Vector3(1, 1, 1);
    this.anchorTransformReady = false;
    this.revealProgress = 0;
    this.revealTarget = 0;
    this.lastFrameTime = performance.now();
    this.boundResize = this.handleResize.bind(this);
    this.frameListeners = new Set();
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
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      console.error('[InkMotion/WebGL] Contexto perdido; el renderizado AR se detuvo.', event);
      EventBus.emit('parallax:webgl-error', new Error('El contexto WebGL se perdió durante la experiencia AR.'));
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.info('[InkMotion/WebGL] Contexto restaurado.');
    });
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

  async loadTexture(url, errorMessage) {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, () => reject(new Error(errorMessage)));
    });
  }

  async setTargetVideo(imageUrl, videoUrl) {
    const reference = await this.loadTexture(imageUrl, 'No se pudo cargar la imagen de referencia.');
    this.disposeTarget();
    const image = reference.image;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    reference.dispose();
    const aspect = THREE.MathUtils.clamp(width / height, 0.2, 5);
    const contentRect = this.config.contentRect;
    const planeWidth = contentRect?.width || 1;
    const planeHeight = contentRect?.height && contentRect?.targetAspect
      ? contentRect.height * contentRect.targetAspect
      : 1 / aspect;

    this.videoElement = await this.createVideoElement(videoUrl);
    const videoAspect = this.videoElement.videoWidth / this.videoElement.videoHeight;
    if (Math.abs(videoAspect - aspect) / aspect > 0.03) throw new Error('El video publicado no coincide con la proporción de la imagen.');
    this.videoTexture = new THREE.VideoTexture(this.videoElement);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    this.storyMaterial = this.createVideoMaterial(this.videoTexture);
    this.videoMesh = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, planeHeight), this.storyMaterial);
    this.videoMesh.position.z = 0.003;
    this.videoMesh.renderOrder = 2;

    this.shadowMesh = this.createLiftShadow(planeWidth, planeHeight);
    this.shadowMesh.position.set(0.012, -0.014, 0.001);

    this.particles = this.createMagicParticles({ width: planeWidth, height: planeHeight });
    this.storyGroup.add(this.shadowMesh, this.videoMesh, this.particles);
    const offsetX = contentRect ? contentRect.x + contentRect.width / 2 - 0.5 : 0;
    const offsetY = contentRect
      ? (0.5 - contentRect.y - contentRect.height / 2) * contentRect.targetAspect
      : 0;
    this.storyGroup.position.set(offsetX, offsetY, 0);
    this.storyGroup.rotation.set(0, 0, 0);
    this.storyGroup.scale.setScalar(1);
    this.anchorGroup.visible = false;
    this.isTargetVisible = false;
    this.revealProgress = 0;
    this.revealTarget = 0;
    this.clockStart = performance.now();
    this.container.classList.add('has-target');
    EventBus.emit('parallax:texture-ready', { width, height, anchorMode: 'mindar' });
  }

  createVideoElement(url) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.onloadedmetadata = () => resolve(video);
      video.onerror = () => reject(new Error('No se pudo cargar la animación MP4 de esta obra.'));
      video.src = url;
      video.load();
    });
  }

  createVideoMaterial(texture) {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uVideo: { value: texture },
        uReveal: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uVideo;
        uniform float uReveal;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(uVideo, vUv);
          vec2 edgeDistance = min(vUv, vec2(1.0) - vUv);
          float edgeMask = smoothstep(0.0, 0.014, min(edgeDistance.x, edgeDistance.y));
          float revealAlpha = smoothstep(0.0, 0.14, uReveal);
          gl_FragColor = vec4(color.rgb, color.a * edgeMask * revealAlpha * 0.96);
        }
      `,
      transparent: true,
      depthWrite: true,
    });
  }

  createLiftShadow(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(128, 128, 45, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(0,0,0,.42)');
    gradient.addColorStop(0.72, 'rgba(0,0,0,.20)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0, depthWrite: false });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.035, height * 1.035), material);
    shadow.renderOrder = 1;
    return shadow;
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
    tracked.decompose(this.anchorTargetPosition, this.anchorTargetQuaternion, this.anchorTargetScale);
    if (!this.anchorTransformReady) {
      this.anchorCurrentPosition.copy(this.anchorTargetPosition);
      this.anchorCurrentQuaternion.copy(this.anchorTargetQuaternion);
      this.anchorCurrentScale.copy(this.anchorTargetScale);
      this.anchorGroup.matrix.compose(
        this.anchorCurrentPosition,
        this.anchorCurrentQuaternion,
        this.anchorCurrentScale,
      );
      this.anchorGroup.matrixWorldNeedsUpdate = true;
      this.anchorTransformReady = true;
    }
  }

  onTargetFound() {
    this.isTargetVisible = true;
    this.revealTarget = 1;
    this.anchorGroup.visible = this.previewMode === '3d' && Boolean(this.videoMesh);
    this.videoElement?.play().catch((error) => console.warn('[InkMotion/Video] El navegador demoró el autoplay.', error));
    this.container.classList.add('target-found');
  }

  onTargetLost() {
    this.isTargetVisible = false;
    this.revealTarget = 0;
    this.videoElement?.pause();
    this.container.classList.remove('target-found');
  }

  createMagicParticles(size) {
    const count = window.innerWidth < 680 ? 24 : 36;
    const positions = new Float32Array(count * 3);
    this.particleBase = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * size.width * 1.05;
      const y = (Math.random() - 0.5) * size.height * 1.05;
      const z = 0.14 + Math.random() * 0.12;
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
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(geometry, material);
    material.opacity = 0;
    particles.renderOrder = 3;
    return particles;
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
    this.particles.material.opacity = (0.58 + Math.sin(angle) * 0.22) * this.revealProgress;
  }

  setPreviewMode(mode) {
    this.previewMode = mode === 'camera' ? 'camera' : '3d';
    if (this.anchorGroup) {
      this.anchorGroup.visible = this.previewMode === '3d' && this.isTargetVisible && Boolean(this.videoMesh);
    }
    this.container.classList.toggle('camera-only', this.previewMode === 'camera');
    EventBus.emit('parallax:mode-changed', { mode: this.previewMode });
  }

  startAnimationLoop() {
    if (this.animationFrame) return;
    const render = (now) => {
      if (!this.isActive) { this.animationFrame = null; return; }
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000));
      this.lastFrameTime = now;
      if (this.anchorTransformReady && this.anchorGroup) {
        const smoothing = THREE.MathUtils.clamp(this.config.anchorSmoothing, 0.04, 0.5);
        const alpha = 1 - Math.pow(1 - smoothing, deltaSeconds * 60);
        this.anchorCurrentPosition.lerp(this.anchorTargetPosition, alpha);
        this.anchorCurrentQuaternion.slerp(this.anchorTargetQuaternion, alpha);
        this.anchorCurrentScale.lerp(this.anchorTargetScale, alpha);
        this.anchorGroup.matrix.compose(
          this.anchorCurrentPosition,
          this.anchorCurrentQuaternion,
          this.anchorCurrentScale,
        );
        this.anchorGroup.matrixWorldNeedsUpdate = true;
      }
      this.revealProgress = THREE.MathUtils.damp(
        this.revealProgress,
        this.revealTarget,
        this.revealTarget > this.revealProgress ? 6.5 : 8.5,
        deltaSeconds,
      );
      if (!this.isTargetVisible && this.revealProgress < 0.015 && this.anchorGroup) {
        this.anchorGroup.visible = false;
        this.anchorTransformReady = false;
        this.revealProgress = 0;
      }
      const loopPhase = ((now - this.clockStart) % LOOP_DURATION) / LOOP_DURATION;
      const angle = loopPhase * Math.PI * 2;
      if (this.anchorGroup?.visible) {
        const revealEase = 1 - Math.pow(1 - this.revealProgress, 3);
        const breathing = 1 + Math.sin(angle) * 0.0015;
        this.storyGroup.scale.setScalar((0.986 + revealEase * 0.028) * breathing);
        if (this.videoMesh) this.videoMesh.position.z = THREE.MathUtils.lerp(0.002, 0.022, revealEase);
        if (this.shadowMesh) this.shadowMesh.material.opacity = 0.22 * revealEase;
        if (this.storyMaterial) this.storyMaterial.uniforms.uReveal.value = revealEase;
        this.updateParticles(loopPhase);
      }
      this.renderer.render(this.scene, this.camera);
      this.frameListeners.forEach((listener) => listener());
      this.animationFrame = requestAnimationFrame(render);
    };
    this.animationFrame = requestAnimationFrame(render);
  }

  addFrameListener(listener) {
    if (typeof listener !== 'function') return () => {};
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  getCaptureSources() {
    return { arCanvas: this.renderer?.domElement || null, animatedVideo: this.videoElement || null };
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
    for (const object of [this.videoMesh, this.shadowMesh, this.particles]) {
      if (!object) continue;
      this.storyGroup?.remove(object);
      object.geometry?.dispose();
      if (object.material?.map) object.material.map.dispose();
      object.material?.dispose();
    }
    this.videoTexture?.dispose();
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
    }
    this.videoMesh = this.shadowMesh = this.particles = null;
    this.particleBase = null;
    this.videoElement = null;
    this.videoTexture = null;
    this.storyMaterial = null;
  }

  stop() {
    this.isActive = false;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    window.removeEventListener('resize', this.boundResize);
    this.disposeTarget();
    this.renderer?.dispose();
    this.frameListeners.clear();
  }
}

export default ParallaxEngine;
