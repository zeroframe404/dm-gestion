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
  // La 22 crea las cuatro listas del módulo Compañías: organizadores, precios, grúas y cláusulas.
  22: '4d113d5ecb27a9a4',
  // La 23 lleva los adjuntos al VPS (fila_id, vps_id, sha256, miniatura…), crea `poliza_adjuntos`, da
  // fila_id a comentarios y observaciones, y suma los índices que faltaban en pagos, cuotas y pólizas.
  23: '99b8f3649faab088',
  // La 24 da a las tareas y a los presupuestos la clave de su vínculo («SINIESTRO:<_ID>», «LEAD:<_ID>»)
  // y a las notas de los leads su fila en la base (viajan por APP COMENTARIOS).
  24: '07924f5ab6b867a2',
  // La 25 crea la mensajería interna: conversaciones, participantes, mensajes con su estado de
  // envío, los acuses de entrega y lectura por destinatario, los adjuntos (con las mismas columnas
  // que `poliza_adjuntos`, para reusar la subida al VPS) y el cursor del carril.
  25: '921e1543cdefdda9',
  // La 26 le da tipo a los mensajes, para distinguir el zumbido de un mensaje que diga «zumbido».
  26: 'd6549d0715eb7b22',
  // La 27 crea caja_movimientos (la caja chica del mostrador: apertura, gastos, lo que baja a la
  // caja fuerte y el arqueo del cierre) y le suma a `pagos` el número de ticket y el tilde de revisión.
  27: '0d45daf3aac857e4',
  // La 28 crea metricas_cache: la caché local de las métricas que ahora calcula el servidor (el podio
  // de sucursales, primero), llenada por el aviso en vivo (ver vivo/grilla.ts; en la 13.2 lo traía el
  // vigía, que la 14.0 reemplazó por el canal). El comentario del SQL de esa migración sigue nombrando
  // a `sincronizacion/vigia.ts`, que ya no existe: las migraciones publicadas no se editan, ni siquiera
  // sus comentarios, así que queda aclarado acá y no allá.
  28: '3a654b789e365ef4',
  // La 29 trae el espejo de la colaboración en vivo (14.0): `perfiles` (la foto y el color de cada
  // persona), `mensaje_reacciones` (un emoji por persona y por mensaje) y los doce pasos que vuelven a
  // crear `mensajes` para que su CHECK de `tipo` acepte también LLAMADA. Ojo: la huella mira la forma
  // (columnas, tipos, valores por defecto, índices) y NO los CHECK ni los datos, así que lo que la
  // mueve son las dos tablas nuevas. Lo que la huella no ve lo prueban dos:
  //   - que la llamada se pueda guardar en el hilo → `colaboracion-en-vivo.prueba.ts`;
  //   - que rehacer `mensajes` no desenganche ningún acuse ni ningún archivo, con las claves foráneas
  //     prendidas y la tabla con datos → `esquema.prueba.ts`, «la migración 29 rehace mensajes…».
  29: 'af6f2ed764ba8b8d',
  // La 30 le suma a `historial` las dos columnas de «Deshacer»: `deshecho_en` y `deshecho_por`. No
  // borra ni pisa nada —el registro sigue siendo el mismo de siempre—, sólo anota si a ESE cambio ya
  // se le dio vuelta y quién lo hizo, para no ofrecer el botón dos veces sobre el mismo renglón.
  30: '5cac24e3d6e30267',
  // La 31 rehace caja_movimientos para que `tipo` acepte OBSERVACION (los doce pasos de la 29, esta vez
  // sobre la caja). La huella no se mueve: mira columnas, tipos, defaults e índices, y ninguno cambia
  // (la tabla vuelve con la misma forma exacta); lo único distinto es el CHECK, que la huella no ve —
  // lo prueba la observación no siendo rechazada en caja.prueba.ts.
  31: '5cac24e3d6e30267',
  // La 32 suma a `cuotas_mes` la columna `obs_pago`: la nota de la liquidación, al lado de Sucursal en
  // la planilla, aparte de `observaciones`.
  32: '48dbd87014b3b103',
}
