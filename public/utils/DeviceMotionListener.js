class DeviceMotionListener {
  constructor() {
    this.orientation = { alpha: 0, beta: 0, gamma: 0 };
    this.isSupported = typeof window.DeviceOrientationEvent !== 'undefined';
    this.isListening = false;
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
    this.orientation = {
      alpha: Number.isFinite(event.alpha) ? event.alpha : 0,
      beta: Number.isFinite(event.beta) ? event.beta : 0,
      gamma: Number.isFinite(event.gamma) ? event.gamma : 0,
    };
  }

  getOrientation() { return { ...this.orientation }; }
  stop() {
    window.removeEventListener('deviceorientation', this.boundHandler);
    this.isListening = false;
  }
}

export default DeviceMotionListener;
