# 🏗️ WebAR Storyteller - Arquitectura Técnica

## 📐 Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                        APP.JS (Orquestador)                      │
│                  Coordina inicialización y eventos               │
└────────────┬──────────────────────────────────────────────────┬──┘
             │                                                   │
    ┌────────▼──────────┐                        ┌──────────────▼────┐
    │  MindARManager    │                        │  ParallaxEngine    │
    │  (Tracking AR)    │                        │  (3D Visual)       │
    ├──────────────────┤                        ├──────────────────┤
    │ - init()         │                        │ - init()         │
    │ - startCamera()  │                        │ - createLayer()  │
    │ - addTarget()    │ ◄─────────────────────► │ - animateTo...() │
    │ - getTracked()   │      Events            │ - updateDepth()  │
    │ - reset()        │      (EventBus)        │                  │
    └──────────────────┘                        └────────────────┬──┘
             ▲                                                   │
             │                                          ┌────────▼───────┐
             │                                          │ DeviceMotion   │
             │                                          │ Listener       │
             │                                          ├────────────────┤
             │                                          │ - getOrient()  │
             │                                          │ - normalize()  │
             │                                          └────────────────┘
             │
    ┌────────┴──────────┐
    │ ImageProcessor    │
    │ (Image Handler)   │
    ├──────────────────┤
    │ - processFile()  │
    │ - validate()     │
    │ - resize()       │
    │ - optimize()     │
    │ - emitAsTarget() │
    └──────────────────┘
             ▲
             │ Emits
    ┌────────┴──────────────────┐
    │      EventBus             │
    │  (Pub/Sub Pattern)        │
    ├───────────────────────────┤
    │ Events:                   │
    │ - mindar:initialized      │
    │ - mindar:camera-ready     │
    │ - mindar:target-detected  │
    │ - mindar:target-lost      │
    │ - parallax:initialized    │
    │ - image-processor:*       │
    └───────────────────────────┘
```

## 🔄 Flujo de Inicialización

```
1. HTML carga (index.html)
   ├─ Carga MindAR SDK (CDN)
   ├─ Carga CSS
   └─ Carga scripts modulares

2. app.js se ejecuta
   ├─ Espera DOMContentLoaded
   └─ Inicia initializeApp()

3. initializeCore()
   ├─ Crea ImageProcessor
   ├─ Inicializa ParallaxEngine
   │  ├─ Crea capas demo
   │  └─ Inicia DeviceMotionListener
   └─ Inicializa MindARManager
      ├─ Espera MindAR SDK (con timeout)
      ├─ Si disponible: inicia tracking
      └─ Si no: modo demo (solo cámara)

4. setupEventListeners()
   └─ Conecta módulos vía EventBus

5. setupUI()
   ├─ Botón upload → ImageProcessor
   └─ Botón reset → MindARManager.reset()

6. Estado: Listo para usar ✅
```

## 📡 Flujo de Datos (Image Upload → AR)

```
Usuario sube imagen
        │
        ▼
┌─────────────────────────────────┐
│   HTML File Input               │
│   (handleImageUpload)           │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│   ImageProcessor.processImageFile()
│   ├─ validateFile()             │
│   ├─ loadImage()                │
│   ├─ resizeImage()              │
│   ├─ denoise()                  │
│   └─ optimizeImage()            │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│   Emit: image-processor:processed
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│   app.js escucha evento          │
│   emitAsTarget('nombre')        │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│   Emit: image-processor:target-ready
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│   MindARManager.addImageTarget() │
│   └─ controller.addImageTarget() │
└────────────┬────────────────────┘
             │
             ▼
      Sistema listo para trackear
      la imagen cargada
```

## 🎯 Flujo de Tracking (AR Detection)

```
Video stream activo (30-60 FPS)
        │
        ▼
┌─────────────────────────────────────┐
│   MindARManager.startTracking()      │
│   ├─ controller.process(video)      │
│   └─ handleTrackingResult()         │
└────────────┬────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
Target      Target
Detected    Lost
    │          │
    ▼          ▼
Emit:       Emit:
target-     target-
detected    lost
    │          │
    └────┬─────┘
         │
         ▼
┌──────────────────────────────────┐
│  app.handleTargetDetected()      │
│  ├─ extractPosition(matrix)      │
│  └─ parallax.animateToTarget()   │
└────────────┬─────────────────────┘
             │
             ▼
    ParallaxEngine actualiza
    rotación y posición de capas
```

## 🎭 Flujo de Parallax (3D Rendering)

```
DeviceMotionListener.getOrientation()
        │
        │ beta, gamma (inclinación del dispositivo)
        │
        ▼
┌───────────────────────────────────────┐
│  ParallaxEngine.startMotionTracking()  │
│  requestAnimationFrame loop (60 FPS)   │
└────────────┬────────────────────────────┘
             │
             ▼
┌───────────────────────────────────────┐
│  updateLayerTransform(rotX, rotY)     │
│  para cada capa:                       │
│  ├─ Calcular profundidad (zOffset)    │
│  ├─ Calcular escala                   │
│  └─ Aplicar transform:                │
│     perspective(1000px)               │
│     rotateX(rotX * depth)             │
│     rotateY(rotY * depth)             │
│     scale(scale * depth)              │
│     translateZ(zOffset)               │
└────────────┬────────────────────────────┘
             │
             ▼
    CSS apply transform a elemento
             │
             ▼
    Browser renderiza 3D con GPU
             │
             ▼
    Usuario ve parallax 2.5D
```

## 🏗️ Estructura de Archivos Detallada

### `public/`
Archivos servidos por el servidor.

```
public/
├── index.html                    # Punto de entrada HTML
├── app.js                        # Orquestador principal
│
├── core/                         # Módulos core del sistema
│   ├── MindARManager.js         # Maneja detección AR y tracking
│   ├── ParallaxEngine.js        # Motor 2.5D con CSS 3D
│   └── ImageProcessor.js        # Procesa imágenes en cliente
│
├── ui/                          # Componentes de interfaz
│   └── UIController.js          # Gestión de UI
│
├── utils/                       # Utilidades
│   ├── EventBus.js             # Pub/Sub para comunicación entre módulos
│   └── DeviceMotionListener.js # Captura acelerómetro/giroscopio
│
└── css/                         # Estilos
    ├── global.css              # Reset y estilos base
    ├── parallax.css            # Estilos de capas parallax
    └── ui.css                  # Estilos de componentes UI
```

## 📦 Dependencias

### Externas (CDN)
- **MindAR**: `https://cdn.jsdelivr.net/npm/mind-ar@1.2.2/dist/mindar-image.prod.js`
  - Permite image-target tracking
  - Alternativa: Colocar localmente

### Internas (Vanilla JS)
- Sin dependencias externas de JavaScript
- Todo es Vanilla JS con ES6 Modules
- CSS nativo (sin preprocesadores)

## 🎯 Puntos de Extensión

### 1. Agregar Nuevos Targets
```javascript
// En app.js o desde cualquier módulo
imageProcessor.processImageFile(file);
// Automáticamente se agrega al MindARManager
```

### 2. Agregar Nuevas Capas Parallax
```javascript
app.parallax.createLayer({
  id: 'mi-capa',
  depth: 0.6,
  content: '<p>Contenido</p>'
});
```

### 3. Escuchar Eventos
```javascript
EventBus.on('mindar:target-detected', (data) => {
  console.log('Target detectado:', data);
});
```

### 4. Agregar Nuevos Componentes UI
Extender `UIController.js` con nuevos métodos.

## ⚡ Optimizaciones Implementadas

### Performance
- ✅ CSS transforms en lugar de DOM manipulation
- ✅ `will-change` en capas parallax
- ✅ `requestAnimationFrame` para tracking
- ✅ Canvas 2D nativo para procesamiento de imágenes

### Tamaño
- ✅ Sin frameworks pesados (no React, Vue, Angular)
- ✅ Sin librerías 3D (no Three.js, Babylon.js)
- ✅ Vanilla JS puro (ES6 Modules)

### Compatibilidad
- ✅ Funciona sin MindAR (modo demo)
- ✅ Fallback graceful para cámara
- ✅ Soporta Android + iOS

## 🔐 Consideraciones de Seguridad

### HTTPS/Localhost
- ✅ Cámara requiere contexto seguro (HTTPS o localhost)
- ✅ DeviceOrientationEvent funciona en HTTP solo en localhost

### Canvas
- ✅ Procesamiento de imagen en cliente (sin servidor)
- ✅ No se envía imagen completa a servidor

### Permisos
- ✅ Usuario solicita permiso de cámara explícitamente
- ✅ Usuario solicita permiso de orientación (iOS)

## 📊 Métricas

### Tamaño de Proyecto
- HTML: ~2KB
- CSS: ~4KB
- JavaScript (core): ~30KB (sin minificar)
- **Total sin dependencias: ~36KB**

### Rendimiento
- Inicialización: ~2-3 segundos
- Tracking: 30-60 FPS (depende del dispositivo)
- Parallax: 60 FPS (depende de GPU)

---

**Última actualización: 2026-08-17**
