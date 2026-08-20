# InkMotion

InkMotion convierte ilustraciones, historietas, portadas y pósters en experiencias WebAR accesibles desde el navegador, sin instalar una aplicación.

El autor publica una obra y recibe una **Lámina Maestra lista para imprimir**. La lámina integra la ilustración, un paspartú técnico, un marco de anclaje, fiduciales en las esquinas y un QR de acceso. MindAR reconoce la lámina completa y Three.js proyecta sobre ella el efecto de profundidad 2.5D.

## Producción

- Aplicación: https://ink-motion-pied.vercel.app
- Panel de autor: https://ink-motion-pied.vercel.app/crear
- Repositorio: https://github.com/LucasWGonzalez/InkMotion
- Rama productiva: `master`

## Flujo del producto

### Autor

1. Inicia sesión con Google OAuth.
2. Sube una ilustración y escribe el título de la obra.
3. InkMotion optimiza la textura y compone la Lámina Maestra conservando la proporción original.
4. El compilador oficial de MindAR procesa la lámina completa y genera un target `.mind`.
5. Se guardan la ilustración, el target y la configuración en Supabase.
6. El autor descarga un único archivo `InkMotion_Lamina_Final.pdf` a 300 DPI.

### Lector

1. Escanea el QR corto `/v/:id` de la lámina.
2. InkMotion descarga la obra y el target `.mind` ya compilado.
3. El lector habilita la cámara y encuadra la lámina completa.
4. MindAR detecta el target con `targetIndex: 0`.
5. Three.js ancla la ilustración y activa la transición **“La obra cobró vida”**.

## Características actuales

- Lámina dinámica: cuadrada, vertical u horizontal según la obra.
- Paspartú neutro con título y QR fuera de la ilustración.
- QR corto con corrección de errores Level M.
- PDF de página personalizada calculado a 300 DPI.
- Compilación `.mind` en el navegador del autor.
- Tracking físico con MindAR Image Tracking 1.2.5.
- Render WebGL con Three.js 0.168.0.
- Shader de profundidad estimada por luminancia.
- Interpolación de posición, rotación y escala para reducir jitter.
- Partículas con `AdditiveBlending`, respiración sutil y barrido de luz.
- Tolerancia de 400 ms ante microcortes de tracking.
- Guía animada de encuadre y respuesta háptica compatible.
- Autenticación Google OAuth, base de datos y Storage mediante Supabase.
- Diagnóstico visible de cámara, descarga, compilación y tracking.

## Arquitectura

InkMotion es una aplicación web modular en JavaScript, HTML y CSS, sin React ni framework de interfaz.

```text
inkmotion/
├── public/
│   ├── index.html
│   ├── app.js
│   ├── core/
│   │   ├── ImageProcessor.js
│   │   ├── MasterSheetGenerator.js
│   │   ├── MindARLoader.js
│   │   ├── MindARManager.js
│   │   └── ParallaxEngine.js
│   ├── services/
│   │   └── ProjectStore.js
│   ├── utils/
│   │   ├── EventBus.js
│   │   └── QRGenerator.js
│   └── css/
│       ├── global.css
│       ├── parallax.css
│       ├── routes.css
│       └── ui.css
├── supabase/
│   └── migrations/
├── server.js
├── vercel.json
├── PROJECT_HISTORY.txt
└── README.md
```

## Componentes principales

### `MasterSheetGenerator`

- Lee las dimensiones reales de la ilustración.
- Calcula el lienzo de impresión sin forzar A4 ni deformar la obra.
- Dibuja paspartú, marco sutil y cuatro fiduciales en “L”.
- Ubica título y QR en la banda inferior externa.
- Genera JPEG de alta resolución y PDF personalizado.

### `MindARManager`

- Carga el compilador/runtime de MindAR con CDNs alternativos.
- Compila la Lámina Maestra como target único.
- Descarga y valida el `.mind` publicado.
- Sincroniza las dimensiones reales del video con el `Controller`.
- Emite eventos de detección, pérdida, progreso y errores.

### `ParallaxEngine`

- Renderiza la obra en un plano subdividido de Three.js.
- Aplica relieve 2.5D mediante shader.
- Suaviza la matriz de tracking con `lerp` y `slerp`.
- Controla barrido de luz, entrada de profundidad y partículas.
- Mantiene el efecto durante pérdidas mínimas para evitar parpadeos.

### `ProjectStore`

- Gestiona Google OAuth con PKCE.
- Guarda proyectos en la tabla `stories`.
- Sube `cover.jpg` y `target.mind` al bucket `stories`.
- Depende de políticas RLS para separar la escritura de cada autor.

## Desarrollo local

Requisitos: Node.js moderno y un navegador con WebGL y acceso a cámara.

```bash
npm start
```

Abrir `http://localhost:8080/crear`. La cámara solo funciona en `localhost` o mediante HTTPS.

## Validación recomendada

1. Publicar una obra rica en detalles y con buen contraste.
2. Descargar la nueva Lámina Maestra.
3. Imprimirla preferentemente en papel mate o mostrarla completa en otra pantalla.
4. Escanear el QR desde un segundo dispositivo.
5. Conceder permiso de cámara y mantener visible todo el marco.
6. Verificar detección, anclaje, transición, pérdida y recuperación.

## Limitaciones del MVP

- Un solo target por experiencia.
- Las obras nuevas solicitan un mapa de profundidad semántico a Depth Anything V2 mediante una Supabase Edge Function. El resultado queda cacheado en Storage y el visor conserva el cálculo local por luminancia como contingencia si Replicate no está disponible.
- Composición, compilación MindAR y PDF se ejecutan en el navegador del autor.
- El resultado depende de la iluminación, la impresión, el enfoque y la capacidad del dispositivo.
- No existe todavía un panel de listado, edición o analítica de obras.

## Próximos pasos

- Procesamiento asíncrono de láminas y targets en backend.
- Panel de obras publicadas y versionado.
- Métricas anónimas de apertura y detección.
- Plantillas visuales seleccionables.
- Organizaciones, equipos y permisos para editoriales.
- Pruebas end-to-end en una matriz de navegadores móviles.

## Seguridad

- La aplicación utiliza una clave publicable de Supabase en el navegador.
- Nunca debe incorporarse una `service_role` key al frontend o al repositorio.
- Las escrituras están protegidas mediante RLS y carpetas por autor en Storage.

## Autor

Creado por [Lic. Lucas Walter González](https://www.linkedin.com/in/lucas-walter-gonzalez).

## Licencia

MIT
