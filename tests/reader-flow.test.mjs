import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('el lector usa la API vigente de ParallaxEngine y MindARManager', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /new ParallaxEngine\(\{ container: '#ar-overlay', contentRect:/);
  assert.match(app, /await this\.parallax\.init\(\)/);
  assert.match(app, /await this\.parallax\.setTargetVideo\(project\.imageUrl, project\.videoUrl\)/);
  assert.match(app, /await this\.mindAR\.init\(\)/);
  assert.match(app, /await this\.mindAR\.setCompiledTarget\(project\.targetUrl\)/);
  assert.doesNotMatch(app, /engine\.load\(/);
  assert.doesNotMatch(app, /manager\.start\(/);
  assert.doesNotMatch(app, /attachToAnchor\(/);
});

test('el lector conecta tracking, proyección y video con el motor visual', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /mindar:target-update[\s\S]*updateWorldAnchor/);
  assert.match(app, /mindar:projection-ready[\s\S]*setProjectionMatrix/);
  assert.match(app, /mindar:target-found[\s\S]*onTargetFound/);
  assert.match(app, /mindar:target-lost[\s\S]*onTargetLost/);
});
