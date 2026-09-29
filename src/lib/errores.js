export class ErrorApi extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

export const noEncontrado = (que) => new ErrorApi(404, `${que} no encontrado`);
export const datosNoValidos = (detalles) => new ErrorApi(400, 'Hay datos no válidos', detalles);
