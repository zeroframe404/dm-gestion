// Prueba de humo de la Fase 8: abre la aplicación de verdad contra una carpeta sembrada y recorre los
// cuatro criterios del pliego —cargar un lead y convertirlo en cliente sin tipear dos veces, armar un
// presupuesto de tres opciones y ver el mensaje de WhatsApp, asignarle una tarea a otro usuario y
// comprobar que le llega, y que las tres pestañas nuevas salgan camino a la hoja.
//
//   npm run sembrar -- <carpeta>
//   npm run humo:fase8 -- <carpeta>
//
// Sobre el criterio «las pestañas aparecieron en la hoja de PRUEBA»: la carpeta sembrada no tiene
// credenciales de Google (a propósito: la prueba no puede escribir en una hoja real), así que lo que
// se comprueba es que las filas quedaron encoladas como «crear» contra APP LEADS, APP PRESUPUESTOS y
// APP TAREAS, con sus campos ya traducidos. Ése es exactamente el mecanismo que crea las pestañas y
// sube las filas en cuanto hay conexión, y es lo mismo que verifica el banco de pruebas contra la
// hoja simulada (ver pruebas/fase8.prueba.ts, «APP LEADS, APP PRESUPUESTOS y APP TAREAS se crean
// solas al final de la hoja»).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const rutaElectron = require('electron')

const CARPETA = process.argv[2]
const USUARIO = process.argv[3] ?? 'daniel'
const CLAVE = process.argv[4] ?? 'cambiar123'
const PUERTO = 9337

if (!CARPETA) {
  console.error('Uso: npm run humo:fase8 -- <carpeta sembrada>')
  process.exit(1)
}

// El archivo que se adjunta a la tarea. Lo crea el script porque el diálogo del sistema no se puede
// manejar desde acá; el canal acepta rutas explícitas justamente para esto.
const carpetaTemporal = mkdtempSync(path.join(tmpdir(), 'dm-humo8-'))
const ARCHIVO = path.join(carpetaTemporal, 'presupuesto del taller.pdf')
writeFileSync(ARCHIVO, 'PDF de prueba de la Fase 8')

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
    await new Promise((r) => setTimeout(r, 700))
    return true
  }
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
for (const modulo of ['Leads', 'Presupuestos', 'Tareas']) {
  const abierto = await evaluar(`(async () => {
    ${AYUDA}
    if (!(await irA(${JSON.stringify(modulo)}))) return { error: 'no está el módulo en la barra lateral' }
    await esperar(() => !/Cargando/i.test(document.body.innerText))
    return { disponible: !document.body.innerText.includes('Próximamente') }
  })()`)
  anotar(`El módulo ${modulo} está disponible`, abierto?.disponible === true, abierto?.error ?? '')
}

// ---------------------------------------------------------------------------
// 3. Criterio 1: cargar un lead y convertirlo en cliente sin tipear dos veces
// ---------------------------------------------------------------------------
const marca = Date.now().toString().slice(-6)
const lead = await evaluar(`(async () => {
  const datos = {
    nombre: 'HUMO FASE8 ' + ${JSON.stringify(marca)},
    telefono: '11 5555-' + ${JSON.stringify(marca)}.slice(0, 4),
    sucursal: '',
    interes: 'El Gol de la hija',
    tipoVehiculo: 'Auto',
    origen: 'WHATSAPP',
    estado: '',
    documento: '2' + ${JSON.stringify(marca)} + '99',
    email: 'humo' + ${JSON.stringify(marca)} + '@correo.com',
    nota: 'Preguntó por terceros completo.',
  }
  const creado = await window.dm.leads.crear(datos)
  if (!creado.ok) return { error: creado.error }
  const l = creado.datos.lead

  const convertido = await window.dm.leads.convertir(l.id)
  if (!convertido.ok) return { error: convertido.error }
  const ficha = await window.dm.clientes.ficha(convertido.datos.clienteId)
  if (!ficha.ok) return { error: ficha.error }

  return {
    lead: { id: l.id, filaId: l.filaId, estado: l.estado, origen: l.origen, whatsapp: !!l.urlWhatsapp },
    escrito: datos,
    cliente: {
      id: ficha.datos.id,
      nombre: ficha.datos.nombre,
      telefono: ficha.datos.telefono,
      documento: ficha.datos.documento,
      email: ficha.datos.email,
    },
    estadoFinal: convertido.datos.lead.lead.estado,
  }
})()`)
anotar('Se carga una consulta y arranca en NUEVO, con su WhatsApp listo', lead?.lead?.estado === 'NUEVO' && lead?.lead?.whatsapp === true, lead?.error ?? '')
anotar(
  'Al convertirla, el cliente sale con los MISMOS datos: no se tipeó nada dos veces',
  !!lead?.cliente &&
    lead.cliente.nombre === lead.escrito.nombre &&
    lead.cliente.telefono === lead.escrito.telefono &&
    lead.cliente.documento === lead.escrito.documento &&
    lead.cliente.email === lead.escrito.email,
  lead?.error ?? JSON.stringify(lead?.cliente ?? {}),
)
anotar('Y la consulta queda GANADA, apuntando a su ficha', lead?.estadoFinal === 'GANADO', lead?.estadoFinal ?? '')

// ---------------------------------------------------------------------------
// 4. Criterio 2: un presupuesto de tres opciones y el mensaje de WhatsApp
// ---------------------------------------------------------------------------
const presupuesto = await evaluar(`(async () => {
  const creado = await window.dm.presupuestos.crear({
    leadId: ${lead?.lead?.id ?? 'null'},
    clienteId: null,
    clienteNombre: '',
    telefono: '',
    documento: '',
    sucursal: '',
    patente: 'AB123CD',
    marca: 'VOLKSWAGEN',
    modelo: 'GOL TREND',
    anio: '2016',
    tipoVehiculo: 'Auto',
    observaciones: 'Los precios son con débito automático.',
    opciones: [
      { compania: 'SANCOR', cobertura: 'TERCEROS COMPLETO', precio: '$ 52.400', comentario: 'Franquicia $ 250.000' },
      { compania: 'RIVADAVIA', cobertura: 'TERCEROS COMPLETO', precio: '$ 47.900', comentario: '' },
      { compania: 'MERCANTIL ANDINA', cobertura: 'TODO RIESGO', precio: '$ 91.300', comentario: 'Incluye granizo' },
    ],
  })
  if (!creado.ok) return { error: creado.error }
  const f = creado.datos

  const enviado = await window.dm.presupuestos.enviar(f.presupuesto.id)
  if (!enviado.ok) return { error: enviado.error }

  // Se cambia después de enviado: tiene que salir la versión 2 y quedar la 1 intacta.
  const version2 = await window.dm.presupuestos.guardar(f.presupuesto.id, {
    leadId: f.presupuesto.leadId,
    clienteId: f.presupuesto.clienteId,
    clienteNombre: f.presupuesto.clienteNombre,
    telefono: f.presupuesto.telefono ?? '',
    documento: f.presupuesto.documento ?? '',
    sucursal: f.presupuesto.sucursal ?? '',
    patente: 'AB123CD',
    marca: 'VOLKSWAGEN',
    modelo: 'GOL TREND',
    anio: '2016',
    tipoVehiculo: 'Auto',
    observaciones: '',
    opciones: [{ compania: 'RIVADAVIA', cobertura: 'TERCEROS COMPLETO', precio: '$ 51.200', comentario: 'Actualizado' }],
  })
  if (!version2.ok) return { error: version2.error }
  const vieja = await window.dm.presupuestos.ficha(f.presupuesto.id)

  return {
    numero: f.presupuesto.numero,
    opciones: f.opciones.length,
    desde: f.presupuesto.desde,
    primera: f.opciones[0]?.compania,
    mensaje: f.mensaje,
    lineas: f.mensaje.split('\\n'),
    estadoEnviado: enviado.datos.ficha.presupuesto.estado,
    urlWhatsapp: enviado.datos.url.slice(0, 40),
    version2: version2.datos.presupuesto.version,
    mismoNumero: version2.datos.presupuesto.numero === f.presupuesto.numero,
    viejaSigueEntera: vieja.ok && vieja.datos.opciones.length === 3 && vieja.datos.presupuesto.vigente === false,
  }
})()`)
anotar(
  'Un presupuesto con 3 opciones se guarda con la más barata primero',
  presupuesto?.opciones === 3 && presupuesto?.primera === 'RIVADAVIA' && presupuesto?.desde === '$ 47.900',
  presupuesto?.error ?? `${presupuesto?.numero} · desde ${presupuesto?.desde}`,
)
anotar(
  'El mensaje de WhatsApp sale prolijo: saludo, vehículo y una línea por opción',
  !!presupuesto?.lineas &&
    /^Hola .*, te paso el presupuesto de SEGUROS DANIEL MARTÍNEZ\.$/.test(presupuesto.lineas[0] ?? '') &&
    presupuesto.lineas[1] === 'Vehículo: VOLKSWAGEN GOL TREND 2016 (AB123CD)' &&
    /^1\) RIVADAVIA — TERCEROS COMPLETO: \$ 47\.900 por mes$/.test(presupuesto.lineas[3] ?? '') &&
    /^2\) SANCOR/.test(presupuesto.lineas[4] ?? '') &&
    /^3\) MERCANTIL ANDINA/.test(presupuesto.lineas[6] ?? '') &&
    !presupuesto.mensaje.includes('*'),
  presupuesto?.error ?? (presupuesto?.lineas ?? []).slice(0, 8).join(' | '),
)
anotar('«Enviar por WhatsApp» lo deja ENVIADO y devuelve la dirección', presupuesto?.estadoEnviado === 'ENVIADO' && (presupuesto?.urlWhatsapp ?? '').startsWith('https://wa.me/'), presupuesto?.error ?? '')
anotar(
  'Cambiar un presupuesto ya enviado crea la versión 2 y deja la 1 intacta',
  presupuesto?.version2 === 2 && presupuesto?.mismoNumero === true && presupuesto?.viejaSigueEntera === true,
  presupuesto?.error ?? `versión ${presupuesto?.version2}`,
)

// ---------------------------------------------------------------------------
// 5. Criterio 3: asignarle una tarea a otro usuario y que le llegue
// ---------------------------------------------------------------------------
const tarea = await evaluar(`(async () => {
  const usuarios = await window.dm.usuarios.listar()
  if (!usuarios.ok) return { error: usuarios.error }
  const sesion = await window.dm.auth.sesion()
  if (!sesion.ok || !sesion.datos) return { error: 'no hay sesión' }
  const otro = usuarios.datos.find((u) => u.activo && u.id !== sesion.datos.id)
  if (!otro) return { error: 'la carpeta sembrada tiene un solo usuario activo: no se le puede asignar a otro' }

  const hoy = new Date().toISOString().slice(0, 10)
  const creada = await window.dm.tareas.crear({
    titulo: 'HUMO FASE8 — llamar al perito ' + ${JSON.stringify(marca)},
    detalle: 'Antes del jueves.',
    responsableId: otro.id,
    sucursal: '',
    venceEl: hoy,
    prioridad: 'ALTA',
    clienteId: null,
    polizaId: null,
    siniestroId: null,
    renovacionId: null,
    leadId: ${lead?.lead?.id ?? 'null'},
    presupuestoId: null,
  })
  if (!creada.ok) return { error: creada.error }

  const comentada = await window.dm.tareas.comentar(creada.datos.id, 'Llamé y no atendieron.')
  const adjuntada = await window.dm.tareas.adjuntar(creada.datos.id, [${JSON.stringify(ARCHIVO)}])
  const mias = await window.dm.tareas.mias()
  const avisos = await window.dm.tareas.avisos()

  return {
    tarea: creada.datos,
    otro: { id: otro.id, nombre: otro.nombre },
    comentarios: comentada.ok ? comentada.datos.comentarios.length : -1,
    adjuntos: adjuntada.ok ? adjuntada.datos.adjuntos.length : -1,
    // A quien la creó no le tiene que aparecer: no es de él.
    mias: mias.ok ? mias.datos.filter((t) => t.id === creada.datos.id).length : -1,
    avisosPropios: avisos.ok ? avisos.datos.pendientes : -1,
    error: comentada.ok ? (adjuntada.ok ? null : adjuntada.error) : comentada.error,
  }
})()`)
anotar(
  'Se le asigna una tarea a otro usuario, con vencimiento y prioridad',
  tarea?.tarea?.responsableId === tarea?.otro?.id && tarea?.tarea?.prioridad === 'ALTA' && tarea?.tarea?.venceHoy === true,
  tarea?.error ?? `para ${tarea?.otro?.nombre}`,
)
anotar('Queda vinculada a la consulta de la que salió', tarea?.tarea?.vinculo === 'lead' && !!tarea?.tarea?.vinculoTexto, tarea?.tarea?.vinculoTexto ?? '')
anotar('Acepta comentarios y documentos', tarea?.comentarios === 1 && tarea?.adjuntos === 1, tarea?.error ?? `${tarea?.comentarios} comentario(s), ${tarea?.adjuntos} documento(s)`)
anotar('Y no aparece en el Inicio ni en la campana de quien la creó (es de otro)', tarea?.mias === 0, `${tarea?.avisosPropios} pendiente(s) propias`)

// La campana existe en la barra superior y sabe contar.
const campana = await evaluar(`(() => {
  const boton = [...document.querySelectorAll('header button')].find((b) => /Tareas:/i.test(b.getAttribute('aria-label') ?? ''))
  return { hay: !!boton, etiqueta: boton?.getAttribute('aria-label') ?? null }
})()`)
anotar('La campana está en la barra superior y dice qué hay', campana?.hay === true, campana?.etiqueta ?? '')

// ---------------------------------------------------------------------------
// 6. Criterio 4: las tres pestañas salen camino a la hoja
// ---------------------------------------------------------------------------
const cola = await evaluar(`(async () => {
  const panel = await window.dm.sincronizacion.panel()
  if (!panel.ok) return { error: panel.error }
  const pendientes = (panel.datos.cola ?? []).filter((e) => e.estado === 'pendiente')
  const por = (pestana) => pendientes.filter((e) => e.pestana === pestana)
  return {
    total: pendientes.length,
    leads: por('APP LEADS').length,
    presupuestos: por('APP PRESUPUESTOS').length,
    tareas: por('APP TAREAS').length,
    ejemploLead: por('APP LEADS')[0] ?? null,
  }
})()`)
anotar('Los leads salen camino a la pestaña APP LEADS', cola?.leads > 0, cola?.error ?? `${cola?.leads} entrada(s)`)
anotar('Los presupuestos salen camino a APP PRESUPUESTOS', cola?.presupuestos > 0, cola?.error ?? `${cola?.presupuestos} entrada(s)`)
anotar('Las tareas salen camino a APP TAREAS', cola?.tareas > 0, cola?.error ?? `${cola?.tareas} entrada(s)`)

// ---------------------------------------------------------------------------
// 7. Nada explotó por el camino
// ---------------------------------------------------------------------------
const errores = await evaluar(`(() => document.body.innerText.match(/Ocurrió un error inesperado/g)?.length ?? 0)()`)
anotar('Sin errores inesperados en pantalla', errores === 0, errores ? `${errores} avisos` : '')

console.log('\n' + resultados.filter((r) => r.ok).length + '/' + resultados.length + ' pasos bien')
rmSync(carpetaTemporal, { recursive: true, force: true })
ws.close()
electron.kill()
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
