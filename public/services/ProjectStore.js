import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.102.0';

const SUPABASE_URL = 'https://srcofwiuobmvezkodscg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_agzhvCuMkzw49BFSyxyAsw_znhUaK1T';
const BUCKET = 'stories';

class ProjectStore {
  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  async getSession() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async sendMagicLink(email) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/crear` },
    });
    if (error) throw error;
  }

  onAuthChange(callback) {
    return this.client.auth.onAuthStateChange((_event, session) => callback(session));
  }

  async signOut() { await this.client.auth.signOut(); }

  async saveProject({ title, imageBlob, targetBlob, config }) {
    const session = await this.getSession();
    if (!session) throw new Error('Iniciá sesión para publicar el cuento.');
    const id = crypto.randomUUID();
    const root = `${session.user.id}/${id}`;
    const imagePath = `${root}/cover.jpg`;
    const targetPath = `${root}/target.mind`;
    const upload = async (path, blob, contentType) => {
      const { error } = await this.client.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
      if (error) throw error;
    };
    try {
      await upload(imagePath, imageBlob, 'image/jpeg');
      await upload(targetPath, targetBlob, 'application/octet-stream');
      const { data, error } = await this.client.from('stories').insert({ id, title: title || 'Cuento sin título', image_path: imagePath, target_path: targetPath, config }).select('id').single();
      if (error) throw error;
      return data;
    } catch (error) {
      await this.client.storage.from(BUCKET).remove([imagePath, targetPath]);
      throw error;
    }
  }

  async getProject(id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    const { data, error } = await this.client.from('stories').select('id,title,image_path,target_path,config,created_at').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const publicUrl = (path) => this.client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return { ...data, imageUrl: publicUrl(data.image_path), targetUrl: publicUrl(data.target_path) };
  }
}

export default ProjectStore;
