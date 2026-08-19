import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.102.0';

const SUPABASE_URL = 'https://srcofwiuobmvezkodscg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_agzhvCuMkzw49BFSyxyAsw_znhUaK1T';
const BUCKET = 'stories';
const NETWORK_ERROR_MESSAGE = 'Error de conexión con el motor o Supabase. Verifica tu red o el tamaño de la imagen.';

function normalizeNetworkError(error) {
  const message = `${error?.message || error || ''}`;
  if (!/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message)) return error;
  const friendly = new Error(NETWORK_ERROR_MESSAGE, { cause: error });
  friendly.code = 'NETWORK_ERROR';
  return friendly;
}

class ProjectStore {
  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  async getSession() {
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      return data.session;
    } catch (error) { throw normalizeNetworkError(error); }
  }

  async sendMagicLink(email) {
    try {
      const { error } = await this.client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/crear` },
      });
      if (error) throw error;
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

  async saveProject({ title, imageBlob, targetBlob, config }) {
    const session = await this.getSession();
    if (!session) throw new Error('Iniciá sesión para publicar el cuento.');
    const id = crypto.randomUUID();
    const root = `${session.user.id}/${id}`;
    const imagePath = `${root}/cover.jpg`;
    const targetPath = `${root}/target.mind`;
    const upload = async (path, blob, contentType) => {
      try {
        const { error } = await this.client.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
        if (error) throw error;
      } catch (error) { throw normalizeNetworkError(error); }
    };
    try {
      await upload(imagePath, imageBlob, 'image/jpeg');
      await upload(targetPath, targetBlob, 'application/octet-stream');
      const { data, error } = await this.client.from('stories').insert({ id, title: title || 'Cuento sin título', image_path: imagePath, target_path: targetPath, config }).select('id').single();
      if (error) throw error;
      return data;
    } catch (error) {
      try {
        await this.client.storage.from(BUCKET).remove([imagePath, targetPath]);
      } catch (cleanupError) {
        console.warn('No se pudieron limpiar los archivos de una publicación fallida.', cleanupError);
      }
      throw normalizeNetworkError(error);
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
