// Prueba de humo del buscador de deudores (Clientes): abre la aplicación de verdad contra una carpeta
// sembrada, recorre los estados del listado —activos sin deuda, activos con deuda y bajas—, abre
// «Buscar deudores», tilda días sueltos y una forma de pago, y exporta el listado a .xlsx y a .txt.
//
//   npm run sembrar -- <carpeta>
//   npm run humo:deudores -- <carpeta>
//
// Los archivos se generan pasando la ruta por el canal, como en Reportes: un diálogo «Guardar como»
// del sistema no se puede manejar desde afuera. Quedan en una carpeta temporal que el script imprime.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const rutaElectron = require('electron')

const CARPETA = process.argv[2]
const USUARIO = process.argv[3] ?? 'daniel'
const CLAVE = process.argv[4] ?? 'cambiar123'
const PUERTO = 9340

if (!CARPETA) {
  console.error('Uso: npm run humo:deudores -- <carpeta sembrada>')
  process.exit(1)
}

const carpetaTemporal = mkdtempSync(path.join(tmpdir(), 'dm-humo-deudores-'))
const XLSX = path.join(carpetaTemporal, 'deudores.xlsx')
const TXT = path.join(carpetaTemporal, 'deudores.txt')

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
  const chips = () => [...document.querySelectorAll('[aria-label="Estado del cliente"] button')]
  const dialogo = () => document.querySelector('[role="dialog"]')
  const botonDelDia = (dia) => [...dialogo().querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Día ' + dia + ':'))
  const chipDelDialogo = (texto) => [...dialogo().querySelectorAll('button')].find((b) => b.textContent.trim() === texto)
  const pie = () => dialogo()?.querySelector('footer')?.textContent ?? ''
  const cuantasDeudas = () => Number((pie().match(/^\\s*([\\d.]+) deuda/) ?? [])[1]?.replace(/\\./g, '') ?? -1)
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
// 2. Los estados del listado de Clientes
// ---------------------------------------------------------------------------
const listado = await evaluar(`(async () => {
  ${AYUDA}
  if (!(await irA('Clientes'))) return { error: 'no está Clientes en la barra lateral' }
  if (!(await esperar(() => chips().length > 0))) return { error: 'no aparecieron los botones de estado' }
  const etiquetas = chips().map((b) => b.textContent.replace(/\\d+$/, '').trim())

  // Lo que dice cada botón tiene que ser lo que trae al tocarlo.
  const cuenta = {}
  for (const etiqueta of etiquetas) {
    const boton = chips().find((b) => b.textContent.startsWith(etiqueta))
    cuenta[etiqueta] = Number(boton.textContent.replace(etiqueta, '').replace(/\\./g, '').trim())
  }
  return { etiquetas, cuenta }
})()`)
anotar(
  'El listado ofrece todos, activos sin deuda, activos con deuda y bajas',
  ['Todos', 'Activos sin deuda', 'Activos con deuda', 'Bajas'].every((e) => (listado?.etiquetas ?? []).includes(e)),
  listado?.error ?? (listado?.etiquetas ?? []).join(' · '),
)

for (const [estado, filtro] of [
  ['Activos con deuda', 'activos-con-deuda'],
  ['Activos sin deuda', 'activos-sin-deuda'],
  ['Bajas', 'bajas'],
]) {
  const paso = await evaluar(`(async () => {
    ${AYUDA}
    const boton = chips().find((b) => b.textContent.startsWith(${JSON.stringify(estado)}))
    if (!boton) return { error: 'no está el botón ' + ${JSON.stringify(estado)} }
    const dice = Number(boton.textContent.replace(${JSON.stringify(estado)}, '').replace(/\\./g, '').trim())
    boton.click()
    await new Promise((r) => setTimeout(r, 700))
    await esperar(() => !/Buscando clientes/.test(document.body.innerText))
    const enPantalla = Number((document.body.innerText.match(/([\\d.]+) clientes? de/) ?? [])[1]?.replace(/\\./g, '') ?? -1)
    // Y lo mismo por el canal, que es la fuente de la verdad.
    const porCanal = await window.dm.clientes.listar({ busqueda: '', sucursales: [], companias: [], estado: ${JSON.stringify(filtro)} })
    return { dice, enPantalla, canal: porCanal.ok ? porCanal.datos.filas.length : -1, marcado: boton.getAttribute('aria-pressed') === 'true' }
  })()`)
  anotar(
    `«${estado}» filtra el listado y su número coincide`,
    paso?.dice === paso?.enPantalla && paso?.enPantalla === paso?.canal && paso?.marcado === true,
    paso?.error ?? `el botón dice ${paso?.dice}, la pantalla ${paso?.enPantalla}, el canal ${paso?.canal}`,
  )
}

// ---------------------------------------------------------------------------
// 3. El diálogo de deudores
// ---------------------------------------------------------------------------
const abierto = await evaluar(`(async () => {
  ${AYUDA}
  chips().find((b) => b.textContent.startsWith('Todos')).click()
  await new Promise((r) => setTimeout(r, 400))
  const boton = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Buscar deudores')
  if (!boton) return { error: 'no está el botón «Buscar deudores»' }
  boton.click()
  if (!(await esperar(() => !!dialogo()))) return { error: 'no se abrió el diálogo' }
  await esperar(() => cuantasDeudas() >= 0)
  await new Promise((r) => setTimeout(r, 500))

  const mes = dialogo().querySelector('select')
  return {
    deudas: cuantasDeudas(),
    mes: mes?.options[mes.selectedIndex]?.textContent ?? '',
    dias: [...dialogo().querySelectorAll('[aria-label^="Día "]')].length,
    grupos: [...dialogo().querySelectorAll('legend')].map((l) => l.textContent.trim()),
  }
})()`)
anotar('«Buscar deudores» abre con el mes abierto y algo para cobrar', abierto?.deudas > 0, abierto?.error ?? `${abierto?.deudas} deuda(s) · ${abierto?.mes}`)
anotar('Están los 31 días para tildar', abierto?.dias === 31, `${abierto?.dias} días`)
anotar(
  'Y los tres filtros que pide el mostrador',
  ['Sucursal', 'Compañía', 'Forma de pago'].every((g) => (abierto?.grupos ?? []).includes(g)),
  (abierto?.grupos ?? []).join(' · '),
)

const porDia = await evaluar(`(async () => {
  ${AYUDA}
  // Los días que tienen algo, según el contador de cada botón.
  const conDeuda = [...dialogo().querySelectorAll('[aria-label^="Día "]')]
    .map((b) => ({ dia: Number(b.getAttribute('aria-label').match(/Día (\\d+):/)[1]), cuantas: Number(b.getAttribute('aria-label').match(/: (\\d+)/)[1]) }))
    .filter((d) => d.cuantas > 0)
  if (conDeuda.length === 0) return { error: 'ningún día tiene deudas en la carpeta sembrada' }

  const primero = conDeuda[0]
  botonDelDia(primero.dia).click()
  await new Promise((r) => setTimeout(r, 600))
  const conUno = cuantasDeudas()

  // Un día salteado más: es justamente lo que no se puede pedir con un rango de fechas.
  const otro = conDeuda[1] ?? null
  let conDos = null
  if (otro) {
    botonDelDia(otro.dia).click()
    await new Promise((r) => setTimeout(r, 600))
    conDos = cuantasDeudas()
  }

  // Un día sin nada tiene que dejar el listado vacío.
  const vacio = [...Array(31).keys()].map((i) => i + 1).find((d) => !conDeuda.some((c) => c.dia === d))
  botonDelDia(primero.dia).click()
  if (otro) botonDelDia(otro.dia).click()
  botonDelDia(vacio).click()
  await new Promise((r) => setTimeout(r, 600))
  const sinNada = cuantasDeudas()
  botonDelDia(vacio).click()
  await new Promise((r) => setTimeout(r, 600))

  return { primero, otro, conUno, conDos, vacio, sinNada, vuelve: cuantasDeudas() }
})()`)
anotar(
  'Tildar un día deja sólo los que vencen ese día',
  porDia?.conUno === porDia?.primero?.cuantas,
  porDia?.error ?? `día ${porDia?.primero?.dia}: ${porDia?.conUno} de ${porDia?.primero?.cuantas}`,
)
anotar(
  'Y se pueden tildar días salteados',
  porDia?.otro === null || porDia?.conDos === (porDia?.primero?.cuantas ?? 0) + (porDia?.otro?.cuantas ?? 0),
  porDia?.otro === null ? 'la carpeta sembrada tiene un solo día con deudas' : `días ${porDia?.primero?.dia} y ${porDia?.otro?.dia}: ${porDia?.conDos}`,
)
anotar('Un día sin vencimientos deja la lista vacía', porDia?.sinNada === 0, `día ${porDia?.vacio}`)
anotar('Y destildarlo la devuelve como estaba', porDia?.vuelve > 0, `${porDia?.vuelve} deuda(s)`)

const formaDePago = await evaluar(`(async () => {
  ${AYUDA}
  const antes = cuantasDeudas()
  // DEBITO se cobra solo: por omisión no está, y tildándolo tiene que aparecer.
  const debito = chipDelDialogo('DEBITO')
  if (!debito) return { error: 'la carpeta sembrada no tiene ninguna cuota impaga por débito' }
  debito.click()
  await new Promise((r) => setTimeout(r, 600))
  const conDebito = cuantasDeudas()
  const soloDebito = [...dialogo().querySelectorAll('.overflow-auto [class*="truncate"]')].length
  debito.click()
  await new Promise((r) => setTimeout(r, 600))
  return { antes, conDebito, vuelve: cuantasDeudas(), soloDebito }
})()`)
anotar(
  'Tildar una forma de pago que se cobra sola trae justamente ésa',
  formaDePago?.conDebito > 0 && formaDePago?.vuelve === formaDePago?.antes,
  formaDePago?.error ?? `${formaDePago?.antes} sin tildar, ${formaDePago?.conDebito} con DEBITO tildado`,
)

// ---------------------------------------------------------------------------
// 4. Exportar
// ---------------------------------------------------------------------------
const exportado = await evaluar(`(async () => {
  ${AYUDA}
  const mes = dialogo().querySelector('select').value
  const filtros = { periodo: mes, sucursales: [], companias: [], formasDePago: [], ramas: [], dias: [], incluirDebito: false }
  const listado = await window.dm.clientes.deudores(filtros)
  const xlsx = await window.dm.clientes.exportarDeudores(filtros, 'xlsx', ${JSON.stringify(XLSX)})
  const txt = await window.dm.clientes.exportarDeudores(filtros, 'txt', ${JSON.stringify(TXT)})
  return {
    filas: listado.ok ? listado.datos.filas.length : -1,
    nombres: listado.ok ? listado.datos.filas.map((f) => f.nombre) : [],
    xlsx: xlsx.ok ? xlsx.datos.ruta : 'ERROR: ' + xlsx.error,
    txt: txt.ok ? txt.datos.ruta : 'ERROR: ' + txt.error,
  }
})()`)

const pesa = (ruta) => {
  try {
    return statSync(ruta).size
  } catch {
    return 0
  }
}
anotar('El .xlsx se escribe y no está vacío', pesa(XLSX) > 1000, `${pesa(XLSX)} bytes`)
anotar('El .xlsx es un archivo de Excel de verdad (ZIP con sus partes)', readFileSync(XLSX).subarray(0, 2).toString() === 'PK', '')

const texto = pesa(TXT) > 0 ? readFileSync(TXT, 'utf8') : ''
anotar('El .txt se escribe con el encabezado del listado', texto.includes('LISTADO DE DEUDORES'), `${pesa(TXT)} bytes`)
anotar(
  'Y trae a los mismos deudores que se ven en pantalla',
  (exportado?.nombres ?? []).length > 0 && exportado.nombres.every((nombre) => texto.includes(nombre)),
  (exportado?.nombres ?? []).join(' · '),
)

// ---------------------------------------------------------------------------
// 5. Nada explotó por el camino
// ---------------------------------------------------------------------------
const errores = await evaluar(`(() => document.body.innerText.match(/Ocurrió un error inesperado/g)?.length ?? 0)()`)
anotar('Sin errores inesperados en pantalla', errores === 0, errores ? `${errores} avisos` : '')

console.log('\n' + resultados.filter((r) => r.ok).length + '/' + resultados.length + ' pasos bien')
console.log(`Los archivos exportados quedaron en ${carpetaTemporal} — abrí «${path.basename(XLSX)}» en Excel para verlo.`)
ws.close()
electron.kill()
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
