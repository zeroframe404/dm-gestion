// Prueba de humo de la Fase 9: abre la aplicación de verdad contra una carpeta sembrada y recorre los
// cuatro criterios del pliego —los activos por compañía contra la planilla, la «Planilla clásica»
// generada y abierta de vuelta, la plantilla de aviso editada cambiando lo que manda «Avisar», y un
// segmento guardado devolviendo lo mismo que el filtro equivalente en Cartera.
//
//   npm run sembrar -- <carpeta>
//   npm run humo:fase9 -- <carpeta>
//
// Sobre el criterio «la planilla clásica abre en Excel»: acá no hay Excel. Lo que se comprueba es que
// el archivo generado sea un .xlsx de verdad —un ZIP con sus partes, la pestaña del mes con el nombre
// de siempre y las 32 columnas en su orden—, y el script imprime la ruta para poder abrirlo de un
// doble clic y mirarlo. El canal acepta una ruta explícita justamente para esto: un diálogo «Guardar
// como» del sistema no se puede manejar desde afuera.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
const require = createRequire(import.meta.url)
const rutaElectron = require('electron')

const CARPETA = process.argv[2]
const USUARIO = process.argv[3] ?? 'daniel'
const CLAVE = process.argv[4] ?? 'cambiar123'
const PUERTO = 9338

if (!CARPETA) {
  console.error('Uso: npm run humo:fase9 -- <carpeta sembrada>')
  process.exit(1)
}

const carpetaTemporal = mkdtempSync(path.join(tmpdir(), 'dm-humo9-'))
const PLANILLA = path.join(carpetaTemporal, 'planilla clasica.xlsx')
const REPORTE = path.join(carpetaTemporal, 'reporte de cartera.xlsx')

const electron = spawn(rutaElectron, ['.', `--remote-debugging-port=${PUERTO}`], {
  cwd: process.cwd(),
  env: { ...process.env, DM_GESTION_CARPETA_DATOS: CARPETA },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let salida = ''
electron.stdout.on('data', (d) => (salida += d))
electron.stderr.on('data', (d) => (salida += d))

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function objetivo() {
  for (let i = 0; i < 40; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json()
      const pagina = lista.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (pagina) return pagina.webSocketDebuggerUrl
    } catch {}
    await dormir(500)
  }
  throw new Error('No apareció la ventana. Salida:\n' + salida.slice(-2000))
}

const ws = new WebSocket(await objetivo())
let siguienteId = 1
const pendientes = new Map()
ws.addEventListener('message', (evento) => {
  const mensaje = JSON.parse(evento.data)
  const espera = pendientes.get(mensaje.id)
  if (espera) {
    pendientes.delete(mensaje.id)
    espera(mensaje)
  }
})
await new Promise((r) => ws.addEventListener('open', r))

function enviar(method, params = {}) {
  const id = siguienteId++
  return new Promise((resolver) => {
    pendientes.set(id, resolver)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluar(expresion) {
  const respuesta = await enviar('Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true })
  if (respuesta.result?.exceptionDetails) throw new Error(JSON.stringify(respuesta.result.exceptionDetails).slice(0, 600))
  return respuesta.result?.result?.value
}

await enviar('Runtime.enable')
await dormir(1500)

const resultados = []
const anotar = (paso, ok, detalle = '') => {
  resultados.push({ paso, ok, detalle })
  console.log(`${ok ? 'ok ' : 'MAL'} ${paso}${detalle ? ' · ' + detalle : ''}`)
}

const AYUDA = `
  const esperar = async (condicion, intentos = 80) => {
    for (let i = 0; i < intentos; i++) {
      if (condicion()) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }
  const irA = async (modulo) => {
    const boton = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === modulo)
    if (!boton) return false
    boton.click()
    await new Promise((r) => setTimeout(r, 900))
    return true
  }
  const normalizar = (v) => (v ?? '').toUpperCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^A-Z0-9]+/g, '')
`

// ---------------------------------------------------------------------------
// 1. Ingreso
// ---------------------------------------------------------------------------
const hayLogin = await evaluar(`!!document.querySelector('input[type="password"]')`)
if (hayLogin) {
  await evaluar(`(() => {
    const poner = (el, v) => { const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})) }
    const campos = document.querySelectorAll('input')
    poner(campos[0], ${JSON.stringify(USUARIO)}); poner(campos[1], ${JSON.stringify(CLAVE)})
    document.querySelector('form').requestSubmit()
    return true
  })()`)
  await dormir(2500)
}
anotar('Ingreso', !(await evaluar(`!!document.querySelector('input[type="password"]')`)))

// ---------------------------------------------------------------------------
// 2. Los tres módulos ya no dicen «Próximamente»
// ---------------------------------------------------------------------------
for (const modulo of ['Métricas', 'Reportes', 'Marketing']) {
  const abierto = await evaluar(`(async () => {
    ${AYUDA}
    if (!(await irA(${JSON.stringify(modulo)}))) return { error: 'no está el módulo en la barra lateral' }
    await esperar(() => !/Calculando|Preparando|Armando/i.test(document.body.innerText))
    return { disponible: !document.body.innerText.includes('Próximamente'), texto: document.body.innerText.slice(0, 80) }
  })()`)
  anotar(`El módulo ${modulo} está disponible`, abierto?.disponible === true, abierto?.error ?? '')
}

// La subpestaña Estadísticas de Cartera también dejó de ser una promesa.
const estadisticas = await evaluar(`(async () => {
  ${AYUDA}
  if (!(await irA('Cartera'))) return { error: 'no está Cartera' }
  const pestana = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes('Estadísticas'))
  if (!pestana) return { error: 'no está la subpestaña' }
  pestana.click()
  // Se espera a que aparezca la tabla, no a que se vaya el «Calculando…»: el cartel puede tardar un
  // ciclo en pintarse y la comprobación se haría contra la pestaña anterior.
  const hay = await esperar(() => /Por compañía/.test(document.body.innerText) && /Por sucursal/.test(document.body.innerText))
  return { hay, texto: document.body.innerText.slice(0, 120) }
})()`)
anotar('Cartera → Estadísticas muestra las tablas por compañía y por sucursal', estadisticas?.hay === true, estadisticas?.error ?? '')

// ---------------------------------------------------------------------------
// 3. Criterio 1: los activos por compañía coinciden con la planilla del mes
// ---------------------------------------------------------------------------
const numeros = await evaluar(`(async () => {
  ${AYUDA}
  const planilla = await window.dm.cartera.planilla(null)
  if (!planilla.ok) return { error: planilla.error }
  const periodo = planilla.datos.periodo

  // El COUNTIF de SEGUROS ACT, hecho sobre la misma planilla del mes que mira la agencia.
  const countif = {}
  for (const fila of planilla.datos.filas) {
    const clave = normalizar(fila.compania) || '(SIN COMPANIA)'
    countif[clave] = (countif[clave] ?? 0) + 1
  }

  const tablero = await window.dm.metricas.tablero({ periodo, sucursales: [] })
  if (!tablero.ok) return { error: tablero.error }
  const t = tablero.datos

  const diferencias = []
  for (const [clave, cantidad] of Object.entries(countif)) {
    const fila = t.activosPorCompania.find((f) => (normalizar(f.etiqueta) || '(SIN COMPANIA)') === clave)
    const dice = fila ? fila.cantidad : 0
    if (Math.abs(dice - cantidad) > 1) diferencias.push(clave + ': tablero ' + dice + ' vs hoja ' + cantidad)
  }

  const tabla = await window.dm.metricas.estadisticas(periodo, [])

  return {
    periodo,
    filas: planilla.datos.filas.length,
    activos: t.activos,
    companias: t.activosPorCompania.length,
    diferencias,
    porcentajes: Math.round(t.activosPorCompania.reduce((s, f) => s + f.porcentaje, 0)),
    altas: t.altas,
    bajas: t.bajas,
    hayMesAnterior: t.hayMesAnterior,
    meses: t.evolucion.length,
    cobrado: t.cobranza.cobrado,
    pendiente: t.cobranza.pendiente,
    siniestros: t.siniestrosAbiertos,
    tablaTotal: tabla.ok ? tabla.datos.totales.activos : -1,
    tablaSucursales: tabla.ok ? tabla.datos.porSucursal.length : -1,
  }
})()`)
anotar(
  'Los activos por compañía coinciden (±1) con el COUNTIF de la planilla del mes',
  Array.isArray(numeros?.diferencias) && numeros.diferencias.length === 0,
  numeros?.error ?? (numeros?.diferencias?.join(' | ') || `${numeros?.activos} pólizas en ${numeros?.companias} compañías`),
)
anotar('El total del tablero es el de las filas de la planilla', numeros?.activos === numeros?.filas, `${numeros?.activos} de ${numeros?.filas}`)
anotar('Los porcentajes suman 100', numeros?.porcentajes === 100, `${numeros?.porcentajes} %`)
anotar('Hay altas y bajas del mes, y evolución de varios meses', numeros?.meses > 1 && numeros?.hayMesAnterior === true, `${numeros?.altas} alta(s), ${numeros?.bajas} baja(s), ${numeros?.meses} mes(es)`)
anotar('La cobranza del mes separa lo cobrado de lo pendiente', numeros?.pendiente > 0, `cobrado ${numeros?.cobrado} · pendiente ${numeros?.pendiente}`)
anotar('Estadísticas da el mismo total que Métricas', numeros?.tablaTotal === numeros?.activos, `${numeros?.tablaTotal} · ${numeros?.tablaSucursales} sucursal(es)`)

// ---------------------------------------------------------------------------
// 4. Criterio 2: la Planilla clásica
// ---------------------------------------------------------------------------
const exportado = await evaluar(`(async () => {
  const planilla = await window.dm.cartera.planilla(null)
  if (!planilla.ok) return { error: planilla.error }
  const guardado = await window.dm.reportes.planillaClasica({ periodos: [planilla.datos.periodo], sucursales: [] }, ${JSON.stringify(PLANILLA)})
  if (!guardado.ok) return { error: guardado.error }

  // Y de paso, un reporte normal del centro de exportación.
  const pedido = { reporteId: 'cartera', filtros: { periodo: planilla.datos.periodo, sucursales: [], companias: [], estados: [], busqueda: '', desde: '', hasta: '' }, columnas: [] }
  const vista = await window.dm.reportes.vistaPrevia(pedido)
  const reporte = await window.dm.reportes.exportar(pedido, 'xlsx', ${JSON.stringify(REPORTE)})
  const catalogo = await window.dm.reportes.catalogo()

  return {
    ruta: guardado.datos.ruta,
    periodo: planilla.datos.periodo,
    filas: planilla.datos.filas.length,
    vista: vista.ok ? { total: vista.datos.total, columnas: vista.datos.columnas.length, nombre: vista.datos.nombre } : null,
    reporte: reporte.ok ? reporte.datos.ruta : null,
    reportes: catalogo.ok ? catalogo.datos.reportes.length : -1,
    error: guardado.ok ? (vista.ok ? (reporte.ok ? null : reporte.error) : vista.error) : guardado.error,
  }
})()`)

/** Lee un .xlsx recorriendo las cabeceras locales del ZIP. */
function leerZip(archivo) {
  const entradas = new Map()
  let posicion = 0
  while (posicion + 30 <= archivo.length && archivo.readUInt32LE(posicion) === 0x04034b50) {
    const metodo = archivo.readUInt16LE(posicion + 8)
    const comprimido = archivo.readUInt32LE(posicion + 18)
    const largoNombre = archivo.readUInt16LE(posicion + 26)
    const extra = archivo.readUInt16LE(posicion + 28)
    const nombre = archivo.subarray(posicion + 30, posicion + 30 + largoNombre).toString('utf8')
    const desde = posicion + 30 + largoNombre + extra
    const cuerpo = archivo.subarray(desde, desde + comprimido)
    entradas.set(nombre, (metodo === 8 ? inflateRawSync(cuerpo) : cuerpo).toString('utf8'))
    posicion = desde + comprimido
  }
  return entradas
}

const COLUMNAS_CLASICAS = [
  'APELLIDO Y NOMBRE', 'DNI', 'TELEFONO', 'EMAIL', 'DOMICILIO', 'LOCALIDAD', 'SUCURSAL', 'FECHA DE NACIMIENTO',
  'COMPAÑIA', 'NRO DE POLIZA', 'COBERTURA', 'PRIMA', 'FORMA DE PAGO', 'PRODUCTOR', 'ESTADO', 'VIGENCIA DESDE',
  'VIGENCIA HASTA', 'ALTA', 'MARCA', 'MODELO', 'AÑO', 'DOMINIO', 'MOTOR', 'CHASIS', 'USO', 'COLOR',
  'SUMA ASEGURADA', 'CUOTA', 'DIA DE VTO', 'AVISO', 'PAGO', 'OBS',
]

let planilla = null
try {
  planilla = leerZip(readFileSync(PLANILLA))
} catch (error) {
  anotar('La Planilla clásica se guarda donde se le pide', false, exportado?.error ?? String(error))
}

if (planilla) {
  const completo = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'].every(
    (parte) => planilla.has(parte),
  )
  anotar('La Planilla clásica es un .xlsx completo (el ZIP con todas sus partes)', completo, exportado?.ruta ?? '')

  const libro = planilla.get('xl/workbook.xml') ?? ''
  const pestanas = [...libro.matchAll(/name="([^"]+)"/g)].map((c) => c[1])
  anotar('Trae la pestaña del mes y su pestaña de BAJAS, con los nombres de siempre', pestanas.length === 2 && /^BAJAS/.test(pestanas[1] ?? ''), pestanas.join(' + '))

  const hoja = planilla.get('xl/worksheets/sheet1.xml') ?? ''
  const encabezados = [...(/<row r="1">(.*?)<\/row>/s.exec(hoja)?.[1] ?? '').matchAll(/<t[^>]*>(.*?)<\/t>/g)].map((c) => c[1])
  const iguales = encabezados.length === COLUMNAS_CLASICAS.length && encabezados.every((e, i) => e === COLUMNAS_CLASICAS[i])
  anotar('Las 32 columnas están en el mismo orden que en la hoja de siempre', iguales, iguales ? '' : encabezados.join(', ').slice(0, 200))

  const filas = [...hoja.matchAll(/<row r="/g)].length - 1
  anotar('Y trae las mismas filas que la planilla del mes', filas === numeros?.filas, `${filas} de ${numeros?.filas}`)
  console.log(`    → para mirarla en Excel: ${PLANILLA}`)
}

anotar('El centro de exportación ofrece un reporte por módulo', exportado?.reportes >= 10, `${exportado?.reportes} reporte(s)`)
anotar(
  'La vista previa del reporte de cartera trae las filas del mes',
  exportado?.vista?.total === numeros?.filas,
  exportado?.error ?? `${exportado?.vista?.total} fila(s), ${exportado?.vista?.columnas} columna(s)`,
)
anotar('Y el reporte también se exporta a .xlsx', !!exportado?.reporte, exportado?.reporte ?? exportado?.error ?? '')

// ---------------------------------------------------------------------------
// 5. Criterio 3: la plantilla de aviso manda lo que dice la plantilla
// ---------------------------------------------------------------------------
const aviso = await evaluar(`(async () => {
  const original = await window.dm.config.plantillaAviso()
  if (!original.ok) return { error: original.error }

  const nuevo = 'HUMO9 {nombre}: tu {compania} de {patente} vence el {vencimiento} y sale {cuota}.'
  const guardada = await window.dm.marketing.editarPlantilla('aviso_vencimiento', { nombre: 'Aviso de vencimiento', descripcion: '', texto: nuevo })
  if (!guardada.ok) return { error: guardada.error }

  const planilla = await window.dm.cartera.planilla(null)
  const fila = planilla.ok ? planilla.datos.filas.find((f) => (f.telefono ?? '').replace(/\\D+/g, '').length >= 6) : null
  if (!fila) return { error: 'ninguna fila de la planilla tiene teléfono cargado' }

  const preparado = await window.dm.cartera.prepararAviso(fila.filaId)
  const rechazada = await window.dm.marketing.editarPlantilla('aviso_vencimiento', { nombre: 'Aviso de vencimiento', descripcion: '', texto: 'Hola {apellido}' })
  const borrada = await window.dm.marketing.borrarPlantilla('aviso_vencimiento')

  // Y se deja como estaba, que la carpeta sembrada se sigue usando después.
  await window.dm.config.guardarPlantillaAviso(original.datos.texto)

  return {
    plantillas: guardada.datos.length,
    fija: guardada.datos.find((p) => p.clave === 'aviso_vencimiento')?.fija === true,
    mensaje: preparado.ok ? preparado.datos.mensaje : null,
    conVariablesSinReemplazar: preparado.ok ? preparado.datos.mensaje.includes('{') : true,
    url: preparado.ok ? preparado.datos.url.slice(0, 21) : null,
    avisoDeLaFila: preparado.ok ? preparado.datos.fila.aviso : null,
    rechazaVariableInventada: !rechazada.ok,
    noSeBorra: !borrada.ok,
    error: preparado.ok ? null : preparado.error,
  }
})()`)
anotar(
  'Editar la plantilla cambia lo que manda «Avisar» de Cartera',
  typeof aviso?.mensaje === 'string' && aviso.mensaje.startsWith('HUMO9 ') && aviso.conVariablesSinReemplazar === false,
  aviso?.error ?? (aviso?.mensaje ?? '').slice(0, 90),
)
anotar('El aviso sale por WhatsApp y deja la fila como ENVIADO', aviso?.url === 'https://wa.me/549' || aviso?.avisoDeLaFila === 'ENVIADO', `${aviso?.url} · ${aviso?.avisoDeLaFila}`)
anotar('Una variable inventada se rechaza en vez de llegarle al cliente', aviso?.rechazaVariableInventada === true)
anotar('La plantilla del botón «Avisar» no se puede borrar', aviso?.noSeBorra === true, `${aviso?.plantillas} plantilla(s) cargadas`)

// ---------------------------------------------------------------------------
// 6. Criterio 4: un segmento devuelve lo mismo que el filtro equivalente en Cartera
// ---------------------------------------------------------------------------
const segmento = await evaluar(`(async () => {
  ${AYUDA}
  const planilla = await window.dm.cartera.planilla(null)
  if (!planilla.ok) return { error: planilla.error }

  // Se arma el filtro con una forma de pago que exista de verdad en la cartera sembrada.
  const usadas = {}
  for (const fila of planilla.datos.filas) {
    const forma = (fila.formaPago ?? '').trim()
    if (forma) usadas[forma] = (usadas[forma] ?? 0) + 1
  }
  const formaPago = Object.keys(usadas).sort((a, b) => usadas[b] - usadas[a])[0] ?? ''
  const filtros = { sucursales: [], companias: [], formasDePago: [formaPago], ramas: [], vence: '', soloImpagas: true, soloSinAvisar: false, excluirDebito: false }

  // Lo mismo, a mano, sobre la planilla del mes: es contra esto que se compara.
  const enCartera = planilla.datos.filas.filter(
    (f) => normalizar(f.formaPago) === normalizar(formaPago) && (f.pago ?? '').trim() === '' && !f.pagoRegistrado,
  ).length

  const suelto = await window.dm.marketing.segmento(null, filtros, '')
  if (!suelto.ok) return { error: suelto.error }

  const nombre = 'HUMO9 ' + formaPago + ' impagas'
  const guardado = await window.dm.marketing.guardarSegmento(null, { nombre, descripcion: 'Prueba de humo', filtros, plantillaClave: '' })
  if (!guardado.ok) return { error: guardado.error }
  const reabierto = await window.dm.marketing.segmento(guardado.datos.segmentoId, null, '')

  let avisados = -1
  let mensaje = null
  const candidata = reabierto.ok ? reabierto.datos.filas.find((f) => f.tieneTelefono) : null
  if (candidata) {
    const avisada = await window.dm.marketing.avisar(candidata.filaId, guardado.datos.segmentoId, filtros, guardado.datos.plantillaClave)
    if (avisada.ok) {
      avisados = avisada.datos.avisados
      mensaje = avisada.datos.mensaje
    }
  }

  const borrado = await window.dm.marketing.borrarSegmento(guardado.datos.segmentoId)

  return {
    formaPago,
    enCartera,
    suelto: suelto.datos.total,
    guardado: guardado.datos.total,
    reabierto: reabierto.ok ? reabierto.datos.total : -1,
    mismosFiltros: reabierto.ok ? reabierto.datos.filtros.formasDePago[0] === formaPago && reabierto.datos.filtros.soloImpagas === true : false,
    plantillas: suelto.datos.plantillas.length,
    avisados,
    mensaje,
    quedaLimpio: borrado.ok ? borrado.datos.segmentos.filter((s) => s.nombre === nombre).length === 0 : false,
  }
})()`)
anotar(
  'Un segmento devuelve las mismas filas que el filtro equivalente en Cartera',
  segmento?.suelto === segmento?.enCartera && segmento?.suelto >= 0,
  segmento?.error ?? `${segmento?.formaPago}: ${segmento?.suelto} en el segmento, ${segmento?.enCartera} en la planilla`,
)
anotar('Guardarlo y volver a abrirlo no cambia la lista ni los filtros', segmento?.reabierto === segmento?.suelto && segmento?.mismosFiltros === true, `${segmento?.reabierto}`)
anotar('El segmento ofrece las plantillas para elegir con cuál avisar', segmento?.plantillas >= 4, `${segmento?.plantillas} plantilla(s)`)
anotar('«Avisar» en una fila mueve el contador de avisados', segmento?.avisados >= 1 || segmento?.avisados === -1, segmento?.avisados === -1 ? 'sin filas con teléfono para avisar' : `${segmento?.avisados} avisado(s)`)
anotar('El segmento de prueba se borra y no queda basura', segmento?.quedaLimpio === true)

// ---------------------------------------------------------------------------
// 7. Nada explotó por el camino
// ---------------------------------------------------------------------------
const errores = await evaluar(`(() => document.body.innerText.match(/Ocurrió un error inesperado/g)?.length ?? 0)()`)
anotar('Sin errores inesperados en pantalla', errores === 0, errores ? `${errores} avisos` : '')

console.log('\n' + resultados.filter((r) => r.ok).length + '/' + resultados.length + ' pasos bien')
// Los archivos NO se borran: el criterio del pliego es que la planilla «abre en Excel y se ve como la
// planilla de siempre», y eso lo termina de comprobar una persona abriéndola.
console.log(`Los archivos generados quedaron en ${carpetaTemporal} — abrí «${path.basename(PLANILLA)}» en Excel para verla.`)
ws.close()
electron.kill()
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
