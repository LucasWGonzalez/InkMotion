# InkMotion

InkMotion convierte una imagen y su animación breve en una obra física aumentada, anclada al papel y lista para imprimir. El foco actual del MVP está en **WebAR + diseño editorial/maquetación**, con la integración de pagos pausada temporalmente mientras se amplían los casos de uso reales de impresión.

Producción: https://ink-motion-pied.vercel.app  
Panel de autor: https://ink-motion-pied.vercel.app/crear

## Versión estable de referencia

**Versión:** MVP estable 2026-08-29.2

La versión validada el **29 de agosto de 2026** conserva funcionando de punta a punta:

- acceso con Google mediante Supabase PKCE, sin bucles de ingreso;
- restauración del borrador después del login;
- validación visible y accionable de título, imagen, video y compatibilidad de proporciones;
- composición clásica o personalizada de la Lámina Maestra;
- compilación del target MindAR sin errores de `drawImage()`;
- guardado de la publicación y actualización de **Mis trabajos**;
- progreso de creación, vista final y descarga del PDF;
- creación consecutiva mediante **Crear una nueva obra** sin cerrar sesión;
- instrucciones de prueba que utilizan únicamente el QR incluido en la lámina, sin QR ni botones redundantes;
- apertura pública desde el QR en el teléfono;
- cámara, tracking, video AR, sonido, grabación y compartir.

Esta versión cuenta con **20 pruebas automatizadas aprobadas** y una prueba manual completa en teléfono real. La referencia recuperable de esta revisión se conserva en la rama `release/stable-2026-08-29-v2`. La rama anterior `release/stable-2026-08-29` permanece intacta.

## Casos de uso objetivo

InkMotion está evolucionando para trabajar no sólo con láminas artísticas, sino también con:

- tapas y contratapas de libros;
- menús de restaurantes;
- manuales técnicos y exploded views;
- packaging y etiquetas;
- posters y láminas educativas;
- piezas editoriales impresas que necesiten una capa WebAR sin aplicación nativa.

## Flujo del autor

1. Inicia sesión con Google en `/crear`.
2. Sube la imagen original (JPG, PNG o WebP; hasta 25 MB).
3. Sube un video loop MP4 de 3 a 10 segundos y hasta 15 MB.
4. InkMotion verifica peso, duración, resolución y relación de aspecto.
5. El autor elige cómo imprimir la obra:
   - **Clásico · recomendado**: conserva la Lámina Maestra histórica de InkMotion.
   - **Personalizar diseño**: permite integrar el QR dentro de la obra y adaptar el marco visual.
6. InkMotion compone la pieza final y la usa como target de MindAR.
7. Publica la obra y genera `InkMotion_Lamina_Final.pdf` a 300 DPI.
8. Desde **Mis trabajos**, puede regenerar la lámina o eliminar una publicación.

La imagen y el video deben conservar la misma proporción y encuadre. Se recomienda cámara fija y movimientos internos sutiles para conseguir una experiencia AR estable.

## Diseño de obra

### Modo clásico — predeterminado

El modo clásico sigue siendo el comportamiento por defecto y recomendado. Utiliza el mismo generador que la Lámina Maestra original:

- paspartú exterior;
- marco técnico de alto contraste;
- cuatro esquinas fiduciales en L;
- banda informativa inferior;
- QR exterior;
- PDF a 300 DPI.

La vista previa del modo clásico se genera con el mismo `MasterSheetGenerator.composeLegacy()` que se usa para la salida final. De esta manera, la preview no es una aproximación CSS: representa la misma composición que se imprimirá.

### Modo personalizado

El modo personalizado es opcional y permite adaptar la pieza a diseños editoriales donde el marco o QR no deben parecer elementos agregados externamente.

Actualmente permite:

- QR dentro de la imagen o en banda exterior;
- cambio proporcional de tamaño del QR;
- desplazamiento del QR sobre la obra mediante drag;
- posiciones rápidas en las cuatro esquinas;
- fondo blanco, blanco suave o sin fondo extra;
- marcos visuales: sin decorativo, minimal, editorial, técnico e integrado;
- color y grosor del marco;
- adaptación de color basada en la obra.

Las coordenadas y tamaños del layout se guardan de forma normalizada para conservar su proporción independientemente de la resolución de impresión.

## Seguridad del tracking WebAR

El diseño visual no puede degradar libremente el tracking. InkMotion mantiene reglas técnicas independientes de la decoración:

- tamaño mínimo de QR;
- grosor mínimo de marco cuando corresponde;
- referencias técnicas de alto contraste;
- validación del target completo mediante MindAR;
- análisis de contraste, bordes y cantidad de features.

La pieza final compuesta —no sólo la imagen original— se compila como `target.mind`. Esto permite que QR, marco y composición formen parte del marcador real utilizado por la cámara.

## Compatibilidad con trabajos existentes

Los trabajos creados antes del editor de diseño **se conservan sin migración destructiva**.

- No se borraron publicaciones existentes.
- No fue necesario modificar el esquema de base de datos.
- `stories.config` continúa siendo el campo JSON de configuración.
- Los proyectos antiguos que no contienen `config.layout` utilizan automáticamente la composición clásica.
- Los proyectos nuevos pueden guardar `config.layout` para reconstruir su diseño personalizado.

Esto permite que las generaciones anteriores y nuevas de publicaciones convivan en el mismo sistema.

## Experiencia del lector

El QR abre `/v/:id` en el navegador. MindAR descarga el `target.mind` previamente compilado y reconoce la composición impresa completa. El video se coloca sobre el rectángulo de la obra mediante `contentRect` y permanece registrado sobre el papel mientras el teléfono se mueve.

El visor WebAR se mantiene deliberadamente desacoplado del editor de diseño: la personalización afecta la pieza impresa y el target, pero no obliga a reconstruir el motor AR.

## Arquitectura principal

- JavaScript ES Modules, HTML y CSS sin framework frontend.
- `public/app.js`: routing, carga, publicación y coordinación general.
- `public/core/MasterSheetGenerator.js`: composición clásica/personalizada y exportación PDF.
- `public/ui/LayoutEditor.js`: editor visual de QR y marco.
- `public/css/layout-editor.css`: interfaz del editor y preview.
- `public/core/MindARManager.js`: compilación, calidad y tracking del target.
- `public/core/ParallaxEngine.js`: render del video AR y alineación mediante `contentRect`.
- `public/core/ImageProcessor.js`: validación y optimización de imágenes.
- `public/core/VideoProcessor.js`: inspección y validación de videos.
- `public/services/ProjectStore.js`: Google Auth, Supabase Database/Storage y persistencia.
- `public/utils/QRGenerator.js`: generación del QR.
- Vercel: hosting y despliegue automático desde `master`.

## Persistencia

Cada publicación almacena:

- `cover.jpg`;
- `animation.mp4`;
- `target.mind`;
- una fila en `stories` con rutas y configuración JSON.

Para publicaciones nuevas, `config` puede incluir:

```js
{
  animation: 'video-loop-lift',
  loopSeconds: 8,
  anchor: 'mindar',
  contentRect: { /* rectángulo normalizado */ },
  sheetDpi: 300,
  layout: {
    page: { mode: 'artwork' },
    qr: {
      placement: 'inside',
      x: 0.80,
      y: 0.80,
      scale: 0.13,
      background: 'white'
    },
    frame: {
      preset: 'minimal',
      color: '#17171f',
      width: 0.006,
      autoColor: false
    }
  }
}
```

## Validaciones del video

| Propiedad | Regla |
|---|---|
| Formato | MP4 |
| Códec recomendado | H.264 |
| Duración | 3–10 segundos |
| Peso máximo | 15 MB |
| Resolución máxima | 1920 px por lado |
| Proporción | Debe coincidir con la imagen (tolerancia aproximada 2,5 %) |
| Audio | Opcional |
| Reproducción | Loop mientras el target está visible |

## Captura de la experiencia

En navegadores compatibles, el lector puede activar el sonido y grabar voluntariamente la cámara junto con la capa AR. La grabación se procesa localmente, no se sube a Supabase y puede guardarse o compartirse mediante Web Share cuando el dispositivo lo permite.

## Estado del producto — agosto 2026

- Flujo activo: **imagen + video**.
- Pagos: **pausados temporalmente**.
- Prioridad de MVP: impresión, maquetación, QR integrado, marcos y estabilidad WebAR.
- Modo clásico: predeterminado y compatible con publicaciones anteriores.
- Modo personalizado: opcional.
- Backend: Supabase.
- Tracking: MindAR Image Tracking.
- Render AR: Three.js.
- Producción: Vercel.

## Verificación recomendada

Antes de considerar estable un cambio de maquetación:

1. Probar una obra cuadrada, una vertical y una horizontal.
2. Verificar que el modo clásico coincida visualmente con el PDF generado.
3. Probar QR personalizado en las cuatro esquinas y con distintos tamaños permitidos.
4. Confirmar que el QR impreso sea legible.
5. Compilar el target y revisar la calidad de features.
6. Imprimir sin escalado automático del sistema operativo.
7. Escanear desde un teléfono real con diferentes luces y distancias.
8. Confirmar targetFound/targetLost y estabilidad del video.
9. Regenerar un proyecto antiguo y comprobar que sigue utilizando el formato clásico.
10. Regenerar un proyecto nuevo personalizado y comprobar que conserva su layout.

Para cambios que afecten autenticación, publicación o lector, ejecutar además:

```bash
node --test tests/*.test.mjs
```

No debe publicarse una nueva versión si falla alguna prueba de autenticación, publicación, biblioteca, descarga, visor o grabación.

## Desarrollo local

```bash
npm start
```

Abrir `http://localhost:3000/crear`. La cámara requiere HTTPS fuera de `localhost`.

## Autor

Creado por [Lic. Lucas Walter González](https://www.linkedin.com/in/lucas-walter-gonzalez).
