# InkMotion

InkMotion convierte una imagen y su animación breve en una obra física aumentada, anclada al papel y lista para imprimir.

## Flujo del autor

1. Inicia sesión con Google en `/crear`.
2. Sube la imagen original (JPG, PNG o WebP; hasta 25 MB).
3. Sube un video loop MP4 H.264 de 3 a 10 segundos y hasta 15 MB.
4. InkMotion muestra una vista previa comparativa con peso, duración y resolución, y verifica automáticamente la relación de aspecto.
5. Publica la obra y descarga `InkMotion_Lamina_Final.pdf` a 300 DPI.

La imagen y el video deben conservar la misma proporción y encuadre. Se recomienda un loop breve, sin movimiento de cámara y con cambios internos sutiles. Para obtener mayor compatibilidad entre generadores, conviene preparar la imagen en 16:9 o 9:16 antes de animarla, porque algunas herramientas pueden recortar o reencuadrar otras proporciones.

La guía de autor aclara que la imagen y el video se preparan fuera de InkMotion. Como ayuda opcional, ofrece instrucciones copiables para pegar junto con la imagen en cualquier herramienta de IA de imagen a video. Si el generador permite elegir fotograma inicial y final, se recomienda usar la misma imagen en ambos para conseguir un loop más estable.

## Experiencia del lector

El QR abre `/v/:id` en el navegador. MindAR reconoce la Lámina Maestra completa y mantiene la animación adherida a su perspectiva. Al detectar el marcador, el video aparece desde la superficie con una elevación, escala y sombra suaves; se reproduce en loop mientras la lámina está visible y se pausa al perderla.

Esto diferencia InkMotion de un QR enlazado a un reproductor: el contenido no se abre aparte, sino que permanece registrado sobre la obra física mientras el teléfono se mueve.

## Lámina Maestra

- Respeta la proporción real de la obra.
- Agrega paspartú sin invadir la ilustración.
- Incluye marco y esquinas fiduciales en L.
- Integra un QR corto en el margen inferior.
- Compila la lámina completa como `target.mind`.
- Exporta PDF listo para impresión a 300 DPI.

## Arquitectura

- Frontend modular en JavaScript.
- Three.js `0.168.0` para el video AR y la transición de despegue.
- MindAR `1.2.5` para compilación y tracking.
- Supabase Auth con Google OAuth.
- Supabase Database y Storage para proyectos y archivos.
- Vercel para hosting y rutas `/crear` y `/v/:id`.

Cada publicación almacena `cover.jpg`, `animation.mp4`, `target.mind` y una fila en `stories` con `image_path`, `video_path`, `target_path` y configuración.

La generación de profundidad con Replicate fue retirada del flujo activo. El producto utiliza un único modelo de creación basado en imagen + video para reducir coste, espera y complejidad.

## Validaciones del video

| Propiedad | Regla |
|---|---|
| Formato | MP4 |
| Códec recomendado | H.264 |
| Duración | 3–10 segundos |
| Peso máximo | 15 MB |
| Resolución máxima | 1920 px por lado |
| Proporción | Debe coincidir con la imagen (tolerancia 2,5 %) |
| Audio | Opcional; el lector decide si lo activa |
| Reproducción | Automática en loop al detectar la lámina |

## Captura de la experiencia

En navegadores compatibles, el lector puede activar el sonido del MP4 y grabar voluntariamente la cámara con la capa AR mediante el botón rojo. La grabación solo comienza al pulsarlo, continúa hasta que la persona la detiene y permanece en su dispositivo: InkMotion no la sube a Supabase. Al finalizar puede descargarla o compartirla si el sistema admite archivos mediante Web Share.

## Desarrollo local

```bash
npm start
```

Abrir `http://localhost:3000/crear`. La cámara requiere HTTPS fuera de `localhost`.

## Verificación recomendada

1. Probar una obra cuadrada, una vertical y una horizontal.
2. Confirmar rechazo de videos fuera del rango de duración o peso.
3. Confirmar rechazo cuando imagen y video no comparten proporción.
4. Publicar con una cuenta Google.
5. Descargar e imprimir la Lámina Maestra sin escalar.
6. Escanear QR, autorizar cámara y encuadrar la lámina completa.
7. Verificar reproducción, anclaje, elevación, pérdida y recuperación del target.

## Autor

Creado por [Lic. Lucas Walter González](https://www.linkedin.com/in/lucas-walter-gonzalez).
