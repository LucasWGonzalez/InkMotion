import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('el callback PKCE conserva una sesión ya guardada si el código fue consumido', async () => {
  const store = await readFile(new URL('../public/services/ProjectStore.js', import.meta.url), 'utf8');
  assert.match(store, /exchangeError=error/);
  assert.match(store, /const existingSession=await this\.getSession\(\);if\(existingSession\)return existingSession/);
  assert.match(store, /finally\{if\(code\|\|providerError\)window\.history\.replaceState/);
});

test('los eventos de Auth se difieren y no llaman Supabase dentro del callback', async () => {
  const store = await readFile(new URL('../public/services/ProjectStore.js', import.meta.url), 'utf8');
  assert.match(store, /onAuthStateChange\(\(event,session\)=>\{window\.setTimeout\(\(\)=>callback\(event,session\),0\);\}\)/);
});

test('la UI ignora INITIAL_SESSION y serializa cambios reales de sesión', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(event === 'INITIAL_SESSION'\) return/);
  assert.match(app, /this\.authorSessionSync = this\.authorSessionSync/);
  assert.match(app, /if \(nextUserId === this\.authorSessionUserId\) return/);
});
