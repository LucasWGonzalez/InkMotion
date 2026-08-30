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
    document.getElementById('btn-replace-video').addEventListener('click', () => document.getElementById('story-video').click());
    document.getElementById('btn-new-story').addEventListener('click', () => this.resetCreationFlow());
    document.getElementById('btn-view-projects').addEventListener('click', () => document.querySelector('.my-projects').scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
    status.textContent = 'Cargando tus obras…';
    grid.setAttribute('aria-busy', 'true');
    try {
      this.myProjects = await this.store.listMyProjects();
      this.renderMyProjects();
    } catch (error) {
      console.error('[InkMotion] No se pudo cargar Mis obras.', error);
      status.dataset.state = 'error';
      status.textContent = this.errorMessage(error, 'No pudimos cargar tus obras. Actualizá la página para reintentar.');
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
      this.renderMediaCompatibility(null);
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
    this.renderMediaCompatibility(ratioResult);
    imageValidation.textContent = 'Lista';
    imageValidation.dataset.state = 'ready';
    videoValidation.textContent = ratioResult.ok ? 'Compatible' : 'No compatible';
    videoValidation.dataset.state = ratioResult.ok ? 'ready' : 'warning';
    // Keep the action available once both files are valid so a click can explain
    // a missing title instead of failing silently behind a disabled control.
    publish.disabled = !ratioResult.ok || this.isPublishing;
    readyLabel.textContent = ratioResult.ok ? 'Imagen y video listos para publicar' : 'La imagen y el video no tienen la misma proporción';
    const readyMessage = hasTitle ? 'Todo listo para crear la obra aumentada.' : 'Falta el título de la obra para continuar.';
    this.setBuildState(ratioResult.ok ? (hasTitle ? 'ready' : 'warning') : 'warning', successMessage || (ratioResult.ok ? readyMessage : ratioResult.message), ratioResult.ok ? 45 : 35);
  }

  renderMediaCompatibility(result) {
    const error = document.getElementById('media-compatibility-error');
    const message = document.getElementById('media-compatibility-message');
    const videoCard = document.querySelector('.video-preview-card');
    const pairStatus = document.querySelector('.media-pair-status');
    const incompatible = Boolean(result && !result.ok);
    error.hidden = !incompatible;
    videoCard?.classList.toggle('is-incompatible', incompatible);
    if (pairStatus) pairStatus.dataset.state = incompatible ? 'error' : '';
    if (incompatible) message.textContent = result.message;
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

  async showPublishResult(id, publicUrl, sheetImageUrl) {
    const result = document.getElementById('publish-result');
    result.hidden = false;
    const input = document.getElementById('public-link');
    input.value = publicUrl;
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

  resetCreationFlow() {
    for (const url of [this.pendingProject?.imageUrl, this.pendingProject?.videoUrl]) {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    this.pendingProject = null;
    this.lastSelectedFile = null;
    this.publicationProgress = 0;
    document.getElementById('publish-form').reset();
    document.getElementById('story-file').value = '';
    document.getElementById('story-video').value = '';
    for (const preview of [document.getElementById('author-preview'), document.getElementById('author-video-preview')]) {
      preview.pause?.();
      preview.removeAttribute('src');
      preview.hidden = true;
    }
    document.getElementById('preview-wrap').hidden = true;
    document.getElementById('image-validation').textContent = 'Pendiente';
    document.getElementById('image-validation').dataset.state = 'pending';
    document.getElementById('video-validation').textContent = 'Pendiente';
    document.getElementById('video-validation').dataset.state = 'pending';
    document.getElementById('image-metadata').textContent = 'Seleccioná una imagen';
    document.getElementById('video-metadata').textContent = 'Seleccioná un video';
    this.renderMediaCompatibility(null);
    document.getElementById('title-error').hidden = true;
    document.getElementById('story-title').removeAttribute('aria-invalid');
    document.getElementById('publish-result').hidden = true;
    document.getElementById('story-sheet-preview').removeAttribute('src');
    document.getElementById('btn-download-sheet').disabled = true;
    const publish = document.getElementById('btn-publish');
    publish.hidden = false;
    publish.disabled = true;
    publish.textContent = 'Crear obra aumentada';
    document.getElementById('publish-help').hidden = false;
    document.getElementById('layout-reset')?.click();
    this.setBuildState('idle', 'Completá el título y subí los dos archivos', 0);
    document.querySelector('.creator-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => document.getElementById('story-file').focus(), 450);
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
      this.setupExperienceRecorder();
      this.setReaderStatus('Buscando ilustración…', 'scanning');
    } catch (error) {
      console.error('[InkMotion/Reader] No se pudo abrir la experiencia.', error);
      this.parallax?.stop();
      this.mindAR?.stop();
      this.showFatal(this.errorMessage(error, 'No pudimos abrir esta experiencia.'), '/crear', 'Crear una obra');
    }
  }

  toggleReaderMode() {
    this.readerCameraOnly = !this.readerCameraOnly;
    this.parallax?.setPreviewMode(this.readerCameraOnly ? 'camera' : '3d');
    document.getElementById('btn-camera-mode').textContent = this.readerCameraOnly ? 'Ver efecto AR' : 'Solo cámara';
  }

  setupExperienceRecorder() {
    if (!ExperienceRecorder.isSupported()) return;
    const sources = this.parallax.getCaptureSources();
    this.experienceRecorder = new ExperienceRecorder({
      cameraVideo: document.getElementById('video-stream'),
      arCanvas: sources.arCanvas,
      animatedVideo: sources.animatedVideo,
      viewport: document.getElementById('reader-view'),
    });
    this.removeRecorderFrameListener = this.parallax.addFrameListener(() => {
      if (this.experienceRecorder?.isRecording()) this.experienceRecorder.drawFrame();
    });
    document.getElementById('capture-controls').hidden = false;
    document.body.classList.add('capture-available');
    document.getElementById('btn-record').addEventListener('click', () => this.toggleExperienceRecording());
    document.getElementById('btn-sound').addEventListener('click', () => this.toggleExperienceSound());
    document.getElementById('btn-download-recording').addEventListener('click', () => this.downloadExperienceRecording());
    document.getElementById('btn-share-recording').addEventListener('click', () => this.shareExperienceRecording());
    document.getElementById('btn-discard-recording').addEventListener('click', () => this.closeExperienceRecording());
    document.getElementById('recording-result').addEventListener('close', () => this.closeExperienceRecording(false));
  }

  async toggleExperienceSound() {
    const button = document.getElementById('btn-sound');
    try {
      const enabled = await this.experienceRecorder.setSoundEnabled(button.getAttribute('aria-pressed') !== 'true');
      button.setAttribute('aria-pressed', `${enabled}`);
      button.setAttribute('aria-label', enabled ? 'Silenciar animación' : 'Activar sonido');
      button.classList.toggle('is-active', enabled);
    } catch (error) {
      console.warn('[InkMotion/Audio] No se pudo activar el sonido.', error);
      this.setReaderStatus('Este navegador no pudo activar el sonido.', 'warning');
    }
  }

  async toggleExperienceRecording() {
    const button = document.getElementById('btn-record');
    try {
      if (this.experienceRecorder.isRecording()) {
        button.disabled = true;
        this.experienceRecorder.stop();
      } else {
        await this.experienceRecorder.start();
      }
    } catch (error) {
      console.error('[InkMotion/Recorder] No se pudo iniciar la grabación.', error);
      this.setReaderStatus(error.message || 'No se pudo iniciar la grabación.', 'error');
      button.disabled = false;
    }
  }

  showExperienceRecording(result) {
    this.closeExperienceRecording(false);
    this.recordingResult = { ...result, url: URL.createObjectURL(result.blob) };
    document.getElementById('recording-preview').src = this.recordingResult.url;
    const shareButton = document.getElementById('btn-share-recording');
    const file = this.recordingFile();
    shareButton.hidden = !(navigator.share && navigator.canShare?.({ files: [file] }));
    document.getElementById('recording-result').showModal();
  }

  recordingFile() {
    if (!this.recordingResult) return null;
    return new File([this.recordingResult.blob], this.recordingFilename(this.recordingResult.extension), { type: this.recordingResult.type });
  }

  downloadExperienceRecording() {
    const file = this.recordingFile();
    if (!file || !this.recordingResult?.url) return;
    const link = document.createElement('a');
    link.href = this.recordingResult.url;
    link.download = file.name;
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

  async shareExperienceRecording() {
    const note = document.getElementById('recording-note');
    const file = this.recordingFile();
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: 'Mi experiencia InkMotion' });
      note.textContent = 'Se abrió el menú de compartir del dispositivo.';
    } catch (error) {
      if (error?.name === 'AbortError') { note.textContent = 'Compartir cancelado.'; return; }
      console.error('No se pudo compartir la grabación.', error);
      note.textContent = 'No se pudo abrir el menú de compartir. Usá Guardar video si querés conservarlo.';
    }
  }

  closeExperienceRecording(closeDialog = true) {
    const dialog = document.getElementById('recording-result');
    const preview = document.getElementById('recording-preview');
    preview?.pause();
    preview?.removeAttribute('src');
    if (this.recordingResult?.url) URL.revokeObjectURL(this.recordingResult.url);
    this.recordingResult = null;
    document.getElementById('recording-note').textContent = 'La grabación todavía no está guardada. Podés guardarla o compartirla. No se sube a InkMotion.';
    if (closeDialog && dialog?.open) dialog.close();
  }

  formatRecordingTime(seconds) {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  bindTrackingEvents() {
    EventBus.on('mindar:target-found', () => {
      window.clearTimeout(this.readerLostTimer);
      this.readerLostTimer = null;
      this.parallax?.onTargetFound();
      document.getElementById('reader-view')?.classList.add('target-found');
      this.setReaderStatus('La obra cobró vida', 'found');
      const recordButton = document.getElementById('btn-record');
      if (recordButton) recordButton.disabled = false;
      navigator.vibrate?.(35);
    });
    EventBus.on('mindar:target-lost', () => {
      window.clearTimeout(this.readerLostTimer);
      this.readerLostTimer = window.setTimeout(() => {
        this.parallax?.onTargetLost();
        document.getElementById('reader-view')?.classList.remove('target-found');
        this.setReaderStatus('Encuadrá la lámina completa', 'lost');
        const recordButton = document.getElementById('btn-record');
        if (recordButton && !this.experienceRecorder?.isRecording()) recordButton.disabled = true;
      }, 400);
    });
    EventBus.on('mindar:target-update', (data) => this.parallax?.updateWorldAnchor(data));
    EventBus.on('mindar:projection-ready', (data) => { this.parallax?.setProjectionMatrix(data.projectionMatrix); this.parallax?.setVideoViewport(data); });
    EventBus.on('mindar:video-ready', (data) => this.parallax?.setVideoViewport(data));
    EventBus.on('mindar:target-download', ({ state, error }) => {
      if (state === 'downloading') this.setReaderStatus('Descargando marcador AR…', 'loading');
      else if (state === 'ready') this.setReaderStatus('Marcador listo · buscando ilustración…', 'scanning');
      else if (state === 'error') this.setReaderStatus(error?.message || 'No se pudo descargar el marcador AR.', 'error');
    });
    EventBus.on('mindar:scan-timeout', ({ message }) => this.setReaderStatus(message, 'warning'));
    EventBus.on('mindar:processing-error', (error) => this.setReaderStatus(error?.message || 'El motor AR interrumpió el procesamiento.', 'error'));
    EventBus.on('parallax:webgl-error', (error) => this.setReaderStatus(error?.message || 'WebGL dejó de responder.', 'error'));
    EventBus.on('parallax:video-error', () => this.setReaderStatus('Tocá la pantalla para activar el video. Si no aparece, usá un MP4 H.264.', 'warning'));
    EventBus.on('recorder:state', ({ state }) => {
      const button = document.getElementById('btn-record');
      const controls = document.getElementById('capture-controls');
      if (!button || !controls) return;
      const recording = state === 'recording';
      controls.classList.toggle('is-recording', recording);
      button.disabled = false;
      button.setAttribute('aria-label', recording ? 'Detener grabación' : 'Iniciar grabación');
      if (!recording) document.getElementById('recording-time').textContent = '00:00';
    });
    EventBus.on('recorder:tick', ({ seconds }) => {
      const time = document.getElementById('recording-time');
      if (!time) return;
      time.textContent = this.formatRecordingTime(seconds);
      time.dateTime = `PT${seconds}S`;
    });
    EventBus.on('recorder:complete', (result) => this.showExperienceRecording(result));
    EventBus.on('recorder:error', (error) => this.setReaderStatus(error?.message || 'La grabación fue interrumpida por el dispositivo.', 'warning'));
    EventBus.on('recorder:audio-warning', () => this.setReaderStatus('La grabación continuará sin audio en este dispositivo.', 'warning'));
  }

  setReaderStatus(message, state) {
    const status = document.getElementById('reader-status');
    if (!status) return;
    status.dataset.state = state;
    document.getElementById('reader-status-text').textContent = message;
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
