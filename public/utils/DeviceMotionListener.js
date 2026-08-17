class DeviceMotionListener {
  constructor() {
    this.orientation = { alpha: 0, beta: 0, gamma: 0 };
    this.baseline = null;
    this.isSupported = typeof window.DeviceOrientationEvent !== 'undefined';
    this.isListening = false;
    this.hasReading = false;
    this.boundHandler = this.handleOrientation.bind(this);
  }

  async init({ requestPermission = false } = {}) {
    if (!this.isSupported) return false;
    const permissionApi = window.DeviceOrientationEvent?.requestPermission;
    if (typeof permissionApi === 'function') {
      if (!requestPermission) return false;
      const permission = await permissionApi.call(window.DeviceOrientationEvent);
      if (permission !== 'granted') return false;
    }
    if (!this.isListening) {
      window.addEventListener('deviceorientation', this.boundHandler, { passive: true });
      this.isListening = true;
    }
    return true;
  }

  handleOrientation(event) {
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    this.orientation = {
      alpha: Number.isFinite(event.alpha) ? event.alpha : 0,
      beta: event.beta,
      gamma: event.gamma,
    };
    this.hasReading = true;
    if (!this.baseline) this.baseline = { ...this.orientation };
  }

  getTilt() {
    if (!this.baseline) return { beta: 0, gamma: 0 };
    return {
      beta: this.orientation.beta - this.baseline.beta,
      gamma: this.orientation.gamma - this.baseline.gamma,
    };
  }

  recalibrate() {
    this.baseline = this.hasReading ? { ...this.orientation } : null;
  }

  stop() {
    window.removeEventListener('deviceorientation', this.boundHandler);
    this.isListening = false;
  }
}

export default DeviceMotionListener;
