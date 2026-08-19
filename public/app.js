import MindARManager from './core/MindARManager.js';
import ParallaxEngine from './core/ParallaxEngine.js';
import ImageProcessor from './core/ImageProcessor.js';
import ProjectStore from './services/ProjectStore.js';
import EventBus from './utils/EventBus.js';
import { renderStoryQR } from './utils/QRGenerator.js';

const NETWORK_ERROR_MESSAGE = 'Error de conexión con el motor o Supabase. Verifica tu red o el tamaño de la imagen.';
const OAUTH_DRAFT_DB = 'inkmotion-oauth-draft';

function accessOAuthDraft(action) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { resolve(null); return; }
    const request = indexedDB.open(OAUTH_DRAFT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('drafts', 'readwrite');
      const store = transaction.objectStore('drafts');
      let result = null;
      try { result = action(store); }
      catch (error) { database.close(); reject(error); return; }
      transaction.oncomplete = () => { database.close(); resolve(result?.result ?? result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  });
}

class InkMotionApp {
  constructor() {
    this.store = new ProjectStore();
    this.processor = new ImageProcessor({ maxFileSize: 25 * 1024 * 1024, targetQuality: 0.82 });
    this.pendingProject = null;
    this.lastSelectedFile = null;
    this.retryAction = null;
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
    document.getElementById('btn-google-auth').addEventListener('click', () => this.loginWithGoogle());
    document.getElementById('btn-sign-out').addEventListener('click', async () => { await this.store.signOut(); window.location.reload(); });
    document.getElementById('story-file').addEventListener('change', (event) => this.prepareStory(event));
    document.getElementById('publish-form').addEventListener('submit', (event) => this.publishStory(event));
    document.getElementById('btn-copy-link').addEventListener('click', () => this.copyPublishedLink());
    document.getElementById('btn-download-qr').addEventListener('click', () => this.downloadQR());
    document.getElementById('btn-retry').addEventListener('click', () => this.retryLastAction());
    const session = await this.store.getSession();
    this.renderAuthorSession(session);
    if (session) await this.restoreOAuthDraft();
    this.store.onAuthChange(async (nextSession) => {
      this.renderAuthorSession(nextSession);
      if (nextSession) await this.restoreOAuthDraft();
    });
  }

  renderAuthorSession(session) {
    document.getElementById('auth-card').hidden = Boolean(session);
    document.getElementById('creator-workspace').hidden = !session;
    if (session) document.getElementById('author-email').textContent = session.user.email || 'Autor';
  }

  async loginWithGoogle() {
    const button = document.getElementById('btn-google-auth');
    const status = document.getElementById('auth-status');
    try {
      button.disabled = true;
      status.textContent = 'Conectando con Google…';
      await this.persistOAuthDraft();
      await this.store.signInWithGoogle();
    } catch (error) {
      console.error('Error en Google Auth:', error?.message, error);
      status.textContent = this.errorMessage(error, 'No se pudo iniciar sesión con Google. Intentá nuevamente.');
      button.disabled = false;
    }
  }

  async persistOAuthDraft() {
    if (!this.pendingProject) return;
    const title = document.getElementById('story-title')?.value || '';
    try {
      await accessOAuthDraft((store) => store.put({ ...this.pendingProject, title, savedAt: Date.now() }, 'current'));
    } catch (error) { console.warn('No se pudo guardar el proyecto temporal antes de Google OAuth.', error); }
  }

  async restoreOAuthDraft() {
    if (this.pendingProject || this.oauthDraftRestored) return;
    this.oauthDraftRestored = true;
    try {
      const draft = await accessOAuthDraft((store) => {
        const request = store.get('current');
        request.onsuccess = () => store.delete('current');
        return request;
      });
      if (!draft || Date.now() - draft.savedAt > 2 * 60 * 60 * 1000) return;
      this.pendingProject = { imageBlob: draft.imageBlob, targetBlob: draft.targetBlob };
      document.getElementById('story-title').value = draft.title || '';
      document.getElementById('author-preview').src = URL.createObjectURL(draft.imageBlob);
      document.getElementById('preview-wrap').hidden = false;
      document.getElementById('btn-publish').disabled = false;
      this.setBuildState('ready', 'Proyecto recuperado después de iniciar sesión.', 100);
    } catch (error) { console.warn('No se pudo recuperar el proyecto temporal de OAuth.', error); }
  }

  async prepareStory(eventOrFile) {
    const file = eventOrFile instanceof File ? eventOrFile : eventOrFile?.target?.files?.[0];
    if (!file) return;
    this.lastSelectedFile = file;
    this.clearRetry();
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
      const message = this.errorMessage(error, 'No se pudo procesar esta ilustración.');
      this.setBuildState('error', message, 0);
      if (this.isNetworkError(error)) this.offerRetry('prepare');
    } finally {
      if (!(eventOrFile instanceof File) && eventOrFile?.target) eventOrFile.target.value = '';
    }
  }

  async publishStory(event) {
    event?.preventDefault();
    if (!this.pendingProject) return;
    this.clearRetry();
    const button = document.getElementById('btn-publish');
    const form = document.getElementById('publish-form');
    const title = new FormData(form).get('title')?.toString().trim() || 'Cuento sin título';
    button.disabled = true;
    this.setBuildState('publishing', 'Publicando el cuento y su experiencia AR…', 100);
    try {
      const project = await this.store.saveProject({ title, ...this.pendingProject, config: { depthStrength: 0.08, animation: 'magic-breathe', loopSeconds: 5, anchor: 'mindar' } });
      const url = `${window.location.origin}/ver/${project.id}`;
      document.getElementById('public-link').value = url;
      document.getElementById('btn-open-story').href = url;
      this.publishedTitle = title;
      await this.prepareQR(url);
      document.getElementById('publish-result').hidden = false;
      this.setBuildState('published', 'Cuento publicado correctamente.', 100);
    } catch (error) {
      console.error('[InkMotion] No se pudo publicar el proyecto', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        status: error?.status || error?.statusCode,
        imageSizeBytes: this.pendingProject?.imageBlob?.size,
        targetSizeBytes: this.pendingProject?.targetBlob?.size,
        online: navigator.onLine,
      }, error);
      const message = this.errorMessage(error, 'No se pudo publicar. Intentá nuevamente.');
      this.setBuildState('error', message, 0);
      if (this.isNetworkError(error)) this.offerRetry('publish');
      button.disabled = false;
      if (error?.code === 'AUTH_SESSION_EXPIRED') {
        document.getElementById('auth-status').textContent = message;
        this.renderAuthorSession(null);
      }
    }
  }

  isNetworkError(error) {
    const message = `${error?.message || error || ''}`;
    return error?.code === 'NETWORK_ERROR' || /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message);
  }

  errorMessage(error, fallback) {
    return this.isNetworkError(error) ? NETWORK_ERROR_MESSAGE : (error?.message || fallback);
  }

  offerRetry(action) {
    this.retryAction = action;
    const button = document.getElementById('btn-retry');
    button.hidden = false;
    button.disabled = false;
  }

  clearRetry() {
    this.retryAction = null;
    const button = document.getElementById('btn-retry');
    if (button) button.hidden = true;
  }

  async retryLastAction() {
    const action = this.retryAction;
    if (!action) return;
    const button = document.getElementById('btn-retry');
    button.disabled = true;
    button.textContent = 'Reintentando…';
    try {
      if (action === 'prepare' && this.lastSelectedFile) await this.prepareStory(this.lastSelectedFile);
      else if (action === 'publish') await this.publishStory();
    } finally {
      button.textContent = 'Reintentar';
      if (!button.hidden) button.disabled = false;
    }
  }

  async copyPublishedLink() {
    const input = document.getElementById('public-link');
    await navigator.clipboard.writeText(input.value);
    document.getElementById('btn-copy-link').textContent = 'Copiado';
  }

  async prepareQR(publicUrl) {
    const canvas = document.getElementById('story-qr');
    const canvasWrap = document.getElementById('qr-canvas-wrap');
    const status = document.getElementById('qr-status');
    const download = document.getElementById('btn-download-qr');
    status.textContent = 'Generando código QR…';
    download.disabled = true;
    try {
      this.qrDataUrl = await renderStoryQR(canvas, publicUrl);
      canvasWrap.hidden = false;
      canvas.hidden = false;
      status.textContent = 'QR listo para impresión · PNG de 1024 × 1024 px';
      download.disabled = false;
    } catch (error) {
      canvas.hidden = true;
      canvasWrap.hidden = true;
      status.textContent = 'El cuento fue publicado, pero no se pudo generar el QR. Recargá e intentá nuevamente.';
      console.error(error);
    }
  }

  downloadQR() {
    if (!this.qrDataUrl) return;
    const slug = (this.publishedTitle || 'cuento-ar').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cuento-ar';
    const link = document.createElement('a');
    link.href = this.qrDataUrl;
    link.download = `inkmotion-${slug}-qr.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
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
      this.setReaderStatus('Verificando marcador AR…', 'loading');
      await this.mindAR.setCompiledTarget(project.targetUrl);
      this.setReaderStatus('Buscando ilustración...', 'scanning');
    } catch (error) { this.showFatal(error.message || 'No se pudo abrir este cuento.'); }
  }

  toggleReaderMode() {
    this.readerCameraOnly = !this.readerCameraOnly;
    this.parallax?.setPreviewMode(this.readerCameraOnly ? 'camera' : '3d');
    document.getElementById('btn-camera-mode').textContent = this.readerCameraOnly ? 'Ver efecto AR' : 'Solo cámara';
  }

  bindTrackingEvents() {
    EventBus.on('mindar:engine-state', ({ state, attempt, total }) => {
      if (state === 'ready') this.setBuildState('processing', 'Motor AR conectado · analizando imagen…', 20);
      else if (state === 'retrying') this.setBuildState('processing', `Conectando con el motor AR · alternativa ${attempt} de ${total}…`, 10);
      else this.setBuildState('processing', 'Conectando con el motor AR…', 8);
    });
    EventBus.on('mindar:compilation-progress', ({ progress }) => this.setBuildState('processing', `Compilando marcador AR · ${Math.min(100, progress)}%`, Math.min(100, progress)));
    EventBus.on('mindar:target-found', () => { this.parallax?.onTargetFound(); this.setReaderStatus('¡Ilustración detectada!', 'found'); });
    EventBus.on('mindar:target-lost', () => { this.parallax?.onTargetLost(); this.setReaderStatus('Buscando ilustración...', 'lost'); });
    EventBus.on('mindar:target-update', (data) => this.parallax?.updateWorldAnchor(data));
    EventBus.on('mindar:projection-ready', (data) => { this.parallax?.setProjectionMatrix(data.projectionMatrix); this.parallax?.setVideoViewport(data); });
    EventBus.on('mindar:video-ready', (data) => this.parallax?.setVideoViewport(data));
    EventBus.on('mindar:target-download', ({ state, error }) => {
      if (state === 'downloading') this.setReaderStatus('Descargando marcador AR…', 'loading');
      else if (state === 'ready') this.setReaderStatus('Marcador listo · buscando ilustración...', 'scanning');
      else if (state === 'error') this.setReaderStatus(error?.message || 'No se pudo descargar el marcador AR.', 'error');
    });
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
