import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('la publicación envía a Supabase el Blob exportado por MindAR', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const compiledTarget = await manager\.compileTarget\(sheet\.imageUrl\)/);
  assert.match(app, /const \{ blob: targetBlob, featureCount, visualQuality, rating \} = compiledTarget/);
  assert.match(app, /targetBlob, config:/);
});

test('la calidad se obtiene de la imagen cargada por el compilador, no de una URL', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const manager = await readFile(new URL('../public/core/MindARManager.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /measureVisualQuality\(sheet\.imageUrl\)/);
  assert.match(manager, /const visualQuality = this\.measureVisualQuality\(image\)/);
  assert.match(manager, /visualQuality,\s+rating:/);
});

test('un fallo de publicación conserva el error visible y permite reintentar', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /publishButton\.textContent = 'Crear obra aumentada';\s+publishButton\.disabled = false;/);
});

test('el resultado final usa el JPEG generado sin volver a ejecutar drawImage', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /this\.showPublishResult\(id, publicUrl, sheet\.jpegDataUrl\)/);
  assert.doesNotMatch(app, /drawImage\(sheetCanvas/);
});
