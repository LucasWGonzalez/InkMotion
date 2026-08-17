/**
 * EventBus.js
 * Event emitter simple para comunicación entre módulos
 */

class EventBus {
  constructor() {
    this.events = new Map();
  }

  /**
   * Suscribirse a un evento
   */
  on(eventName, listener) {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, []);
    }
    this.events.get(eventName).push(listener);
  }

  /**
   * Desuscribirse de un evento
   */
  off(eventName, listener) {
    if (!this.events.has(eventName)) return;

    const listeners = this.events.get(eventName);
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * Emitir un evento
   */
  emit(eventName, data = null) {
    if (!this.events.has(eventName)) return;

    this.events.get(eventName).forEach((listener) => {
      listener(data);
    });
  }

  /**
   * Suscribirse una sola vez
   */
  once(eventName, listener) {
    const onceListener = (data) => {
      listener(data);
      this.off(eventName, onceListener);
    };
    this.on(eventName, onceListener);
  }

  /**
   * Limpia todos los eventos
   */
  clear() {
    this.events.clear();
  }
}

export default new EventBus();
