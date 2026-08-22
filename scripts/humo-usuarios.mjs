// Prueba de humo de la Fase 11 (base de usuarios compartida): abre la aplicación de verdad contra una
// carpeta de datos nueva y recorre el ciclo completo: inicializar la base desde la computadora
// principal, crear un usuario, «cortar internet» y entrar con la credencial cifrada, volver a tener
// internet y confirmar la sesión, el primer ingreso del usuario nuevo con cambio obligatorio de
// contraseña, y la desactivación desde otra computadora que cierra la sesión abierta. Usa safeStorage
// de verdad (DPAPI).
//
//   npm run humo:usuarios          contra un simulador local de la API de GitHub (no sale a internet)
//   npm run humo:usuarios -- --real contra el repositorio real, con el token de `gh auth token`, en un
//                                  archivo de prueba aparte (pruebas/humo-<fecha>.json) que se borra al
//                                  final pase lo que pase. Sólo los pasos que no necesitan «cortar internet».
//
// No toca la carpeta %APPDATA%/dm-gestion ni, en modo real, el usuarios.json de verdad.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GitHubSimulado } from './github-simulado.mjs'
const require = createRequire(import.meta.url)
const rutaElectron = require('electron')

const REAL = process.argv.includes('--real')
const REPO = 'zeroframe404/dm-gestion-datos'
const PUERTO_CDP = 9339
const PUERTO_SIMULADOR = 9340
const ESPERA_CDP_MS = 30_000
const carpetaDatos = mkdtempSync(path.join(tmpdir(), 'dm-humo-usuarios-'))
const archivoReal = `pruebas/humo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`

const resultados = []
const anotar = (paso, ok, detalle = '') => {
  resultados.push({ paso, ok, detalle })
  console.log(`${ok ? 'ok ' : 'MAL'} ${paso}${detalle ? ' · ' + detalle : ''}`)
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

let simulador = null
let electron = null
let ws = null
let terminado = false

/** Limpieza, pase lo que pase: Electron, el simulador, el archivo de prueba en el repo real y la carpeta temporal. */
async function terminar(codigoForzado) {
  if (terminado) return
  terminado = true
  try {
    ws?.close()
  } catch {}
  try {
    electron?.kill()
  } catch {}
  if (simulador) await simulador.cerrar().catch(() => undefined)
  if (REAL) borrarArchivoReal()
  await dormir(500)
  try {
    rmSync(carpetaDatos, { recursive: true, force: true })
  } catch {}
  const bien = resultados.filter((r) => r.ok).length
  console.log(`\n${bien}/${resultados.length} pasos bien`)
  process.exit(codigoForzado ?? (resultados.length > 0 && resultados.every((r) => r.ok) ? 0 : 1))
}

/** El archivo de prueba no tiene que quedar en el repositorio de datos: se intenta dos veces y se avisa si no se pudo. */
function borrarArchivoReal() {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const contenido = JSON.parse(execFileSync('gh', ['api', `repos/${REPO}/contents/${archivoReal}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      execFileSync('gh', ['api', '-X', 'DELETE', `repos/${REPO}/contents/${archivoReal}`, '-f', 'message=Humo: borrar archivo de prueba', '-f', `sha=${contenido.sha}`], { stdio: 'ignore' })
      console.log(`Borrado ${archivoReal} del repositorio ${REPO}.`)
      return
    } catch (error) {
      // Si el GET falla con 404 el archivo nunca se creó: no hay nada que borrar.
      const mensaje = String(error?.stderr ?? error?.message ?? error)
      if (/404|Not Found/.test(mensaje)) return
    }
  }
  console.error(`ATENCIÓN: no se pudo borrar ${archivoReal} de ${REPO}. Borralo a mano: gh api -X DELETE repos/${REPO}/contents/${archivoReal} -f message=limpieza -f sha=<sha>`)
}

process.on('SIGINT', () => void terminar(130))
process.on('SIGTERM', () => void terminar(143))

// ---------------------------------------------------------------------------
// Arranque: simulador (o token real), Electron y el puente CDP
// ---------------------------------------------------------------------------
async function arrancar() {
  if (!REAL) {
    simulador = new GitHubSimulado({ tokens: ['prueba'], vence: '2027-06-30' })
    await simulador.escuchar(PUERTO_SIMULADOR)
  }
  const tokenReal = REAL ? execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() : ''

  electron = spawn(rutaElectron, ['.', `--remote-debugging-port=${PUERTO_CDP}`], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DM_GESTION_CARPETA_DATOS: carpetaDatos,
      DM_GESTION_TOKEN_DATOS: REAL ? tokenReal : 'prueba',
      ...(REAL ? { DM_GESTION_ARCHIVO_DATOS: archivoReal } : { DM_GESTION_GITHUB_API: simulador.url }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let salida = ''
  electron.stdout.on('data', (d) => (salida += d))
  electron.stderr.on('data', (d) => (salida += d))
  electron.on('exit', (codigo) => {
    if (!terminado) {
      console.error(`Electron terminó solo (código ${codigo}). Salida:\n${salida.slice(-2000)}`)
      void terminar(1)
    }
  })

  let urlDepuracion = null
  for (let i = 0; i < 40 && !urlDepuracion; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()
      urlDepuracion = lista.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? null
    } catch {}
    if (!urlDepuracion) await dormir(500)
  }
  if (!urlDepuracion) throw new Error('No apareció la ventana. Salida:\n' + salida.slice(-2000))

  ws = new WebSocket(urlDepuracion)
  ws.addEventListener('message', (evento) => {
    const mensaje = JSON.parse(evento.data)
    const espera = pendientes.get(mensaje.id)
    if (espera) {
      pendientes.delete(mensaje.id)
      espera.resolver(mensaje)
    }
  })
  const cortar = (motivo) => {
    for (const espera of pendientes.values()) espera.rechazar(new Error(motivo))
    pendientes.clear()
  }
  ws.addEventListener('close', () => cortar('Se cerró la conexión con la ventana.'))
  ws.addEventListener('error', () => cortar('Falló la conexión con la ventana.'))
  await new Promise((resolver, rechazar) => {
    ws.addEventListener('open', resolver)
    ws.addEventListener('error', rechazar)
  })
  await enviar('Runtime.enable')
  await dormir(1500)
}

let siguienteId = 1
const pendientes = new Map()

function enviar(method, params = {}) {
  const id = siguienteId++
  return new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => {
      pendientes.delete(id)
      rechazar(new Error(`La ventana no respondió a ${method} en ${ESPERA_CDP_MS / 1000} s.`))
    }, ESPERA_CDP_MS)
    pendientes.set(id, {
      resolver: (mensaje) => {
        clearTimeout(temporizador)
        resolver(mensaje)
      },
      rechazar: (error) => {
        clearTimeout(temporizador)
        rechazar(error)
      },
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluar(expresion) {
  const respuesta = await enviar('Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true })
  if (respuesta.result?.exceptionDetails) throw new Error(JSON.stringify(respuesta.result.exceptionDetails).slice(0, 600))
  return respuesta.result?.result?.value
}

/** Lo que hay en GitHub (real o simulado): el archivo parseado y los mensajes de commit. */
function remoto() {
  if (!REAL) return { documento: simulador.texto ? JSON.parse(simulador.texto) : null, commits: simulador.commits }
  try {
    const contenido = JSON.parse(execFileSync('gh', ['api', `repos/${REPO}/contents/${archivoReal}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    const commits = JSON.parse(execFileSync('gh', ['api', `repos/${REPO}/commits?path=${archivoReal}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      .map((c) => c.commit.message)
      .reverse()
    return { documento: JSON.parse(Buffer.from(contenido.content, 'base64').toString('utf8')), commits }
  } catch {
    return { documento: null, commits: [] }
  }
}

const AYUDA = `
  const esperar = async (condicion, intentos = 100) => {
    for (let i = 0; i < intentos; i++) {
      if (await condicion()) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }
  const poner = (el, v) => { const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})) }
  const texto = () => document.body.innerText
`

/** Completa el formulario de ingreso y espera a que haya sesión (o a que aparezca un error). */
async function ingresar(usuario, clave) {
  return evaluar(`(async () => {
    ${AYUDA}
    const campos = document.querySelectorAll('form input')
    if (campos.length < 2) return { error: 'no está el formulario de ingreso' }
    poner(campos[0], ${JSON.stringify(usuario)}); poner(campos[1], ${JSON.stringify(clave)})
    document.querySelector('form').requestSubmit()
    await esperar(async () => {
      const s = await window.dm.auth.sesion()
      return (s.ok && s.datos) || /incorrectos|Sin internet|no pudo acceder|desactivado|hace falta|días/i.test(texto())
    }, 150)
    const s = await window.dm.auth.sesion()
    return { sesion: s.ok ? s.datos : null, texto: texto().slice(0, 400) }
  })()`)
}

async function cambiarClaveEnPantalla(actual, nueva) {
  return evaluar(`(async () => {
    ${AYUDA}
    if (!/Cambiá tu contraseña/.test(texto())) return { error: 'no está la pantalla de cambio de contraseña' }
    const campos = document.querySelectorAll('form input')
    poner(campos[0], ${JSON.stringify(actual)}); poner(campos[1], ${JSON.stringify(nueva)}); poner(campos[2], ${JSON.stringify(nueva)})
    document.querySelector('form').requestSubmit()
    const listo = await esperar(async () => { const s = await window.dm.auth.sesion(); return s.ok && s.datos && !s.datos.debeCambiarClave })
    return { listo, texto: texto().slice(0, 300) }
  })()`)
}

const textoDePantalla = () => evaluar(`document.body.innerText`)
/** Cierra sesión como una persona: con el botón de la barra, así la pantalla vuelve al Login. */
const salir = () =>
  evaluar(`(async () => {
    ${AYUDA}
    const boton = [...document.querySelectorAll('button')].find((b) => /Cerrar sesión/.test(b.textContent))
    if (!boton) return false
    boton.click()
    return esperar(() => !!document.querySelector('input[type="password"]'))
  })()`)

// ---------------------------------------------------------------------------
// El guion
// ---------------------------------------------------------------------------
async function correr() {
  // 1. Sin inicializar: el Login lo dice y se ingresa con la semilla local
  const lineaInicial = await evaluar(`(async () => { ${AYUDA} await esperar(() => /todavía no se inicializó|En línea|Comprobando/.test(texto())); return texto() })()`)
  anotar('El Login avisa que la base compartida todavía no se inicializó', /todavía no se inicializó/.test(lineaInicial ?? ''))

  const primero = await ingresar('daniel', 'cambiar123')
  anotar('daniel entra con la semilla local y tiene que cambiar la contraseña', primero?.sesion?.debeCambiarClave === true, primero?.error ?? '')
  const cambio = await cambiarClaveEnPantalla('cambiar123', 'Clave-Humo-1')
  anotar('Cambia la contraseña inicial (todavía local)', cambio?.listo === true, cambio?.error ?? '')

  // 2. Subir los usuarios de esta computadora: la base queda en GitHub y sin hashes locales
  const antes = await evaluar(`window.dm.usuarios.estado(true)`)
  anotar('Usuarios informa «sin inicializar» con la lista de locales a subir', antes?.ok && antes.datos.origen === 'sin-inicializar' && antes.datos.localesParaSubir.join() === 'daniel', JSON.stringify(antes?.datos?.localesParaSubir))
  const subida = await evaluar(`window.dm.usuarios.subirLocales()`)
  const remoto1 = remoto()
  anotar(
    `Subir usuarios crea ${REAL ? archivoReal : 'usuarios.json'} en GitHub con daniel y su hash`,
    subida?.ok && subida.datos.origen === 'github' && remoto1.documento?.usuarios?.length === 1 && remoto1.documento.usuarios[0].usuario === 'daniel' && /^\$2/.test(remoto1.documento.usuarios[0].claveHash),
    subida?.ok ? `${remoto1.commits.length} commit(s): ${remoto1.commits[0]}` : subida?.error,
  )
  anotar('El mensaje de commit deja quién, desde dónde y con qué versión', /inicialización.*daniel en .+ · DM Gestión/.test(remoto1.commits[0] ?? ''), remoto1.commits[0] ?? '')
  anotar('Quedó la credencial cifrada de daniel en la carpeta de datos', existsSync(path.join(carpetaDatos, 'credencial.bin')))
  const estadoAcceso = await evaluar(`window.dm.auth.estadoDeAcceso(false)`)
  anotar(
    `El estado dice en línea, con 1 usuario${REAL ? '' : ' y el vencimiento del token'}`,
    estadoAcceso?.ok && estadoAcceso.datos.modo === 'en-linea' && estadoAcceso.datos.cantidad === 1 && (REAL || estadoAcceso.datos.tokenVence === '2027-06-30'),
    JSON.stringify({ modo: estadoAcceso?.datos?.modo, vence: estadoAcceso?.datos?.tokenVence }),
  )

  // 3. Crear un usuario: va a GitHub con contraseña temporal
  const creado = await evaluar(`window.dm.usuarios.crear({ nombre: 'María Pérez', usuario: 'maria', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: 2 })`)
  const remoto2 = remoto()
  const mariaRemota = remoto2.documento?.usuarios?.find((u) => u.usuario === 'maria')
  anotar('Crear «maria» la escribe en GitHub con cambio de contraseña pendiente', creado?.ok && mariaRemota?.debeCambiarClave === true && mariaRemota.sucursal === 'Lanús', creado?.ok ? '' : creado?.error)
  // Después de escribir, la primera relectura baja el archivo entero (el cliente descarta su caché a
  // propósito); la siguiente ya va con If-None-Match y GitHub responde 304 sin gastar cuota.
  await evaluar(`window.dm.auth.estadoDeAcceso(true)`)
  const intercambiosAntes = simulador ? simulador.intercambios.length : 0
  const relectura = await evaluar(`window.dm.auth.estadoDeAcceso(true)`)
  const ultimo = simulador ? simulador.intercambios.at(-1) : null
  anotar(
    'Volver a comprobar (lectura condicional) sigue en línea con 2 usuarios',
    relectura?.ok && relectura.datos.modo === 'en-linea' && relectura.datos.cantidad === 2 && (REAL || (simulador.intercambios.length === intercambiosAntes + 1 && ultimo?.estado === 304)),
    JSON.stringify({ modo: relectura?.datos?.modo, cantidad: relectura?.datos?.cantidad, estado: ultimo?.estado ?? 'real' }),
  )
  await salir()

  if (REAL) {
    // Contra GitHub real no se puede «cortar internet» ni escribir como otra computadora: con esto alcanza.
    const mariaEnLinea = await ingresar('maria', 'Temporal-123')
    anotar('maria ingresa en línea contra GitHub real con la temporal', mariaEnLinea?.sesion?.usuario === 'maria' && mariaEnLinea.sesion.debeCambiarClave === true, mariaEnLinea?.error ?? '')
    const cambioMaria = await cambiarClaveEnPantalla('Temporal-123', 'Maria-Humo-1')
    const mariaDespues = remoto().documento?.usuarios?.find((u) => u.usuario === 'maria')
    anotar('maria cambia la contraseña y GitHub tiene el hash nuevo', cambioMaria?.listo === true && mariaDespues?.debeCambiarClave === false && mariaDespues.claveHash !== mariaRemota?.claveHash, cambioMaria?.error ?? '')
    const errores = await evaluar(`(() => document.body.innerText.match(/Ocurrió un error inesperado/g)?.length ?? 0)()`)
    anotar('Sin errores inesperados en pantalla', errores === 0, errores ? `${errores} avisos` : '')
    return
  }

  // 4. Se corta internet: entra sólo daniel, con la credencial guardada
  await simulador.cerrar()
  const sinInternet = await evaluar(`window.dm.auth.estadoDeAcceso(true)`)
  anotar('Sin el simulador, el estado pasa a «sin internet» y recuerda a daniel', sinInternet?.ok && sinInternet.datos.modo === 'sin-internet' && sinInternet.datos.usuarioGuardado === 'daniel', JSON.stringify({ modo: sinInternet?.datos?.modo }))
  const lineaSinInternet = await textoDePantalla()
  anotar('El Login explica quién puede entrar sin internet', /Sin internet.*sólo puede ingresar «daniel»/.test(lineaSinInternet ?? ''))

  const mariaOffline = await ingresar('maria', 'Temporal-123')
  anotar('maria no puede entrar sin internet (nunca ingresó acá con conexión)', !mariaOffline?.sesion && /sólo puede ingresar «daniel»/.test(mariaOffline?.texto ?? ''), (mariaOffline?.texto ?? '').match(/Sin internet[^\n]*/)?.[0] ?? '')
  const danielOffline = await ingresar('daniel', 'Clave-Humo-1')
  const accesoOffline = await evaluar(`window.dm.auth.estadoDeAcceso(false)`)
  anotar('daniel entra sin internet con la credencial cifrada', danielOffline?.sesion?.usuario === 'daniel' && accesoOffline?.datos?.sesionSinConfirmar === true, danielOffline?.error ?? '')
  const barra = await evaluar(`(async () => { ${AYUDA} await esperar(() => /Ingresaste sin internet/.test(texto())); return /Ingresaste sin internet/.test(texto()) })()`)
  anotar('La barra superior dice «Ingresaste sin internet»', barra === true)
  const crearOffline = await evaluar(`window.dm.usuarios.crear({ nombre: 'Nadie', usuario: 'nadie', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: 2 })`)
  anotar('Sin internet no se pueden administrar usuarios', crearOffline?.ok === false && /sin conexión|internet/i.test(crearOffline?.error ?? ''), crearOffline?.error ?? '')

  // 5. Vuelve internet: la sesión se confirma sola y maria hace su primer ingreso
  await simulador.escuchar(PUERTO_SIMULADOR)
  const confirmada = await evaluar(`window.dm.auth.estadoDeAcceso(true)`)
  anotar('Con internet de vuelta la sesión se confirma contra GitHub', confirmada?.ok && confirmada.datos.modo === 'en-linea' && confirmada.datos.sesionSinConfirmar === false, JSON.stringify({ modo: confirmada?.datos?.modo, sinConfirmar: confirmada?.datos?.sesionSinConfirmar }))
  const barraConfirmada = await evaluar(`(async () => { ${AYUDA} return esperar(() => !/Ingresaste sin internet/.test(texto())) })()`)
  anotar('La barra deja de decir «Ingresaste sin internet»', barraConfirmada === true)
  await salir()

  const mariaPrimera = await ingresar('maria', 'Temporal-123')
  anotar('maria ingresa en línea con la temporal y debe cambiarla', mariaPrimera?.sesion?.usuario === 'maria' && mariaPrimera.sesion.debeCambiarClave === true, mariaPrimera?.error ?? '')
  const credencialAntes = await evaluar(`window.dm.auth.estadoDeAcceso(false)`)
  anotar('Con contraseña temporal todavía no queda credencial de maria', credencialAntes?.datos?.usuarioGuardado === 'daniel', credencialAntes?.datos?.usuarioGuardado ?? '')
  const cambioMaria = await cambiarClaveEnPantalla('Temporal-123', 'Maria-Humo-1')
  const remoto3 = remoto().documento
  const mariaDespues = remoto3?.usuarios?.find((u) => u.usuario === 'maria')
  const credencialDespues = await evaluar(`window.dm.auth.estadoDeAcceso(false)`)
  anotar(
    'maria cambia la contraseña: GitHub tiene el hash nuevo y la credencial de esta PC pasa a ser la suya',
    cambioMaria?.listo === true && mariaDespues?.debeCambiarClave === false && mariaDespues.claveHash !== mariaRemota?.claveHash && credencialDespues?.datos?.usuarioGuardado === 'maria',
    cambioMaria?.error ?? '',
  )

  // 6. Otra computadora le cambia el rol y después la desactiva: la sesión lo refleja y al final se cierra sola
  simulador.escribirDirecto(JSON.stringify({ ...remoto3, usuarios: remoto3.usuarios.map((u) => (u.usuario === 'maria' ? { ...u, rol: 'ADMIN' } : u)) }, null, 2) + '\n')
  await evaluar(`window.dm.auth.estadoDeAcceso(true)`)
  const rolNuevo = await evaluar(`(async () => { ${AYUDA} await esperar(() => /Administrador · Sucursal/.test(texto())); return /Administrador · Sucursal/.test(texto()) })()`)
  anotar('Un cambio de rol desde otra PC se ve en la barra sin cerrar sesión', rolNuevo === true)

  const remoto4 = remoto().documento
  simulador.escribirDirecto(JSON.stringify({ ...remoto4, usuarios: remoto4.usuarios.map((u) => (u.usuario === 'maria' ? { ...u, activo: false } : u)) }, null, 2) + '\n')
  await evaluar(`window.dm.auth.estadoDeAcceso(true)`)
  const cerrada = await evaluar(`(async () => { ${AYUDA} await esperar(() => /desactivado/.test(texto()) && !!document.querySelector('input[type="password"]')); const s = await window.dm.auth.sesion(); return { sesion: s.datos, texto: texto().slice(0, 300) } })()`)
  anotar('Desactivada desde otra PC, la sesión se cierra y el Login explica por qué', cerrada?.sesion === null && /desactivado/.test(cerrada?.texto ?? ''), (cerrada?.texto ?? '').match(/Tu usuario[^\n]*/)?.[0] ?? '')
  const accesoFinal = await evaluar(`window.dm.auth.estadoDeAcceso(false)`)
  anotar('La credencial de maria se descartó', accesoFinal?.datos?.usuarioGuardado === null, String(accesoFinal?.datos?.usuarioGuardado))

  // 7. Nada explotó por el camino
  const errores = await evaluar(`(() => document.body.innerText.match(/Ocurrió un error inesperado/g)?.length ?? 0)()`)
  anotar('Sin errores inesperados en pantalla', errores === 0, errores ? `${errores} avisos` : '')
  const tokenFueraDeLugar = simulador.intercambios.some(
    (i) => /prueba/.test(i.busqueda) || Object.entries(i.cabeceras).some(([nombre, valor]) => nombre !== 'authorization' && /prueba/.test(String(valor))),
  )
  anotar('El token sólo viaja en la cabecera Authorization (nunca en la URL ni en otra cabecera)', !tokenFueraDeLugar)
}

try {
  await arrancar()
  await correr()
} catch (error) {
  console.error('El humo se cortó:', error instanceof Error ? error.message : error)
  anotar('El guion llegó al final', false)
} finally {
  await terminar()
}
