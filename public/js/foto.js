// Reduce una foto en el propio dispositivo ANTES de subirla: una foto de cámara
// (3-8 MB) pasa a unos 100 KB, así sube rápido incluso con datos móviles. El
// servidor vuelve a procesarla y es quien garantiza el tamaño; esto solo
// evita subir megas innecesarios.

const LADO_MAX = 1280;
const PESO_OBJETIVO = 300 * 1024;
const SUBIDA_MAX = 8 * 1024 * 1024;

function aBlob(canvas, tipo, calidad) {
  return new Promise((resolver) => canvas.toBlob(resolver, tipo, calidad));
}

export class ErrorFoto extends Error {}

export async function comprimirFoto(archivo) {
  if (!archivo?.type?.startsWith('image/')) throw new ErrorFoto('El fichero elegido no es una imagen.');

  let imagen;
  try {
    // 'from-image' aplica la orientación guardada por el móvil (si no, saldría girada).
    imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    // Formato que este navegador no sabe leer: se deja que el servidor lo intente.
    if (archivo.size <= SUBIDA_MAX && /^image\/(jpeg|png|webp|gif)$/.test(archivo.type)) return archivo;
    throw new ErrorFoto('No se ha podido leer la foto. Prueba con otra o haz una nueva.');
  }

  const intentos = [[LADO_MAX, 0.78], [LADO_MAX, 0.62], [1000, 0.55], [800, 0.5]];
  let mejor = null;
  for (const [lado, calidad] of intentos) {
    const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(imagen.width * escala));
    canvas.height = Math.max(1, Math.round(imagen.height * escala));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // PNG con transparencia: fondo blanco, no negro
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imagen, 0, 0, canvas.width, canvas.height);

    // Safari antiguo no sabe WebP y devuelve PNG (enorme): en ese caso, JPEG.
    let blob = await aBlob(canvas, 'image/webp', calidad);
    if (!blob || blob.type !== 'image/webp') blob = await aBlob(canvas, 'image/jpeg', calidad);
    if (blob && (!mejor || blob.size < mejor.size)) mejor = blob;
    if (blob && blob.size <= PESO_OBJETIVO) break;
  }
  imagen.close?.();
  if (!mejor) throw new ErrorFoto('No se ha podido preparar la foto. Prueba con otra.');
  return mejor;
}

export const kb = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
