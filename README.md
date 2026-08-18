# InkMotion · Libros Vivos

**InkMotion** es una plataforma de **realidad aumentada web** (WebAR) que convierte ilustraciones impresas —portadas, historietas, pósters, cuentos— en experiencias interactivas ancladas al papel, directamente en el navegador y **sin apps**.

- 🎯 **Image Target Tracking** con MindAR (marcador compilado por imagen)
- 🌋 **Motor de relieve 2.5D** con Three.js + WebGL y shaders GLSL propios
- 🖼️ **Procesamiento de imágenes** en cliente con Canvas 2D
- 🔗 **Publicación con QR** para imprimir el acceso AR en el libro físico
- 🔐 **Autor sin contraseña** (magic link) sobre Supabase

## 📁 Estructura del Proyecto

```
InkMotion/
├── public/
│   ├── index.html                # SPA: panel de autor + lector AR
│   ├── app.js                    # Orquestador y ruteo (/crear, /ver/:id)
│   ├── core/
│   │   ├── MindARManager.js      # Cámara, compilación y tracking del marcador
│   │   ├── MindARLoader.js       # Carga resiliente del SDK MindAR (CDN)
│   │   ├── ParallaxEngine.js     # Motor 2.5D con Three.js/WebGL + shaders
│   │   └── ImageProcessor.js     # Validación, resize y compresión de imágenes
│   ├── services/
│   │   └── ProjectStore.js       # Auth + persistencia (Supabase)
│   ├── ui/
│   │   └── UIController.js        # Componentes de interfaz
│   ├── utils/
│   │   ├── EventBus.js            # Pub/Sub para desacoplar módulos
│   │   ├── QRGenerator.js         # Generación de QR para impresión
│   │   └── DeviceMotionListener.js
│   └── css/
│       ├── global.css
│       ├── parallax.css
│       ├── ui.css
│       └── routes.css
├── supabase/                     # Esquema / configuración de backend
├── server.js                     # Servidor estático de desarrollo (Node)
├── vercel.json                   # Configuración de deploy
└── package.json
```

## 🚀 Guía Rápida

### 1. Instalar y correr

```bash
npm start          # sirve /public en http://localhost:8080
# o, con recarga:
npm run dev
```

### 2. Flujo de uso

**Autor** (`/crear`):
1. Ingresá con tu correo (magic link, sin contraseña).
2. Subí una ilustración (JPG, PNG, WebP, HEIC · hasta 25 MB).
3. La imagen se optimiza y se **compila un marcador AR** (se valida contraste y cantidad de puntos reconocibles).
4. Publicá el cuento y descargá su **QR** para imprimir junto a la obra.

**Lector** (`/ver/:id`):
1. Abrí el enlace (o escaneá el QR) en el móvil.
2. Dale permiso a la cámara y apuntá a la ilustración impresa.
3. Al detectarse, el contenido AR queda **anclado al papel** con relieve y animación.

### 3. Requisitos

- Navegador moderno con **WebGL** (Chrome, Safari mobile, Firefox)
- Cámara trasera del dispositivo
- Conexión **HTTPS o localhost** (requisito de cámara)

## 🔧 Componentes Core

### MindARManager
Gestiona cámara, compilación del marcador y tracking en tiempo real.

- `init()` — abre la cámara trasera y prepara el motor MindAR
- `compileTarget(url)` — compila la imagen a marcador; valida contraste (`< 17` rechaza), densidad de bordes y cantidad de puntos (`< 35` rechaza; `< 90` = calidad *limited*)
- `setCompiledTarget(url)` — carga un marcador ya compilado y arranca el tracking
- `measureVisualQuality(image)` — mide contraste y `edgeRatio` antes de compilar

Eventos: `mindar:target-found`, `mindar:target-lost`, `mindar:target-update` (worldMatrix), `mindar:projection-ready`, `mindar:scan-timeout`.

### ParallaxEngine
Motor 2.5D con **Three.js / WebGL** (no CSS). Renderiza la ilustración como un plano de `80×60` subdivisiones deformado por un **shader de profundidad** derivado de la luminancia, y la ancla al mundo con la matriz de MindAR (`updateWorldAnchor`).

- `init()` — crea escena, cámara y renderer WebGL con fondo transparente
- `setTargetImage(url)` — carga la textura y arma malla + marco + partículas
- `updateWorldAnchor({ worldMatrix, dimensions })` — fija el contenido sobre el marcador
- `setProjectionMatrix(matrix)` / `setVideoViewport(...)` — alinea con la cámara real
- `setPreviewMode('3d' | 'camera')` — alterna entre efecto AR y solo cámara

### ImageProcessor
Optimiza la imagen en cliente antes de compilar.

- Valida formato y tamaño (máx. 25 MB) y dimensiones mínimas (200×200)
- Redimensiona hasta `1920×1920` con suavizado alta calidad
- Exporta a **JPEG** con calidad `0.82`

## ✨ Efectos AR aplicados a la imagen

Todos los efectos se calculan en GPU y quedan anclados a la ilustración física:

| Efecto | Qué hace | Cómo |
|--------|----------|------|
| **Relieve por profundidad** | Levanta zonas claras, hunde oscuras | Displacement por luminancia en el vertex shader |
| **Parallax de cámara** | Sensación de mirar *dentro* de la imagen al mover el móvil | Desplazamiento de UV según la dirección de vista |
| **Ondulación orgánica** | Sutil movimiento tipo viento/agua | Seno animado sobre el loop de 5 s |
| **Respiración (breathing)** | Escala rítmica ±0.8 % | Loop de 5 s |
| **Partículas mágicas** | Chispas doradas flotantes (additive blending) | 24/36 puntos animados |
| **Marco luminoso** | Halo violeta alrededor de la obra | Plano semitransparente detrás |
| **Realce de luz** | Refuerza el relieve iluminando lo elevado | En el fragment shader |

Parámetro clave: `depthStrength` (por defecto `0.08`–`0.12`) controla la intensidad del relieve; se guarda por proyecto en `config`.

## 🎨 Personalización

Intensidad del relieve, al crear el motor (`app.js`):

```javascript
this.parallax = new ParallaxEngine({
  container: '#ar-overlay',
  depthStrength: 0.1,   // más alto = relieve más marcado
});
```

Duración del loop de animación: constante `LOOP_DURATION` en `ParallaxEngine.js`.

## 📱 Notas por Dispositivo

- **iOS (Safari):** requiere permiso explícito de cámara; el tracking usa la cámara trasera (`facingMode: environment`).
- **Android (Chrome):** soportado nativamente sobre HTTPS/localhost.

## ⚠️ Limitaciones Actuales

- Un solo target por experiencia (`maxTrack: 1`)
- El relieve se infiere de la **luminancia**, no de un mapa de profundidad real
- Requiere WebGL y buena iluminación / bajo reflejo para un tracking estable
- Imágenes de bajo contraste o muy "lisas" son rechazadas en la compilación

## 🔮 Próximos Pasos

- [ ] Múltiples targets simultáneos
- [ ] Mapas de profundidad reales (en vez de luminancia)
- [ ] Capas de contenido HTML/video sobre el marcador
- [ ] Métricas de tracking y performance

## 📝 Licencia

MIT

---

**Construido con:** MindAR · Three.js (WebGL + GLSL) · Canvas 2D · Supabase · Vanilla JS (ES Modules)
