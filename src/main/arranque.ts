// La red de seguridad del arranque: la bitácora en disco y lo que impide que el programa quede
// vivo sin ventana.
//
// El problema que resuelve, tal como pasó en la agencia: el programa se actualizó, alguien le dio
// doble click y no abrió nada — pero en el Administrador de tareas SÍ estaba el proceso. Sin ventana
// y sin cartel no hay nada que mirar, y encima ese proceso fantasma se queda con el cerrojo de
// «una sola instancia», así que los siguientes dobles clicks tampoco abren nada.
//
// De dónde sale ese estado: en Electron, una promesa rechazada del proceso principal NO abre ningún
// cartel ni corta el programa. Si algo falla adentro de `app.whenReady().then(...)` —una migración,
// un servicio, la ventana misma— el proceso se queda vivo, escuchando, sin haber dibujado nada.
//
// Las tres reglas de este archivo:
//
// 1. NADA FALLA EN SILENCIO. Mientras el programa está arrancando, cualquier error suelto termina en
//    un cartel que dice qué pasó y en una salida limpia. Un programa que no abre y lo dice es
//    infinitamente mejor que uno que no abre y calla.
// 2. UNA VEZ ABIERTO, UN ERROR SUELTO NO CIERRA NADA. Que una respuesta de red llegue tarde no puede
//    voltear la pantalla de quien está atendiendo: pasado el arranque, esos errores se anotan y ya.
// 3. TODO QUEDA ESCRITO. Cada arranque deja su rastro en un archivo de texto dentro de la carpeta de
//    datos, así el día que una computadora haga algo raro hay algo para leer.
import { app, dialog } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/** Al pasarse de este tamaño, la bitácora se archiva como `.1` y se empieza una nueva. */
const TAMANO_MAXIMO = 2 * 1024 * 1024

let ruta: string | null = null
/** Mientras es false, un error suelto es fatal: todavía no hay ventana con la que trabajar. */
let arranqueTerminado = false
/** Un solo cartel: si el primer error arrastra a otros, no se llena la pantalla de carteles. */
let yaAviso = false

function marca(): string {
  const ahora = new Date()
  const dosDigitos = (n: number) => String(n).padStart(2, '0')
  return (
    `${ahora.getFullYear()}-${dosDigitos(ahora.getMonth() + 1)}-${dosDigitos(ahora.getDate())} ` +
    `${dosDigitos(ahora.getHours())}:${dosDigitos(ahora.getMinutes())}:${dosDigitos(ahora.getSeconds())}`
  )
}

/**
 * Deja la bitácora lista y hace que TODO lo que ya se escribe con `console.log` / `warn` / `error`
 * —las migraciones, la sincronización, los avisos del actualizador— vaya también al archivo.
 *
 * Se engancha a `console` a propósito, en vez de cambiar los cientos de llamadas que ya existen: lo
 * que hace falta el día del problema es justamente ese relato, completo y en orden.
 */
export function iniciarBitacora(carpetaDeDatos: string): void {
  try {
    const carpeta = path.join(carpetaDeDatos, 'registro')
    mkdirSync(carpeta, { recursive: true })
    ruta = path.join(carpeta, 'arranque.log')
    rotarSiEstaGrande()
  } catch {
    // Sin poder escribir (carpeta de sólo lectura, disco lleno) se sigue igual: la bitácora es una
    // ayuda para diagnosticar, no un requisito para trabajar.
    ruta = null
  }

  engancharConsola()
  anotar(`===== DM Gestión ${app.getVersion()} — arranque ${marca()} (pid ${process.pid}) =====`)
  anotar(`[arranque] Carpeta de datos: ${carpetaDeDatos}`)
}

function rotarSiEstaGrande(): void {
  if (!ruta) return
  try {
    if (statSync(ruta).size < TAMANO_MAXIMO) return
    const anterior = `${ruta}.1`
    try {
      unlinkSync(anterior)
    } catch {
      // no había archivo anterior
    }
    renameSync(ruta, anterior)
  } catch {
    // no existe todavía, o no se pudo rotar: se sigue escribiendo donde se pueda
  }
}

function engancharConsola(): void {
  const niveles = [
    ['log', console.log],
    ['warn', console.warn],
    ['error', console.error],
  ] as const
  for (const [nivel, original] of niveles) {
    console[nivel] = (...args: unknown[]) => {
      original(...args)
      escribir(nivel === 'log' ? '' : `${nivel.toUpperCase()} `, args.map(comoTexto).join(' '))
    }
  }
}

function comoTexto(valor: unknown): string {
  if (typeof valor === 'string') return valor
  if (valor instanceof Error) return valor.stack ?? `${valor.name}: ${valor.message}`
  try {
    return JSON.stringify(valor)
  } catch {
    return String(valor)
  }
}

function escribir(prefijo: string, texto: string): void {
  if (!ruta) return
  try {
    appendFileSync(ruta, `${marca()} ${prefijo}${texto}\n`)
  } catch {
    // El disco lleno no puede tumbar el programa por una línea de bitácora.
  }
}

/** Una línea a la bitácora y a la consola. */
export function anotar(mensaje: string): void {
  console.log(mensaje)
}

/** La ventana ya está a la vista: a partir de acá un error suelto se anota y no cierra nada. */
export function marcarArranqueTerminado(): void {
  if (arranqueTerminado) return
  arranqueTerminado = true
  anotar('[arranque] Ventana a la vista: el programa abrió bien.')
}

export function detalleDelError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`
  return String(error)
}

/**
 * El programa no pudo abrir. Se anota, se dice qué pasó y se sale de verdad.
 *
 * `app.exit` y no `app.quit`: `quit` es una pedida amable que cualquier `beforeunload`, temporizador
 * o handle abierto puede frenar, y frenarla es exactamente cómo nace un proceso fantasma. Acá ya no
 * hay nada que guardar —el programa nunca terminó de abrir—, así que se corta.
 */
export function fallaDeArranque(paso: string, error: unknown): void {
  const detalle = detalleDelError(error)
  console.error(`[arranque] Falló ${paso}: ${detalle}`)
  if (!yaAviso) {
    yaAviso = true
    try {
      dialog.showErrorBox(
        'DM Gestión no pudo abrir',
        `Falló ${paso}.\n\n${error instanceof Error ? error.message : String(error)}\n\n` +
          `El detalle quedó anotado en:\n${ruta ?? '(no se pudo escribir la bitácora)'}`,
      )
    } catch {
      // Sin entorno gráfico no hay cartel; el motivo ya quedó escrito.
    }
  }
  app.exit(1)
}

/**
 * Los errores que nadie atrapó. Antes de que haya ventana son fatales (regla 1); después, sólo se
 * anotan (regla 2).
 */
export function vigilarErroresSueltos(): void {
  process.on('uncaughtException', (error) => {
    if (arranqueTerminado) {
      console.error('[error] Excepción no atrapada:', detalleDelError(error))
      return
    }
    fallaDeArranque('el arranque por un error no atrapado', error)
  })

  process.on('unhandledRejection', (razon) => {
    if (arranqueTerminado) {
      console.error('[error] Promesa rechazada sin atrapar:', detalleDelError(razon))
      return
    }
    fallaDeArranque('el arranque por una promesa rechazada', razon)
  })
}

/** Corre un paso del arranque; si tira, el programa avisa y sale en vez de quedar de fantasma. */
export function paso(nombre: string, hacer: () => void): boolean {
  try {
    hacer()
    return true
  } catch (error) {
    fallaDeArranque(nombre, error)
    return false
  }
}
