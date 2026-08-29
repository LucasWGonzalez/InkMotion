import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const htmlPath = new URL('../public/index.html', import.meta.url);
const storePath = new URL('../public/services/ProjectStore.js', import.meta.url);
const routesCssPath = new URL('../public/css/routes.css', import.meta.url);
const sheetGeneratorPath = new URL('../public/core/MasterSheetGenerator.js', import.meta.url);

test('la hoja de prueba conserva el texto y apunta al PDF incluido', async () => {
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, />Descargar imagen de prueba</);
  assert.match(html, /Hacé la prueba en un segundo: Escaneá esta hoja de muestra y probá la magia de la AR al instante\./);
  assert.match(html, /href="\/assets\/InkMotion_Lamina_Prueba\.pdf"/);
  await access(new URL('../public/assets/InkMotion_Lamina_Prueba.pdf', import.meta.url));
  await access(new URL('../public/assets/inkmotion-lamina-prueba-preview.webp', import.meta.url));
  const css = await readFile(routesCssPath, 'utf8');
  assert.doesNotMatch(css, /\.test-sheet-preview[^}]*transform\s*:\s*rotate/, 'la vista previa debe quedar recta');
});

test('Mis trabajos exige filtro de autor y borrado propietario', async () => {
  const source = await readFile(storePath, 'utf8');
  assert.match(source, /async listMyProjects\(\)/);
  assert.match(source, /\.eq\('author_id',\s*session\.user\.id\)/);
  assert.match(source, /async deleteProject\(projectId\)/);
  assert.match(source, /storage\.from\(BUCKET\)\.remove\(paths\)/);
  assert.match(source, /DELETE_CLEANUP_TIMEOUT_MS/);
  const deleteBlock = source.slice(source.indexOf('async deleteProject(projectId)'));
  assert.ok(deleteBlock.indexOf(".delete()") < deleteBlock.indexOf('storage.from(BUCKET).remove(paths)'), 'el registro debe eliminarse antes de limpiar Storage');
  assert.match(deleteBlock, /return\s*\{\s*\.\.\.deleted,\s*cleanupWarning\s*\}/);
});

test('cada trabajo permite regenerar y descargar su Lámina Maestra', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /download\.textContent = 'Descargar lámina'/);
  assert.match(source, /remove\.className = 'btn btn-danger'/);
  assert.match(source, /remove\.textContent = 'Eliminar trabajo'/);
  assert.doesNotMatch(source, /open\.textContent = 'Abrir experiencia'/);
  assert.match(source, /actions\.append\(download, remove\)/);
  assert.match(source, /async downloadProjectSheet\(project, button\)/);
  assert.match(source, /link\.download = 'InkMotion_Lamina_Final\.pdf'/);
});


test('las láminas históricas cargan imágenes remotas con CORS antes de exportar el canvas', async () => {
  const source = await readFile(sheetGeneratorPath, 'utf8');
  const crossOriginIndex = source.indexOf("image.crossOrigin = 'anonymous'");
  const sourceIndex = source.indexOf('image.src = source');
  assert.ok(crossOriginIndex >= 0, 'la imagen remota debe habilitar CORS');
  assert.ok(crossOriginIndex < sourceIndex, 'crossOrigin debe configurarse antes de asignar src');
});
