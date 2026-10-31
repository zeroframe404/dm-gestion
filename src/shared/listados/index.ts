// Contrato de los listados de Cartera (Asegurados, Pólizas, Siniestros y Vencimientos) y de Cobranzas
// (Vencimientos de Cuotas, Rechazos y Comisiones).
//
// Cada listado es una consulta de SÓLO LECTURA (JOINs al leer, sin columnas ni migraciones nuevas) más
// una exportación a Excel local. Para que varias personas puedan construirlos en paralelo sin pisarse,
// el cableado ya está hecho UNA vez y no hay que volver a tocarlo:
//
//   canal IPC                  tipos (acá)                  servicio (proceso principal)        permiso
//   'listados:asegurados'      ./asegurados.ts              servicios/listadoAsegurados.ts      clientes
//   'listados:polizas'         ./polizas.ts                 servicios/listadoPolizas.ts         polizas
//   'listados:siniestros'      ./siniestros.ts              servicios/listadoSiniestros.ts      siniestros
//   'listados:vencimientos'    ./vencimientos.ts            servicios/listadoVencimientos.ts    renovaciones
//   'listados:cuotas'          ./cuotas.ts                  servicios/listadoCuotas.ts          cobranzas
//   'listados:rechazos'        ./rechazos.ts                servicios/listadoRechazos.ts        cobranzas
//   'listados:comisiones'      ./comisiones.ts              servicios/listadoComisiones.ts      cobranzas + rol ADMIN/SUPER_ADMIN
//
//   (Los de Cobranzas se abren desde Cobranzas → Vencimientos Cuotas / Rechazos / Comisiones, en
//   renderer/pantallas/cobranzas/listados/. Comisiones, además del área, exige rol ADMIN o SUPER_ADMIN
//   —igual que 'cobranzas:comisiones'— porque son números de la agencia, no del mostrador.)
//
//   Cableado ya hecho: shared/canales.ts (firma), shared/api.ts (window.dm.listados.*), preload/index.ts
//   y main/ipc.ts (exigirVista del área de la tabla + llamada al servicio).
//
// Cada canal recibe `Filtros` y devuelve `Fila[]`, con los tipos de SU archivo de acá. Quien es dueño
// de un listado cambia con libertad `Filtros` y `Fila` (agregar, quitar o renombrar campos) y la
// función `listar…` de su servicio; el compilador propaga el cambio hasta el canal y hasta
// `window.dm.listados.<x>(filtros)`. NO hace falta editar ipc.ts, preload, api.ts ni canales.ts.
//
// Reglas del contrato:
//   - La función exportada de cada servicio (listarAsegurados, listarPolizasDelListado,
//     listarSiniestrosDelListado, listarVencimientos, listarVencimientosDeCuotas,
//     listarRechazosDelListado, listarComisionesDelListado) se queda con ese nombre y con la forma
//     `(filtros) => Fila[]` (puede ser async si hace falta: ipc.ts la espera), porque ipc.ts la llama.
//   - Los filtros llegan del renderer sin validar: el servicio tiene que sanear lo que usa (textos,
//     fechas AAAA-MM-DD, listas) antes de armar la consulta, como el resto de los servicios.
//   - Sólo se lee. Nada de escribir en la base ni mandar algo al servidor (VPS): la beta y la normal
//     comparten servidor y no se puede cambiar lo que se escribe ahí.
//   - La paginación (10 por página) la hace el renderer con `Paginador`; el servicio devuelve todo lo
//     que cumple el filtro. Si un listado puede ser enorme, que el servicio ponga un tope y lo diga.
//   - Exportar a Excel: el renderer arma {titulo, columnas, filas} con lo que ya muestra y llama a
//     `exportarAExcel` (renderer/exportarAExcel.ts → canal 'listados:exportarExcel'), que guarda un
//     .xlsx local con el diálogo «Guardar como». Los tipos del pedido están en ./excel.ts.
//   - Los componentes de pantalla compartidos viven en renderer/componentes/listados/.
export * from './asegurados'
export * from './comisiones'
export * from './cuotas'
export * from './excel'
export * from './polizas'
export * from './rechazos'
export * from './siniestros'
export * from './vencimientos'
