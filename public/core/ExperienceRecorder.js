import EventBus from '../utils/EventBus.js';

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function supportedMimeType() {
  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function outputSize(width, height) {
  const maximum = 1280;
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const nativeWidth = width * pixelRatio;
  const nativeHeight = height * pixelRatio;
  const scale = Math.min(1, maximum / Math.max(nativeWidth, nativeHeight));
  return {
    width: Math.max(2, Math.round(nativeWidth * scale / 2) * 2),
    height: Math.max(2, Math.round(nativeHeight * scale / 2) * 2),
  };
}

export default class ExperienceRecorder {
  constructor({ cameraVideo, arCanvas, animatedVideo, viewport }) {
    this.cameraVideo = cameraVideo;
    this.arCanvas = arCanvas;
    this.animatedVideo = animatedVideo;
    this.viewport = viewport;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { alpha: false });
    this.mediaRecorder = null;
    this.recordingStream = null;
    this.chunks = [];
    this.startedAt = 0;
    this.timer = null;
    this.audioContext = null;
    this.audioSource = null;
    this.speakerGain = null;
    this.audioDestination = null;
    this.soundEnabled = false;
    this.mimeType = supportedMimeType();
  }

  static isSupported() {
    const canvas = document.createElement('canvas');
    return Boolean(window.MediaRecorder && canvas.captureStream && supportedMimeType() !== null);
  }

  isRecording() {
    return this.mediaRecorder?.state === 'recording';
  }

  async prepareAudio() {
    if (!this.animatedVideo) return null;
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      this.audioContext = new AudioContextClass();
      this.audioSource = this.audioContext.createMediaElementSource(this.animatedVideo);
      this.speakerGain = this.audioContext.createGain();
      this.audioDestination = this.audioContext.createMediaStreamDestination();
      this.audioSource.connect(this.speakerGain);
      this.speakerGain.connect(this.audioContext.destination);
      this.audioSource.connect(this.audioDestination);
      this.animatedVideo.muted = false;
      this.speakerGain.gain.value = this.soundEnabled ? 1 : 0;
    }
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    return this.audioDestination?.stream || null;
  }

  async setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    await this.prepareAudio();
    if (this.speakerGain) this.speakerGain.gain.setValueAtTime(this.soundEnabled ? 1 : 0, this.audioContext.currentTime);
    EventBus.emit('recorder:sound', { enabled: this.soundEnabled });
    return this.soundEnabled;
  }

  drawFrame() {
    if (!this.context || !this.cameraVideo?.videoWidth || !this.viewport) return;
    const viewportRect = this.viewport.getBoundingClientRect();
    if (!viewportRect.width || !viewportRect.height) return;
    const size = outputSize(viewportRect.width, viewportRect.height);
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }

    const cameraAspect = this.cameraVideo.videoWidth / this.cameraVideo.videoHeight;
    const viewportAspect = viewportRect.width / viewportRect.height;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = this.cameraVideo.videoWidth;
    let sourceHeight = this.cameraVideo.videoHeight;
    if (cameraAspect > viewportAspect) {
      sourceWidth = sourceHeight * viewportAspect;
      sourceX = (this.cameraVideo.videoWidth - sourceWidth) / 2;
    } else {
      sourceHeight = sourceWidth / viewportAspect;
      sourceY = (this.cameraVideo.videoHeight - sourceHeight) / 2;
    }
    this.context.drawImage(this.cameraVideo, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size.width, size.height);

    if (this.arCanvas && Number.parseFloat(getComputedStyle(this.arCanvas).opacity || '1') > 0.01) {
      const arRect = this.arCanvas.getBoundingClientRect();
      const scaleX = size.width / viewportRect.width;
      const scaleY = size.height / viewportRect.height;
      this.context.drawImage(
        this.arCanvas,
        (arRect.left - viewportRect.left) * scaleX,
        (arRect.top - viewportRect.top) * scaleY,
        arRect.width * scaleX,
        arRect.height * scaleY,
      );
    }
  }

  async start() {
    if (this.mediaRecorder?.state === 'recording') return false;
    if (!ExperienceRecorder.isSupported()) throw new Error('Este navegador no permite grabar la experiencia AR.');
    this.drawFrame();
    const canvasStream = this.canvas.captureStream(30);
    let audioStream = null;
    try { audioStream = await this.prepareAudio(); }
    catch (error) { EventBus.emit('recorder:audio-warning', error); }
    const tracks = [...canvasStream.getVideoTracks(), ...(audioStream?.getAudioTracks() || [])];
    this.recordingStream = new MediaStream(tracks);
    const options = this.mimeType ? { mimeType: this.mimeType, videoBitsPerSecond: 4_000_000 } : { videoBitsPerSecond: 4_000_000 };
    this.mediaRecorder = new MediaRecorder(this.recordingStream, options);
    this.chunks = [];
    this.mediaRecorder.ondataavailable = ({ data }) => { if (data?.size) this.chunks.push(data); };
    this.mediaRecorder.onerror = ({ error }) => EventBus.emit('recorder:error', error || new Error('La grabación fue interrumpida.'));
    this.mediaRecorder.onstop = () => this.finish();
    this.mediaRecorder.start(1000);
    this.startedAt = performance.now();
    this.timer = window.setInterval(() => {
      EventBus.emit('recorder:tick', { seconds: Math.floor((performance.now() - this.startedAt) / 1000) });
    }, 500);
    EventBus.emit('recorder:state', { state: 'recording' });
    return true;
  }

  stop() {
    if (this.mediaRecorder?.state !== 'recording') return false;
    this.mediaRecorder.stop();
    return true;
  }

  finish() {
    window.clearInterval(this.timer);
    this.timer = null;
    const type = this.mediaRecorder?.mimeType || this.mimeType || 'video/webm';
    const blob = new Blob(this.chunks, { type });
    this.recordingStream?.getTracks().forEach((track) => track.stop());
    this.recordingStream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    if (blob.size) EventBus.emit('recorder:complete', { blob, type, extension: type.includes('mp4') ? 'mp4' : 'webm' });
    else EventBus.emit('recorder:error', new Error('El dispositivo no generó datos de la grabación.'));
    EventBus.emit('recorder:state', { state: 'idle' });
  }

  dispose() {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
    window.clearInterval(this.timer);
    this.recordingStream?.getTracks().forEach((track) => track.stop());
    this.speakerGain?.disconnect();
    this.audioSource?.disconnect();
    this.audioContext?.close().catch(() => {});
  }
}
