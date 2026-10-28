// Los datos de la versión de demostración (src/main/demo/datos.ts): que la grilla entre ENTERA por el
// importador, sin un solo dato raro, y que cada pantalla tenga qué mostrar el día que se abre la demo.
//
// Se prueba con varios «hoy» fijos —uno en el medio del año, uno a principios de marzo y uno a
// principios de enero, donde las planillas cruzan diciembre → enero y el año se deduce por el orden—,
// con el camino de la HojaSimulada y el de la FuenteVps contra el VPS simulado, que es el que usa la demo.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { armarDatosDeLaDemo, ENCABEZADOS_APP_DE_LA_DEMO, MESES_DE_LA_DEMO, type DatosDeLaDemo } from '../src/main/demo/datos'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import type { FuenteHoja } from '../src/main/importacion/fuente'
import { ahoraIso, normalizarTexto } from '../src/main/importacion/normalizar'
import { clasificarPestanas } from '../src/main/importacion/pestanas'
import { bajarCatalogo, estadoDelCatalogo, marcasDelCatalogo, usarFuenteDePrueba } from '../src/main/servicios/catalogoVehiculos'
import { PESTANAS_DE_LA_APP } from '../src/main/sincronizacion/pestanasApp'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import { USUARIOS_DE_LA_DEMO } from '../src/shared/demo'
import { ramaDeVehiculo, RAMAS } from '../src/shared/ramas'
import { calcularAlerta, type ColorAlerta } from '../src/shared/semaforo'
import { sucursalCanonica, SUCURSALES } from '../src/shared/sucursales'
import type { InformeImportacion } from '../src/shared/tipos'
import { HojaSimulada } from './hoja-simulada'

/** Los avisos que el informe da siempre con una hoja así, y que no son datos raros. */
const AVISOS_ESPERADOS = [
  // Las planillas del año en curso van sin año en el título, como las titula la agencia.
  /^Planillas sin año en el título; se dedujo por el orden de las pestañas/,
  // AMP y las pestañas APP no son tablas del importador «clásico»: se guardan también en filas crudas.
  /^Pestañas que se guardan completas en filas crudas pero todavía no tienen mapeo a una tabla/,
]

const DIAS = ['2026-10-27', '2027-03-05', '2027-01-08']

function fechaLocal(iso: string, hora = 10): Date {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return new Date(anio!, mes! - 1, dia!, hora, 0, 0)
}

function diaDe(iso: string): number {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(anio!, mes! - 1, dia!) / 86_400_000)
}

function isoDe(dia: number): string {
  return new Date(dia * 86_400_000).toISOString().slice(0, 10)
}

/** Una base nueva en una carpeta temporal, con los usuarios de la demo (las tareas se asignan por nombre). */
function baseNueva(): { db: BaseDeDatos; carpeta: string } {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-demo-'))
  const registrar = console.log
  console.log = () => undefined
  let db: BaseDeDatos
  try {
    db = abrirBaseDeDatos(path.join(carpeta, 'dm.db'))
  } finally {
    console.log = registrar
  }
  const clave = (db.prepare(`SELECT clave_hash FROM usuarios ORDER BY id LIMIT 1`).get() as { clave_hash: string }).clave_hash
  for (const u of USUARIOS_DE_LA_DEMO) {
    const sucursal = db.prepare('SELECT id FROM sucursales WHERE nombre = ?').get(u.sucursal) as { id: number }
    db.prepare(
      `INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
       VALUES (?, ?, ?, ?, ?, 1, 0)
       ON CONFLICT(usuario) DO UPDATE SET nombre = excluded.nombre, rol = excluded.rol, sucursal_id = excluded.sucursal_id`,
    ).run(u.nombre, u.usuario, clave, u.rol, sucursal.id)
  }
  return { db, carpeta }
}

function cerrar(carpeta: string): void {
  cerrarBaseDeDatos()
  rmSync(carpeta, { recursive: true, force: true })
}

async function importar(db: BaseDeDatos, fuente: FuenteHoja, hoy: string): Promise<InformeImportacion> {
  const [anio, mes] = hoy.split('-').map(Number)
  const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
  const informe = await ejecutarImportacion({ db, fuente, importacionId: id, anioActual: anio, mesActual: mes })
  db.prepare('UPDATE importaciones SET terminada_en = ?, estado = ? WHERE id = ?').run(informe.terminadaEn, informe.estado, id)
  return informe
}

function contar(db: BaseDeDatos, sql: string, ...parametros: unknown[]): number {
  return (db.prepare(sql).get(...(parametros as [])) as { n: number }).n
}

/** Lo que el informe dice que salió mal, para que el mensaje de la prueba diga qué arreglar. */
function resumenDeProblemas(informe: InformeImportacion): string {
  return [
    ...informe.problemas.slice(0, 30).map((p) => `[${p.pestana}] fila ${p.fila ?? '-'}: ${p.tipo} — ${p.detalle}`),
    ...informe.avisos.filter((a) => !AVISOS_ESPERADOS.some((r) => r.test(a))).map((a) => `AVISO: ${a}`),
  ].join('\n')
}

/** Revisa el informe y el contenido de la base importada con los datos de ese día. */
function revisarLaBase(db: BaseDeDatos, informe: InformeImportacion, hoy: string, datos: DatosDeLaDemo): void {
  // --- El informe: completa y limpia.
  assert.equal(informe.error, null)
  assert.equal(informe.estado, 'COMPLETA', resumenDeProblemas(informe))
  assert.deepEqual(informe.sucursalesDesconocidas, {}, 'ninguna sucursal fuera de catálogo')
  assert.equal(informe.problemas.length, 0, resumenDeProblemas(informe))
  assert.equal(informe.totales.problemas, 0, resumenDeProblemas(informe))
  for (const aviso of informe.avisos) assert.ok(AVISOS_ESPERADOS.some((r) => r.test(aviso)), `aviso inesperado: ${aviso}`)
  for (const pestana of informe.pestanas) {
    assert.equal(pestana.estado, 'lista', `«${pestana.titulo}» quedó en ${pestana.estado}`)
    assert.equal(pestana.idsNuevos, 0, `«${pestana.titulo}» tenía filas sin _ID`)
    // (Las bajas sí quedan «sin póliza conocida»: la póliza dada de baja ya no está en la planilla más
    // nueva, que es la única que crea pólizas. Así pasa también con la hoja real.)
    for (const clave of ['tareas_sin_ficha', 'anexos_sin_ficha', 'siniestros_sin_cliente_en_cartera', 'riesgos_sin_cliente_en_cartera']) {
      assert.equal(pestana.registros[clave] ?? 0, 0, `«${pestana.titulo}»: ${clave}`)
    }
    // Ninguna fila con datos se quedó sin guardar en su tabla.
    const guardadas = Object.entries(pestana.registros)
      .filter(([clave]) => !['filas_crudas', 'clientes_unificados', 'cuotas_sin_poliza_vigente', 'bajas_sin_poliza_conocida', 'cuotas_con_texto'].includes(clave))
      .reduce((suma, [clave, n]) => suma + (['vehiculos', 'polizas', 'clientes'].includes(clave) && pestana.tipo === 'MENSUAL' ? 0 : n), 0)
    if (pestana.tipo !== 'MENSUAL') assert.equal(guardadas, pestana.filasConDatos, `«${pestana.titulo}» guardó ${guardadas} de ${pestana.filasConDatos} filas`)
  }

  // --- La planilla del mes en curso es la más nueva y es la de hoy.
  const periodo = hoy.slice(0, 7)
  const masNueva = informe.pestanas.find((p) => p.titulo === informe.pestanaMasNueva)
  assert.equal(masNueva?.periodo, periodo, 'la planilla del mes en curso es la más nueva')
  const periodos = (db.prepare('SELECT DISTINCT periodo FROM cuotas_mes ORDER BY periodo').all() as Array<{ periodo: string }>).map((p) => p.periodo)
  assert.equal(periodos.length, MESES_DE_LA_DEMO)
  assert.equal(periodos[periodos.length - 1], periodo)

  // --- Volumen.
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM clientes') >= 250, 'al menos 250 clientes')
  const activas = contar(db, 'SELECT COUNT(*) AS n FROM polizas WHERE activa = 1')
  assert.ok(activas >= 250, `pólizas activas: ${activas}`)

  // --- Todas las ramas y todas las sucursales.
  const tipos = db.prepare('SELECT v.tipo FROM polizas p JOIN vehiculos v ON v.id = p.vehiculo_id WHERE p.activa = 1').all() as Array<{ tipo: string | null }>
  const ramas = new Set(tipos.map((t) => ramaDeVehiculo(t.tipo)))
  for (const rama of RAMAS) assert.ok(ramas.has(rama), `hay pólizas de ${rama}`)
  const sucursales = new Set(
    (db.prepare('SELECT DISTINCT sucursal_texto AS s FROM cuotas_mes WHERE periodo = ?').all(periodo) as Array<{ s: string }>).map((f) => sucursalCanonica(f.s)),
  )
  for (const sucursal of SUCURSALES) assert.ok(sucursales.has(sucursal), `hay cuotas de ${sucursal}`)
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM clientes WHERE sucursal_id IS NULL'), 0, 'todos los clientes con sucursal')

  // --- El semáforo del mes en curso: de todos los colores, con vencimientos hoy y esta semana.
  const cuotas = db
    .prepare(
      `SELECT c.fila_id, c.dia_vencimiento_numero AS dia, c.pago_fecha, c.forma_pago,
              EXISTS (SELECT 1 FROM pagos pg WHERE pg.cuota_fila_id = c.fila_id AND pg.estado_cobro = 'PAGO') AS pagada_app,
              EXISTS (SELECT 1 FROM pagos pg WHERE pg.cuota_fila_id = c.fila_id AND pg.estado_cobro = 'IMPUTADO') AS imputada
         FROM cuotas_mes c WHERE c.periodo = ? AND c.dada_de_baja = 0`,
    )
    .all(periodo) as Array<{ fila_id: string; dia: number | null; pago_fecha: string | null; forma_pago: string | null; pagada_app: number; imputada: number }>
  const colores = new Map<ColorAlerta, number>()
  let vencenHoy = 0
  let vencenEstaSemana = 0
  for (const c of cuotas) {
    const pagada = c.pago_fecha !== null || c.pagada_app === 1
    const alerta = calcularAlerta({ periodo, diaVencimiento: c.dia, pagada, formaPago: c.forma_pago, diasCobertura: 7, imputada: c.imputada === 1 && !pagada }, hoy)
    colores.set(alerta.color, (colores.get(alerta.color) ?? 0) + 1)
    if (alerta.etiqueta === 'Vence hoy') vencenHoy++
    if (!pagada && alerta.diasParaVencer !== null && alerta.diasParaVencer >= 1 && alerta.diasParaVencer <= 7) vencenEstaSemana++
    if (pagada && c.pago_fecha) assert.ok(c.pago_fecha <= hoy, `pago en el futuro: ${c.pago_fecha}`)
  }
  assert.ok(vencenHoy >= 5, `vencen hoy: ${vencenHoy}`)
  for (const color of ['verde', 'azul', 'rojo', 'violeta'] as ColorAlerta[]) assert.ok((colores.get(color) ?? 0) > 0, `hay filas en ${color}: ${JSON.stringify([...colores])}`)
  const pagadas = colores.get('verde') ?? 0
  assert.ok(pagadas > 50 && pagadas < cuotas.length - 30, `pagadas ${pagadas} de ${cuotas.length}`)
  // El último día del mes no tiene «esta semana» dentro del mes.
  const finDeMes = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 0)).getUTCDate() - Number(hoy.slice(8, 10)) < 2
  if (!finDeMes) assert.ok(vencenEstaSemana >= 5, `vencen esta semana: ${vencenEstaSemana}`)

  // --- Deudores: cuotas de meses anteriores sin pagar, de quien no paga por débito.
  const deudas = contar(
    db,
    `SELECT COUNT(DISTINCT c.poliza_id) AS n FROM cuotas_mes c
      WHERE c.periodo < ? AND c.pago_fecha IS NULL AND c.dada_de_baja = 0
        AND NOT EXISTS (SELECT 1 FROM pagos pg WHERE pg.cuota_fila_id = c.fila_id)
        AND c.forma_pago NOT IN ('TARJETA', 'CBU')`,
    periodo,
  )
  assert.ok(deudas >= 8, `deudores de meses anteriores: ${deudas}`)

  // --- Renovaciones: vencen en los próximos 60 días, incluidas las de renovación manual, y alguna vencida.
  const hoyDia = diaDe(hoy)
  const proximas = db
    .prepare(`SELECT compania FROM polizas WHERE activa = 1 AND vigencia_hasta_iso >= ? AND vigencia_hasta_iso <= ?`)
    .all(hoy, isoDe(hoyDia + 60)) as Array<{ compania: string }>
  assert.ok(proximas.length >= 20, `renovaciones próximas: ${proximas.length}`)
  const manuales = proximas.filter((p) => ['AGROSALTA', 'RIO URUGUAY', 'METROPOL'].includes(p.compania)).length
  assert.ok(manuales >= 3, `renovaciones manuales próximas: ${manuales}`)
  const vencidas = contar(db, 'SELECT COUNT(*) AS n FROM polizas WHERE activa = 1 AND vigencia_hasta_iso < ? AND vigencia_hasta_iso >= ?', hoy, isoDe(hoyDia - 30))
  assert.ok(vencidas >= 2, `renovaciones vencidas sin renovar: ${vencidas}`)
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM polizas WHERE activa = 1 AND (vigencia_hasta_iso IS NULL OR vigencia_desde_iso IS NULL)'), 0)
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM polizas WHERE activa = 1 AND observaciones LIKE '%AUMENTAR CUANDO SE RENUEVA%'`) >= 1)

  // --- Bajas, siniestros, AMP, riesgos varios, reglas.
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM bajas') >= 20)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM bajas WHERE periodo = ?', periodo) >= 1, 'bajas del mes en curso')
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM bajas WHERE periodo IS NULL OR motivo IS NULL OR fecha_baja_iso IS NULL'), 0)
  const siniestros = contar(db, 'SELECT COUNT(*) AS n FROM siniestros')
  assert.ok(siniestros >= 20 && siniestros <= 40, `siniestros: ${siniestros}`)
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM siniestros WHERE cliente_id IS NULL OR poliza_id IS NULL OR fecha_iso IS NULL'), 0)
  assert.ok(contar(db, `SELECT COUNT(DISTINCT estado) AS n FROM siniestros`) >= 4, 'siniestros en varios estados')
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM amp WHERE resuelto = 0') >= 2, 'AMP pendientes')
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM amp WHERE resuelto = 1') >= 2, 'AMP resueltas')
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM amp WHERE poliza_id IS NULL'), 0)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM riesgos_varios WHERE cliente_id IS NOT NULL') >= 20)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM reglas_cobertura') >= 30)

  // --- Lo comercial: leads, presupuestos, tareas, comentarios.
  const leads = contar(db, 'SELECT COUNT(*) AS n FROM leads')
  assert.ok(leads >= 30 && leads <= 60, `leads: ${leads}`)
  assert.ok(contar(db, 'SELECT COUNT(DISTINCT origen) AS n FROM leads') >= 4)
  assert.ok(contar(db, 'SELECT COUNT(DISTINCT estado) AS n FROM leads') >= 4)
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM leads WHERE sucursal_id IS NULL'), 0)
  const presupuestos = contar(db, 'SELECT COUNT(*) AS n FROM presupuestos')
  assert.ok(presupuestos >= 15, `presupuestos: ${presupuestos}`)
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM presupuestos p WHERE NOT EXISTS (SELECT 1 FROM presupuesto_opciones o WHERE o.presupuesto_id = p.id)'), 0)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM presupuestos WHERE lead_id IS NOT NULL') >= 8)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM presupuestos WHERE cliente_id IS NOT NULL') >= 3)
  const tareas = contar(db, 'SELECT COUNT(*) AS n FROM tareas')
  assert.ok(tareas >= 20, `tareas: ${tareas}`)
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM tareas WHERE responsable_id IS NULL'), 0, 'todas las tareas con responsable')
  assert.equal(contar(db, 'SELECT COUNT(DISTINCT responsable_id) AS n FROM tareas'), USUARIOS_DE_LA_DEMO.length, 'todos los usuarios tienen tareas')
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM tareas WHERE estado <> 'hecha' AND vence_el < ?`, hoy) >= 3, 'tareas vencidas')
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM tareas WHERE estado = 'hecha'`) >= 3, 'tareas hechas')
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM tareas WHERE siniestro_id IS NOT NULL`) >= 1)
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM tareas WHERE lead_id IS NOT NULL AND presupuesto_id IS NULL`) >= 1)
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM tareas WHERE presupuesto_id IS NOT NULL`) >= 1)
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM tareas WHERE poliza_id IS NOT NULL AND siniestro_id IS NULL`) >= 1)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM lead_notas') >= 20)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM tarea_comentarios') >= 3)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM siniestro_observaciones') >= 5)

  // --- Cobranzas: pagos del mostrador enganchados a su cuota, caja de los últimos días, rechazos.
  const pagos = contar(db, 'SELECT COUNT(*) AS n FROM pagos')
  assert.ok(pagos >= 40, `pagos: ${pagos}`)
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM pagos p WHERE NOT EXISTS (SELECT 1 FROM cuotas_mes c WHERE c.fila_id = p.cuota_fila_id)'), 0, 'cada pago con su cuota')
  assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM pagos WHERE fecha_iso IS NULL OR importe_monto IS NULL OR periodo IS NULL OR cliente_id IS NULL OR poliza_id IS NULL'), 0)
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM pagos WHERE fecha_iso = ? OR fecha_iso = ?`, hoy, isoDe(hoyDia - 1)) >= 1, 'cobros de hoy o de ayer')
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM pagos WHERE estado_cobro = 'IMPUTADO'`) >= 2)
  // El historial de la ficha del cliente: meses de pagos y no sólo los últimos días, uno por cuota pagada.
  assert.ok(contar(db, 'SELECT COUNT(DISTINCT periodo) AS n FROM pagos') >= 6, 'pagos de varios meses')
  assert.ok(contar(db, `SELECT COUNT(DISTINCT cliente_id) AS n FROM pagos`) >= contar(db, 'SELECT COUNT(*) AS n FROM clientes') * 0.7, 'la mayoría de los clientes tiene pagos')
  const periodosDePagos = (db.prepare('SELECT DISTINCT periodo FROM pagos ORDER BY periodo').all() as Array<{ periodo: string }>).map((x) => x.periodo)
  for (const periodo of periodosDePagos) {
    // Lo cobrado de un mes sale de los pagos y las «cuotas cobradas» de la planilla: tienen que ser las mismas.
    const cobradas = contar(db, `SELECT COUNT(*) AS n FROM cuotas_mes WHERE periodo = ? AND pago_fecha IS NOT NULL AND dada_de_baja = 0 AND poliza_id IN (SELECT id FROM polizas WHERE activa = 1)`, periodo)
    const pagadas = contar(db, `SELECT COUNT(*) AS n FROM pagos WHERE periodo = ? AND estado_cobro = 'PAGO'`, periodo)
    assert.equal(pagadas, cobradas, `${periodo}: un pago por cuota cobrada`)
  }
  // Los meses cerrados ya se rindieron: sin cobros pendientes de revisar de hace meses.
  assert.equal(contar(db, `SELECT COUNT(*) AS n FROM pagos WHERE periodo < ? AND COALESCE(resultado, '') = ''`, hoy.slice(0, 7)), 0, 'sin rendiciones pendientes de meses cerrados')

  // --- Siniestros: la línea de tiempo y la observación cuentan lo que pasó.
  assert.equal(
    contar(db, `SELECT COUNT(*) AS n FROM siniestros s WHERE s.estado = 'CERRADO' AND NOT EXISTS (
        SELECT 1 FROM siniestro_observaciones o WHERE o.siniestro_id = s.id AND (o.texto LIKE '%liquid%' OR o.texto LIKE '%rechaz%'))`),
    0,
    'todo siniestro CERRADO llega hasta la liquidación o el rechazo',
  )
  assert.equal(
    contar(db, `SELECT COUNT(*) AS n FROM siniestros s JOIN siniestro_observaciones o ON o.siniestro_id = s.id WHERE substr(o.creado_en, 1, 10) < s.fecha_carga_iso`),
    0,
    'la línea de tiempo arranca el día de la carga, no antes',
  )
  assert.equal(contar(db, `SELECT COUNT(*) AS n FROM siniestros WHERE observaciones LIKE '%REPARADO%' AND (descripcion LIKE '%ROBO%' OR cobertura = 'RC')`), 0, 'sin «reparado» en robos ni RC')
  assert.equal(contar(db, `SELECT COUNT(*) AS n FROM siniestros WHERE observaciones LIKE '%TERCERO%' AND COALESCE(tercero_compania, '') = ''`), 0, 'sin «falta el registro del tercero» si no hay tercero')
  assert.equal(contar(db, `SELECT COUNT(*) AS n FROM siniestros WHERE descripcion LIKE '%CHOCARON%' AND COALESCE(tercero_compania, '') = ''`), 0, 'los datos del tercero de «lo chocaron»')
  assert.equal(contar(db, `SELECT COUNT(*) AS n FROM siniestros WHERE cobertura = 'RC' AND descripcion NOT LIKE 'RECLAMO%' AND descripcion NOT LIKE 'CAIDA EN MOTO%' AND descripcion NOT LIKE 'ROBO%'`), 0, 'una RC sólo denuncia reclamos de terceros')
  // El de la Hilux, que cuelga de la tarea que pide al perito: con una cobertura que cubre el daño propio.
  assert.equal(
    contar(db, `SELECT COUNT(*) AS n FROM siniestros s JOIN polizas p ON p.id = s.poliza_id JOIN vehiculos v ON v.id = p.vehiculo_id WHERE v.modelo LIKE '%HILUX%' AND s.fecha_carga_iso = ? AND s.cobertura = 'RC'`, hoy),
    0,
    'la Hilux de hoy no es una RC',
  )
  const caja = contar(db, 'SELECT COUNT(*) AS n FROM caja_movimientos')
  assert.ok(caja >= 40, `movimientos de caja: ${caja}`)
  assert.equal(contar(db, `SELECT COUNT(DISTINCT sucursal) AS n FROM caja_movimientos`), SUCURSALES.length)
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM caja_movimientos WHERE tipo = 'APERTURA' AND fecha_iso = ?`, hoy) >= 1 || new Date(`${hoy}T12:00:00Z`).getUTCDay() === 0)
  assert.ok(contar(db, `SELECT COUNT(*) AS n FROM caja_movimientos WHERE tipo = 'CIERRE'`) >= 20)
  assert.ok(contar(db, 'SELECT COUNT(*) AS n FROM rechazos_debito WHERE poliza_id IS NOT NULL') >= 3)

  // --- Lo que el VPS manda aparte: el catálogo cubre las marcas de la cartera.
  const marcasDelCatalogo = new Set(datos.vehiculos.map((v) => String(v.marca)))
  const marcasDeLaCartera = db
    .prepare(`SELECT DISTINCT v.marca, v.tipo FROM polizas p JOIN vehiculos v ON v.id = p.vehiculo_id WHERE p.activa = 1 AND v.tipo <> 'TRAILER'`)
    .all() as Array<{ marca: string }>
  for (const { marca } of marcasDeLaCartera) assert.ok(marcasDelCatalogo.has(marca), `la marca ${marca} está en el catálogo`)
}

test('datos de la demo: la grilla es determinista y con la forma que escribe la aplicación', () => {
  const datos = armarDatosDeLaDemo(fechaLocal('2026-10-27', 9))
  assert.deepEqual(datos, armarDatosDeLaDemo(fechaLocal('2026-10-27', 9)), 'el mismo instante da exactamente la misma grilla')
  // A otra hora del mismo día sólo cambia la hora de los comentarios de HOY (se cuentan hacia atrás desde ahora).
  const tarde = armarDatosDeLaDemo(fechaLocal('2026-10-27', 23))
  assert.deepEqual(datos.vehiculos, tarde.vehiculos)
  assert.equal(datos.pestanas.length, tarde.pestanas.length)
  datos.pestanas.forEach((pestana, n) => {
    const otra = tarde.pestanas[n]!
    assert.equal(pestana.titulo, otra.titulo)
    if (pestana.titulo !== 'APP COMENTARIOS') return assert.deepEqual(pestana.valores, otra.valores, `«${pestana.titulo}» igual a cualquier hora`)
    const columna = pestana.valores[0]!.indexOf('FECHA')
    pestana.valores.forEach((fila, i) => {
      const gemela = otra.valores[i]!
      if (i === 0 || !fila[columna]!.startsWith('2026-10-27')) return assert.deepEqual(fila, gemela)
      assert.deepEqual(fila.filter((_, c) => c !== columna), gemela.filter((_, c) => c !== columna), 'sólo cambia la hora de los comentarios de hoy')
    })
  })
  assert.notDeepEqual(datos.pestanas, armarDatosDeLaDemo(fechaLocal('2026-10-28')).pestanas, 'otro día corre las fechas')

  const titulos = datos.pestanas.map((p) => p.titulo)
  assert.equal(new Set(titulos).size, titulos.length, 'títulos únicos')
  assert.ok(!titulos.includes('APP ADJUNTOS'), 'sin adjuntos: no hay archivos')
  // Las pestañas de la aplicación van al final, en el orden en que las crea el programa, con sus encabezados.
  const deLaApp = PESTANAS_DE_LA_APP.filter((p) => p.titulo !== 'APP ADJUNTOS')
  assert.deepEqual(titulos.slice(-deLaApp.length), deLaApp.map((p) => p.titulo))
  for (const pestana of deLaApp) {
    assert.deepEqual(ENCABEZADOS_APP_DE_LA_DEMO[pestana.titulo], pestana.encabezados, `encabezados de «${pestana.titulo}»`)
    assert.deepEqual(datos.pestanas.find((p) => p.titulo === pestana.titulo)?.valores[0], pestana.encabezados)
  }

  // Cada fila de cada pestaña tiene su _ID, y no se repite en toda la grilla.
  const ids = new Set<string>()
  for (const pestana of datos.pestanas) {
    const columna = pestana.valores[0]!.indexOf('_ID')
    assert.ok(columna >= 0, `«${pestana.titulo}» tiene columna _ID`)
    for (const fila of pestana.valores.slice(1)) {
      assert.equal(fila.length, pestana.valores[0]!.length, `«${pestana.titulo}»: fila del ancho de los encabezados`)
      const id = fila[columna]!
      assert.ok(id, `«${pestana.titulo}»: fila sin _ID`)
      assert.ok(!ids.has(id), `_ID repetido: ${id}`)
      ids.add(id)
    }
  }

  // El catálogo: autos y motos, con años, sin repetir códigos.
  assert.ok(datos.vehiculos.length >= 60 && datos.vehiculos.length <= 150, `vehículos del catálogo: ${datos.vehiculos.length}`)
  assert.equal(new Set(datos.vehiculos.map((v) => v.mtm)).size, datos.vehiculos.length)
  for (const v of datos.vehiculos) {
    assert.ok(v.tipo === 'AUTO' || v.tipo === 'MOTO')
    assert.ok(Array.isArray(v.anios) && (v.anios as number[]).length > 0)
  }
})

test('datos de la demo: el año de las planillas se deduce bien también al cruzar diciembre → enero', () => {
  for (const hoy of DIAS) {
    const datos = armarDatosDeLaDemo(fechaLocal(hoy))
    const [anio, mes] = hoy.split('-').map(Number)
    const clasificadas = clasificarPestanas(
      datos.pestanas.map((p, indice) => ({ titulo: p.titulo, indice })),
      anio,
      mes,
    )
    const mensuales = clasificadas.filter((p) => p.tipo === 'MENSUAL')
    assert.equal(mensuales.length, MESES_DE_LA_DEMO)
    assert.equal(mensuales[mensuales.length - 1]!.periodo, hoy.slice(0, 7), `${hoy}: la última es la del mes en curso`)
    for (let i = 1; i < mensuales.length; i++) {
      const [a, m] = mensuales[i - 1]!.periodo!.split('-').map(Number)
      const esperado = `${m === 12 ? a! + 1 : a}-${String(m === 12 ? 1 : m! + 1).padStart(2, '0')}`
      assert.equal(mensuales[i]!.periodo, esperado, `${hoy}: «${mensuales[i]!.titulo}» sigue a «${mensuales[i - 1]!.titulo}»`)
    }
    // Cada pestaña de bajas cae en el período de la planilla que tiene al lado.
    for (const bajas of clasificadas.filter((p) => p.tipo === 'BAJAS')) {
      const planilla = clasificadas[bajas.indice - 1]!
      assert.equal(bajas.periodo, planilla.periodo, `${hoy}: «${bajas.titulo}»`)
    }
  }
})

for (const hoy of DIAS) {
  test(`datos de la demo (${hoy}): la grilla entra entera y limpia por el importador`, async () => {
    const datos = armarDatosDeLaDemo(fechaLocal(hoy))
    const { db, carpeta } = baseNueva()
    try {
      const informe = await importar(db, new HojaSimulada(datos.pestanas, { titulo: 'GENERAL DE CLIENTES (DEMO)' }), hoy)
      revisarLaBase(db, informe, hoy, datos)

      // Una segunda importación de la misma grilla no cambia nada: no hay _ID que escribir ni filas nuevas.
      const antes = contar(db, 'SELECT COUNT(*) AS n FROM cuotas_mes') + contar(db, 'SELECT COUNT(*) AS n FROM clientes')
      const segunda = await importar(db, new HojaSimulada(datos.pestanas), hoy)
      assert.equal(segunda.estado, 'COMPLETA')
      assert.equal(segunda.problemas.length, 0, resumenDeProblemas(segunda))
      assert.equal(contar(db, 'SELECT COUNT(*) AS n FROM cuotas_mes') + contar(db, 'SELECT COUNT(*) AS n FROM clientes'), antes)
      assert.equal(segunda.totales.polizasInactivadas, 0)
    } finally {
      cerrar(carpeta)
    }
  })
}

/**
 * El `fetch` de verdad, tomado al cargar el archivo: antes de que corra ninguna prueba. Otras pruebas del
 * banco lo reemplazan por uno falso y, si alguna se olvida de devolverlo, ésta —la que habla por HTTP con
 * el simulador— no puede quedar a merced de eso.
 */
const fetchDeVerdad = globalThis.fetch

test('datos de la demo: entran por el VPS simulado, con el catálogo de vehículos', async (t) => {
  const fetchPuesto = globalThis.fetch
  globalThis.fetch = fetchDeVerdad
  t.after(() => {
    globalThis.fetch = fetchPuesto
  })
  const hoy = DIAS[0]!
  const datos = armarDatosDeLaDemo(fechaLocal(hoy))
  const vps = new VpsSimulado({ pestanas: datos.pestanas })
  vps.cargarVehiculos(datos.vehiculos as Parameters<VpsSimulado['cargarVehiculos']>[0])
  await vps.escuchar()
  const { db, carpeta } = baseNueva()
  try {
    const fuente = new FuenteVps({ urlBase: vps.url, token: vps.token })
    const informe = await importar(db, fuente, hoy)
    revisarLaBase(db, informe, hoy, datos)
    // El importador no escribió nada en la base del servidor: todas las filas ya traían su _ID.
    assert.equal(vps.llamadas.tramos, 0)

    // El catálogo maestro baja entero y ofrece las marcas de la cartera.
    usarFuenteDePrueba(fuente)
    await bajarCatalogo()
    const estado = estadoDelCatalogo()
    assert.equal(estado.porTipo.reduce((suma, t) => suma + t.versiones, 0), datos.vehiculos.length)
    const marcas = marcasDelCatalogo('AUTO').map((m) => normalizarTexto(m.id))
    for (const marca of ['VOLKSWAGEN', 'FIAT', 'TOYOTA', 'FORD']) assert.ok(marcas.includes(marca), `marca ${marca} en el catálogo de autos`)
    assert.ok(marcasDelCatalogo('MOTO').length >= 5)
  } finally {
    usarFuenteDePrueba(null)
    cerrar(carpeta)
    await vps.cerrar()
  }
})
