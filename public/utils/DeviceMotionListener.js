/**
 * DeviceMotionListener.js
 * Captura acelerómetro y giroscopio del dispositivo
 * Proporciona orientación para parallax 2.5D
 */

class DeviceMotionListener {
  constructor() {
    this.orientation = {
      alpha: 0, // Z axis (0-360)
      beta: 0,  // X axis (-180 to 180)
      gamma: 0, // Y axis (-90 to 90)
    };

    this.isSupported = false;
    this.isListening = false;
  }

  /**
   * Inicializa el listener
   */
  async init() {
    try {
      console.log('📱 Inicializando DeviceMotionListener...');

      // Verificar soporte
      this.isSupported =
        typeof window.DeviceOrientationEvent !== 'undefined' ||
        typeof window.DeviceMotionEvent !== 'undefined';

      if (!this.isSupported) {
        console.warn('⚠️  DeviceOrientation no soportado en este dispositivo');
        return false;
      }

      // Verificar permisos (iOS 13+)
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        try {
          const permission = await DeviceOrientationEvent.requestPermission();
          if (permission !== 'granted') {
            console.warn('⚠️  Permiso de orientación denegado');
            return false;
          }
        } catch (error) {
          console.warn('⚠️  Error solicitando permiso:', error);
        }
      }

      this.attachListeners();
      console.log('✅ DeviceMotionListener inicializado');
      return true;
    } catch (error) {
      console.error('❌ Error en DeviceMotionListener init:', error);
      return false;
    }
  }

  /**
   * Adjunta listeners de eventos
   */
  attachListeners() {
    window.addEventListener('deviceorientation', (event) => {
      this.orientation = {
        alpha: event.alpha || 0,
        beta: event.beta || 0,
        gamma: event.gamma || 0,
      };
    });

    this.isListening = true;
  }

  /**
   * Obtiene orientación actual
   */
  getOrientation() {
    return { ...this.orientation };
  }

  /**
   * Obtiene ángulo normalizado (-1 a 1)
   */
  getNormalizedOrientation() {
    return {
      alpha: this.normalize(this.orientation.alpha, 0, 360),
      beta: this.normalize(this.orientation.beta, -180, 180),
      gamma: this.normalize(this.orientation.gamma, -90, 90),
    };
  }

  /**
   * Normaliza valor a rango -1 a 1
   */
  normalize(value, min, max) {
    return ((value - min) / (max - min)) * 2 - 1;
  }

  /**
   * Detiene listeners
   */
  stop() {
    this.isListening = false;
  }
}

export default DeviceMotionListener;
