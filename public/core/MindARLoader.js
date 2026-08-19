const VERSION = '1.2.5';
const SOURCES = [
  `https://cdn.jsdelivr.net/npm/mind-ar@${VERSION}/dist/mindar-image.prod.js`,
  `https://esm.sh/mind-ar@${VERSION}/dist/mindar-image.prod.js`,
  `https://unpkg.com/mind-ar@${VERSION}/dist/mindar-image.prod.js`,
];

let loadingPromise = null;
const NETWORK_ERROR_MESSAGE = 'Error de conexión con el motor o Supabase. Verifica tu red o el tamaño de la imagen.';

function networkError(cause) {
  const error = new Error(NETWORK_ERROR_MESSAGE, { cause });
  error.code = 'NETWORK_ERROR';
  return error;
}

function currentApi() {
  const root = window.MINDAR || {};
  const image = root.IMAGE || root;
  return image.Compiler && image.Controller ? image : null;
}

async function loadFrom(source) {
  try {
    const module = await import(source);
    const api = {
      Compiler: module.Compiler || window.MINDAR?.IMAGE?.Compiler || window.MINDAR?.Compiler,
      Controller: module.Controller || window.MINDAR?.IMAGE?.Controller || window.MINDAR?.Controller,
      UI: module.UI || window.MINDAR?.IMAGE?.UI || window.MINDAR?.UI,
    };
    if (!api.Compiler || !api.Controller) throw new Error('El módulo descargado no expone la API de imagen.');
    window.MINDAR ||= {};
    window.MINDAR.IMAGE = { ...(window.MINDAR.IMAGE || {}), ...api };
    return window.MINDAR.IMAGE;
  } catch (error) {
    console.warn(`No se pudo cargar el recurso MindAR: ${source}`, error);
    throw error;
  }
}

export async function ensureMindAR(onState = () => {}) {
  const ready = currentApi();
  if (ready) return ready;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    let lastError;
    for (let index = 0; index < SOURCES.length; index++) {
      onState({ state: index === 0 ? 'connecting' : 'retrying', attempt: index + 1, total: SOURCES.length });
      try {
        const api = await loadFrom(SOURCES[index]);
        onState({ state: 'ready', attempt: index + 1, total: SOURCES.length });
        return api;
      } catch (error) {
        lastError = error;
        console.warn(`MindAR CDN ${index + 1} no disponible`, error);
      }
    }
    throw networkError(lastError);
  })();

  try { return await loadingPromise; }
  catch (error) { loadingPromise = null; throw error; }
}

export function getMindARImageApi() { return currentApi(); }
