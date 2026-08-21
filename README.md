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
6. La Edge Function autenticada `generate-depth` envía la obra a Replicate Depth Anything V2, guarda `depth.png` en Storage y registra su ruta en la configuración del proyecto.
7. El autor descarga un único archivo `InkMotion_Lamina_Final.pdf` a 300 DPI.

### Lector

1. Escanea el QR corto `/v/:id` de la lámina.
2. InkMotion descarga la obra y el target `.mind` ya compilado.
3. El lector habilita la cámara y encuadra la lámina completa.
4. MindAR detecta el target con `targetIndex: 0`.
5. Three.js carga `depth.png`, desplaza la malla con el mapa semántico y activa la transición **“La obra cobró vida”**.
6. Si el mapa IA no está disponible, el shader utiliza automáticamente el relieve local por luminancia.

## Características actuales

- Lámina dinámica: cuadrada, vertical u horizontal según la obra.
- Paspartú neutro con título y QR fuera de la ilustración.
- QR corto con corrección de errores Level M.
- PDF de página personalizada calculado a 300 DPI.
- Compilación `.mind` en el navegador del autor.
- Tracking físico con MindAR Image Tracking 1.2.5.
- Render WebGL con Three.js 0.168.0.
- Mapa de profundidad semántico generado con Replicate Depth Anything V2.
- Shader con textura de profundidad independiente y fallback por luminancia.
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
│   ├── functions/
│   │   └── generate-depth/
│   │       ├── index.ts
│   │       └── deno.json
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
- Aplica relieve 2.5D con un mapa semántico independiente de la textura de color.
- Conserva un height field local por luminancia como contingencia.
- Suaviza la matriz de tracking con `lerp` y `slerp`.
- Controla barrido de luz, entrada de profundidad y partículas.
- Mantiene el efecto durante pérdidas mínimas para evitar parpadeos.

### `ProjectStore`

- Gestiona Google OAuth con PKCE.
- Guarda proyectos en la tabla `stories`.
- Sube `cover.jpg` y `target.mind` al bucket `stories`.
- Invoca la función autenticada `generate-depth` y expone `depthUrl` al visor.
- Depende de políticas RLS para separar la escritura de cada autor.

### Edge Function `generate-depth`

- Valida el JWT y confirma que la obra pertenece al autor autenticado.
- Invoca una versión fija de Depth Anything V2 en Replicate.
- Espera o consulta el resultado sin exponer el token al navegador.
- Copia inmediatamente el resultado a `stories/<autor>/<obra>/depth.png`.
- Actualiza `config.depthPath`, `config.depthModel` y `config.depthStatus`.
- Lee `REPLICATE_API_TOKEN` exclusivamente desde los secretos de Supabase.

## Desarrollo local

Requisitos: Node.js moderno y un navegador con WebGL y acceso a cámara.

```bash
npm start
```

Abrir `http://localhost:8080/crear`. La cámara solo funciona en `localhost` o mediante HTTPS.

## Validación recomendada

1. Publicar una obra rica en detalles y con buen contraste.
2. Confirmar que el estado muestre “Generando relieve 3D con inteligencia artificial…”.
3. Descargar la nueva Lámina Maestra.
4. Imprimirla preferentemente en papel mate o mostrarla completa en otra pantalla.
5. Escanear el QR desde un segundo dispositivo.
6. Conceder permiso de cámara y mantener visible todo el marco.
7. Verificar detección, relieve semántico, anclaje, transición, pérdida y recuperación.

## Limitaciones del MVP

- Un solo target por experiencia.
- La generación semántica depende de Replicate, agrega algunos segundos al alta y tiene un costo variable por ejecución (aproximadamente USD 0,0026 con la tarifa observada durante el MVP).
- Las obras publicadas antes de esta integración no incorporan `depth.png` automáticamente.
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
- `REPLICATE_API_TOKEN` está almacenado como secreto de la Edge Function y nunca se entrega al navegador.
- Las escrituras están protegidas mediante RLS y carpetas por autor en Storage.

## Autor

Creado por [Lic. Lucas Walter González](https://www.linkedin.com/in/lucas-walter-gonzalez).

## Licencia

MIT
