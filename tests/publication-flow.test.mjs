import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('la publicación envía a Supabase el Blob exportado por MindAR', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const \{ blob: targetBlob \} = await manager\.compileTarget\(sheet\.imageUrl\)/);
  assert.match(app, /targetBlob, config:/);
});

test('un fallo de publicación conserva el error visible y permite reintentar', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /publishButton\.textContent = 'Crear obra aumentada';\s+publishButton\.disabled = false;/);
});
