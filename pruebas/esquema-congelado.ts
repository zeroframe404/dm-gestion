// Huella de la FORMA del esquema (tablas, columnas, tipos, valores por defecto e índices) que deja cada
// migración. Es el guardián de esquema.prueba.ts: una migración ya publicada no se puede editar, porque
// las bases que ya pasaron por esa versión nunca la vuelven a correr y se quedan sin el cambio. Así
// apareció el error «table filas_crudas has no column named huella» en la PC de Daniel.
//
// Si necesitás cambiar el esquema, agregá una versión NUEVA al final de MIGRACIONES y sumá su huella acá.
// Los comentarios y el formato del SQL no cuentan: la huella sólo cambia si cambia el esquema resultante.
export const HUELLAS_POR_VERSION: Record<number, string> = {
  1: 'd67f87442154e647',
  2: 'f2e1fde5bd4d005e',
  3: '813b3ceb7a4b4c85',
  4: 'f203a202ec76729e',
  5: '48cc0600e3ea0f69',
  6: 'b6486eea6e87fd4d',
  7: '8ca91c4c064ceaab',
  8: '5948f403e73cbc98',
  9: '48caf0f86c2c9cbc',
  10: '28bdb6b7642249f6',
  11: '3119b4f1eb136525',
  12: '5015fee4d15cffd6',
  13: 'fd05b8e5fd4af5fb',
  14: 'fd05b8e5fd4af5fb',
  // La 15 no toca la forma del esquema: siembra Sarandí y reescribe el texto de las sucursales.
  15: 'fd05b8e5fd4af5fb',
  // La 16 suma las partes de la dirección del cliente (calle, altura, provincia, código postal).
  16: 'bfb228d6238ad748',
  // La 17 crea publicaciones_redes: el historial de lo publicado en Facebook e Instagram.
  17: '8c5b02d9800d56b1',
  // La 18 crea la caché del catálogo de vehículos y las columnas de línea y categoría.
  18: '4f9827fa2494bd1e',
  // La 19 suma a `vehiculos` lo que piden los riesgos que no son vehículos: dirección, titular, integrantes.
  19: 'c2907470739eee1e',
  // La 20 suma a `pagos` el estado del cobro (PAGO / IMPUTADO) y el modo del pago adelantado.
  20: '6530ee7a3b141017',
  // La 21 suma a `siniestros` el abogado y los datos del tercero, y a `siniestro_adjuntos` su categoría.
  21: '5b6e250fc95c5b6e',
}
