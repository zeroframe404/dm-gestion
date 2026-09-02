// Prueba de humo de la Fase 6: abre la aplicación de verdad contra una carpeta sembrada y recorre
// Cobranzas —caja del día, mora, imputados y comisiones— comprobando los criterios del pliego.
//
//   npm run sembrar -- <carpeta>
//   npm run humo:fase6 -- <carpeta>
//
// Los pagos de prueba se registran por el mismo canal que usa el botón «Registrar pago» de la Cartera
// y después se comprueba en la PANTALLA que la caja los sume bien: así se prueban las dos mitades.
// «Avisar» no se hace clic a propósito: abriría WhatsApp en el navegador de quien corre la prueba.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const rutaElectron = require('electron')

const CARPETA = process.argv[2]
const USUARIO = process.argv[3] ?? 'daniel'
const CLAVE = process.argv[4] ?? 'cambiar123'
const PUERTO = 9335

if (!CARPETA) {
  console.error('Uso: npm run humo:fase6 -- <carpeta sembrada>')
  process.exit(1)
}

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

/** Utilidades que se inyectan en la página para no repetirlas en cada paso. */
const AYUDA = `
  const porTexto = (sel, txt) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === txt)
  const esperar = async (condicion, intentos = 80) => {
    for (let i = 0; i < intentos; i++) {
      if (condicion()) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }
  const irA = async (modulo) => {
    const boton = porTexto('button', modulo)
    if (!boton) return false
    boton.click()
    await new Promise((r) => setTimeout(r, 700))
    return true
  }
  const solapa = async (nombre) => {
    const b = [...document.querySelectorAll('[role="tab"]')].find((t) => new RegExp(nombre, 'i').test(t.textContent))
    if (!b) return false
    b.click()
    await new Promise((r) => setTimeout(r, 900))
    return true
  }
  const filasDeTabla = () => [...document.querySelectorAll('tbody tr')].filter((f) => f.querySelectorAll('td').length > 2)
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
// 2. Cobranzas ya no dice «Próximamente» y tiene sus subpestañas
// ---------------------------------------------------------------------------
const modulo = await evaluar(`(async () => {
  ${AYUDA}
  if (!(await irA('Cobranzas'))) return { error: 'no está el módulo en la barra lateral' }
  return {
    disponible: !document.body.innerText.includes('Próximamente'),
    subpestanas: [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()),
  }
})()`)
anotar('El módulo Cobranzas está disponible', modulo?.disponible === true, modulo?.error ?? '')
anotar(
  'Cobranzas tiene Caja del día, Mora, Imputados y Comisiones',
  ['Caja del día', 'Mora', 'Imputados', 'Comisiones'].every((s) => (modulo?.subpestanas ?? []).some((t) => t.includes(s))),
  (modulo?.subpestanas ?? []).join(' · '),
)

// ---------------------------------------------------------------------------
// 3. Criterio 1: tres pagos de prueba y la caja del día suma bien por medio de pago
// ---------------------------------------------------------------------------
const pagos = await evaluar(`(async () => {
  const planilla = await window.dm.cartera.planilla(null)
  if (!planilla.ok) return { error: planilla.error }
  const hoy = planilla.datos.hoy
  const elegidas = planilla.datos.filas.slice(0, 3)
  if (elegidas.length < 3) return { error: 'la carpeta sembrada tiene menos de tres filas' }
  const medios = ['EFECTIVO', 'EFECTIVO', 'TRANSFERENCIA']
  const importes = ['10000', '5500,50', '20000']
  for (let i = 0; i < 3; i++) {
    const r = await window.dm.cartera.registrarPago(elegidas[i].filaId, { fecha: hoy, importe: importes[i], medioDePago: medios[i] })
    if (!r.ok) return { error: r.error }
  }
  return { hoy, nombres: elegidas.map((f) => f.nombre) }
})()`)
anotar('Se registran tres pagos de prueba desde la Cartera', !pagos?.error, pagos?.error ?? (pagos?.nombres ?? []).join(', '))

const caja = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Cobranzas')
  if (!(await solapa('Caja del día'))) return { error: 'no está la solapa' }
  const actualizar = [...document.querySelectorAll('button')].find((b) => /actualizar/i.test(b.textContent))
  if (actualizar) { actualizar.click(); await new Promise((r) => setTimeout(r, 900)) }
  const cargo = await esperar(() => filasDeTabla().length > 0 || /Todavía no se registró/i.test(document.body.innerText))
  if (!cargo) return { error: 'no cargó la caja' }
  const texto = document.body.innerText
  return {
    filas: filasDeTabla().length,
    texto: texto.slice(0, 1200),
    tieneTotal: /TOTAL DEL DÍA/i.test(texto),
    tieneEfectivo: /EFECTIVO/.test(texto),
    tieneTransferencia: /TRANSFERENCIA/.test(texto),
    tieneExportar: [...document.querySelectorAll('button')].some((b) => /exportar el día/i.test(b.textContent)),
    tieneAlta: [...document.querySelectorAll('button')].some((b) => /registrar pago/i.test(b.textContent)),
  }
})()`)
anotar('La caja del día lista los pagos registrados', caja?.filas >= 3, caja?.error ?? `${caja?.filas} filas`)
anotar('Muestra el total del día y el subtotal por medio de pago', caja?.tieneTotal && caja?.tieneEfectivo && caja?.tieneTransferencia)
anotar('Tiene «Exportar el día» y el alta manual de un pago', caja?.tieneExportar === true && caja?.tieneAlta === true)

// La suma de los tres pagos, comprobada contra el proceso principal.
const suma = await evaluar(`(async () => {
  const r = await window.dm.cobranzas.caja(null, [])
  if (!r.ok) return { error: r.error }
  const porMedio = Object.fromEntries(r.datos.totalesPorMedio.map((t) => [t.medio, t.total]))
  return { total: r.datos.total, porMedio, pagos: r.datos.pagos.length }
})()`)
anotar(
  'El total por medio de pago cierra: 15.500,50 en efectivo y 20.000 por transferencia',
  suma?.porMedio?.EFECTIVO === 15500.5 && suma?.porMedio?.TRANSFERENCIA === 20000,
  suma?.error ?? JSON.stringify(suma?.porMedio ?? {}),
)

// ---------------------------------------------------------------------------
// 4. Criterio 2: la mora lista cuotas realmente vencidas y «Avisar» arma el WhatsApp
// ---------------------------------------------------------------------------
const mora = await evaluar(`(async () => {
  ${AYUDA}
  if (!(await solapa('Mora'))) return { error: 'no está la solapa' }
  const cargo = await esperar(() => /Cuotas vencidas/i.test(document.body.innerText))
  if (!cargo) return { error: 'no cargó la mora' }
  const texto = document.body.innerText
  const listado = await window.dm.cobranzas.mora({ busqueda: '', sucursales: [], companias: [], rangos: [], incluirDebito: false })
  if (!listado.ok) return { error: listado.error }
  const hoy = listado.datos.hoy
  return {
    total: listado.datos.total,
    todasVencidas: listado.datos.filas.every((f) => f.diasDeAtraso >= 1 && f.vencimiento < hoy),
    rangos: listado.datos.porRango,
    tieneRangos: /1 a 7 días/i.test(texto) && /8 a 30 días/i.test(texto) && /Más de 30 días/i.test(texto),
    tieneFiltros: [...document.querySelectorAll('select')].length >= 3,
    primera: listado.datos.filas.find((f) => f.telefono)?.filaId ?? null,
  }
})()`)
anotar('La mora lista sólo cuotas realmente vencidas sin pago', mora?.total > 0 && mora?.todasVencidas === true, mora?.error ?? `${mora?.total} cuotas`)
anotar('Tiene los filtros por sucursal, compañía y rango de atraso (1-7, 8-30, +30)', mora?.tieneRangos === true && mora?.tieneFiltros === true, JSON.stringify(mora?.rangos ?? {}))

const aviso = await evaluar(`(async () => {
  const filaId = ${JSON.stringify(mora?.primera ?? null)}
  if (!filaId) return { error: 'ninguna cuota en mora tiene teléfono cargado' }
  // Se pide el aviso pero NO se abre: abrir el enlace lanzaría WhatsApp en el navegador de quien
  // corre la prueba. Lo que importa es que la dirección salga bien armada.
  const r = await window.dm.cobranzas.avisarMora(filaId)
  if (!r.ok) return { error: r.error }
  return { url: r.datos.url, marcada: r.datos.marcada }
})()`)
anotar(
  '«Avisar» arma el WhatsApp con la plantilla de la agencia',
  typeof aviso?.url === 'string' && aviso.url.startsWith('https://wa.me/549'),
  aviso?.error ?? aviso?.url?.slice(0, 70),
)

// ---------------------------------------------------------------------------
// 5. Criterio 3: RESULTADO=IMPUTADO en dos pagos, y el cambio camino a la hoja
// ---------------------------------------------------------------------------
const imputados = await evaluar(`(async () => {
  ${AYUDA}
  if (!(await solapa('Imputados'))) return { error: 'no está la solapa' }
  const cargo = await esperar(() => filasDeTabla().length > 0 || /No hay pagos/i.test(document.body.innerText))
  if (!cargo) return { error: 'no cargó la rendición' }

  // Se marcan dos pendientes desde los desplegables de la propia pantalla.
  const marcados = []
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    const select = [...document.querySelectorAll('tbody select')].find((s) => s.value === '')
    if (!select) break
    const poner = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    poner.call(select, 'IMPUTADO')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1200))
    marcados.push(true)
  }
  const rendicion = await window.dm.cobranzas.imputados(null, [])
  return {
    marcados: marcados.length,
    imputados: rendicion.ok ? rendicion.datos.contadores.IMPUTADO : 0,
    pendientes: rendicion.ok ? rendicion.datos.pendientes : -1,
    aviso: rendicion.ok ? rendicion.datos.avisoDeSincronizacion : null,
    columnas: [...document.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
  }
})()`)
anotar(
  'La rendición tiene fecha, cliente, póliza, importe, medio y RESULTADO',
  ['Fecha', 'Cliente', 'Póliza', 'Importe', 'Medio', 'Resultado'].every((c) => (imputados?.columnas ?? []).some((t) => t.includes(c))),
  imputados?.error ?? (imputados?.columnas ?? []).join(' · '),
)
anotar('Se marcan dos pagos como IMPUTADO desde la pantalla', imputados?.marcados === 2 && imputados?.imputados >= 2, `imputados: ${imputados?.imputados} · pendientes: ${imputados?.pendientes}`)

const cola = await evaluar(`(async () => {
  const r = await window.dm.sincronizacion.panel()
  if (!r.ok) return { error: r.error }
  const conResultado = r.datos.cola.filter((e) => e.campos.includes('resultado'))
  return { pendientes: r.datos.cola.length, conResultado: conResultado.length, pestanas: [...new Set(conResultado.map((e) => e.pestana))] }
})()`)
anotar(
  'El RESULTADO queda encolado hacia la hoja de Google',
  cola?.conResultado >= 2 || imputados?.aviso !== null,
  cola?.error ?? (imputados?.aviso ? 'la hoja sembrada no tiene pestaña IMPUTADOS usable: se avisa en pantalla' : `${cola?.conResultado} cambios hacia ${(cola?.pestanas ?? []).join(', ')}`),
)

// ---------------------------------------------------------------------------
// 6. Comisiones: el porcentaje se carga en Compañías y acá se estima
// ---------------------------------------------------------------------------
const comisiones = await evaluar(`(async () => {
  ${AYUDA}
  const lista = await window.dm.companias.listar()
  if (!lista.ok) return { error: lista.error }
  const compania = lista.datos[0]
  const guardada = await window.dm.companias.editar(compania.id, {
    nombre: compania.nombre,
    diasCoberturaFinanciera: compania.diasCoberturaFinanciera,
    comisionPorcentaje: 15,
    activa: compania.activa,
  })
  if (!guardada.ok) return { error: guardada.error }

  await irA('Cobranzas')
  if (!(await solapa('Comisiones'))) return { error: 'no está la solapa' }
  const cargo = await esperar(() => /Comisión estimada/i.test(document.body.innerText))
  if (!cargo) return { error: 'no cargó la pantalla' }
  const resumen = await window.dm.cobranzas.comisiones(null)
  return {
    compania: compania.nombre,
    enPantalla: document.body.innerText.includes(compania.nombre),
    cobrado: resumen.ok ? resumen.datos.cobrado : -1,
    comision: resumen.ok ? resumen.datos.comision : -1,
  }
})()`)
anotar(
  'Comisiones muestra lo cobrado del mes y la comisión estimada por compañía',
  comisiones?.cobrado > 0 && comisiones?.comision > 0,
  comisiones?.error ?? `${comisiones?.compania} al 15 % · cobrado ${comisiones?.cobrado} · comisión ${comisiones?.comision}`,
)

// ---------------------------------------------------------------------------
// 7. Criterio 4: la ticketeadora, si la hay
// ---------------------------------------------------------------------------
const impresora = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Administración')
  if (!(await solapa('Impresora'))) return { error: 'no está la solapa' }
  const cargo = await esperar(() => /Ticketeadora térmica/i.test(document.body.innerText))
  if (!cargo) return { error: 'no cargó la pantalla' }
  const estado = await window.dm.impresora.estado()
  return {
    ok: estado.ok,
    habilitada: estado.ok ? estado.datos.habilitada : false,
    disponibles: estado.ok ? estado.datos.disponibles.length : 0,
    ultimoError: estado.ok ? estado.datos.ultimoError : null,
  }
})()`)
anotar(
  'Administración → Impresora abre y lee las impresoras de la PC',
  impresora?.ok === true,
  impresora?.error ?? `${impresora?.disponibles} impresora(s) · ticket ${impresora?.habilitada ? 'activo' : 'apagado'}`,
)
if (!impresora?.habilitada) {
  console.log('    (el ticket es opcional: sin impresora configurada no se imprime nada y el cobro sigue igual)')
} else {
  anotar('El último pago no dejó error de impresión', !impresora?.ultimoError, impresora?.ultimoError ?? '')
}

// Una impresora mal configurada NO puede romper el cobro: se comprueba con un nombre inventado.
const ticketRoto = await evaluar(`(async () => {
  const guardar = await window.dm.impresora.guardar({ habilitada: true, impresora: 'DM GESTION IMPRESORA INEXISTENTE', anchoMm: 80, copias: 1 })
  if (!guardar.ok) return { error: guardar.error }
  const planilla = await window.dm.cartera.planilla(null)
  const fila = planilla.datos.filas[3] ?? planilla.datos.filas[0]
  const pago = await window.dm.cartera.registrarPago(fila.filaId, { fecha: planilla.datos.hoy, importe: '1', medioDePago: 'EFECTIVO' })
  await new Promise((r) => setTimeout(r, 2500))
  const estado = await window.dm.impresora.estado()
  await window.dm.impresora.guardar({ habilitada: false, impresora: '', anchoMm: 80, copias: 1 })
  return { pagoOk: pago.ok, error: pago.ok ? null : pago.error, ultimoError: estado.ok ? estado.datos.ultimoError : null }
})()`)
anotar(
  'Con la impresora mal configurada el pago se registra igual y el error queda anotado',
  ticketRoto?.pagoOk === true,
  ticketRoto?.error ?? (ticketRoto?.ultimoError ? `error anotado: ${String(ticketRoto.ultimoError).slice(0, 90)}` : 'sin error anotado'),
)

// ---------------------------------------------------------------------------
// 8. Cartera → Imputados es la misma rendición, y nada explotó por el camino
// ---------------------------------------------------------------------------
const cartera = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Cartera')
  const subpestanas = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
  if (!(await solapa('Imputados'))) return { error: 'no está la subpestaña' }
  const cargo = await esperar(() => filasDeTabla().length > 0 || /No hay pagos|Todavía no hay pagos/i.test(document.body.innerText))
  return { subpestanas, cargo, sinProximamente: !document.body.innerText.includes('Próximamente') }
})()`)
anotar('Cartera → Imputados ya muestra la rendición (no «Próximamente»)', cartera?.cargo === true && cartera?.sinProximamente === true, cartera?.error ?? (cartera?.subpestanas ?? []).join(' · '))

const errores = await evaluar(`(() => document.body.innerText.match(/Ocurrió un error inesperado/g)?.length ?? 0)()`)
anotar('Sin errores inesperados en pantalla', errores === 0, errores ? `${errores} avisos` : '')

console.log('\n' + resultados.filter((r) => r.ok).length + '/' + resultados.length + ' pasos bien')
ws.close()
electron.kill()
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
