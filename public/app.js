import MindARManager from './core/MindARManager.js';
import ParallaxEngine from './core/ParallaxEngine.js';
import ImageProcessor from './core/ImageProcessor.js';
import ProjectStore from './services/ProjectStore.js';
import EventBus from './utils/EventBus.js';

class InkMotionApp {
  constructor() {
    this.store = new ProjectStore();
    this.processor = new ImageProcessor({ maxFileSize: 25 * 1024 * 1024, targetQuality: 0.82 });
    this.pendingProject = null;
    this.bindTrackingEvents();
    this.start();
  }

  async start() {
    if (document.readyState === 'loading') await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') { window.location.replace('/crear'); return; }
    if (path === '/crear') return this.startAuthor();
    const match = path.match(/^\/ver\/([0-9a-f-]+)$/i);
    if (match) return this.startReader(match[1]);
    this.showFatal('La página solicitada no existe.', '/crear', 'Ir al panel de autor');
  }

  async startAuthor() {
    document.body.dataset.route = 'author';
    document.getElementById('author-view').hidden = false;
    document.getElementById('auth-form').addEventListener('submit', (event) => this.requestAccess(event));
    document.getElementById('btn-sign-out').addEventListener('click', async () => { await this.store.signOut(); window.location.reload(); });
    document.getElementById('story-file').addEventListener('change', (event) => this.prepareStory(event));
    document.getElementById('publish-form').addEventListener('submit', (event) => this.publishStory(event));
    document.getElementById('btn-copy-link').addEventListener('click', () => this.copyPublishedLink());
    const session = await this.store.getSession();
    this.renderAuthorSession(session);
    this.store.onAuthChange((nextSession) => this.renderAuthorSession(nextSession));
  }

  renderAuthorSession(session) {
    document.getElementById('auth-card').hidden = Boolean(session);
    document.getElementById('creator-workspace').hidden = !session;
    if (session) document.getElementById('author-email').textContent = session.user.email || 'Autor';
  }

  async requestAccess(event) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email')?.toString().trim();
    const status = document.getElementById('auth-status');
    try {
      status.textContent = 'Enviando acceso seguro…';
      await this.store.sendMagicLink(email);
      status.textContent = 'Revisá tu correo y abrí el enlace para entrar al panel.';
    } catch (error) { status.textContent = error.message; }
  }

  async prepareStory(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const publish = document.getElementById('btn-publish');
    publish.disabled = true;
    this.setBuildState('processing', 'Optimizando la ilustración…', 15);
    try {
      const processed = await this.processor.processImageFile(file, `story-${Date.now()}`);
      document.getElementById('author-preview').src = processed.url;
      document.getElementById('preview-wrap').hidden = false;
      const compiled = await new MindARManager().compileTarget(processed.url);
      this.pendingProject = { imageBlob: processed.blob, targetBlob: compiled.blob };
      this.setBuildState('ready', `Target listo · ${compiled.featureCount} puntos visuales`, 100);
      publish.disabled = false;
    } catch (error) {
      this.pendingProject = null;
      this.setBuildState('error', error.message || 'No se pudo procesar esta ilustración.', 0);
    } finally { event.target.value = ''; }
  }

  async publishStory(event) {
    event.preventDefault();
    if (!this.pendingProject) return;
    const button = document.getElementById('btn-publish');
    const title = new FormData(event.currentTarget).get('title')?.toString().trim() || 'Cuento sin título';
    button.disabled = true;
    this.setBuildState('publishing', 'Publicando el cuento y su experiencia AR…', 100);
    try {
      const project = await this.store.saveProject({ title, ...this.pendingProject, config: { depthStrength: 0.08, animation: 'magic-breathe', loopSeconds: 5, anchor: 'mindar' } });
      const url = `${window.location.origin}/ver/${project.id}`;
      document.getElementById('public-link').value = url;
      document.getElementById('btn-open-story').href = url;
      document.getElementById('publish-result').hidden = false;
      this.setBuildState('published', 'Cuento publicado correctamente.', 100);
    } catch (error) {
      this.setBuildState('error', error.message || 'No se pudo publicar. Intentá nuevamente.', 0);
      button.disabled = false;
    }
  }

  async copyPublishedLink() {
    const input = document.getElementById('public-link');
    await navigator.clipboard.writeText(input.value);
    document.getElementById('btn-copy-link').textContent = 'Copiado';
  }

  setBuildState(state, message, progress) {
    const box = document.getElementById('build-status');
    if (!box) return;
    box.dataset.state = state;
    document.getElementById('build-label').textContent = message;
    document.getElementById('build-progress').style.width = `${progress}%`;
  }

  async startReader(id) {
    document.body.dataset.route = 'reader';
    document.getElementById('reader-view').hidden = false;
    this.setReaderStatus('Cargando cuento…', 'loading');
    try {
      const project = await this.store.getProject(id);
      if (!project) return this.showFatal('Este cuento no existe o todavía no fue publicado.');
      document.title = `${project.title} · InkMotion`;
      document.getElementById('reader-title').textContent = project.title;
      document.getElementById('info-title').textContent = project.title;
      document.getElementById('btn-info').addEventListener('click', () => document.getElementById('story-info').showModal());
      document.getElementById('btn-close-info').addEventListener('click', () => document.getElementById('story-info').close());
      document.getElementById('btn-camera-mode').addEventListener('click', () => this.toggleReaderMode());
      this.parallax = new ParallaxEngine({ container: '#ar-overlay', depthStrength: Number(project.config?.depthStrength) || 0.08 });
      await this.parallax.init();
      await this.parallax.setTargetImage(project.imageUrl);
      this.mindAR = new MindARManager({ video: '#video-stream' });
      const ready = await this.mindAR.init();
      if (!ready) throw new Error('No se pudo iniciar la cámara. Revisá sus permisos.');
      await this.mindAR.setCompiledTarget(project.targetUrl);
      this.setReaderStatus('Buscando la ilustración…', 'scanning');
    } catch (error) { this.showFatal(error.message || 'No se pudo abrir este cuento.'); }
  }

  toggleReaderMode() {
    this.readerCameraOnly = !this.readerCameraOnly;
    this.parallax?.setPreviewMode(this.readerCameraOnly ? 'camera' : '3d');
    document.getElementById('btn-camera-mode').textContent = this.readerCameraOnly ? 'Ver efecto AR' : 'Solo cámara';
  }

  bindTrackingEvents() {
    EventBus.on('mindar:compilation-progress', ({ progress }) => this.setBuildState('processing', `Compilando marcador AR · ${Math.min(100, progress)}%`, Math.min(100, progress)));
    EventBus.on('mindar:target-found', () => { this.parallax?.onTargetFound(); this.setReaderStatus('Ilustración detectada · AR anclada', 'found'); });
    EventBus.on('mindar:target-lost', () => { this.parallax?.onTargetLost(); this.setReaderStatus('Buscando la ilustración…', 'lost'); });
    EventBus.on('mindar:target-update', (data) => this.parallax?.updateWorldAnchor(data));
    EventBus.on('mindar:projection-ready', (data) => { this.parallax?.setProjectionMatrix(data.projectionMatrix); this.parallax?.setVideoViewport(data); });
    EventBus.on('mindar:video-ready', (data) => this.parallax?.setVideoViewport(data));
    EventBus.on('mindar:scan-timeout', ({ message }) => this.setReaderStatus(message, 'warning'));
  }

  setReaderStatus(message, state) {
    const status = document.getElementById('reader-status');
    if (!status) return;
    status.dataset.state = state;
    document.getElementById('reader-status-text').textContent = message;
  }

  showFatal(message, href = '/crear', label = 'Volver a crear') {
    document.querySelectorAll('main > section').forEach((section) => { section.hidden = true; });
    const fatal = document.getElementById('fatal-view');
    fatal.hidden = false;
    document.getElementById('fatal-message').textContent = message;
    const link = document.getElementById('fatal-link');
    link.href = href; link.textContent = label;
  }
}

new InkMotionApp();
