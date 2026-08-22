import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const htmlPath = new URL('../public/index.html', import.meta.url);
const storePath = new URL('../public/services/ProjectStore.js', import.meta.url);

test('la hoja de prueba conserva el texto y apunta al PDF incluido', async () => {
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, />Descargar imagen de prueba</);
  assert.match(html, /Hacé la prueba en un segundo: Escaneá esta hoja de muestra y probá la magia de la AR al instante\./);
  assert.match(html, /href="\/assets\/InkMotion_Lamina_Prueba\.pdf"/);
  await access(new URL('../public/assets/InkMotion_Lamina_Prueba.pdf', import.meta.url));
  await access(new URL('../public/assets/inkmotion-lamina-prueba-preview.webp', import.meta.url));
});

test('Mis trabajos exige filtro de autor y borrado propietario', async () => {
  const source = await readFile(storePath, 'utf8');
  assert.match(source, /async listMyProjects\(\)/);
  assert.match(source, /\.eq\('author_id', session\.user\.id\)/);
  assert.match(source, /async deleteProject\(projectId\)/);
  assert.match(source, /storage\.from\(BUCKET\)\.remove\(paths\)/);
});

test('cada trabajo permite regenerar y descargar su Lámina Maestra', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /download\.textContent = 'Descargar lámina'/);
  assert.match(source, /async downloadProjectSheet\(project, button\)/);
  assert.match(source, /link\.download = 'InkMotion_Lamina_Final\.pdf'/);
});
