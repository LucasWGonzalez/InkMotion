import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const drawCalls = [];
const fakeTrack = { stop() {} };
const fakeCanvas = {
  width: 0,
  height: 0,
  getContext: () => ({ drawImage: (...args) => drawCalls.push(args) }),
  captureStream: () => ({ getVideoTracks: () => [fakeTrack] }),
};

class FakeMediaStream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
}

class FakeMediaRecorder {
  static isTypeSupported(type) { return type.startsWith('video/webm'); }
  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || 'video/webm';
    this.state = 'inactive';
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['recording'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

globalThis.window = {
  MediaRecorder: FakeMediaRecorder,
  devicePixelRatio: 2,
  setInterval,
  clearInterval,
};
globalThis.MediaRecorder = FakeMediaRecorder;
globalThis.MediaStream = FakeMediaStream;
globalThis.document = { createElement: () => fakeCanvas };
globalThis.getComputedStyle = () => ({ opacity: '1' });

const { default: ExperienceRecorder } = await import('../public/core/ExperienceRecorder.js');
const { default: EventBus } = await import('../public/utils/EventBus.js');

function createRecorder() {
  return new ExperienceRecorder({
    cameraVideo: { videoWidth: 1280, videoHeight: 720 },
    arCanvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }) },
    animatedVideo: null,
    viewport: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }) },
  });
}

test('la grabación nunca comienza al crear el módulo', () => {
  const recorder = createRecorder();
  assert.equal(recorder.isRecording(), false);
  assert.equal(ExperienceRecorder.isSupported(), true);
});

test('solo comienza al invocar start y finaliza al pulsar stop', async () => {
  const recorder = createRecorder();
  let result = null;
  EventBus.once('recorder:complete', (value) => { result = value; });
  await recorder.start();
  assert.equal(recorder.isRecording(), true);
  assert.equal(recorder.stop(), true);
  assert.equal(recorder.isRecording(), false);
  assert.ok(result.blob.size > 0);
  assert.equal(result.extension, 'webm');
});

test('compone la cámara y la capa AR en el canvas final', () => {
  drawCalls.length = 0;
  createRecorder().drawFrame();
  assert.equal(drawCalls.length, 2);
  assert.equal(fakeCanvas.width, 720);
  assert.equal(fakeCanvas.height, 1280);
});


test('la interfaz diferencia guardar de compartir y usa nombres únicos', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, />Guardar video<\/button>/);
  assert.match(html, /La grabación todavía no está guardada/);
  assert.match(app, /InkMotion_AR_\$\{day\}_\$\{time\}\.\$\{extension\}/);
  assert.match(app, /Descarga iniciada\. Buscá el video en la carpeta Descargas/);
  assert.doesNotMatch(app, /InkMotion_Experiencia_AR\.\$\{extension\}/);
});
