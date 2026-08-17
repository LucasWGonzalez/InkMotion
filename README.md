# WebAR Storyteller

**WebAR Storyteller** es una plataforma de realidad aumentada web que combina:
- 🎯 **Image Target Tracking** con MindAR
- 🎭 **Motor Parallax 2.5D** basado en CSS transforms y DeviceMotion
- 🖼️ **Procesamiento de imágenes** en cliente con Canvas 2D nativo

## 📁 Estructura del Proyecto

```
webr-storyteller/
├── public/
│   └── index.html              # HTML raíz con CDN MindAR
├── src/
│   ├── core/
│   │   ├── MindARManager.js     # Gestión de tracking AR
│   │   ├── ParallaxEngine.js    # Motor 2.5D CSS
│   │   └── ImageProcessor.js    # Optimización de imágenes
│   ├── ui/
│   │   └── UIController.js      # Componentes de interfaz
│   ├── utils/
│   │   ├── EventBus.js          # Event emitter
│   │   └── DeviceMotionListener.js # Acelerómetro/giroscopio
│   ├── css/
│   │   ├── global.css           # Estilos base
│   │   ├── parallax.css         # Estilos parallax
│   │   └── ui.css               # Estilos de componentes
│   └── app.js                   # Orquestador principal
├── package.json                 # Dependencias
├── server.js                    # Servidor Node.js de desarrollo
└── README.md                    # Este archivo
```

## 🚀 Guía Rápida

### 1. Instalar y Correr

```bash
cd webr-storyteller
npm start
```

Luego abre en tu navegador:
```
http://localhost:8080
```

### 2. Flujo de uso

1. **Abre la aplicación** en dispositivo móvil (requiere HTTPS o localhost)
2. **Sube una imagen target** usando el botón "Subir Imagen Target"
3. **La imagen se procesa** (optimización automática)
4. **Mueve la cámara** para detectar la imagen en el mundo real
5. **Observa el parallax** 3D respondiendo a los movimientos del dispositivo

### 3. Requisitos

- ✅ Navegador moderno (Chrome, Firefox, Safari mobile)
- ✅ Cámara web / frontal del dispositivo
- ✅ Soporte DeviceOrientation (giroscopio)
- ✅ Conexión HTTPS o localhost (requerimiento de cámara)

## 🔧 Componentes Core

### MindARManager
Integración ligera de MindAR en modo image-target.

**Métodos principales:**
- `init()` - Inicializa cámara y tracking
- `addImageTarget(url)` - Agrega nuevo target
- `getTrackedTargets()` - Obtiene targets actuales
- `stop()` - Detiene tracking

**Eventos emitidos:**
- `mindar:initialized`
- `mindar:camera-ready`
- `mindar:target-detected`
- `mindar:target-lost`

### ParallaxEngine
Motor 2.5D sin WebGL que usa CSS transforms y DeviceMotion.

**Métodos principales:**
- `init()` - Inicializa motor
- `createLayer(config)` - Crea capa parallax
- `updateLayerDepth(id, depth)` - Ajusta profundidad
- `animateToTarget(position, duration)` - Anima a posición

**Características:**
- Perspectiva CSS 3D
- Tracking de DeviceOrientation
- Animaciones suaves con easing

### ImageProcessor
Procesa y optimiza imágenes en cliente.

**Métodos principales:**
- `processImageFile(file)` - Procesa archivo
- `validateFile(file)` - Valida formato y tamaño
- `resizeImage(img)` - Redimensiona automáticamente
- `optimizeImage(canvas)` - Comprime con Canvas

**Características:**
- Validación de formato (JPEG, PNG, WebP)
- Redimensionamiento automático
- Compresión automática con Canvas 2D
- Reducción de ruido

## 📱 Configuración por Dispositivo

### iOS (Safari)
Requiere solicitar permisos de cámara y orientación.

```javascript
// En DeviceOrientationEvent.requestPermission()
// Solicita permiso explícitamente
```

### Android (Chrome)
Soportado nativamente, requiere HTTPS o localhost.

## 🎨 Personalización

### Ajustar sensibilidad parallax

En `src/app.js`:
```javascript
this.parallax = new ParallaxEngine({
  depthScale: 0.05,              // Escala de profundidad
  rotationSensitivity: 0.8,      // Sensibilidad giroscopio
  baseZoom: 1,                   // Zoom inicial
});
```

### Cambiar targets iniciales

En `src/app.js` método `createDemoLayers()`:
```javascript
this.parallax.createLayer({
  id: 'layer-custom',
  depth: 0.5,                    // 0-1 (lejano-cercano)
  scale: 0.8,
  content: `<div>...</div>`,
});
```

## 📊 Debug

Abre la consola del navegador (F12) para ver logs:

```
🚀 Inicializando WebAR Storyteller...
--- INICIALIZANDO MÓDULOS CORE ---
✅ ImageProcessor inicializado
✅ ParallaxEngine inicializado
✅ MindARManager inicializado
```

## ⚠️ Limitaciones Actuales

- Single image target por vez (configurable en MindARManager)
- Parallax basado en CSS (no soporta texturas complejas)
- Requisito de permisos de cámara explícitos
- Mejor rendimiento en dispositivos con GPU

## 🔮 Próximos Pasos

- [ ] Múltiples targets simultáneos
- [ ] Animaciones basadas en tracking
- [ ] Capas con contenido HTML/Canvas
- [ ] Estadísticas de performance
- [ ] Integración con WASM para procesamiento más rápido

## 📝 Licencia

MIT

---

**Construido con:**
- MindAR SDK
- CSS 3D Transforms
- Canvas 2D nativo
- DeviceOrientation API
- Vanilla JavaScript (ES6 Modules)
