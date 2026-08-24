// Prueba de humo de los permisos por rol: el superadministrador recorta lo que puede un empleado en
// Administración → Permisos, y después entra «lucia» (EMPLEADO, sembrada por `npm run sembrar`) para
// comprobar que la barra lateral, las pantallas y los botones respetan lo que se configuró.
//
// Uso: npm run humo:permisos -- <carpeta sembrada>
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const rutaElectron = require('electron')

const CARPETA = process.argv[2]
const PUERTO = 9338

if (!CARPETA) {
  console.error('Uso: npm run humo:permisos -- <carpeta sembrada con npm run sembrar>')
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
  if (respuesta.result?.exceptionDetails) throw new Error(JSON.stringify(respuesta.result.exceptionDetails).slice(0, 500))
  return respuesta.result?.result?.value
}

await enviar('Runtime.enable')
await dormir(1500)

const resultados = []
const anotar = (paso, ok, detalle = '') => {
  resultados.push({ paso, ok, detalle })
  console.log(`${ok ? 'ok ' : 'MAL'} ${paso}${detalle ? ' · ' + detalle : ''}`)
}

async function ingresar(usuario, clave) {
  await evaluar(`(() => {
    const poner = (el, v) => { const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})) }
    const campos = document.querySelectorAll('input')
    poner(campos[0], ${JSON.stringify(usuario)}); poner(campos[1], ${JSON.stringify(clave)})
    document.querySelector('form').requestSubmit()
    return true
  })()`)
  await dormir(2500)
}

async function salir() {
  await evaluar(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Cerrar sesión')
    if (b) b.click()
    return true
  })()`)
  await dormir(1500)
}

// 1) Entra el superadministrador
if (await evaluar(`!!document.querySelector('input[type="password"]')`)) await ingresar('daniel', 'cambiar123')
anotar('Ingresa el superadministrador', !(await evaluar(`!!document.querySelector('input[type="password"]')`)))

const originales = await evaluar(`(async () => (await window.dm.permisos.matriz()).datos.permisos)()`)
anotar('La matriz se lee desde la aplicación', !!originales?.EMPLEADO, originales ? `EMPLEADO/Cartera: ${originales.EMPLEADO.cartera}` : 'no vino')

// 2) La pestaña Permisos existe y muestra una fila por módulo
const pantalla = await evaluar(`(async () => {
  const admin = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Administración')
  if (!admin) return { error: 'no está Administración' }
  admin.click()
  await new Promise((r) => setTimeout(r, 800))
  const solapa = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === 'Permisos')
  if (!solapa) return { error: 'no está la solapa Permisos' }
  solapa.click()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if (/Permisos por rol/.test(document.body.innerText)) {
      const selects = document.querySelectorAll('table select')
      // innerText aplica el text-transform de la hoja de estilos: los encabezados llegan en mayúsculas.
      const texto = document.body.innerText
      return { selects: selects.length, columnas: /Administrador/i.test(texto) && /Empleado/i.test(texto) }
    }
  }
  return { error: 'no cargó', texto: document.body.innerText.slice(0, 300) }
})()`)
anotar(
  'Administración → Permisos abre con la matriz',
  !pantalla.error && pantalla.columnas && pantalla.selects === 26,
  pantalla.error ?? `${pantalla.selects} celdas (13 módulos × 2 roles)`,
)

// 3) Se recorta al empleado: Cartera en sólo lectura y Marketing sin acceso.
const guardado = await evaluar(`(async () => {
  const matriz = (await window.dm.permisos.matriz()).datos.permisos
  matriz.EMPLEADO.cartera = 'ver'
  matriz.EMPLEADO.marketing = 'ninguno'
  const r = await window.dm.permisos.guardar(matriz)
  return r.ok ? r.datos.permisos.EMPLEADO : { error: r.error }
})()`)
anotar(
  'Guardar la matriz recortada',
  guardado?.cartera === 'ver' && guardado?.marketing === 'ninguno',
  guardado?.error ?? `cartera: ${guardado?.cartera} · marketing: ${guardado?.marketing}`,
)

// 4) Entra la empleada y mira su barra lateral
await salir()
await ingresar('lucia', 'cambiar123')
const barra = await evaluar(`(() => {
  const nav = document.querySelector('nav[aria-label="Módulos"]')
  if (!nav) return { error: 'no está la barra lateral' }
  return { modulos: [...nav.querySelectorAll('button')].map((b) => b.textContent.trim()) }
})()`)
anotar('Entra la empleada', !barra.error, barra.error ?? `${barra.modulos.length} módulos en la barra`)
anotar('Marketing desapareció de la barra lateral', !barra.error && !barra.modulos.includes('Marketing'), (barra.modulos ?? []).join(' · '))
anotar('Cartera sigue estando (queda en sólo lectura)', !barra.error && barra.modulos.includes('Cartera'))

// 5) Cartera se abre pero no se puede tocar
const cartera = await evaluar(`(async () => {
  const boton = [...document.querySelectorAll('nav[aria-label="Módulos"] button')].find((b) => b.textContent.trim() === 'Cartera')
  if (!boton) return { error: 'no está Cartera' }
  boton.click()
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const texto = document.body.innerText
    if (/filas/.test(texto) && !/Abriendo la planilla/.test(texto)) {
      const acciones = [...document.querySelectorAll('button[title="Registrar pago"]')]
      return {
        soloLectura: /sólo lectura/i.test(texto),
        cerrarMes: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Cerrar mes'),
        accionesApagadas: acciones.length > 0 && acciones.every((b) => b.disabled),
      }
    }
  }
  return { error: 'no cargó', texto: document.body.innerText.slice(0, 300) }
})()`)
anotar('La planilla abre en sólo lectura', !cartera.error && cartera.soloLectura, cartera.error ?? '')
anotar('Los botones de la fila quedan apagados', !cartera.error && cartera.accionesApagadas)
anotar('No aparece «Cerrar mes»', !cartera.error && !cartera.cerrarMes)

// 6) Administración se abre igual, con «Acerca de» y nada más
const administracion = await evaluar(`(async () => {
  const boton = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Administración')
  if (!boton) return { error: 'no está Administración en la barra' }
  boton.click()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const solapas = [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim())
    if (solapas.length > 0) return { solapas }
  }
  return { error: 'no aparecieron las solapas', texto: document.body.innerText.slice(0, 300) }
})()`)
anotar(
  'Administración se abre con «Acerca de» y nada más',
  !administracion.error && administracion.solapas.length === 1 && administracion.solapas[0] === 'Acerca de',
  administracion.error ? `${administracion.error}: ${administracion.texto ?? ''}` : (administracion.solapas ?? []).join(' · '),
)

// 7) Y el proceso principal rechaza igual lo que la pantalla no ofrece
const rechazos = await evaluar(`(async () => {
  const planilla = await window.dm.cartera.planilla(null)
  const primera = planilla.ok ? planilla.datos.filas[0] : null
  const edicion = primera ? await window.dm.cartera.editarCelda(primera.filaId, 'observaciones', 'no debería entrar') : { ok: true }
  const marketing = await window.dm.marketing.plantillas()
  return { verCartera: planilla.ok, edicion: edicion.ok, errorEdicion: edicion.error ?? '', marketing: marketing.ok, errorMarketing: marketing.error ?? '' }
})()`)
anotar('Con «ver» la planilla se consulta igual', rechazos.verCartera)
anotar('Editar una celda lo frena el proceso principal', rechazos.edicion === false, rechazos.errorEdicion)
anotar('Marketing sin acceso también se rechaza por IPC', rechazos.marketing === false, rechazos.errorMarketing)

// 8) La empleada no puede tocar la matriz
const intento = await evaluar(`(async () => {
  const matriz = await window.dm.permisos.matriz()
  const guardar = await window.dm.permisos.guardar(${JSON.stringify({ EMPLEADO: { administracion: 'editar' } })})
  return { leer: matriz.ok, guardar: guardar.ok, error: guardar.error ?? '' }
})()`)
anotar('Un empleado no puede leer ni cambiar la matriz', intento.leer === false && intento.guardar === false, intento.error)

// 9) Se deja todo como estaba
await salir()
await ingresar('daniel', 'cambiar123')
const restaurado = await evaluar(`(async () => {
  const r = await window.dm.permisos.guardar(${JSON.stringify(originales)})
  return r.ok ? r.datos.permisos.EMPLEADO : { error: r.error }
})()`)
anotar(
  'Los permisos vuelven a como estaban',
  restaurado?.cartera === originales?.EMPLEADO.cartera && restaurado?.marketing === originales?.EMPLEADO.marketing,
  restaurado?.error ?? '',
)
console.log('\n' + resultados.filter((r) => r.ok).length + '/' + resultados.length + ' pasos bien')
ws.close()
electron.kill()
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
