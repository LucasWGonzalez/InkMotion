const SOURCES = [
  'https://esm.sh/qrcode@1.5.4',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm',
];

let libraryPromise = null;

async function loadLibrary() {
  if (libraryPromise) return libraryPromise;
  libraryPromise = (async () => {
    let lastError;
    for (const source of SOURCES) {
      try {
        const module = await import(source);
        const library = module.default || module;
        if (typeof library.toCanvas !== 'function') throw new Error('API de QR no disponible.');
        return library;
      } catch (error) {
        lastError = error;
        console.warn('No se pudo cargar el generador QR desde', source, error);
      }
    }
    throw new Error(`No se pudo generar el QR. ${lastError?.message || ''}`.trim());
  })();
  try { return await libraryPromise; }
  catch (error) { libraryPromise = null; throw error; }
}

export async function renderStoryQR(canvas, publicUrl) {
  const QRCode = await loadLibrary();
  await QRCode.toCanvas(canvas, publicUrl, {
    errorCorrectionLevel: 'H',
    width: 1024,
    margin: 4,
    color: { dark: '#08080DFF', light: '#FFFFFFFF' },
  });
  return canvas.toDataURL('image/png');
}
