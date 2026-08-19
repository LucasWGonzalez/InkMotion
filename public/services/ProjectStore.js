import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.102.0';

const SUPABASE_URL = 'https://srcofwiuobmvezkodscg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_agzhvCuMkzw49BFSyxyAsw_znhUaK1T';
const BUCKET = 'stories';
const BUCKET_FILE_LIMIT = 10 * 1024 * 1024;
const NETWORK_ERROR_MESSAGE = 'Error de conexión con el motor o Supabase. Verifica tu red o el tamaño de la imagen.';

function errorDetails(error) {
  return {
    name: error?.name,
    message: error?.message || `${error || 'Error desconocido'}`,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    status: error?.status || error?.statusCode,
  };
}

function logSupabaseError(stage, error, context = {}) {
  console.error(`[InkMotion/Supabase] Falló ${stage}`, {
    ...errorDetails(error),
    ...context,
    online: navigator.onLine,
    timestamp: new Date().toISOString(),
  });
}

function sessionExpiredError(cause) {
  const error = new Error('Tu sesión de autor expiró. Volvé a iniciar sesión antes de publicar.', { cause });
  error.code = 'AUTH_SESSION_EXPIRED';
  return error;
}

function normalizeNetworkError(error) {
  const message = `${error?.message || error || ''}`;
  if (!/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message)) return error;
  const friendly = new Error(NETWORK_ERROR_MESSAGE, { cause: error });
  friendly.code = 'NETWORK_ERROR';
  return friendly;
}

class ProjectStore {
  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  async getSession() {
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      return data.session;
    } catch (error) { throw normalizeNetworkError(error); }
  }

  async requireActiveSession() {
    let session;
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      session = data.session;
    } catch (error) {
      logSupabaseError('la verificación de sesión', error);
      throw normalizeNetworkError(error);
    }
    if (!session) throw sessionExpiredError();

    const expiresSoon = Number(session.expires_at || 0) * 1000 <= Date.now() + 60_000;
    if (expiresSoon) {
      try {
        const { data, error } = await this.client.auth.refreshSession();
        if (error) throw error;
        session = data.session;
      } catch (error) {
        logSupabaseError('la renovación de sesión', error);
        const normalized = normalizeNetworkError(error);
        if (normalized?.code === 'NETWORK_ERROR') throw normalized;
        throw sessionExpiredError(error);
      }
    }
    if (!session) throw sessionExpiredError();
    return session;
  }

  async signInWithGoogle() {
    try {
      const { data, error } = await this.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/crear`,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
      return data;
    } catch (error) { throw normalizeNetworkError(error); }
  }

  onAuthChange(callback) {
    return this.client.auth.onAuthStateChange((_event, session) => callback(session));
  }

  async signOut() {
    try {
      const { error } = await this.client.auth.signOut();
      if (error) throw error;
    } catch (error) { throw normalizeNetworkError(error); }
  }

  async saveProject({ id: reservedId, title, imageBlob, targetBlob, config }) {
    const session = await this.requireActiveSession();
    const validateBlob = (label, blob, expectedType) => {
      if (!(blob instanceof Blob) || blob.size <= 0) {
        const error = new Error(`${label} no es un archivo válido. Volvé a procesar la ilustración.`);
        error.code = 'INVALID_UPLOAD_BLOB';
        throw error;
      }
      if (blob.size > BUCKET_FILE_LIMIT) {
        const size = (blob.size / 1024 / 1024).toFixed(2);
        const error = new Error(`${label} pesa ${size} MB y supera el límite de 10 MB de Supabase Storage.`);
        error.code = 'UPLOAD_TOO_LARGE';
        throw error;
      }
      return blob.type === expectedType ? blob : new Blob([blob], { type: expectedType });
    };
    const imageFile = validateBlob('La imagen optimizada', imageBlob, 'image/jpeg');
    const targetFile = validateBlob('El archivo .mind', targetBlob, 'application/octet-stream');
    const id = reservedId || crypto.randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('El identificador reservado del proyecto no es válido.');
    }
    const root = `${session.user.id}/${id}`;
    const imagePath = `${root}/cover.jpg`;
    const targetPath = `${root}/target.mind`;
    const upload = async (path, blob, contentType) => {
      try {
        const { error } = await this.client.storage.from(BUCKET).upload(path, blob, {
          contentType,
          cacheControl: '3600',
          upsert: false,
        });
        if (error) throw error;
      } catch (error) {
        logSupabaseError(`la subida de ${path.endsWith('.mind') ? 'target.mind' : 'cover.jpg'}`, error, {
          path,
          contentType,
          sizeBytes: blob.size,
          sizeMB: Number((blob.size / 1024 / 1024).toFixed(3)),
          sessionExpiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
        });
        throw normalizeNetworkError(error);
      }
    };
    try {
      await upload(imagePath, imageFile, 'image/jpeg');
      await upload(targetPath, targetFile, 'application/octet-stream');
      let data;
      try {
        const response = await this.client.from('stories').insert({
          id,
          author_id: session.user.id,
          title: title || 'Cuento sin título',
          image_path: imagePath,
          target_path: targetPath,
          config,
        }).select('id').single();
        if (response.error) throw response.error;
        data = response.data;
      } catch (error) {
        logSupabaseError('el INSERT en stories', error, { storyId: id, authorId: session.user.id });
        throw error;
      }
      return data;
    } catch (error) {
      try {
        await this.client.storage.from(BUCKET).remove([imagePath, targetPath]);
      } catch (cleanupError) {
        console.warn('No se pudieron limpiar los archivos de una publicación fallida.', cleanupError);
      }
      const normalized = normalizeNetworkError(error);
      if (normalized === error && !['AUTH_SESSION_EXPIRED', 'UPLOAD_TOO_LARGE', 'INVALID_UPLOAD_BLOB'].includes(error?.code)) {
        logSupabaseError('la publicación del proyecto', error, {
          storyId: id,
          imageSizeBytes: imageFile.size,
          targetSizeBytes: targetFile.size,
        });
      }
      throw normalized;
    }
  }

  async getProject(id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    try {
      const { data, error } = await this.client.from('stories').select('id,title,image_path,target_path,config,created_at').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const publicUrl = (path) => this.client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      return { ...data, imageUrl: publicUrl(data.image_path), targetUrl: publicUrl(data.target_path) };
    } catch (error) { throw normalizeNetworkError(error); }
  }
}

export default ProjectStore;
