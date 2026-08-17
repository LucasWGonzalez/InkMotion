# 🚀 WebAR Storyteller - Guía Rápida

## ⚡ Inicio Rápido (5 minutos)

### 1. Instalar y ejecutar
```bash
cd /home/akagrumpy/Escritorio/CoderCup/webr-storyteller
npm start
```

Luego abre:
```
http://localhost:8080
```

### 2. Probar en tu dispositivo móvil

**En la misma red:**
```bash
# Obtén tu IP local
hostname -I
# Luego abre en móvil: http://<tu-ip>:8080
```

**Requisitos:**
- 📱 Dispositivo con cámara
- 🔌 Conexión a la misma red
- 🌐 Navegador moderno (Chrome, Firefox, Safari)

### 3. Flujo de prueba

1. Abre la aplicación
2. Haz clic en **"Subir Imagen Target"**
3. Selecciona una imagen (JPG, PNG, WebP)
   - Tamaño recomendado: 200x200 a 1920x1920px
   - Archivo máximo: 2MB
4. La imagen se procesa automáticamente
5. Observa cómo el parallax 3D responde a los movimientos del dispositivo

## 📁 Estructura del Proyecto

```
webr-storyteller/
├── public/              # Archivos servidos por el servidor
│   ├── index.html       # HTML raíz
│   ├── app.js           # Orquestador principal
│   ├── core/            # Módulos core
│   │   ├── MindARManager.js
│   │   ├── ParallaxEngine.js
│   │   └── ImageProcessor.js
│   ├── ui/              # Componentes UI
│   ├── utils/           # Utilidades (EventBus, DeviceMotion)
│   └── css/             # Estilos (global, parallax, ui)
├── package.json
├── server.js            # Servidor Node.js
└── README.md
```

## 🎯 Módulos Principales

### **MindARManager** (`core/MindARManager.js`)
Maneja detección de imágenes target con MindAR.

```javascript
// Agregar un nuevo target
mindAR.addImageTarget({
  url: 'data:image/jpeg;base64,...',
  name: 'mi-target'
});

// Obtener targets detectados
const tracked = mindAR.getTrackedTargets();
```

**Eventos disponibles:**
- `mindar:initialized` - MindAR listo
- `mindar:camera-ready` - Cámara disponible
- `mindar:target-detected` - Target encontrado
- `mindar:target-lost` - Target perdido

### **ParallaxEngine** (`core/ParallaxEngine.js`)
Motor 2.5D CSS sin WebGL que responde a giroscopio.

```javascript
// Crear una capa parallax
parallax.createLayer({
  id: 'mi-capa',
  depth: 0.5,        // 0-1 (lejano-cercano)
  scale: 1,
  content: '<div>Contenido</div>'
});

// Animar a posición AR
parallax.animateToTarget({ x: 0.5, y: 0.5 }, 300);
```

### **ImageProcessor** (`core/ImageProcessor.js`)
Procesa y optimiza imágenes en cliente.

```javascript
// Procesar archivo
const processed = await processor.processImageFile(file);
// → { name, url, dimensions, optimizedSize }

// Emitir como target AR
processor.emitAsTarget('nombre-imagen');
```

## 🔧 Configuración

### Cambiar sensibilidad parallax

En `public/app.js` línea ~70:

```javascript
this.parallax = new ParallaxEngine({
  depthScale: 0.05,              // Escala: 0-1
  rotationSensitivity: 0.8,      // Sensibilidad giroscopio
  enableDeviceMotion: true,      // Activar DeviceMotion
});
```

### Ajustar capas demo

En `public/app.js` método `createDemoLayers()`:

```javascript
this.parallax.createLayer({
  id: 'layer-custom',
  depth: 0.6,                    // Profundidad
  scale: 0.9,                    // Escala
  className: 'mi-clase',
  content: `<img src="..." />`   // HTML/contenido
});
```

## 📊 Debug y Desarrollo

### Ver logs
```
Abre F12 → Consola
```

Verás información de inicialización:
```
🚀 Inicializando WebAR Storyteller...
--- INICIALIZANDO MÓDULOS CORE ---
✅ ImageProcessor inicializado
✅ ParallaxEngine inicializado
✅ MindARManager inicializado
--- CONFIGURANDO EVENTOS ---
--- INICIALIZANDO UI ---
✅ WebAR Storyteller listo
```

### Monitorear tracking
```javascript
// En consola del navegador
app.mindAR.getTrackedTargets()
// → Array de targets activos
```

### Probar parallax sin AR
```javascript
app.parallax.animateRotation(15, -10, 500)
```

## 🐛 Problemas Comunes

### "MindAR SDK no disponible"
- CDN está en modo demo
- La funcionalidad parallax sigue funcionando
- En producción, la CDN de MindAR se cargará correctamente

### "Requested device not found"
- La cámara no está disponible en el navegador
- Prueba en un dispositivo móvil real
- Verifica permisos de cámara

### Parallax muy lento
- Reduce la cantidad de capas
- Desactiva animaciones en parallax.css
- Prueba en otro dispositivo

## 📱 Prueba en Dispositivo Real

### iOS (Safari)
1. Abre `http://<IP>:8080`
2. Solicita permiso de cámara
3. Solicita permiso de orientación
4. ¡Listo!

### Android (Chrome)
1. Abre `http://<IP>:8080`
2. Solicita permiso de cámara
3. ¡Listo!

## 🎨 Personalización

### Cambiar colores de parallax
Edita `public/css/parallax.css`:

```css
#layer-bg {
  background: linear-gradient(135deg, #YOUR_COLOR1, #YOUR_COLOR2);
}
```

### Agregar nuevas capas dinámicamente
```javascript
app.parallax.createLayer({
  id: 'nueva-capa',
  depth: 0.7,
  content: `<p>Mi contenido</p>`
});
```

### Cambiar botones
Edita `public/index.html` líneas ~40-43.

## 📚 Recursos

- **MindAR Docs**: https://hiukim.github.io/mind-ar-js-doc/
- **CSS 3D Transforms**: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Transforms
- **DeviceOrientationEvent**: https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent

## 🚀 Próximos Pasos

1. **Integrar imágenes reales**: Usa fotos con características distintivas
2. **Agregar contenido AR**: HTML, animaciones, efectos
3. **Optimizar para móvil**: Ajustar sensibilidad y layers
4. **Publicar**: Deploy en servidor HTTPS

## ❓ FAQ

**P: ¿Puedo usar múltiples targets?**
R: Sí, configura `maxTrack` en MindARManager

**P: ¿Funciona sin cámara?**
R: Sí, en modo demo. Para tracking real necesitas MindAR SDK

**P: ¿Puedo cambiar los colores?**
R: Sí, edita los CSS en `public/css/`

**P: ¿Cómo agrego video/audio?**
R: Dentro de `createLayer()` content puedes poner HTML con video/audio

---

**¡Happy AR coding! 🎉**
