import MindARManager from './core/MindARManager.js?v=2';
import ParallaxEngine from './core/ParallaxEngine.js';
import ImageProcessor from './core/ImageProcessor.js';
import ProjectStore from './services/ProjectStore.js?v=3';
import EventBus from './utils/EventBus.js';
import MasterSheetGenerator from './core/MasterSheetGenerator.js?v=5';
import VideoProcessor from './core/VideoProcessor.js';
import ExperienceRecorder from './core/ExperienceRecorder.js';

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
    this.experienceRecorder = null;
    this.recordingResult = null;
    this.myProjects = [];
    this.projectPendingDeletion = null;
    this.authorSessionUserId = null;
    this.authorSessionSync = Promise.resolve();
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
    document.getElementById('story-title').addEventListener('input', () => this.handleTitleInput());
    document.getElementById('btn-copy-prompt').addEventListener('click', () => this.copyLoopPrompt());
    document.getElementById('publish-form').addEventListener('submit', (event) => this.publishStory(event));
    document.getElementById('btn-copy-link').addEventListener('click', () => this.copyPublishedLink());
    document.getElementById('btn-download-sheet').addEventListener('click', () => this.downloadMasterSheet());
    document.getElementById('btn-retry').addEventListener('click', () => this.retryLastAction());
    document.getElementById('btn-close-delete').addEventListener('click', () => this.closeDeleteProjectDialog());
    document.getElementById('btn-cancel-delete').addEventListener('click', () => this.closeDeleteProjectDialog());
    document.getElementById('btn-confirm-delete').addEventListener('click', () => this.confirmDeleteProject());
    document.getElementById('delete-project-dialog').addEventListener('cancel', () => { this.projectPendingDeletion = null; });
    const authStatus = document.getElementById('auth-status');
    const isOAuthReturn = new URLSearchParams(window.location.search).has('code');
    if (isOAuthReturn) authStatus.textContent = 'Completando el acceso con Google…';
    let session = null;
    try {
      session = await this.store.initializeAuth();
      authStatus.textContent = '';
    } catch (error) {
      console.error('[InkMotion] No se pudo completar Google OAuth.', error);
      authStatus.textContent = this.errorMessage(error, 'No pudimos completar el acceso con Google. Intentá nuevamente.');
    }
    await this.syncAuthorSession(session);
    this.store.onAuthChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION') return;
      this.authorSessionSync = this.authorSessionSync
        .then(() => this.syncAuthorSession(nextSession))
        .catch((error) => console.error('[InkMotion] Falló la sincronización de la sesión.', error));
    });
  }

  async syncAuthorSession(session) {
    const nextUserId = session?.user?.id || null;
    if (nextUserId === this.authorSessionUserId) return;
    this.authorSessionUserId = nextUserId;
    this.renderAuthorSession(session);
    if (session) await Promise.all([this.restoreOAuthDraft(), this.loadMyProjects()]);
  }

  renderAuthorSession(session) {
    document.getElementById('auth-card').hidden = Boolean(session);
    document.getElementById('creator-workspace').hidden = !session;
    if (session) document.getElementById('author-email').textContent = session.user.email || 'Autor';
    else {
      this.myProjects = [];
      document.getElementById('projects-grid').replaceChildren();
      document.getElementById('projects-count').textContent = '';
    }
  }

  async loadMyProjects() {
    const status = document.getElementById('projects-status');
    const grid = document.getElementById('projects-grid');
    status.hidden = false;
    status.dataset.state = 'loading';
    status.textContent = 'Cargando tus trabajos…';
    grid.setAttribute('aria-busy', 'true');
    try {
      this.myProjects = await this.store.listMyProjects();
      this.renderMyProjects();
    } catch (error) {
      console.error('[InkMotion] No se pudo cargar Mis trabajos.', error);
      status.dataset.state = 'error';
      status.textContent = this.errorMessage(error, 'No pudimos cargar tus trabajos. Actualizá la página para reintentar.');
    } finally {
      grid.removeAttribute('aria-busy');
    }
  }

  renderMyProjects() {
    const grid = document.getElementById('projects-grid');
    const status = document.getElementById('projects-status');
    const count = document.getElementById('projects-count');
    grid.replaceChildren();
    count.textContent = `${this.myProjects.length} ${this.myProjects.length === 1 ? 'trabajo' : 'trabajos'}`;
    if (!this.myProjects.length) {
      status.hidden = false;
      status.dataset.state = 'empty';
      status.textContent = 'Todavía no publicaste ningún trabajo. Tu primera obra aparecerá acá.';
      return;
    }
    status.hidden = true;
    const dateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
    this.myProjects.forEach((project) => {
      const article = document.createElement('article');
      article.className = 'project-card';
      article.dataset.projectId = project.id;

      const thumbnail = document.createElement('div');
      thumbnail.className = 'project-thumbnail';
      const image = document.createElement('img');
      image.src = project.imageUrl;
      image.alt = `Miniatura de ${project.title}`;
      image.loading = 'lazy';
      thumbnail.append(image);

      const content = document.createElement('div');
      content.className = 'project-content';
      const time = document.createElement('time');
      time.dateTime = project.created_at;
      time.textContent = `Creado el ${dateFormatter.format(new Date(project.created_at))}`;
      const title = document.createElement('h3');
      title.textContent = project.title;
      const actions = document.createElement('div');
      actions.className = 'project-actions';
      const download = document.createElement('button');
      download.className = 'btn btn-primary';
      download.type = 'button';
      download.textContent = 'Descargar lámina';
      download.addEventListener('click', () => this.downloadProjectSheet(project, download));
      const remove = document.createElement('button');
      remove.className = 'btn btn-danger';
      remove.type = 'button';
      remove.textContent = 'Eliminar trabajo';
      remove.setAttribute('aria-label', `Eliminar ${project.title}`);
      remove.addEventListener('click', () => this.openDeleteProjectDialog(project));
      actions.append(download, remove);
      content.append(time, title, actions);
      article.append(thumbnail, content);
      grid.append(article);
    });
  }

  async downloadProjectSheet(project, button) {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparando PDF…';
    try {
      const publicUrl = `${window.location.origin}/v/${compactProjectId(project.id)}`;
      const sheet = await this.sheetGenerator.compose({
        illustrationUrl: project.imageUrl,
        publicUrl,
        title: project.title,
      });
      const pdfBlob = await this.sheetGenerator.createPdf(sheet.jpegDataUrl, sheet.pageSizeMm);
      const objectUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'InkMotion_Lamina_Final.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      button.textContent = 'Descargada';
      window.setTimeout(() => { button.textContent = originalLabel; }, 1_500);
    } catch (error) {
      console.error('[InkMotion] No se pudo regenerar la lámina.', error);
      button.textContent = 'Reintentar descarga';
    } finally {
      button.disabled = false;
    }
  }

  openDeleteProjectDialog(project) {
    this.projectPendingDeletion = project;
    const dialog = document.getElementById('delete-project-dialog');
    document.getElementById('delete-project-title').textContent = `“${project.title}”`;
    document.getElementById('delete-project-status').textContent = '';
    document.getElementById('btn-confirm-delete').disabled = false;
    dialog.showModal();
  }

  closeDeleteProjectDialog() {
    const dialog = document.getElementById('delete-project-dialog');
    if (dialog.open) dialog.close();
    this.projectPendingDeletion = null;
  }

  async confirmDeleteProject() {
    const project = this.projectPendingDeletion;
    if (!project) return;
    const button = document.getElementById('btn-confirm-delete');
    const status = document.getElementById('delete-project-status');
    button.disabled = true;
    status.textContent = 'Eliminando archivos y publicación…';
    try {
      await this.store.deleteProject(project.id);
      this.myProjects = this.myProjects.filter((item) => item.id !== project.id);
      this.renderMyProjects();
      this.closeDeleteProjectDialog();
    } catch (error) {
      console.error('[InkMotion] No se pudo eliminar el trabajo.', error);
      status.textContent = this.errorMessage(error, 'No se pudo eliminar el trabajo. Intentá nuevamente.');
      button.disabled = false;
    }
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
    const imageValidation = document.getElementById('image-validation');
    const videoValidation = document.getElementById('video-validation');
    const readyLabel = document.getElementById('media-ready-label');
    const hasTitle = this.hasValidTitle();
    if (!hasImage || !hasVideo) {
      publish.disabled = true;
      imageValidation.textContent = hasImage ? 'Lista' : 'Pendiente';
      imageValidation.dataset.state = hasImage ? 'ready' : 'pending';
      videoValidation.textContent = hasVideo ? 'Listo' : 'Pendiente';
      videoValidation.dataset.state = hasVideo ? 'ready' : 'pending';
      readyLabel.textContent = hasImage && !hasVideo ? 'Falta el video loop' : !hasImage && hasVideo ? 'Falta la imagen original' : 'Esperando imagen y video';
      this.setBuildState('idle', readyLabel.textContent, hasImage ? 25 : hasVideo ? 35 : 0);
      return;
    }
    const ratioResult = this.validateMediaRatio();
    imageValidation.textContent = 'Lista';
    imageValidation.dataset.state = 'ready';
    videoValidation.textContent = ratioResult.ok ? 'Compatible' : 'Revisar';
    videoValidation.dataset.state = ratioResult.ok ? 'ready' : 'warning';
    // Keep the action available once both files are valid so a click can explain
    // a missing title instead of failing silently behind a disabled control.
    publish.disabled = !ratioResult.ok || this.isPublishing;
    readyLabel.textContent = ratioResult.ok ? 'Imagen y video listos para publicar' : 'La imagen y el video no tienen la misma proporción';
    const readyMessage = hasTitle ? 'Todo listo para crear la obra aumentada.' : 'Falta el título de la obra para continuar.';
    this.setBuildState(ratioResult.ok ? (hasTitle ? 'ready' : 'warning') : 'warning', successMessage || (ratioResult.ok ? readyMessage : ratioResult.message), ratioResult.ok ? 45 : 35);
  }

  hasValidTitle() {
    return Boolean(document.getElementById('story-title')?.value.trim());
  }

  handleTitleInput() {
    const input = document.getElementById('story-title');
    const error = document.getElementById('title-error');
    const valid = this.hasValidTitle();
    input.removeAttribute('aria-invalid');
    error.hidden = true;
    if (valid) this.updateMediaReadiness();
    else if (this.pendingProject?.imageBlob && this.pendingProject?.videoBlob) this.updateMediaReadiness();
  }

  showTitleError() {
    const input = document.getElementById('story-title');
    const error = document.getElementById('title-error');
    input.setAttribute('aria-invalid', 'true');
    error.hidden = false;
    this.setBuildState('error', 'Ingresá el título de la obra para poder publicarla.', 45);
    input.focus({ preventScroll: true });
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  validateMediaRatio() {
    const image = this.pendingProject?.imageDimensions;
    const video = this.pendingProject?.videoMetadata;
    if (!image || !video?.width || !video?.height) return { ok: false, message: 'Todavía faltan datos para comparar la imagen y el video.' };
    const imageRatio = image.width / image.height;
    const videoRatio = video.width / video.height;
    const difference = Math.abs(imageRatio - videoRatio) / imageRatio;
    if (difference > 0.025) {
      return { ok: false, message: `La imagen es ${image.width}×${image.height} y el video ${video.width}×${video.height}. Necesitan la misma proporción para mantener el encuadre en AR.` };
    }
    return { ok: true, message: '' };
  }

  updateMediaMetadata() {
    const project = this.pendingProject || {};
    const imageText = project.imageDimensions ? `${project.imageName || 'Imagen'} · ${project.imageDimensions.width}×${project.imageDimensions.height} · ${formatBytes(project.imageBlob?.size)}` : 'Seleccioná una imagen';
    const videoText = project.videoMetadata ? `${project.videoName || 'Video'} · ${project.videoMetadata.width}×${project.videoMetadata.height} · ${formatDuration(project.videoMetadata.duration)} · ${formatBytes(project.videoBlob?.size)}` : 'Seleccioná un video';
    document.getElementById('image-metadata').textContent = imageText;
    document.getElementById('video-metadata').textContent = videoText;
  }

  async publishStory(event) {
    event.preventDefault();
    if (!this.hasValidTitle()) { this.showTitleError(); return; }
    if (!this.pendingProject?.imageBlob || !this.pendingProject?.videoBlob) {
      this.updateMediaReadiness();
      this.setBuildState('error', !this.pendingProject?.imageBlob ? 'Subí la imagen original para continuar.' : 'Subí el video loop para continuar.', 0);
      return;
    }
    if (!this.validateMediaRatio().ok) { this.updateMediaReadiness(); return; }
    if (this.isPublishing) return;
    this.isPublishing = true;
    let publicationSucceeded = false;
    this.publicationProgress = 0;
    const publishButton = document.getElementById('btn-publish');
    const publishForm = document.getElementById('publish-form');
    const publishResult = document.getElementById('publish-result');
    publishButton.disabled = true;
    publishButton.textContent = 'Procesando obra…';
    publishButton.classList.add('is-processing');
    publishForm.setAttribute('aria-busy', 'true');
    publishResult.hidden = true;
    this.clearRetry();
    try {
      const id = this.pendingProject.id || crypto.randomUUID();
      this.pendingProject.id = id;
      const publicUrl = `${window.location.origin}/v/${compactProjectId(id)}`;
      const title = document.getElementById('story-title').value.trim();
      this.setBuildState('processing', 'Componiendo la Lámina Maestra…', 52);
      const sheet = await this.sheetGenerator.compose({ illustrationUrl: this.pendingProject.imageUrl, publicUrl, title });
      this.pendingProject.masterSheet = sheet;
      this.setBuildState('processing', 'Validando calidad de tracking…', 60);
      const manager = new MindARManager();
      const compiledTarget = await manager.compileTarget(sheet.imageUrl);
      const { blob: targetBlob, featureCount, visualQuality, rating } = compiledTarget;
      const trackingQuality = {
        rating,
        featureCount,
        contrast: Math.round(visualQuality.contrast),
        edgeRatio: visualQuality.edgeRatio,
      };
      const pdfBlob = await this.sheetGenerator.createPdf(sheet.jpegDataUrl, sheet.pageSizeMm);
      this.pendingProject.pdfBlob = pdfBlob;
      this.setBuildState('processing', `Tracking ${trackingQuality.rating === 'good' ? 'fuerte' : 'aceptable'} · preparando subida…`, 67);
      await this.store.saveProject({ id, title, imageBlob: this.pendingProject.imageBlob, videoBlob: this.pendingProject.videoBlob, targetBlob, config: { contentRect: sheet.contentRect, targetAspect: sheet.contentRect.targetAspect, trackingQuality, video: this.pendingProject.videoMetadata }, onStage: ({ message, progress }) => this.setBuildState('processing', message, progress) });
      await this.loadMyProjects();
      this.showPublishResult(id, publicUrl, sheet.jpegDataUrl);
      this.setBuildState('success', 'Publicación lista · descargá la Lámina Maestra en PDF.', 100);
      publicationSucceeded = true;
    } catch (error) {
      console.error('[InkMotion] Falló la publicación.', error);
      const message = this.errorMessage(error, 'No pudimos crear la publicación.');
      this.setBuildState('error', message, 0);
      if (this.isNetworkError(error)) this.offerRetry('publish');
    } finally {
      this.isPublishing = false;
      publishForm.removeAttribute('aria-busy');
      publishButton.classList.remove('is-processing');
      if (publicationSucceeded) {
        publishButton.hidden = true;
      } else {
        publishButton.textContent = 'Crear obra aumentada';
        publishButton.disabled = false;
      }
    }
  }

  showPublishResult(id, publicUrl, sheetImageUrl) {
    const result = document.getElementById('publish-result');
    result.hidden = false;
    const input = document.getElementById('public-link');
    input.value = publicUrl;
    const open = document.getElementById('btn-open-story');
    open.href = publicUrl;
    const previewWrap = document.getElementById('qr-canvas-wrap');
    previewWrap.hidden = false;
    const preview = document.getElementById('story-sheet-preview');
    preview.src = sheetImageUrl;
    preview.hidden = false;
    document.getElementById('qr-status').textContent = 'Lámina lista para imprimir. Usá el PDF sin escalar para conservar el tracking.';
    document.getElementById('btn-download-sheet').disabled = false;
    document.getElementById('publish-help').hidden = true;
    result.scrollIntoView({ behavior: 'smooth', block: 'center' });
    result.focus({ preventScroll: true });
  }

  async downloadMasterSheet() {
    const pdfBlob = this.pendingProject?.pdfBlob;
    if (!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'InkMotion_Lamina_Final.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async copyPublishedLink() {
    const input = document.getElementById('public-link');
    try {
      await navigator.clipboard.writeText(input.value);
      document.getElementById('btn-copy-link').textContent = 'Copiado';
      window.setTimeout(() => { document.getElementById('btn-copy-link').textContent = 'Copiar'; }, 1_500);
    } catch { input.select(); document.execCommand('copy'); }
  }

  copyLoopPrompt() {
    const prompt = `Image Reference Control: Use the uploaded image as the exact visual reference and first frame. Preserve its composition, framing, aspect ratio, color palette, text, linework, characters and object geometry.\n\nCamera Lock: Static tripod shot. No zoom, pan, tilt, orbit, dolly, crop or reframing.\n\nMotion: Animate only subtle internal or atmospheric details that make sense for this specific image, such as gentle wind, breathing, water, smoke, light, particles or small environmental movement. Keep all structural shapes and the main subject locked. No morphing, warping, added objects, removed objects or redesigned details.\n\nLoop: Create a seamless short loop. The last frame should visually return to the original image. If the tool supports first and last frame references, use this same uploaded image for both.\n\nOutput: Keep the original aspect ratio and composition. Preserve readable text and logos exactly. No camera movement.`;
    navigator.clipboard.writeText(prompt).then(() => {
      const button = document.getElementById('btn-copy-prompt');
      button.textContent = 'Instrucciones copiadas';
      window.setTimeout(() => { button.textContent = 'Copiar instrucciones para crear el video loop'; }, 1_800);
    }).catch(() => {});
  }

  async startReader(id) {
    document.body.dataset.route = 'reader';
    document.getElementById('reader-view').hidden = false;
    const statusText = document.getElementById('reader-status-text');
    try {
      statusText.textContent = 'Buscando la obra…';
      const project = await this.store.getProject(id);
      if (!project) throw new Error('Esta obra no existe o ya no está disponible.');
      document.getElementById('reader-title').textContent = project.title;
      document.getElementById('info-title').textContent = project.title;
      const manager = new MindARManager();
      const engine = new ParallaxEngine(document.getElementById('ar-overlay'));
      this.experienceRecorder = new ExperienceRecorder({ videoElement: document.getElementById('video-stream'), canvasProvider: () => engine.renderer?.domElement || null });
      const storedRect = project.config?.contentRect || { x: 0, y: 0, width: 1, height: 1, targetAspect: 1 };
      await engine.load(project.imageUrl, project.videoUrl, storedRect);
      await manager.start({ container: document.getElementById('camera-feed'), targetUrl: project.targetUrl, targetIndex: 0, onAnchor: (group) => engine.attachToAnchor(group) });
      this.bindReaderControls(manager, engine, project);
      statusText.textContent = 'Buscando la lámina…';
    } catch (error) {
      console.error(error);
      this.showFatal(this.errorMessage(error, 'No pudimos abrir esta experiencia.'), '/crear', 'Crear una obra');
    }
  }

  bindReaderControls(manager, engine, project) {
    document.getElementById('btn-camera-mode').addEventListener('click', () => engine.toggleCameraOnly());
    document.getElementById('btn-info').addEventListener('click', () => document.getElementById('story-info').showModal());
    document.getElementById('btn-close-info').addEventListener('click', () => document.getElementById('story-info').close());
    document.getElementById('btn-sound').addEventListener('click', async () => {
      const enabled = await engine.toggleSound();
      const button = document.getElementById('btn-sound');
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      button.setAttribute('aria-label', enabled ? 'Silenciar sonido' : 'Activar sonido');
    });
    const capture = document.getElementById('capture-controls');
    if (this.experienceRecorder?.supported) {
      capture.hidden = false;
      const record = document.getElementById('btn-record');
      record.disabled = false;
      record.addEventListener('click', () => this.toggleRecording());
      document.getElementById('btn-download-recording').addEventListener('click', () => this.downloadRecording());
      document.getElementById('btn-share-recording').addEventListener('click', () => this.shareRecording());
      document.getElementById('btn-discard-recording').addEventListener('click', () => this.discardRecording());
    }
    EventBus.on('target:found', () => {
      document.getElementById('reader-status').dataset.state = 'found';
      document.getElementById('reader-status-text').textContent = 'La obra cobró vida';
      if (navigator.vibrate) navigator.vibrate(35);
    });
    EventBus.on('target:lost', () => {
      document.getElementById('reader-status').dataset.state = 'searching';
      document.getElementById('reader-status-text').textContent = 'Volvé a encuadrar la lámina';
    });
  }

  async toggleRecording() {
    const button = document.getElementById('btn-record');
    if (!this.experienceRecorder?.isRecording) {
      try {
        await this.experienceRecorder.start();
        button.classList.add('is-recording');
        button.setAttribute('aria-label', 'Detener grabación');
        this.startRecordingClock();
      } catch (error) { console.error('No se pudo iniciar la grabación.', error); }
      return;
    }
    try {
      this.recordingResult = await this.experienceRecorder.stop();
      button.classList.remove('is-recording');
      button.setAttribute('aria-label', 'Iniciar grabación');
      this.stopRecordingClock();
      const preview = document.getElementById('recording-preview');
      preview.src = this.recordingResult.url;
      document.getElementById('recording-result').showModal();
    } catch (error) { console.error('No se pudo finalizar la grabación.', error); }
  }

  startRecordingClock() {
    this.recordingStartedAt = Date.now();
    const time = document.getElementById('recording-time');
    const tick = () => {
      if (!this.experienceRecorder?.isRecording) return;
      const seconds = Math.floor((Date.now() - this.recordingStartedAt) / 1000);
      time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      time.dateTime = `PT${seconds}S`;
      this.recordingTimer = window.setTimeout(tick, 500);
    };
    tick();
  }

  stopRecordingClock() {
    window.clearTimeout(this.recordingTimer);
    const time = document.getElementById('recording-time');
    time.textContent = '00:00';
    time.dateTime = 'PT0S';
  }

  downloadRecording() {
    if (!this.recordingResult) return;
    const link = document.createElement('a');
    link.href = this.recordingResult.url;
    link.download = this.recordingFilename(this.recordingResult.extension);
    document.body.appendChild(link);
    link.click();
    link.remove();
    document.getElementById('recording-note').textContent = 'Descarga iniciada. Buscá el video en la carpeta Descargas.';
  }

  recordingFilename(extension) {
    const now = new Date();
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    return `InkMotion_AR_${day}_${time}.${extension}`;
  }

  async shareRecording() {
    const note = document.getElementById('recording-note');
    if (!this.recordingResult) return;
    if (!navigator.share || !navigator.canShare) {
      note.textContent = 'Este navegador no permite compartir archivos directamente. Usá Guardar video y compartilo desde tu galería o gestor de archivos.';
      return;
    }
    try {
      const shareType = this.recordingResult.extension === 'mp4' ? 'video/mp4' : 'video/webm';
      const file = new File([this.recordingResult.blob], this.recordingFilename(this.recordingResult.extension), { type: shareType });
      if (!navigator.canShare({ files: [file] })) {
        note.textContent = 'Este dispositivo no admite compartir este archivo directamente. Usá Guardar video.';
        return;
      }
      await navigator.share({ files: [file] });
      note.textContent = 'Se abrió el menú de compartir del dispositivo.';
    } catch (error) {
      if (error?.name === 'AbortError') { note.textContent = 'Compartir cancelado.'; return; }
      console.error('No se pudo compartir la grabación.', error);
      note.textContent = 'No se pudo abrir el menú de compartir. Usá Guardar video si querés conservarlo.';
    }
  }

  discardRecording() {
    const dialog = document.getElementById('recording-result');
    if (dialog.open) dialog.close();
    if (this.recordingResult?.url) URL.revokeObjectURL(this.recordingResult.url);
    this.recordingResult = null;
    document.getElementById('recording-preview').removeAttribute('src');
    document.getElementById('recording-note').textContent = 'La grabación todavía no está guardada. Podés guardarla o compartirla. No se sube a InkMotion.';
  }

  bindTrackingEvents() {
    EventBus.on('mindar:status', ({ state, message }) => {
      const reader = document.getElementById('reader-status');
      if (!reader) return;
      reader.dataset.state = state;
      document.getElementById('reader-status-text').textContent = message;
    });
  }

  setBuildState(state, message, progress) {
    const build = document.getElementById('build-status');
    build.dataset.state = state;
    const next = Math.max(this.publicationProgress || 0, Math.min(100, Number(progress) || 0));
    if (state === 'error' || state === 'warning') this.publicationProgress = Math.max(0, Number(progress) || 0);
    else this.publicationProgress = next;
    document.getElementById('build-label').textContent = message;
    document.getElementById('build-progress').style.width = `${this.publicationProgress}%`;
  }

  offerRetry(action) {
    this.retryAction = action;
    document.getElementById('btn-retry').hidden = false;
  }

  clearRetry() {
    this.retryAction = null;
    document.getElementById('btn-retry').hidden = true;
  }

  retryLastAction() {
    const action = this.retryAction;
    this.clearRetry();
    if (action === 'publish') this.publishStory(new Event('submit'));
    else if (action === 'prepare' && this.lastSelectedFile) this.prepareStory(this.lastSelectedFile);
  }

  isNetworkError(error) {
    return error?.code === 'NETWORK_ERROR' || /failed to fetch|network|load failed/i.test(error?.message || '');
  }

  errorMessage(error, fallback) {
    if (!error) return fallback;
    if (error.code === 'NETWORK_ERROR') return NETWORK_ERROR_MESSAGE;
    if (error.code === 'AUTH_SESSION_EXPIRED') return 'Tu sesión expiró. Volvé a iniciar sesión y repetí la publicación.';
    return error.message || fallback;
  }

  showFatal(message, link = '/crear', label = 'Volver') {
    document.getElementById('author-view').hidden = true;
    document.getElementById('reader-view').hidden = true;
    document.getElementById('fatal-view').hidden = false;
    document.getElementById('fatal-message').textContent = message;
    const anchor = document.getElementById('fatal-link');
    anchor.href = link;
    anchor.textContent = label;
  }
}

new InkMotionApp();
