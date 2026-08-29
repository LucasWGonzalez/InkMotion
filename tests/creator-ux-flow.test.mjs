import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('una proporción incompatible muestra un error accionable', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(app, /videoValidation\.textContent = ratioResult\.ok \? 'Compatible' : 'No compatible'/);
  assert.match(app, /videoCard\?\.classList\.toggle\('is-incompatible', incompatible\)/);
  assert.match(html, /id="media-compatibility-error"[^>]*role="alert"/);
  assert.match(html, />Cambiar video<\/button>/);
  assert.match(html, /No podés continuar hasta reemplazar el video/);
});

test('la prueba AR orienta a escritorio hacia el celular', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(app, /mobile \? 'Abrir experiencia AR' : 'Probar en un celular'/);
  assert.match(app, /renderStoryQR\(document\.getElementById\('desktop-story-qr'\), publicUrl/);
  assert.match(html, /Escaneá este código con tu celular/);
  assert.match(html, /id="ar-device-help"/);
});

test('el resultado permite crear otra obra sin cerrar sesión', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, />Crear una nueva obra<\/button>/);
  assert.match(html, />Ver Mis trabajos<\/button>/);
  assert.match(app, /resetCreationFlow\(\)/);
  assert.match(app, /this\.pendingProject = null/);
  assert.match(app, /document\.getElementById\('publish-result'\)\.hidden = true/);
  assert.doesNotMatch(app, /resetCreationFlow[\s\S]{0,1800}signOut\(/);
});
