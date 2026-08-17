/**
 * UIController.js
 * Controlador de componentes UI
 */

import EventBus from '../utils/EventBus.js';

class UIController {
  constructor() {
    this.elements = {};
    this.init();
  }

  init() {
    this.cacheElements();
    this.setupEventListeners();
  }

  cacheElements() {
    this.elements = {
      btnUpload: document.getElementById('btn-upload-target'),
      btnReset: document.getElementById('btn-reset-tracking'),
      statusDisplay: document.getElementById('status-display'),
      uiPanel: document.getElementById('ui-panel'),
    };
  }

  setupEventListeners() {
    // Los listeners principales se configuran en app.js
    // Este módulo es extensible para componentes adicionales
  }

  /**
   * Actualiza estado del botón
   */
  setButtonState(buttonId, state) {
    const btn = this.elements[buttonId];
    if (!btn) return;

    if (state === 'loading') {
      btn.classList.add('loading');
      btn.disabled = true;
    } else if (state === 'active') {
      btn.classList.remove('loading');
      btn.disabled = false;
    } else if (state === 'disabled') {
      btn.classList.remove('loading');
      btn.disabled = true;
    }
  }

  /**
   * Muestra notificación temporal
   */
  showNotification(message, duration = 3000) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      font-size: 14px;
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }
}

export default new UIController();
