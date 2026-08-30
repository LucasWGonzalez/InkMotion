const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_pointer;
uniform vec2 u_pointerVelocity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = turn * p * 2.03 + vec2(5.2, 1.7);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv - 0.5;
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.12;
  vec2 mouse = u_pointer - 0.5;
  mouse.x *= u_resolution.x / u_resolution.y;
  vec2 delta = p - mouse;
  float influence = exp(-dot(delta, delta) * 2.8);

  // The pointer bends the flow instead of drawing a circular spotlight.
  vec2 tangent = vec2(-delta.y, delta.x);
  float speed = min(length(u_pointerVelocity) * 0.018, 1.0);
  p += tangent * influence * (0.34 + speed * 0.52);
  p -= u_pointerVelocity * influence * 0.0017;

  vec2 q = vec2(
    fbm(p * 1.35 + vec2(t, -t * 0.7)),
    fbm(p * 1.35 + vec2(3.9 - t * 0.55, 7.1 + t * 0.4))
  );
  vec2 r = vec2(
    fbm(p * 1.72 + 3.4 * q + vec2(1.7, 9.2) + t * 0.35),
    fbm(p * 1.72 + 3.4 * q + vec2(8.3, 2.8) - t * 0.3)
  );
  float liquid = fbm(p * 1.10 + 4.2 * r + t * 0.22);

  vec3 navy = vec3(0.020, 0.035, 0.095);
  vec3 blue = vec3(0.055, 0.34, 0.83);
  vec3 violet = vec3(0.43, 0.12, 0.84);
  vec3 magenta = vec3(0.84, 0.10, 0.52);
  vec3 cyan = vec3(0.05, 0.62, 0.86);

  float blueField = smoothstep(0.18, 0.78, q.x + 0.23 * sin(r.y * 6.283));
  float violetField = smoothstep(0.22, 0.82, r.x);
  float pinkField = smoothstep(0.48, 0.88, liquid + 0.13 * q.y);
  vec3 color = mix(navy, blue, blueField * 0.82);
  color = mix(color, violet, violetField * 0.76);
  color = mix(color, magenta, pinkField * 0.60);
  color += cyan * smoothstep(0.56, 0.86, q.y + r.y * 0.24) * 0.25;

  float folds = smoothstep(0.28, 0.72, abs(sin((liquid + r.x) * 8.0))) * 0.12;
  color += folds * vec3(0.24, 0.18, 0.46);
  color *= 0.74 + 0.26 * smoothstep(0.0, 0.86, 1.0 - length(p) * 0.33);
  color = pow(color, vec3(0.90));
  gl_FragColor = vec4(color, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || 'No se pudo compilar el fondo líquido.');
  }
  return shader;
}

export function installLiquidInkBackground() {
  if (window.__inkmotionLiquidInkInstalled) return;
  if (document.body?.dataset.route !== 'author') return;
  window.__inkmotionLiquidInkInstalled = true;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'liquid-ink-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  if (reducedMotion) {
    document.body.classList.add('liquid-ink-fallback');
    return;
  }

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power'
  });
  if (!gl) {
    document.body.classList.add('liquid-ink-fallback');
    return;
  }

  try {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, 'u_resolution');
    const time = gl.getUniformLocation(program, 'u_time');
    const pointerUniform = gl.getUniformLocation(program, 'u_pointer');
    const velocityUniform = gl.getUniformLocation(program, 'u_pointerVelocity');
    const pointer = { x: 0.62, y: 0.32, targetX: 0.62, targetY: 0.32, vx: 0, vy: 0 };

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.25) * (window.innerWidth < 720 ? 0.48 : 0.62);
      canvas.width = Math.max(1, Math.round(window.innerWidth * scale));
      canvas.height = Math.max(1, Math.round(window.innerHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const move = (event) => {
      pointer.targetX = event.clientX / window.innerWidth;
      pointer.targetY = 1 - event.clientY / window.innerHeight;
    };
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pointermove', move, { passive: true });
    resize();

    let previous = performance.now();
    let elapsed = 0;
    let animationFrame = 0;
    const render = (now) => {
      animationFrame = requestAnimationFrame(render);
      if (document.hidden || now - previous < 32) return;
      const delta = Math.min((now - previous) / 1000, 0.08);
      previous = now;
      elapsed += delta;

      const oldX = pointer.x;
      const oldY = pointer.y;
      pointer.x += (pointer.targetX - pointer.x) * 0.075;
      pointer.y += (pointer.targetY - pointer.y) * 0.075;
      pointer.vx = pointer.vx * 0.86 + ((pointer.x - oldX) / Math.max(delta, 0.001)) * 0.14;
      pointer.vy = pointer.vy * 0.86 + ((pointer.y - oldY) / Math.max(delta, 0.001)) * 0.14;

      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, elapsed);
      gl.uniform2f(pointerUniform, pointer.x, pointer.y);
      gl.uniform2f(velocityUniform, pointer.vx, pointer.vy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    animationFrame = requestAnimationFrame(render);
    window.addEventListener('pagehide', () => cancelAnimationFrame(animationFrame), { once: true });
  } catch (error) {
    console.warn('[InkMotion] Fondo líquido no disponible:', error);
    canvas.remove();
    document.body.classList.add('liquid-ink-fallback');
  }
}
