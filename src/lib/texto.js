// Minúsculas y sin tildes: base de las búsquedas y de la comparación de nombres.
export function normalizar(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function ahora() {
  return new Date().toISOString();
}
