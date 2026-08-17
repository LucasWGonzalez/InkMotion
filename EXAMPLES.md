# 💡 WebAR Storyteller - Ejemplos de Uso

## Ejemplo 1: Crear Capas Parallax Personalizadas

Edita `public/app.js`, método `createDemoLayers()`:

### Con imagen de fondo
```javascript
this.parallax.createLayer({
  id: 'layer-hero',
  depth: 0.3,
  scale: 1,
  className: 'hero-layer',
  content: `
    <img src="data:image/svg+xml,..." 
         style="width: 100%; height: 100%; object-fit: cover;" />
  `,
});

// En public/css/parallax.css
#layer-hero img {
  border-radius: 20px;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6);
}
```

### Con contenido HTML
```javascript
this.parallax.createLayer({
  id: 'layer-title',
  depth: 0.7,
  scale: 0.8,
  content: `
    <div style="
      width: 100%; height: 100%;
      display: flex; flex-direction: column;
      justify-content: center; align-items: center;
      background: rgba(255, 255, 255, 0.95);
      border-radius: 15px;
      padding: 20px;
      text-align: center;
    ">
      <h2 style="margin: 0 0 10px 0;">Mi Historia AR</h2>
      <p style="margin: 0; font-size: 14px; color: #666;">
        Interactúa para descubrir
      </p>
    </div>
  `,
});
```

### Con animación CSS
```javascript
this.parallax.createLayer({
  id: 'layer-animated',
  depth: 0.9,
  scale: 0.6,
  className: 'animated-layer',
  content: `
    <div style="
      width: 100%; height: 100%;
      background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%;
    ">
      <span style="font-size: 40px; animation: bounce 1s infinite;">⭐</span>
    </div>
  `,
});

// En public/css/parallax.css
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

#layer-animated span {
  display: inline-block;
  animation: bounce 1s infinite;
}
```

## Ejemplo 2: Integrar Contenido Multimedia

### Con Video
```javascript
this.parallax.createLayer({
  id: 'layer-video',
  depth: 0.5,
  scale: 0.9,
  content: `
    <video style="
      width: 100%; height: 100%;
      object-fit: cover; border-radius: 15px;
    "
      autoplay muted loop playsinline>
      <source src="video.mp4" type="video/mp4">
    </video>
  `,
});
```

### Con Canvas Drawing
```javascript
this.parallax.createLayer({
  id: 'layer-canvas',
  depth: 0.6,
  scale: 0.8,
  content: '<canvas id="my-canvas" style="width:100%; height:100%;"></canvas>',
});

// Dibujar en el canvas
setTimeout(() => {
  const canvas = document.getElementById('my-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 200;
  canvas.height = 200;
  
  ctx.fillStyle = '#ff6b6b';
  ctx.beginPath();
  ctx.arc(100, 100, 80, 0, Math.PI * 2);
  ctx.fill();
}, 100);
```

## Ejemplo 3: Cambiar Comportamiento de Parallax

Edita `public/app.js`, método `initializeCore()`:

### Mayor sensibilidad
```javascript
this.parallax = new ParallaxEngine({
  depthScale: 0.10,           // Aumentado de 0.05
  rotationSensitivity: 1.2,   // Aumentado de 0.8
  enableDeviceMotion: true,
});
```

### Desactivar motion tracking
```javascript
this.parallax = new ParallaxEngine({
  enableDeviceMotion: false,  // Desactivado
  depthScale: 0.05,
});
// Ahora solo responde a posición AR, no al giroscopio
```

### Cambiar escala base
```javascript
this.parallax = new ParallaxEngine({
  baseZoom: 1.5,              // Zoom inicial 150%
  depthScale: 0.05,
  rotationSensitivity: 0.8,
});
```

## Ejemplo 4: Personalizar Procesamiento de Imágenes

Edita `public/app.js`, método `initializeCore()`:

```javascript
this.imageProcessor = new ImageProcessor({
  maxFileSize: 5 * 1024 * 1024,    // 5MB (antes: 2MB)
  targetQuality: 0.92,              // Mejor calidad
  minWidth: 400,                    // Mínimo más grande
  minHeight: 400,
  maxWidth: 2560,
  maxHeight: 2560,
  supportedFormats: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif'                    // Agregar formato AVIF
  ],
});
```

## Ejemplo 5: Escuchar y Reaccionar a Eventos

Agrega en `public/app.js`, método `setupEventListeners()`:

### Al detectar target
```javascript
EventBus.on('mindar:target-detected', (data) => {
  console.log('🎯 Target detectado:', data.index);
  
  // Reproducir sonido
  const audio = new Audio('target-found.mp3');
  audio.play();
  
  // Cambiar color de capa
  const layer = this.parallax.getLayer('layer-title');
  if (layer) {
    layer.element.style.opacity = '1';
  }
  
  // Actualizar UI
  this.updateStatus('✨ Target encontrado!');
});
```

### Cuando se pierde target
```javascript
EventBus.on('mindar:target-lost', (data) => {
  console.log('❌ Target perdido:', data.index);
  
  // Fade out de capa
  const layer = this.parallax.getLayer('layer-title');
  if (layer) {
    layer.element.style.opacity = '0.5';
  }
  
  // Resetear posición
  this.parallax.animateRotation(0, 0, 300);
});
```

### Imagen procesada
```javascript
EventBus.on('image-processor:processed', (processed) => {
  console.log('📸 Imagen procesada');
  console.log('  - Tamaño original:', processed.originalSize);
  console.log('  - Tamaño optimizado:', processed.optimizedSize);
  console.log('  - Ahorro:', 
    ((1 - processed.optimizedSize/processed.originalSize) * 100).toFixed(0) + '%'
  );
});
```

## Ejemplo 6: Crear Múltiples Targets (Avanzado)

```javascript
// En app.js, agregar método
async loadMultipleTargets() {
  const targets = [
    { name: 'target1', url: 'image1.jpg' },
    { name: 'target2', url: 'image2.jpg' },
    { name: 'target3', url: 'image3.jpg' },
  ];

  for (const target of targets) {
    try {
      // Cargar imagen
      const response = await fetch(target.url);
      const blob = await response.blob();
      const file = new File([blob], target.name, { type: 'image/jpeg' });
      
      // Procesar
      const processed = await this.imageProcessor.processImageFile(
        file,
        target.name
      );
      
      // Agregar al tracking
      this.imageProcessor.emitAsTarget(target.name);
    } catch (error) {
      console.error(`Error cargando ${target.name}:`, error);
    }
  }
}

// Llamar en initializeCore()
// await this.loadMultipleTargets();
```

## Ejemplo 7: Animar Parallax Programáticamente

```javascript
// En app.js
animateParallaxSequence() {
  // Secuencia de animaciones
  const rotations = [
    { x: 15, y: -15, duration: 500 },
    { x: -15, y: 15, duration: 500 },
    { x: 0, y: 0, duration: 300 },
  ];
  
  let delay = 0;
  rotations.forEach((rotation) => {
    setTimeout(() => {
      this.parallax.animateRotation(
        rotation.x,
        rotation.y,
        rotation.duration
      );
    }, delay);
    delay += rotation.duration + 100;
  });
}

// Llamar desde UI
document.getElementById('btn-animate').addEventListener('click', () => {
  this.animateParallaxSequence();
});
```

## Ejemplo 8: Tema Oscuro/Claro

Edita `public/css/global.css`:

```css
/* Agregar variable CSS */
:root {
  --bg-color: #fff;
  --text-color: #000;
  --panel-bg: rgba(0, 0, 0, 0.1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-color: #000;
    --text-color: #fff;
    --panel-bg: rgba(255, 255, 255, 0.1);
  }
}

body {
  background: var(--bg-color);
  color: var(--text-color);
}

#ui-panel {
  background: var(--panel-bg);
}
```

## Ejemplo 9: Estadísticas en Tiempo Real

```javascript
// En app.js
setupPerformanceMonitor() {
  const stats = {
    fps: 0,
    targets: 0,
    layers: 0,
  };
  
  let frameCount = 0;
  let lastTime = Date.now();
  
  const monitor = setInterval(() => {
    const now = Date.now();
    const delta = now - lastTime;
    
    if (delta >= 1000) {
      stats.fps = frameCount;
      stats.targets = this.mindAR.getTrackedTargets().length;
      stats.layers = this.parallax.layers.size;
      
      console.log('📊 Stats:', stats);
      frameCount = 0;
      lastTime = now;
    }
    
    frameCount++;
  }, 16); // ~60fps
  
  return monitor;
}
```

## Ejemplo 10: Exportar/Guardar Estado

```javascript
// En app.js
exportState() {
  const state = {
    layers: Array.from(this.parallax.layers.entries()).map(([id, data]) => ({
      id,
      depth: data.depth,
      opacity: data.opacity,
    })),
    targets: this.mindAR.getTrackedTargets(),
    timestamp: new Date().toISOString(),
  };
  
  // Descargar como JSON
  const blob = new Blob([JSON.stringify(state, null, 2)], 
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ar-state-${Date.now()}.json`;
  a.click();
}
```

## Ejemplo 11: Control Touch

```javascript
// En public/app.js, agregar en setupUI()
setupTouchControls() {
  let touchStartX = 0;
  let touchStartY = 0;
  
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  });
  
  document.addEventListener('touchmove', (e) => {
    const deltaX = e.touches[0].clientX - touchStartX;
    const deltaY = e.touches[0].clientY - touchStartY;
    
    // Convertir touch a rotación
    const rotX = (deltaY / window.innerHeight) * 30;
    const rotY = (deltaX / window.innerWidth) * 30;
    
    this.parallax.animateRotation(rotX, rotY, 50);
  });
}

// Llamar en initializeApp()
// this.setupTouchControls();
```

---

**¡Explora y personaliza según tus necesidades! 🚀**
