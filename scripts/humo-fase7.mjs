// Prueba de humo de la Fase 7: abre la aplicación de verdad contra una carpeta sembrada y recorre los
// cuatro criterios del pliego —cargar un siniestro buscando la patente, seguirlo con una observación y
// un adjunto, comprobar que sale camino a la pestaña SINIESTROS y editar un riesgo vario.
//
//   npm run sembrar -- <carpeta>
//   npm run humo:fase7 -- <carpeta>
//
// Sobre el criterio «aparece en la pestaña SINIESTROS de la hoja de PRUEBA»: la carpeta sembrada no
// tiene credenciales de Google (a propósito: la prueba no puede escribir en una hoja real), así que lo
// que se comprueba es que la fila quedó encolada como «crear» contra esa pestaña, con sus campos ya
// traducidos. Ése es exactamente el mecanismo que la sube en cuanto hay conexión, y es lo mismo que
// verifica el banco de pruebas contra la hoja simulada.
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
const PUERTO = 9336

if (!CARPETA) {
  console.error('Uso: npm run humo:fase7 -- <carpeta sembrada>')
  process.exit(1)
}

// El archivo que se va a adjuntar. Lo crea el script porque el diálogo de archivos del sistema no se
// puede manejar desde acá; el canal acepta rutas explícitas justamente para esto.
const carpetaTemporal = mkdtempSync(path.join(tmpdir(), 'dm-humo-'))
const ARCHIVO = path.join(carpetaTemporal, 'denuncia policial.pdf')
writeFileSync(ARCHIVO, 'PDF de prueba de la Fase 7')

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
// 2. El módulo Siniestros ya no dice «Próximamente» y lista la hoja
// ---------------------------------------------------------------------------
const modulo = await evaluar(`(async () => {
  ${AYUDA}
  if (!(await irA('Siniestros'))) return { error: 'no está el módulo en la barra lateral' }
  const cargo = await esperar(() => filasDeTabla().length > 0 || /Todavía no hay siniestros/i.test(document.body.innerText))
  const encabezados = [...document.querySelectorAll('thead th')].map((t) => t.textContent.trim())
  return {
    cargo,
    disponible: !document.body.innerText.includes('Próximamente'),
    filas: filasDeTabla().length,
    encabezados,
    tieneAlta: [...document.querySelectorAll('button')].some((b) => /cargar siniestro/i.test(b.textContent)),
  }
})()`)
anotar('El módulo Siniestros está disponible', modulo?.disponible === true && modulo?.cargo === true, modulo?.error ?? `${modulo?.filas} filas`)
anotar(
  'El listado trae las columnas de la hoja (sucursal, compañía, póliza, cobertura, asegurado, patente, fechas, N° y observaciones)',
  ['Sucursal', 'Compañía', 'Póliza', 'Cobertura', 'Asegurado', 'Patente', 'Carga', 'Siniestro', 'N° siniestro', 'Observaciones'].every((c) =>
    (modulo?.encabezados ?? []).some((e) => e.includes(c)),
  ),
  (modulo?.encabezados ?? []).join(' · '),
)
anotar('Tiene selector de mes, buscador, filtros y el alta rápida', modulo?.tieneAlta === true)

// La palabra ROBO va destacada en rojo, como en la hoja.
const robo = await evaluar(`(() => {
  const marca = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'ROBO')
  if (!marca) return { hay: false }
  // Tailwind escribe los colores en oklch, así que mirar el texto del color no alcanza: se lo pasa por
  // un canvas, que lo devuelve ya resuelto, y se comprueba que sea rojo de verdad.
  const color = getComputedStyle(marca).color
  const lienzo = document.createElement('canvas').getContext('2d')
  lienzo.fillStyle = color
  lienzo.fillRect(0, 0, 1, 1)
  const [r, v, a] = lienzo.getImageData(0, 0, 1, 1).data
  return { hay: true, color, rgb: [r, v, a], rojo: r > 140 && r > v * 2 && r > a * 2 }
})()`)
anotar('La palabra ROBO aparece destacada en rojo', robo?.hay === true && robo?.rojo === true, robo?.color ?? 'no hay ningún siniestro con ROBO')

// ---------------------------------------------------------------------------
// 3. Criterio 1: cargar un siniestro buscando por patente
// ---------------------------------------------------------------------------
const alta = await evaluar(`(async () => {
  const polizas = await window.dm.polizas.listar({ busqueda: '', estados: ['ACTIVA'], companias: [], sucursales: [], coberturas: [], ramas: [] })
  if (!polizas.ok) return { error: polizas.error }
  const conPatente = polizas.datos.filas.find((p) => p.patente && p.patente.length > 3)
  if (!conPatente) return { error: 'la carpeta sembrada no tiene ninguna póliza con patente' }

  const encontrados = await window.dm.siniestros.buscar(conPatente.patente)
  if (!encontrados.ok) return { error: encontrados.error }
  const candidato = encontrados.datos[0]
  if (!candidato) return { error: 'el buscador no encontró la patente ' + conPatente.patente }

  const creado = await window.dm.siniestros.alta({
    clienteId: candidato.clienteId,
    polizaId: candidato.polizaId,
    fecha: new Date().toISOString().slice(0, 10),
    fechaCarga: new Date().toISOString().slice(0, 10),
    numeroSiniestro: '',
    descripcion: 'PRUEBA DE HUMO — CHOQUE CONTRA UN POSTE',
    estado: 'CARGADO',
    importe: '',
    observaciones: '',
    sucursal: candidato.sucursal ?? '',
  })
  if (!creado.ok) return { error: creado.error }
  const s = creado.datos.siniestro
  return {
    patente: conPatente.patente,
    buscado: { compania: candidato.compania, poliza: candidato.numeroPoliza, cobertura: candidato.cobertura },
    guardado: { id: s.id, filaId: s.filaId, compania: s.compania, poliza: s.numeroPoliza, cobertura: s.cobertura, patente: s.patente },
    observaciones: creado.datos.observaciones.length,
  }
})()`)
anotar('Buscando por patente aparece la póliza con sus datos', !alta?.error, alta?.error ?? `${alta?.patente} → ${alta?.buscado?.compania} ${alta?.buscado?.poliza}`)
anotar(
  'Los datos de la póliza se completan solos en el siniestro nuevo',
  !!alta?.guardado &&
    alta.guardado.compania === alta.buscado.compania &&
    alta.guardado.poliza === alta.buscado.poliza &&
    alta.guardado.patente === alta.patente,
  alta?.error ?? JSON.stringify(alta?.guardado ?? {}),
)
anotar('La ficha arranca con la denuncia ya en la línea de tiempo', alta?.observaciones === 1, `${alta?.observaciones} entrada(s)`)

// ---------------------------------------------------------------------------
// 4. Criterio 2: una observación y un adjunto, con el usuario que los cargó
// ---------------------------------------------------------------------------
const seguimiento = await evaluar(`(async () => {
  const id = ${alta?.guardado?.id ?? 0}
  if (!id) return { error: 'no se creó el siniestro' }
  const conObservacion = await window.dm.siniestros.agregarObservacion(id, 'Se pidió la denuncia policial al asegurado')
  if (!conObservacion.ok) return { error: conObservacion.error }
  const conAdjunto = await window.dm.siniestros.adjuntar(id, [${JSON.stringify(ARCHIVO)}], 'Denuncia policial')
  if (!conAdjunto.ok) return { error: conAdjunto.error }
  const sesion = await window.dm.auth.sesion()
  const yo = sesion.ok ? sesion.datos?.nombre : null
  const f = conAdjunto.datos
  return {
    yo,
    observaciones: f.observaciones.map((o) => ({ texto: o.texto, usuario: o.usuarioNombre, cuando: o.creadoEn })),
    adjuntos: f.adjuntos.map((a) => ({ nombre: a.nombre, usuario: a.usuarioNombre, tamano: a.tamano, enDrive: a.enDrive, categoria: a.categoria })),
    carpeta: f.carpetaDeAdjuntos,
  }
})()`)
const observaciones = seguimiento?.observaciones ?? []
anotar(
  'La observación queda en la línea de tiempo, fechada y con el usuario',
  observaciones.some((o) => /denuncia policial/i.test(o.texto) && o.usuario === seguimiento?.yo && !!o.cuando),
  seguimiento?.error ?? observaciones.map((o) => `${o.usuario}: ${o.texto.slice(0, 40)}`).join(' | '),
)
const adjuntos = seguimiento?.adjuntos ?? []
anotar(
  'El adjunto queda con su nombre, su peso, su categoría y el usuario que lo subió',
  adjuntos.length === 1 &&
    adjuntos[0].nombre === 'denuncia policial.pdf' &&
    adjuntos[0].usuario === seguimiento?.yo &&
    adjuntos[0].tamano > 0 &&
    adjuntos[0].categoria === 'Denuncia policial',
  seguimiento?.error ?? JSON.stringify(adjuntos),
)
anotar(
  'Y también deja su rastro en la línea de tiempo',
  observaciones.some((o) => /denuncia policial\.pdf/.test(o.texto)),
  seguimiento?.carpeta ? `carpeta: ${seguimiento.carpeta}` : '',
)

// El estado y una tarea vinculada, que es el resto del seguimiento.
const tramite = await evaluar(`(async () => {
  const id = ${alta?.guardado?.id ?? 0}
  const conEstado = await window.dm.siniestros.cambiarEstado(id, 'ESPERANDO DOCUMENTACIÓN')
  if (!conEstado.ok) return { error: conEstado.error }
  const conTarea = await window.dm.siniestros.crearTarea({ siniestroId: id, titulo: 'Llamar al perito', detalle: '', responsableId: null, venceEl: '' })
  if (!conTarea.ok) return { error: conTarea.error }
  return { estado: conTarea.datos.siniestro.estado, tareas: conTarea.datos.tareas.length, pendientes: conTarea.datos.siniestro.tareasPendientes }
})()`)
anotar('El estado del trámite se cambia y queda guardado', tramite?.estado === 'ESPERANDO DOCUMENTACIÓN', tramite?.error ?? tramite?.estado)
anotar('Se le vincula una tarea y queda contada como pendiente', tramite?.tareas === 1 && tramite?.pendientes === 1, tramite?.error ?? '')

// ---------------------------------------------------------------------------
// 5. Criterio 3: el siniestro nuevo va camino a la pestaña SINIESTROS de la hoja
// ---------------------------------------------------------------------------
const enLaCola = await evaluar(`(async () => {
  const panel = await window.dm.sincronizacion.panel()
  if (!panel.ok) return { error: panel.error }
  const entrada = panel.datos.cola.find((e) => e.filaId === ${JSON.stringify(alta?.guardado?.filaId ?? '')})
  if (!entrada) return { error: 'la fila no quedó en la cola de subida' }
  return { pestana: entrada.pestana, operacion: entrada.operacion, campos: entrada.campos }
})()`)
anotar(
  'El siniestro nuevo queda encolado como fila nueva de la pestaña SINIESTROS',
  enLaCola?.pestana === 'SINIESTROS' && enLaCola?.operacion === 'crear',
  enLaCola?.error ?? `${enLaCola?.operacion} en «${enLaCola?.pestana}»`,
)
anotar(
  'Con la compañía, la póliza, el estado y las observaciones ya traducidos a columnas',
  ['compania', 'numero_poliza', 'estado', 'observaciones', 'fecha', 'fecha_carga'].every((c) => (enLaCola?.campos ?? []).includes(c)),
  (enLaCola?.campos ?? []).join(', '),
)

// ---------------------------------------------------------------------------
// 6. Criterio 4: editar un riesgo vario y que el cambio llegue a la hoja
// ---------------------------------------------------------------------------
const riesgos = await evaluar(`(async () => {
  ${AYUDA}
  if (!(await irA('Cartera'))) return { error: 'no está el módulo Cartera' }
  if (!(await solapa('Riesgos varios'))) return { error: 'no está la subpestaña Riesgos varios' }
  const cargo = await esperar(() => filasDeTabla().length > 0 || /Todavía no hay riesgos/i.test(document.body.innerText))
  const listado = await window.dm.riesgos.listar()
  if (!listado.ok) return { error: listado.error }
  const riesgo = listado.datos.filas[0]
  if (!riesgo) return { error: 'la carpeta sembrada no tiene riesgos varios' }

  const editado = await window.dm.riesgos.editar(riesgo.id, 'observaciones', 'REVISADO EN LA PRUEBA DE HUMO')
  if (!editado.ok) return { error: editado.error }
  const panel = await window.dm.sincronizacion.panel()
  const entrada = panel.ok ? panel.datos.cola.find((e) => e.filaId === riesgo.filaId) : null
  return {
    cargo,
    filas: filasDeTabla().length,
    encabezados: [...document.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
    valor: editado.datos.observaciones,
    cola: entrada ? { pestana: entrada.pestana, operacion: entrada.operacion, campos: entrada.campos } : null,
    tieneAlta: [...document.querySelectorAll('button')].some((b) => /nuevo riesgo/i.test(b.textContent)),
  }
})()`)
anotar('Cartera → Riesgos varios muestra la tabla de la hoja', riesgos?.cargo === true, riesgos?.error ?? `${riesgos?.filas} filas`)
anotar(
  'Con las columnas del pliego (sucursal, emisión, titular, día de VTO, forma de pago, compañía, póliza, desde, hasta, teléfono, obs)',
  ['Sucursal', 'Emisión', 'Titular', 'Día de VTO', 'Forma de pago', 'Compañía', 'Póliza', 'Desde', 'Hasta', 'Teléfono', 'Obs'].every((c) =>
    (riesgos?.encabezados ?? []).some((e) => e.includes(c)),
  ),
  (riesgos?.encabezados ?? []).join(' · '),
)
anotar('Y con el alta simple', riesgos?.tieneAlta === true)
anotar('Editar una celda la guarda', riesgos?.valor === 'REVISADO EN LA PRUEBA DE HUMO', riesgos?.error ?? String(riesgos?.valor))
anotar(
  'Y el cambio sale camino a la pestaña RIESGOS VARIOS de la hoja',
  riesgos?.cola?.operacion === 'actualizar' && /RIESGO/i.test(riesgos?.cola?.pestana ?? '') && (riesgos?.cola?.campos ?? []).includes('observaciones'),
  riesgos?.cola ? `${riesgos.cola.operacion} en «${riesgos.cola.pestana}» (${riesgos.cola.campos.join(', ')})` : 'no quedó en la cola',
)

// El semáforo azul de TARJETA y CBU, que es lo que la agencia mira de un vistazo.
const azul = await evaluar(`(async () => {
  ${AYUDA}
  const listado = await window.dm.riesgos.listar()
  if (!listado.ok) return { error: listado.error }
  const riesgo = listado.datos.filas[0]
  const editado = await window.dm.riesgos.editar(riesgo.id, 'formaPago', 'CBU')
  if (!editado.ok) return { error: editado.error }
  // El cambio se hizo por fuera de la pantalla: hay que volver a entrar para que la tabla lo relea.
  await solapa('Planilla del mes')
  await solapa('Riesgos varios')
  await esperar(() => filasDeTabla().length > 0)
  const puntos = [...document.querySelectorAll('tbody span[aria-label="Débito automático"]')]
  return { puntos: puntos.length, color: puntos[0] ? getComputedStyle(puntos[0]).backgroundColor : null }
})()`)
anotar('El semáforo azul marca lo que se cobra solo (TARJETA y CBU)', azul?.puntos >= 1, azul?.error ?? `${azul?.puntos} punto(s), ${azul?.color}`)

// ---------------------------------------------------------------------------
// 7. AMP: la lista chica y el tilde de «resuelto»
// ---------------------------------------------------------------------------
const amp = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Cartera')
  if (!(await solapa('^AMP$'))) return { error: 'no está la subpestaña AMP' }
  const cargo = await esperar(() => filasDeTabla().length > 0 || /Todavía no se importó/i.test(document.body.innerText))
  const antes = await window.dm.amp.listar(false)
  if (!antes.ok) return { error: antes.error }
  const primera = antes.datos.filas[0]
  if (!primera) return { error: 'la carpeta sembrada no tiene ampliaciones pendientes' }
  const despues = await window.dm.amp.cambiarResuelto(primera.id, true, false)
  if (!despues.ok) return { error: despues.error }
  return {
    cargo,
    encabezados: [...document.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
    pendientesAntes: antes.datos.pendientes,
    pendientesDespues: despues.datos.pendientes,
    sigueEnLaLista: despues.datos.filas.some((f) => f.id === primera.id),
    aviso: despues.datos.avisoDeSincronizacion,
  }
})()`)
anotar('Cartera → AMP muestra la lista de ampliaciones', amp?.cargo === true, amp?.error ?? (amp?.encabezados ?? []).join(' · '))
anotar(
  'Con sus columnas (sucursal, fecha, nombre, forma de pago, patente, marca, modelo, fecha de vto)',
  ['Sucursal', 'Fecha', 'Nombre', 'Forma de pago', 'Patente', 'Marca', 'Modelo', 'Fecha de vto'].every((c) =>
    (amp?.encabezados ?? []).some((e) => e.includes(c)),
  ),
  (amp?.encabezados ?? []).join(' · '),
)
anotar(
  'Tildar «resuelto» la saca de la lista',
  amp?.pendientesDespues === amp?.pendientesAntes - 1 && amp?.sigueEnLaLista === false,
  amp?.error ?? `${amp?.pendientesAntes} → ${amp?.pendientesDespues} pendientes`,
)

// ---------------------------------------------------------------------------
// 8. Nada explotó por el camino
// ---------------------------------------------------------------------------
const errores = await evaluar(`(() => document.body.innerText.match(/Ocurrió un error inesperado/g)?.length ?? 0)()`)
anotar('Sin errores inesperados en pantalla', errores === 0, errores ? `${errores} avisos` : '')

console.log('\n' + resultados.filter((r) => r.ok).length + '/' + resultados.length + ' pasos bien')
rmSync(carpetaTemporal, { recursive: true, force: true })
ws.close()
electron.kill()
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
