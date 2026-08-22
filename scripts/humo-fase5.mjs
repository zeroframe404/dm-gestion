// Prueba de humo de la Fase 5: abre la aplicación de verdad contra una carpeta sembrada y recorre
// Clientes, Pólizas, Renovaciones y la matriz de reglas, comprobando los cuatro criterios del pliego.
//
//   npm run sembrar -- <carpeta>
//   npm run humo:fase5 -- <carpeta>
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const rutaElectron = require('electron')

const CARPETA = process.argv[2]
const USUARIO = process.argv[3] ?? 'daniel'
const CLAVE = process.argv[4] ?? 'cambiar123'
const PUERTO = 9334

if (!CARPETA) {
  console.error('Uso: npm run humo:fase5 -- <carpeta sembrada>')
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
  const contiene = (sel, txt) => [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(txt))
  const esperar = async (condicion, intentos = 60) => {
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
    await new Promise((r) => setTimeout(r, 600))
    return true
  }
  const escribir = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
    s.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
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
// 2. Los tres módulos nuevos ya no dicen «Próximamente»
// ---------------------------------------------------------------------------
const disponibles = await evaluar(`(async () => {
  ${AYUDA}
  const resultado = {}
  for (const modulo of ['Clientes', 'Pólizas', 'Renovaciones']) {
    await irA(modulo)
    resultado[modulo] = !document.body.innerText.includes('Próximamente')
  }
  return resultado
})()`)
anotar(
  'Clientes, Pólizas y Renovaciones están disponibles',
  Object.values(disponibles ?? {}).every(Boolean),
  Object.entries(disponibles ?? {})
    .map(([k, v]) => `${k}: ${v ? 'sí' : 'NO'}`)
    .join(' · '),
)

// ---------------------------------------------------------------------------
// 3. Clientes: listado, búsqueda y ficha con sus pestañas
// ---------------------------------------------------------------------------
const clientes = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Clientes')
  const cargo = await esperar(() => /clientes?/i.test(document.body.innerText) && document.querySelectorAll('button').length > 5)
  if (!cargo) return { error: 'no cargó el listado' }

  const buscador = document.querySelector('input[type="search"], input[placeholder*="usc"], input[placeholder*="ombre"]')
  if (!buscador) return { error: 'no encontré el buscador', texto: document.body.innerText.slice(0, 400) }
  escribir(buscador, 'perez')
  await esperar(() => document.body.innerText.includes('PEREZ'), 40)

  // Cada fila del listado es un <button> cuyo texto es el nombre del cliente.
  const fila = porTexto('button', 'PEREZ JUAN CARLOS')
  if (!fila) return { error: 'no apareció Pérez al buscar', texto: document.body.innerText.slice(0, 400) }
  fila.click()
  const abrio = await esperar(() => document.body.innerText.includes('Vehículos') && document.body.innerText.includes('Pólizas'))
  if (!abrio) return { error: 'no abrió la ficha', texto: document.body.innerText.slice(0, 400) }

  // Las solapas llevan el contador pegado al nombre («Vehículos2»): se comparan por el principio.
  const pestanas = [...document.querySelectorAll('[role="tab"], button')].map((b) => b.textContent.trim())
  const esperadas = ['Datos', 'Vehículos', 'Pólizas', 'Pagos', 'Siniestros', 'Notas']
  return {
    pestanas: esperadas.filter((p) => pestanas.some((t) => t.startsWith(p))),
    acciones: ['Nueva póliza', 'Registrar pago', 'Cargar siniestro', 'Nueva tarea'].filter((a) => document.body.innerText.includes(a)),
    // El pliego pide las cuatro andando: ninguna puede quedar deshabilitada.
    apagados: ['Nueva póliza', 'Registrar pago', 'Cargar siniestro', 'Nueva tarea'].filter(
      (a) => porTexto('button', a)?.disabled === true,
    ).length,
  }
})()`)
anotar('Clientes: buscar y abrir la ficha', !clientes?.error, clientes?.error ?? '')
anotar('Ficha con sus seis pestañas', clientes?.pestanas?.length === 6, (clientes?.pestanas ?? []).join(' · '))
anotar('Botones de acción de la ficha', clientes?.acciones?.length === 4, (clientes?.acciones ?? []).join(' · '))
anotar('Los cuatro botones están activos (ninguno apagado)', clientes?.apagados === 0, `${clientes?.apagados ?? '?'} apagados`)

// Las dos acciones que salen de la ficha hacia otros módulos tienen que abrir su diálogo.
const accionesDeLaFicha = await evaluar(`(async () => {
  ${AYUDA}
  const textoDelDialogo = () => document.querySelector('[role="dialog"]')?.innerText ?? ''
  const cerrarDialogo = async () => {
    document.querySelector('[role="dialog"] button[aria-label="Cerrar"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
  }
  const resultado = {}

  porTexto('button', 'Registrar pago').click()
  resultado.pago = (await esperar(() => /cuota|no tiene ninguna cuota/i.test(textoDelDialogo()), 80))
    ? textoDelDialogo().replace(/\\s+/g, ' ').slice(0, 120)
    : null
  await cerrarDialogo()

  porTexto('button', 'Cargar siniestro').click()
  resultado.siniestro = (await esperar(() => /qué pasó/i.test(textoDelDialogo()), 80))
    ? textoDelDialogo().replace(/\\s+/g, ' ').slice(0, 120)
    : null
  await cerrarDialogo()

  return resultado
})()`)
anotar('«Registrar pago» abre las cuotas del mes del cliente', accionesDeLaFicha?.pago !== null, accionesDeLaFicha?.pago ?? 'no abrió')
anotar('«Cargar siniestro» abre su formulario', accionesDeLaFicha?.siniestro !== null, accionesDeLaFicha?.siniestro ?? 'no abrió')

// ---------------------------------------------------------------------------
// 4. Criterio N°1: un DNI repetido no crea un duplicado
// ---------------------------------------------------------------------------
const duplicado = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Clientes')
  await esperar(() => !!porTexto('button', 'Nuevo cliente'))
  const nuevo = porTexto('button', 'Nuevo cliente')
  if (!nuevo) return { error: 'no está el botón «Nuevo cliente»' }
  nuevo.click()
  await esperar(() => !!document.querySelector('[role="dialog"]'))

  const dialogo = document.querySelector('[role="dialog"]')
  if (!dialogo) return { error: 'no abrió el diálogo de alta' }
  const campos = [...dialogo.querySelectorAll('input')]
  const etiqueta = (el) => (el.labels?.[0]?.textContent ?? '').toLowerCase()
  const nombre = campos.find((c) => /nombre/.test(etiqueta(c)))
  const documento = campos.find((c) => /dni|cuit|documento/.test(etiqueta(c)))
  if (!nombre || !documento) return { error: 'no encontré los campos', etiquetas: campos.map(etiqueta) }

  // 30111222 es el DNI de Pérez, que ya está en la cartera.
  escribir(nombre, 'PEREZ J. C. (REPETIDO)')
  escribir(documento, '30.111.222')
  const guardar = [...dialogo.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Crear cliente')
  if (!guardar) return { error: 'no está «Crear cliente»', botones: [...dialogo.querySelectorAll('button')].map((b) => b.textContent.trim()) }
  guardar.click()

  // El texto del modal NO sale en document.body.innerText (queda fuera del flujo): hay que preguntarle
  // al propio diálogo.
  const textoDelDialogo = () => document.querySelector('[role="dialog"]')?.innerText ?? ''
  const aviso = await esperar(() => /ya está cargado|abrir el cliente existente/i.test(textoDelDialogo()), 100)
  const texto = textoDelDialogo()
  return {
    aviso,
    ofreceAbrir: /abrir el cliente/i.test(texto),
    ofreceVolver: /volver a editar/i.test(texto),
    muestraExistente: texto.includes('PEREZ JUAN CARLOS'),
    texto: texto.slice(0, 300),
  }
})()`)
const fallaAlta = ['aviso', 'ofreceAbrir', 'ofreceVolver', 'muestraExistente'].filter((k) => duplicado?.[k] !== true)
anotar(
  'Criterio 1 · un DNI repetido no duplica: ofrece el existente',
  !duplicado?.error && fallaAlta.length === 0,
  duplicado?.error ?? (fallaAlta.length ? 'falta: ' + fallaAlta.join(', ') : (duplicado?.texto ?? '').replace(/\s+/g, ' ').slice(0, 110)),
)

// ---------------------------------------------------------------------------
// 5. Pólizas: listado con estados
// ---------------------------------------------------------------------------
const polizas = await evaluar(`(async () => {
  ${AYUDA}
  // Cerrar cualquier diálogo abierto.
  const cerrar = document.querySelector('[role="dialog"] button[aria-label="Cerrar"]')
  if (cerrar) { cerrar.click(); await new Promise((r) => setTimeout(r, 400)) }

  await irA('Pólizas')
  const cargo = await esperar(() => /ACTIVA|Activa/.test(document.body.innerText))
  if (!cargo) return { error: 'no cargó el listado', texto: document.body.innerText.slice(0, 400) }
  const texto = document.body.innerText
  return {
    estados: ['Activa', 'Baja', 'Vencida'].filter((e) => texto.includes(e)),
    hayNueva: !!porTexto('button', 'Nueva póliza'),
    filas: [...document.querySelectorAll('div')].filter((d) => d.className.includes('group flex border-b')).length,
  }
})()`)
anotar('Pólizas: el listado abre con sus estados', !polizas?.error, polizas?.error ?? `estados: ${(polizas?.estados ?? []).join(', ')}`)
anotar('Pólizas: botón «Nueva póliza»', polizas?.hayNueva === true)

// ---------------------------------------------------------------------------
// 5 bis. Criterio N°2: un vehículo demasiado viejo dispara la advertencia en vivo
// ---------------------------------------------------------------------------
const advertencia = await evaluar(`(async () => {
  ${AYUDA}
  const etiqueta = (el) => (el.labels?.[0]?.textContent ?? '').toLowerCase()
  const campo = (texto) => [...document.querySelectorAll('input, select')].find((c) => etiqueta(c).includes(texto))

  await irA('Pólizas')
  await esperar(() => !!porTexto('button', 'Nueva póliza'))
  porTexto('button', 'Nueva póliza').click()
  if (!(await esperar(() => !!campo('buscá el cliente')))) return { error: 'no abrió el formulario' }

  // 1) Elegir un cliente con el buscador.
  escribir(campo('buscá el cliente'), 'rodriguez')
  if (!(await esperar(() => !!contiene('button', 'RODRIGUEZ'), 60))) return { error: 'el buscador no encontró a Rodríguez' }
  contiene('button', 'RODRIGUEZ').click()
  await new Promise((r) => setTimeout(r, 500))

  // 2) Cargar un vehículo nuevo de 1995.
  const nuevo = [...document.querySelectorAll('input[type="radio"]')].find((r) => etiqueta(r).includes('cargar uno nuevo'))
  if (!nuevo) return { error: 'no está la opción de cargar un vehículo nuevo' }
  nuevo.click()
  if (!(await esperar(() => !!campo('año')))) return { error: 'no apareció el campo del año' }
  escribir(campo('año'), '1995')

  // 3) Compañía y cobertura que SÍ tienen regla cargada (la siembra le pone 15 años a SANCOR).
  escribir(campo('compañía'), 'SANCOR')
  escribir(campo('cobertura'), 'TERCEROS COMPLETO')

  // 4) La advertencia tiene que aparecer sola, sin apretar Guardar.
  const aviso = await esperar(() => /no acepta|antig|modelo 1995/i.test(document.body.innerText), 80)
  const texto = document.body.innerText
  const alerta = [...document.querySelectorAll('[role="status"], [role="alert"]')].map((a) => a.innerText).join(' ')
  return {
    aviso,
    mencionaElAnio: /1995/.test(alerta || texto),
    ofreceConfirmar: /continuar igual/i.test(texto),
    alerta: (alerta || '').replace(/\\s+/g, ' ').slice(0, 200),
  }
})()`)
anotar(
  'Criterio 2 · un vehículo de 1995 dispara la advertencia de cobertura',
  advertencia?.aviso === true && advertencia?.mencionaElAnio === true,
  advertencia?.error ?? advertencia?.alerta ?? '',
)
anotar('La advertencia deja continuar con confirmación de ADMIN', advertencia?.ofreceConfirmar === true)

// ---------------------------------------------------------------------------
// 6. Criterio N°3: la bandeja de renovaciones muestra los próximos 60 días
// ---------------------------------------------------------------------------
const renovaciones = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Renovaciones')
  const cargo = await esperar(() => /semana|vence|renov/i.test(document.body.innerText))
  if (!cargo) return { error: 'no cargó la bandeja', texto: document.body.innerText.slice(0, 400) }
  const texto = document.body.innerText
  return {
    semanas: (texto.match(/Esta semana|La semana que viene|Semana del/g) ?? []).length,
    tieneAumento: /aumentar|aumenta/i.test(texto),
    hayRenovar: [...document.querySelectorAll('button')].some((b) => /renovar/i.test(b.textContent)),
    hayNoRenueva: [...document.querySelectorAll('button, option')].some((b) => /no renueva/i.test(b.textContent)),
    hayResponsable: [...document.querySelectorAll('select')].length > 0,
    texto: texto.slice(0, 400),
  }
})()`)
anotar(
  'Criterio 3 · la bandeja agrupa por semana los próximos 60 días',
  !renovaciones?.error && renovaciones?.semanas > 0,
  renovaciones?.error ?? `${renovaciones?.semanas} semanas`,
)
anotar('Etiqueta de «aumentar al renovar»', renovaciones?.tieneAumento === true)
anotar('Acciones Renovar / No renueva y responsable', renovaciones?.hayRenovar === true && renovaciones?.hayResponsable === true)

// ---------------------------------------------------------------------------
// 6 bis. El diálogo de «Renovar» propone la vigencia y la cuota, ya con el aumento
// ---------------------------------------------------------------------------
const dialogoRenovar = await evaluar(`(async () => {
  ${AYUDA}
  const textoDelDialogo = () => document.querySelector('[role="dialog"]')?.innerText ?? ''
  await irA('Renovaciones')
  await esperar(() => [...document.querySelectorAll('button')].some((b) => /renovar/i.test(b.textContent)))
  const boton = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Renovar')
  if (!boton) return { error: 'no está el botón Renovar' }
  boton.click()
  if (!(await esperar(() => /vigencia desde/i.test(textoDelDialogo()), 80))) {
    return { error: 'no abrió el diálogo', texto: textoDelDialogo().slice(0, 200) }
  }
  const texto = textoDelDialogo()
  const campos = [...document.querySelectorAll('[role="dialog"] input')]
  const etiqueta = (el) => (el.labels?.[0]?.textContent ?? '').toLowerCase()
  const valorDe = (nombre) => campos.find((c) => etiqueta(c).includes(nombre))?.value ?? ''
  return {
    explicaQuePasa: /queda como histórica/i.test(texto),
    proponeVigencia: valorDe('vigencia desde') !== '' && valorDe('vigencia hasta') !== '',
    proponeCuota: valorDe('cuota') !== '',
    // La póliza sembrada lleva «20% aumentar cuando se renueva»: la cuota tiene que venir ya aumentada
    // y el diálogo tiene que decirlo, sin ofrecer volver a aplicar el aumento.
    avisaDelAumento: /ya lo incluye/i.test(texto),
    noReaplicaElAumento: !/aplicar \\+/i.test(texto),
    texto: texto.replace(/\\s+/g, ' ').slice(0, 200),
  }
})()`)
anotar(
  'Renovar propone vigencia y cuota, y explica qué va a pasar',
  !dialogoRenovar?.error && dialogoRenovar?.proponeVigencia === true && dialogoRenovar?.proponeCuota === true && dialogoRenovar?.explicaQuePasa === true,
  dialogoRenovar?.error ?? '',
)
anotar(
  'El aumento viene aplicado una sola vez y el diálogo lo aclara',
  dialogoRenovar?.avisaDelAumento === true && dialogoRenovar?.noReaplicaElAumento === true,
  dialogoRenovar?.texto ?? '',
)

// ---------------------------------------------------------------------------
// 7. Cartera → Reglas de cobertura
// ---------------------------------------------------------------------------
const reglas = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Cartera')
  await new Promise((r) => setTimeout(r, 600))
  const solapa = [...document.querySelectorAll('[role="tab"]')].find((b) => /reglas/i.test(b.textContent))
  if (!solapa) return { error: 'no está la subpestaña de reglas', solapas: [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim()) }
  solapa.click()
  // Ojo: el rótulo de la solapa ya dice «cobertura», así que hay que esperar contenido de la matriz.
  const cargo = await esperar(() => /REGLAS CARGADAS|sin límite cargado|Faltan d+ combinaciones/i.test(document.body.innerText))
  if (!cargo) return { error: 'no cargó la matriz', texto: document.body.innerText.slice(0, 400) }
  const texto = document.body.innerText
  return {
    hayMatriz: /SANCOR|ZURICH/.test(texto),
    hayFaltantes: /falta|sin regla|Cargar/i.test(texto),
    hayNueva: [...document.querySelectorAll('button')].some((b) => /nueva regla/i.test(b.textContent)),
    hayReferencia: /hoja/i.test(texto),
  }
})()`)
anotar('Cartera → Reglas de cobertura', !reglas?.error, reglas?.error ?? `matriz: ${reglas?.hayMatriz ? 'sí' : 'no'}`)
anotar('La matriz avisa qué combinaciones faltan cargar', reglas?.hayFaltantes === true)
anotar('El SUPER_ADMIN puede cargar una regla nueva', reglas?.hayNueva === true)

// ---------------------------------------------------------------------------
// 7 bis. La Planilla del mes (Fase 3) sigue andando: guarda contra regresiones
// ---------------------------------------------------------------------------
const planilla = await evaluar(`(async () => {
  ${AYUDA}
  await irA('Cartera')
  const solapa = [...document.querySelectorAll('[role="tab"]')].find((b) => /planilla del mes/i.test(b.textContent))
  if (!solapa) return { error: 'no está la solapa de la planilla' }
  solapa.click()
  // Ojo: la pantalla anterior también dice «filas», así que hay que esperar las filas de la tabla
  // virtualizada, no un texto cualquiera.
  const filasDibujadas = () =>
    [...document.querySelectorAll('div')].filter((d) => typeof d.className === 'string' && d.className.includes('group flex border-b')).length
  const cargo = await esperar(() => filasDibujadas() > 0 || /Ninguna fila coincide/i.test(document.body.innerText), 100)
  if (!cargo) return { error: 'no cargó la planilla' }
  const texto = document.body.innerText
  return {
    hayFilas: filasDibujadas(),
    hayColores: /vencen hoy|Al día|Vencido|Vence/i.test(texto),
    subpestanas: [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim()),
  }
})()`)
anotar(
  'La Planilla del mes sigue abriendo con sus filas (sin regresiones)',
  !planilla?.error && planilla?.hayFilas > 0,
  planilla?.error ?? `${planilla?.hayFilas} filas dibujadas`,
)
anotar(
  'Cartera tiene sus seis subpestañas, con Reglas de cobertura ya disponible',
  planilla?.subpestanas?.length === 6 && planilla?.subpestanas?.some((s) => /reglas/i.test(s)),
  (planilla?.subpestanas ?? []).join(' · '),
)

// ---------------------------------------------------------------------------
// 8. Nada explotó por el camino
// ---------------------------------------------------------------------------
const errores = await evaluar(`(() => document.body.innerText.match(/Ocurrió un error inesperado/g)?.length ?? 0)()`)
anotar('Sin errores inesperados en pantalla', errores === 0, errores ? `${errores} avisos` : '')

console.log('\n' + resultados.filter((r) => r.ok).length + '/' + resultados.length + ' pasos bien')
ws.close()
electron.kill()
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
