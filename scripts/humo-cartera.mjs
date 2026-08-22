// Prueba de humo de la Cartera: abre la app contra la copia, entra, va a Cartera y mide la planilla.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const rutaElectron = require('electron')

const CARPETA = process.argv[2]
const USUARIO = process.argv[3] ?? 'daniel'
const CLAVE = process.argv[4] ?? 'cambiar123'
const PUERTO = 9333

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

const url = await objetivo()
const { default: WS } = await import('node:worker_threads').then(() => ({ default: null })).catch(() => ({ default: null }))

// CDP por WebSocket con la implementación del propio Node (undici trae WebSocket global).
const ws = new WebSocket(url)
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

// 1) Ingreso
const conCredenciales = (t) => t.replace("USUARIO_AQUI", USUARIO).replace("CLAVE_AQUI", CLAVE)
const hayLogin = await evaluar(`!!document.querySelector('input[type="password"]')`)
if (hayLogin) {
  await evaluar(conCredenciales(`(() => {
    const poner = (el, v) => { const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})) }
    const campos = document.querySelectorAll('input')
    poner(campos[0], "USUARIO_AQUI"); poner(campos[1], "CLAVE_AQUI")
    document.querySelector('form').requestSubmit()
    return true
  })()`))
  await dormir(2500)
}
anotar('Ingreso', !(await evaluar(`!!document.querySelector('input[type="password"]')`)), '')

// 2) Ir a Cartera y medir
const abrio = await evaluar(`(async () => {
  const boton = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cartera')
  if (!boton) return { error: 'no está el botón Cartera' }
  const t0 = performance.now()
  boton.click()
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const filas = document.querySelectorAll('[role="progressbar"]').length
    const texto = document.body.innerText
    if (/de 2\.384 filas/.test(texto) || /Ninguna fila coincide/.test(texto)) return { ms: Math.round(performance.now() - t0), texto: texto.slice(0, 400) }
  }
  return { error: 'no cargó', texto: document.body.innerText.slice(0, 600) }
})()`)
anotar('La planilla abre', !abrio.error, abrio.error ? abrio.error : `${abrio.ms} ms`)

// 3) Contenido
const info = await evaluar(`(() => {
  const texto = document.body.innerText
  const celdas = document.querySelectorAll('.sticky.top-0 > div').length
  const filasDibujadas = [...document.querySelectorAll('div')].filter((d) => d.className.includes('group flex border-b')).length
  return { celdas, filasDibujadas, tieneAlerta: texto.includes('Alerta'), tieneContadores: /vencen hoy/i.test(texto), muestra: texto.slice(0, 500) }
})()`)
anotar('Encabezados de la tabla', info.celdas >= 20, `${info.celdas} columnas`)
anotar('Virtualización (no dibuja las 2.384)', info.filasDibujadas > 5 && info.filasDibujadas < 100, `${info.filasDibujadas} filas en el DOM`)
anotar('Contadores arriba', info.tieneContadores)

// 4) Desplazamiento
const scroll = await evaluar(`(async () => {
  const cont = [...document.querySelectorAll('div')].find((d) => d.className.includes('overflow-auto') && d.scrollHeight > 2000)
  if (!cont) return { error: 'no encontré el contenedor' }
  const t0 = performance.now()
  for (let i = 0; i < 20; i++) { cont.scrollTop += 1500; await new Promise((r) => requestAnimationFrame(r)) }
  return { ms: Math.round(performance.now() - t0), alto: cont.scrollHeight, arriba: cont.scrollTop }
})()`)
anotar('Se desplaza fluido', !scroll.error && scroll.ms < 2000, scroll.error ?? `20 saltos en ${scroll.ms} ms (alto ${scroll.alto}px)`)

// 5) Botón Cerrar mes visible para SUPER_ADMIN
const cerrar = await evaluar(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Cerrar mes')`)
anotar(USUARIO === 'daniel' ? '«Cerrar mes» visible para SUPER_ADMIN' : '«Cerrar mes» NO aparece para EMPLEADO', USUARIO === 'daniel' ? cerrar === true : cerrar === false)

// 6) Subpestañas de Cartera
const subs = await evaluar(`[...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim())`)
anotar('Subpestañas de Cartera', Array.isArray(subs) && subs.length === 6, (subs ?? []).join(' · '))

// 7) Indicador de sincronización en la barra superior
const indicador = await evaluar(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Local|Sincronizado|por subir|Sin conexión|Sincronizando/.test(x.textContent))
  return b ? { texto: b.textContent.trim(), deshabilitado: b.disabled } : null
})()`)
anotar('Indicador de sincronización', indicador !== null, indicador ? indicador.texto : 'no aparece')

// 7) Pantalla de Administración → Sincronización
const sincronizacion = await evaluar(`(async () => {
  const admin = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Administración')
  if (!admin) return { error: 'no está Administración' }
  admin.click()
  await new Promise((r) => setTimeout(r, 800))
  const solapa = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === 'Sincronización')
  if (!solapa) return { error: 'no está la solapa Sincronización' }
  solapa.click()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const t = document.body.innerText
    if (/COLA DE SUBIDA|Cola de subida/i.test(t)) {
      return {
        secciones: ['Estado', 'Cola de subida', 'Últimos movimientos', 'Respaldos'].filter((x) => new RegExp(x, 'i').test(t)),
        hayBotones: ['Sincronizar ahora', 'Forzar bajada completa', 'Respaldar ahora'].filter((x) => t.includes(x)),
      }
    }
  }
  return { error: 'no cargó', texto: document.body.innerText.slice(0, 300) }
})()`)
anotar(
  'Pantalla de Sincronización',
  !sincronizacion.error && sincronizacion.secciones.length === 4 && sincronizacion.hayBotones.length === 3,
  sincronizacion.error ?? `${sincronizacion.secciones.length}/4 secciones · ${sincronizacion.hayBotones.length}/3 botones`,
)


console.log('\n' + resultados.filter((r) => r.ok).length + '/' + resultados.length + ' pasos bien')
ws.close()
electron.kill()
process.exit(resultados.every((r) => r.ok) ? 0 : 1)
