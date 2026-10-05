// Limitador de peticiones en memoria (ventana deslizante) para los accesos
// públicos por QR. Al reiniciar el servidor se vacía, y es suficiente: solo
// frena abusos, no es un control de seguridad (el token ya es indescifrable).
export function crearLimitador({ ventanaMs, max, ahora = Date.now }) {
  const intentos = new Map(); // clave -> marcas de tiempo dentro de la ventana

  function purgar(clave, t) {
    const marcas = (intentos.get(clave) ?? []).filter((m) => t - m < ventanaMs);
    if (marcas.length) intentos.set(clave, marcas);
    else intentos.delete(clave);
    return marcas;
  }

  return {
    // Registra un intento y devuelve false si se ha superado el límite.
    intentar(clave) {
      const t = ahora();
      const marcas = purgar(clave, t);
      if (marcas.length >= max) return false;
      marcas.push(t);
      intentos.set(clave, marcas);
      return true;
    },
    // Consulta sin registrar.
    permitido(clave) {
      return purgar(clave, ahora()).length < max;
    },
    // Libera memoria de claves caducadas (se llama de vez en cuando).
    limpiar() {
      const t = ahora();
      for (const clave of [...intentos.keys()]) purgar(clave, t);
    },
    get tamano() { return intentos.size; },
  };
}
