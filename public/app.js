import MindARManager from './core/MindARManager.js';
import ParallaxEngine from './core/ParallaxEngine.js';
import ImageProcessor from './core/ImageProcessor.js';
import ProjectStore from './services/ProjectStore.js';
import EventBus from './utils/EventBus.js';
import MasterSheetGenerator from './core/MasterSheetGenerator.js';
import VideoProcessor from './core/VideoProcessor.js';

const NETWORK_ERROR_MESSAGE = 'Error de conexión con el motor o Supabase. Verifica tu red o el tamaño de la imagen.';
const OAUTH_DRAFT_DB = 'inkmotion-oauth-draft';

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function formatDuration(seconds = 0) {
  return Number.isFinite(seconds) ? `${seconds.toFixed(1)} s` : '—';
}

function compactProjectId(uuid) {
  const bytes = uuid.replaceAll('-', '').match(/.{2}/g).map((pair) => String.fromCharCode(parseInt(pair, 16))).join('');
  return btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function expandProjectId(value) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '==');
    const hex = Array.from(binary, (character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid) ? uuid : null;
  } catch { return null; }
}

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
    this.videoProcessor = new VideoProcessor();
    this.sheetGenerator = new MasterSheetGenerator();
    this.pendingProject = null;
    this.lastSelectedFile = null;
    this.retryAction = null;
    this.isPublishing = false;
    this.publicationProgress = 0;
    this.bindTrackingEvents();
    this.start();
  }

  async start() {
    if (document.readyState === 'loading') await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') { window.location.replace('/crear'); return; }
    if (path === '/crear') return this.startAuthor();
    const match = path.match(/^\/(?:v|ver)\/([A-Za-z0-9_-]+)$/);
    if (match) {
      const id = expandProjectId(match[1]);
      if (id) return this.startReader(id);
    }
    this.showFatal('La página solicitada no existe.', '/crear', 'Ir al panel de autor');
  }

  async startAuthor() {
    document.body.dataset.route = 'author';
    document.getElementById('author-view').hidden = false;
    document.getElementById('btn-google-auth').addEventListener('click', () => this.loginWithGoogle());
    document.getElementById('btn-sign-out').addEventListener('click', async () => { await this.store.signOut(); window.location.reload(); });
    document.getElementById('story-file').addEventListener('change', (event) => this.prepareStory(event));
    document.getElementById('story-video').addEventListener('change', (event) => this.prepareVideo(event));
    document.getElementById('btn-copy-prompt').addEventListener('click', () => this.copyLoopPrompt());
    document.getElementById('publish-form').addEventListener('submit', (event) => this.publishStory(event));
    document.getElementById('btn-copy-link').addEventListener('click', () => this.copyPublishedLink());
    document.getElementById('btn-download-sheet').addEventListener('click', () => this.downloadMasterSheet());
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
      const imageUrl = draft.imageBlob ? URL.createObjectURL(draft.imageBlob) : null;
      const videoUrl = draft.videoBlob ? URL.createObjectURL(draft.videoBlob) : null;
      this.pendingProject = { id: draft.id, imageBlob: draft.imageBlob, imageUrl, imageDimensions: draft.imageDimensions, videoBlob: draft.videoBlob, videoUrl, videoMetadata: draft.videoMetadata };
      document.getElementById('story-title').value = draft.title || '';
      if (imageUrl) {
        const preview = document.getElementById('author-preview');
        preview.src = imageUrl;
        preview.hidden = false;
      }
      if (videoUrl) {
        const preview = document.getElementById('author-video-preview');
        preview.src = videoUrl;
        preview.hidden = false;
        preview.play().catch(() => {});
      }
      document.getElementById('preview-wrap').hidden = false;
      this.updateMediaMetadata();
      this.updateMediaReadiness('Proyecto recuperado después de iniciar sesión.');
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
      const preview = document.getElementById('author-preview');
      preview.src = processed.url;
      preview.hidden = false;
      document.getElementById('preview-wrap').hidden = false;
      this.pendingProject = { ...(this.pendingProject || {}), imageBlob: processed.blob, imageUrl: processed.url, imageDimensions: processed.dimensions, imageName: file.name };
      this.updateMediaMetadata();
      this.updateMediaReadiness();
    } catch (error) {
      if (this.pendingProject) {
        delete this.pendingProject.imageBlob;
        delete this.pendingProject.imageUrl;
        delete this.pendingProject.imageDimensions;
        delete this.pendingProject.imageName;
      }
      document.getElementById('author-preview').removeAttribute('src');
      document.getElementById('author-preview').hidden = true;
      this.updateMediaMetadata();
      const message = this.errorMessage(error, 'No se pudo procesar esta ilustración.');
      this.setBuildState('error', message, 0);
      if (this.isNetworkError(error)) this.offerRetry('prepare');
    } finally {
      if (!(eventOrFile instanceof File) && eventOrFile?.target) eventOrFile.target.value = '';
    }
  }

  async prepareVideo(eventOrFile) {
    const file = eventOrFile instanceof File ? eventOrFile : eventOrFile?.target?.files?.[0];
    if (!file) return;
    this.clearRetry();
    document.getElementById('btn-publish').disabled = true;
    this.setBuildState('processing', 'Verificando duración, peso y proporción del video…', 35);
    try {
      const inspected = await this.videoProcessor.inspect(file);
      this.pendingProject = { ...(this.pendingProject || {}), videoBlob: inspected.blob, videoUrl: inspected.url, videoMetadata: { duration: inspected.duration, width: inspected.width, height: inspected.height }, videoName: file.name };
      const preview = document.getElementById('author-video-preview');
      preview.src = inspected.url;
      preview.hidden = false;
      document.getElementById('preview-wrap').hidden = false;
      preview.play().catch(() => {});
      this.updateMediaMetadata();
      this.updateMediaReadiness();
    } catch (error) {
      this.setBuildState('error', this.errorMessage(error, 'No se pudo preparar el video.'), 0);
    } finally {
      if (!(eventOrFile instanceof File) && eventOrFile?.target) eventOrFile.target.value = '';
    }
  }

  updateMediaReadiness(successMessage = '') {
    const project = this.pendingProject || {};
    const hasImage = Boolean(project.imageBlob && project.imageDimensions);
    const hasVideo = Boolean(project.videoBlob && project.videoMetadata);
    const publish = document.getElementById('btn-publish');
    const label = document.getElementById('media-ready-label');
    if (hasImage && hasVideo) {
      try {
        this.videoProcessor.validateAspect(project.imageDimensions, project.videoMetadata);
        publish.disabled = false;
        document.getElementById('video-validation').textContent = 'Listo';
        label.textContent = 'Imagen y video alineados · listos para AR';
        this.setBuildState('ready', successMessage || 'Imagen y video listos para crear la obra aumentada.', 100);
      } catch (error) {
        publish.disabled = true;
        document.getElementById('video-validation').textContent = 'Revisar';
        label.textContent = 'Las proporciones no coinciden';
        this.setBuildState('error', error.message, 0);
      }
      return;
    }
    publish.disabled = true;
    label.textContent = hasImage ? 'Imagen lista · falta el video' : hasVideo ? 'Video listo · falta la imagen' : 'Esperando imagen y video';
    this.setBuildState('processing', hasImage ? 'Ahora subí el video loop.' : hasVideo ? 'Ahora subí la imagen original.' : 'Esperando imagen y video.', 50);
  }

  updateMediaMetadata() {
    const project = this.pendingProject || {};
    const imageMetadata = document.getElementById('image-metadata');
    const videoMetadata = document.getElementById('video-metadata');
    const imageValidation = document.getElementById('image-validation');
    const videoValidation = document.getElementById('video-validation');
    if (project.imageBlob && project.imageDimensions) {
      imageMetadata.textContent = `${project.imageName || 'Imagen recuperada'} · ${project.imageDimensions.width} × ${project.imageDimensions.height} px · ${formatBytes(project.imageBlob.size)}`;
      imageValidation.textContent = 'Lista';
    } else {
      imageMetadata.textContent = 'Seleccioná una imagen';
      imageValidation.textContent = 'Pendiente';
    }
    if (project.videoBlob && project.videoMetadata) {
      videoMetadata.textContent = `${project.videoName || 'Video recuperado'} · ${project.videoMetadata.width} × ${project.videoMetadata.height} px · ${formatDuration(project.videoMetadata.duration)} · ${formatBytes(project.videoBlob.size)}`;
      videoValidation.textContent = 'Listo';
    } else {
      videoMetadata.textContent = 'Seleccioná un video';
      videoValidation.textContent = 'Pendiente';
    }
  }

  async copyLoopPrompt() {
    const prompt = `Use the uploaded image as the strict and exclusive visual reference for the entire video.

REFERENCE FIDELITY
Preserve the original image's composition, framing, aspect ratio, perspective, color palette, lighting, artistic style, textures, linework, background and all existing details. The first frame must match the uploaded image. Keep all non-animated regions visually unchanged and stable throughout the video.

LOCKED CAMERA
Use a completely static tripod shot. Absolute zero camera movement: no zoom, pan, tilt, roll, shift, dolly, orbit, reframing, perspective change, parallax or simulated depth movement. Do not crop, stretch, rotate or change the aspect ratio.

SUBTLE LOCALIZED ANIMATION
Create only subtle, natural and cyclical micro-movements in a small number of elements already visible in the source image. Automatically choose movements appropriate to the existing content.

Keep the main subject's position, silhouette, proportions, anatomy, geometry, structural lines and contact points locked in place. Keep the background fixed. Motion must remain localized and must not cause the rest of the image to drift, warp or move.

SEAMLESS LOOP
Create one continuous shot that returns smoothly to its initial visual state. The final frame must match the first frame as closely as possible, with every animated element returning to its original position, shape, scale, color and lighting state. No visible jump at the loop point.

STRICT RESTRICTIONS
Do not add, remove, replace or redesign any object, character, body part, facial feature, texture, shadow, reflection or background element.
Do not morph, deform, melt, stretch, duplicate or reshape anything.
Do not change anatomy, proportions, geometry, line art, palette, art style or scene layout.
Do not introduce new camera angles, foreground elements or background expansion.
Preserve all existing text, logos and symbols exactly; do not alter them or generate new text.
No cuts, transitions, scene changes, flicker, flashing, sudden movement, frame instability or temporal artifacts.

OUTPUT
One continuous MP4 shot, fixed camera, no audio, fully faithful to the uploaded image and suitable for a seamless AR loop.`;
    await navigator.clipboard.writeText(prompt);
    const button = document.getElementById('btn-copy-prompt');
    button.textContent = 'Prompt copiado';
    window.setTimeout(() => { button.textContent = 'Copiar prompt universal'; }, 1800);
  }

  async publishStory(event) {
    event?.preventDefault();
    if (!this.pendingProject?.imageBlob || !this.pendingProject?.videoBlob) return;
    this.clearRetry();
    const button = document.getElementById('btn-publish');
    const form = document.getElementById('publish-form');
    const title = new FormData(form).get('title')?.toString().trim() || 'Obra sin título';
    button.disabled = true;
    this.isPublishing = true;
    this.publicationProgress = 0;
    this.setBuildState('publishing', 'Validando los archivos de la obra…', 5);
    try {
      const projectId = this.pendingProject.id || crypto.randomUUID();
      this.pendingProject.id = projectId;
      const url = `${window.location.origin}/v/${compactProjectId(projectId)}`;
      this.setBuildState('publishing', 'Componiendo lámina maestra a 300 DPI…', 12);
      const sheet = await this.sheetGenerator.compose({ illustrationUrl: this.pendingProject.imageUrl, publicUrl: url, title });
      this.setBuildState('publishing', 'Lámina compuesta · compilando el marcador AR…', 25);
      const compiled = await new MindARManager().compileTarget(sheet.imageUrl);
      this.setBuildState('publishing', 'Marcador AR validado · preparando el PDF…', 58);
      const pdfBlob = await this.sheetGenerator.createPdf(sheet.jpegDataUrl, sheet.pageSizeMm);
      const config = { animation: 'video-loop-lift', loopSeconds: this.pendingProject.videoMetadata.duration, anchor: 'mindar', contentRect: sheet.contentRect, sheetDpi: sheet.dpi };
      this.setBuildState('publishing', 'PDF listo · iniciando la publicación…', 65);
      await this.store.saveProject({
        id: projectId,
        title,
        imageBlob: this.pendingProject.imageBlob,
        videoBlob: this.pendingProject.videoBlob,
        targetBlob: compiled.blob,
        config,
        onStage: ({ message, progress }) => this.setBuildState('publishing', message, progress),
      });
      this.masterSheetPdfUrl = URL.createObjectURL(pdfBlob);
      document.getElementById('public-link').value = url;
      document.getElementById('btn-open-story').href = url;
      this.publishedTitle = title;
      await this.prepareSheetResult(sheet.canvas);
      document.getElementById('publish-result').hidden = false;
      this.setBuildState('published', 'Obra publicada correctamente.', 100);
      this.isPublishing = false;
    } catch (error) {
      console.error('[InkMotion] No se pudo publicar el proyecto', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        status: error?.status || error?.statusCode,
        imageSizeBytes: this.pendingProject?.imageBlob?.size,
        videoSizeBytes: this.pendingProject?.videoBlob?.size,
        targetSizeBytes: this.pendingProject?.targetBlob?.size,
        online: navigator.onLine,
      }, error);
      const message = this.errorMessage(error, 'No se pudo publicar. Intentá nuevamente.');
      this.setBuildState('error', message, 0);
      this.isPublishing = false;
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

  async prepareSheetResult(sheetCanvas) {
    const canvas = document.getElementById('story-qr');
    const canvasWrap = document.getElementById('qr-canvas-wrap');
    const status = document.getElementById('qr-status');
    const download = document.getElementById('btn-download-sheet');
    status.textContent = 'Preparando la lámina final…';
    download.disabled = true;
    try {
      canvas.width = sheetCanvas.width;
      canvas.height = sheetCanvas.height;
      canvas.getContext('2d').drawImage(sheetCanvas, 0, 0);
      canvasWrap.hidden = false;
      canvas.hidden = false;
      status.textContent = 'Lámina generada: tu ilustración, el marco de anclaje AR y el acceso directo integrados en un solo diseño listo para imprimir.';
      download.disabled = false;
    } catch (error) {
      canvas.hidden = true;
      canvasWrap.hidden = true;
      status.textContent = 'La obra fue publicada, pero no se pudo preparar la vista de la lámina.';
      console.error(error);
    }
  }

  downloadMasterSheet() {
    if (!this.masterSheetPdfUrl) return;
    const link = document.createElement('a');
    link.href = this.masterSheetPdfUrl;
    link.download = 'InkMotion_Lamina_Final.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  setBuildState(state, message, progress) {
    const box = document.getElementById('build-status');
    if (!box) return;
    const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
    const displayProgress = this.isPublishing && ['publishing', 'processing'].includes(state)
      ? Math.max(this.publicationProgress, safeProgress)
      : safeProgress;
    if (this.isPublishing && ['publishing', 'processing'].includes(state)) this.publicationProgress = displayProgress;
    box.dataset.state = state;
    document.getElementById('build-label').textContent = message;
    document.getElementById('build-progress').style.width = `${displayProgress}%`;
  }

  async startReader(id) {
    document.body.dataset.route = 'reader';
    document.getElementById('reader-view').hidden = false;
    this.setReaderStatus('Cargando obra…', 'loading');
    try {
      const project = await this.store.getProject(id);
      if (!project) return this.showFatal('Esta obra no existe o todavía no fue publicada.');
      document.title = `${project.title} · InkMotion`;
      document.getElementById('reader-title').textContent = project.title;
      document.getElementById('info-title').textContent = project.title;
      document.getElementById('btn-info').addEventListener('click', () => document.getElementById('story-info').showModal());
      document.getElementById('btn-close-info').addEventListener('click', () => document.getElementById('story-info').close());
      document.getElementById('btn-camera-mode').addEventListener('click', () => this.toggleReaderMode());
      if (!project.videoUrl) throw new Error('Esta publicación pertenece a una versión anterior de InkMotion. Volvé a publicarla agregando su video loop.');
      this.parallax = new ParallaxEngine({ container: '#ar-overlay', contentRect: project.config?.contentRect });
      await this.parallax.init();
      await this.parallax.setTargetVideo(project.imageUrl, project.videoUrl);
      this.mindAR = new MindARManager({ video: '#video-stream' });
      const ready = await this.mindAR.init();
      if (!ready) throw new Error('No se pudo iniciar la cámara. Revisá sus permisos.');
      this.setReaderStatus('Verificando marcador AR…', 'loading');
      await this.mindAR.setCompiledTarget(project.targetUrl);
      this.setReaderStatus('Buscando ilustración...', 'scanning');
    } catch (error) { this.showFatal(error.message || 'No se pudo abrir esta obra.'); }
  }

  toggleReaderMode() {
    this.readerCameraOnly = !this.readerCameraOnly;
    this.parallax?.setPreviewMode(this.readerCameraOnly ? 'camera' : '3d');
    document.getElementById('btn-camera-mode').textContent = this.readerCameraOnly ? 'Ver efecto AR' : 'Solo cámara';
  }

  bindTrackingEvents() {
    window.addEventListener('error', (event) => {
      console.error('[InkMotion/Global] Excepción no controlada', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[InkMotion/Global] Promise rechazada sin controlar', event.reason);
    });
    EventBus.on('mindar:engine-state', ({ state, attempt, total }) => {
      if (this.isPublishing) {
        const message = state === 'ready'
          ? 'Motor AR conectado · analizando la lámina…'
          : state === 'retrying'
          ? `Conectando con el motor AR · alternativa ${attempt} de ${total}…`
          : 'Conectando con el motor AR…';
        this.setBuildState('publishing', message, 25);
        return;
      }
      if (state === 'ready') this.setBuildState('processing', 'Motor AR conectado · analizando imagen…', 20);
      else if (state === 'retrying') this.setBuildState('processing', `Conectando con el motor AR · alternativa ${attempt} de ${total}…`, 10);
      else this.setBuildState('processing', 'Conectando con el motor AR…', 8);
    });
    EventBus.on('mindar:compilation-progress', ({ progress }) => {
      const normalized = Math.min(100, progress);
      if (this.isPublishing) {
        this.setBuildState('publishing', `Compilando marcador AR · ${normalized}%`, 25 + normalized * 0.3);
      } else {
        this.setBuildState('processing', `Compilando marcador AR · ${normalized}%`, normalized);
      }
    });
    EventBus.on('mindar:target-quality', ({ quality }) => {
      if (!this.isPublishing) return;
      const message = quality === 'good'
        ? 'Tracking fuerte · preparando archivos finales…'
        : 'Tracking aceptable · usá buena luz al escanear.';
      this.setBuildState('publishing', message, 56);
    });
    EventBus.on('mindar:target-found', () => {
      window.clearTimeout(this.readerLostTimer);
      this.readerLostTimer = null;
      this.parallax?.onTargetFound();
      document.getElementById('reader-view')?.classList.add('target-found');
      this.setReaderStatus('La obra cobró vida', 'found');
      navigator.vibrate?.(35);
    });
    EventBus.on('mindar:target-lost', () => {
      window.clearTimeout(this.readerLostTimer);
      this.readerLostTimer = window.setTimeout(() => {
        this.parallax?.onTargetLost();
        document.getElementById('reader-view')?.classList.remove('target-found');
        this.setReaderStatus('Encuadrá la lámina completa', 'lost');
      }, 400);
    });
    EventBus.on('mindar:target-update', (data) => this.parallax?.updateWorldAnchor(data));
    EventBus.on('mindar:projection-ready', (data) => { this.parallax?.setProjectionMatrix(data.projectionMatrix); this.parallax?.setVideoViewport(data); });
    EventBus.on('mindar:video-ready', (data) => this.parallax?.setVideoViewport(data));
    EventBus.on('mindar:target-download', ({ state, error }) => {
      if (state === 'downloading') this.setReaderStatus('Descargando marcador AR…', 'loading');
      else if (state === 'ready') this.setReaderStatus('Marcador listo · buscando ilustración...', 'scanning');
      else if (state === 'error') this.setReaderStatus(error?.message || 'No se pudo descargar el marcador AR.', 'error');
    });
    EventBus.on('mindar:scan-timeout', ({ message }) => this.setReaderStatus(message, 'warning'));
    EventBus.on('mindar:processing-error', (error) => this.setReaderStatus(error?.message || 'El motor AR interrumpió el procesamiento.', 'error'));
    EventBus.on('parallax:webgl-error', (error) => this.setReaderStatus(error?.message || 'WebGL dejó de responder.', 'error'));
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
