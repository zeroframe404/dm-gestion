// Lo que se carga UNA vez y lo tienen todas las computadoras.
//
// El problema de siempre: la configuración de los servicios externos vivía en el config.json de cada
// PC y el encabezado del ticket, en la base local de cada una. Cargar el catálogo de vehículos
// significaba ir máquina por máquina, y con que una quedara sin cargar esa persona atendía el
// mostrador sin los desplegables y sin la categoría del vehículo, que es de lo que dependen la prima
// y la cobertura. Lo mismo con Google (la sucursal sin cuenta no subía los adjuntos de los siniestros
// y nadie se enteraba hasta que hacían falta), con la app de Meta y con el teléfono del ticket.
//
// Desde acá: se carga una vez, viaja al VPS —que lo guarda cifrado— y el resto de las computadoras lo
// adopta solo al arrancar.
//
// Qué se comparte y quién lo carga:
//
//   clave          qué es                                                   quién lo carga
//   ─────────────  ──────────────────────────────────────────────────────   ──────────────────────────
//   vehiculos      credenciales del catálogo (InfoAuto, Mercado Libre, DNRPA)  superadministrador
//   google         cuenta de servicio y URL de la hoja (Drive)                 superadministrador
//   meta           app de Facebook e Instagram y su dirección de vuelta        superadministrador
//   companias      días de cobertura, comisión, renovación y plantilla         administrador o superadmin
//   ticket         dirección y teléfono del encabezado de cada sucursal        cualquiera, la de SU sucursal
//   referencias    las listas del módulo Compañías (ver referenciasCompartidas.ts)
//
// El recorte por rol NO se hace acá: se hace en ipc.ts, que es donde se sabe quién llamó. Este archivo
// sólo sabe llevar y traer.
//
// Dos reglas que ordenan todo el archivo:
//
// 1. NADA DE ESTO PUEDE FRENAR EL PROGRAMA. Si el VPS no contesta, si el token está mal o si la
//    respuesta viene rara, se devuelve el motivo y se sigue con lo que haya guardado localmente. Un
//    programa que no abre porque un servidor no contestó es peor que uno sin catálogo.
// 2. LA ÚLTIMA CARGA GANA. No hay resolución de conflictos ni versiones: se carga y eso es lo que
//    vale. Es configuración de la agencia, no un dato que dos personas escriben a la vez.
import { createHash } from 'node:crypto'
import { claveDeSucursal, sucursalCanonica } from '../../shared/sucursales'
import type { EstadoDeAjusteCompartido } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import { adoptarCompanias, valorCompartidoDeCompanias } from './companias'
import {
  adoptarCredencialesDeVehiculos,
  adoptarGoogle,
  adoptarMeta,
  valorCompartidoDeGoogle,
  valorCompartidoDeMeta,
  valorCompartidoDeVehiculos,
} from './config'
import { ErrorDeNegocio } from './errores'
import { adoptarReferenciasDelVps } from './referenciasCompartidas'
import { crearFuenteVps } from './sincronizacion'
import { adoptarEncabezadoDelTicket, valorCompartidoDelTicket } from './ticket'

/**
 * Un ajuste que viaja: cómo se llama en el servidor, cómo se lee de esta computadora y cómo se
 * escribe lo que baja.
 *
 * `valorLocal` devuelve null cuando no hay nada que compartir (todavía no se cargó). El ORDEN DE LAS
 * CLAVES del objeto que devuelve importa y por eso está escrito a mano en cada uno: la huella con la
 * que el servidor y cada computadora se comparan es el hash del JSON, así que dos objetos con los
 * mismos datos en distinto orden darían huellas distintas y la pantalla diría «desactualizada» para
 * siempre.
 */
interface AjusteCompartido {
  clave: string
  /** Cómo se lo nombra en los mensajes: «las credenciales del catálogo». */
  nombre: string
  valorLocal: () => object | null
  /** Escribe en esta computadora lo que vino del servidor. false = no tenía la forma esperada. */
  adoptar: (valor: unknown) => boolean
}

const VEHICULOS: AjusteCompartido = {
  clave: 'vehiculos',
  nombre: 'las credenciales del catálogo',
  valorLocal: valorCompartidoDeVehiculos,
  adoptar: adoptarCredencialesDeVehiculos,
}

const GOOGLE: AjusteCompartido = {
  clave: 'google',
  nombre: 'la conexión con Google',
  valorLocal: valorCompartidoDeGoogle,
  adoptar: adoptarGoogle,
}

const META: AjusteCompartido = {
  clave: 'meta',
  nombre: 'la app de Facebook e Instagram',
  valorLocal: valorCompartidoDeMeta,
  adoptar: adoptarMeta,
}

const COMPANIAS: AjusteCompartido = {
  clave: 'companias',
  nombre: 'el catálogo de compañías',
  valorLocal: valorCompartidoDeCompanias,
  adoptar: adoptarCompanias,
}

const TICKET: AjusteCompartido = {
  clave: 'ticket',
  nombre: 'el encabezado del ticket',
  valorLocal: valorCompartidoDelTicket,
  adoptar: adoptarEncabezadoDelTicket,
}

/** Los que se adoptan solos al arrancar, en el orden en que se piden. */
const TODOS = [VEHICULOS, GOOGLE, META, COMPANIAS, TICKET]

/** Lo que se devuelve cuando ni siquiera hay puente: en desarrollo, o sin VPS configurado. */
const SIN_SERVIDOR: EstadoDeAjusteCompartido = {
  enElServidor: false,
  actualizadoEn: null,
  actualizadoPor: null,
  alDia: false,
  error: null,
}

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** La huella de lo que hay acá, con la misma cuenta que hace el servidor. */
function huellaLocal(ajuste: AjusteCompartido): string | null {
  const valor = ajuste.valorLocal()
  if (!valor) return null
  return createHash('sha256').update(JSON.stringify(valor)).digest('hex')
}

// ---------------------------------------------------------------------------
// Lo que esta computadora ya sabe que viajó
//
// El caso que esto evita: alguien corrige el teléfono del ticket de su sucursal con el servidor caído.
// Queda bien guardado acá, pero no llegó a viajar. Sin esta marca, el arranque de mañana adoptaría lo
// del servidor —que es lo VIEJO— y le borraría la corrección sin que nadie se entere.
//
// Con la marca: si lo que hay acá no es lo último que se sincronizó, hay un cambio local sin publicar y
// la adopción del arranque no lo pisa. Sin marca (una computadora recién instalada, o un ajuste que
// nunca viajó) se adopta, que es justo lo que se quiere ahí.
// ---------------------------------------------------------------------------

function claveDeSincronizada(ajuste: AjusteCompartido): string {
  return `ajuste_sincronizado_${ajuste.clave}`
}

function huellaSincronizada(ajuste: AjusteCompartido): string | null {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(claveDeSincronizada(ajuste)) as
    | { valor: string }
    | undefined
  return fila?.valor ?? null
}

function recordarSincronizada(ajuste: AjusteCompartido, huella: string | null): void {
  if (!huella) return
  db()
    .prepare(
      `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    )
    .run(claveDeSincronizada(ajuste), huella, ahoraIso())
}

/** ¿Hay acá algo cargado que todavía no viajó a las demás computadoras? */
function hayCambiosSinPublicar(ajuste: AjusteCompartido): boolean {
  const recordada = huellaSincronizada(ajuste)
  if (!recordada) return false
  const actual = huellaLocal(ajuste)
  return actual !== null && actual !== recordada
}

// ---------------------------------------------------------------------------
// Las tres operaciones, iguales para todos
// ---------------------------------------------------------------------------

/**
 * Cómo está el ajuste en el servidor y si esta computadora tiene lo mismo.
 *
 * Pide sólo la ficha (huella y fecha), no el valor: para dibujar la pantalla no hace falta bajarse una
 * credencial, y no bajarla es una cosa menos que puede quedar dando vueltas en memoria.
 */
async function estadoDe(ajuste: AjusteCompartido): Promise<EstadoDeAjusteCompartido> {
  const vps = crearFuenteVps()
  if (!vps) return { ...SIN_SERVIDOR }
  try {
    const ficha = await vps.estadoAjuste(ajuste.clave)
    if (!ficha) return { ...SIN_SERVIDOR }
    return {
      enElServidor: true,
      actualizadoEn: ficha.actualizadoEn,
      actualizadoPor: ficha.actualizadoPor,
      alDia: ficha.huella === huellaLocal(ajuste),
      error: null,
    }
  } catch (error) {
    return { ...SIN_SERVIDOR, error: motivo(error) }
  }
}

/**
 * Manda al VPS lo que hay en esta computadora.
 *
 * Acá sí se propaga el error: esto lo dispara alguien que tocó «Guardar» y tiene que enterarse de que
 * el resto de las máquinas NO se enteró. Lo local ya quedó escrito antes de llamar a esto, así que un
 * fallo no pierde nada: se vuelve a intentar con el botón.
 */
async function publicar(ajuste: AjusteCompartido, quien: string | null): Promise<EstadoDeAjusteCompartido> {
  const valor = ajuste.valorLocal()
  if (!valor) {
    throw new ErrorDeNegocio(`No hay ${ajuste.nombre} cargado en esta computadora para mandar al servidor.`)
  }
  const vps = crearFuenteVps()
  if (!vps) {
    throw new ErrorDeNegocio(
      `La base del VPS no está disponible en esta computadora, así que ${ajuste.nombre} quedó sólo acá.`,
    )
  }
  const ficha = await vps.guardarAjuste(ajuste.clave, valor, quien)
  const huella = huellaLocal(ajuste)
  // Desde acá lo de esta computadora y lo del servidor son lo mismo: se anota, y el arranque de mañana
  // ya sabe que puede adoptar sin pisarle nada a nadie.
  if (ficha.huella === huella) recordarSincronizada(ajuste, huella)
  return {
    enElServidor: true,
    actualizadoEn: ficha.actualizadoEn,
    actualizadoPor: ficha.actualizadoPor,
    alDia: ficha.huella === huella,
    error: null,
  }
}

export type ResultadoDeAdopcion = {
  adoptadas: boolean
  detalle: string
}

/**
 * Trae del servidor lo publicado y lo escribe en esta computadora.
 *
 * Si ya coinciden no toca nada: reescribir el config.json pisaría el `refreshToken` de InfoAuto, que
 * es de esta máquina, y obligaría a volver a entrar con la clave en cada arranque.
 */
async function adoptarDelVps(ajuste: AjusteCompartido, opciones: { pisarLoLocal?: boolean } = {}): Promise<ResultadoDeAdopcion> {
  const vps = crearFuenteVps()
  if (!vps) return { adoptadas: false, detalle: 'No hay conexión con la base del VPS en esta computadora.' }

  const guardado = await vps.leerAjuste(ajuste.clave)
  if (!guardado) {
    return { adoptadas: false, detalle: `El servidor todavía no tiene ${ajuste.nombre}. Se carga una sola vez.` }
  }
  if (guardado.huella === huellaLocal(ajuste)) {
    // Coinciden aunque esta computadora nunca hubiera publicado: quedan igualadas igual.
    recordarSincronizada(ajuste, guardado.huella)
    return { adoptadas: false, detalle: `Esta computadora ya tenía lo mismo que el servidor en ${ajuste.nombre}.` }
  }
  // La adopción del arranque NO pisa lo que se cargó acá y no llegó a viajar (se guardó con el servidor
  // caído): sería borrar el teléfono que alguien corrigió anoche y devolverle el viejo.
  if (!opciones.pisarLoLocal && hayCambiosSinPublicar(ajuste)) {
    return {
      adoptadas: false,
      detalle: `Esta computadora tiene ${ajuste.nombre} sin publicar: no se pisó con lo del servidor.`,
    }
  }
  if (!ajuste.adoptar(guardado.valor)) {
    return { adoptadas: false, detalle: `Lo que hay guardado en el servidor no tiene la forma de ${ajuste.nombre}.` }
  }
  recordarSincronizada(ajuste, guardado.huella)
  return { adoptadas: true, detalle: `Se adoptó ${ajuste.nombre} que publicó otra computadora.` }
}

async function borrarDelVps(ajuste: AjusteCompartido): Promise<void> {
  const vps = crearFuenteVps()
  if (!vps) return
  await vps.borrarAjuste(ajuste.clave)
}

// ---------------------------------------------------------------------------
// Uno por uno, para que ipc.ts nombre lo que hace
// ---------------------------------------------------------------------------

export const estadoCompartidoDeVehiculos = (): Promise<EstadoDeAjusteCompartido> => estadoDe(VEHICULOS)
export const publicarVehiculosEnElVps = (quien: string | null): Promise<EstadoDeAjusteCompartido> => publicar(VEHICULOS, quien)
export const borrarVehiculosDelVps = (): Promise<void> => borrarDelVps(VEHICULOS)
/** El botón «Traer las del servidor»: lo apretó alguien, así que sí pisa lo local sin publicar. */
export const adoptarVehiculosDelVps = (): Promise<ResultadoDeAdopcion> => adoptarDelVps(VEHICULOS, { pisarLoLocal: true })

export const estadoCompartidoDeGoogle = (): Promise<EstadoDeAjusteCompartido> => estadoDe(GOOGLE)
export const publicarGoogleEnElVps = (quien: string | null): Promise<EstadoDeAjusteCompartido> => publicar(GOOGLE, quien)
export const adoptarGoogleDelVps = (): Promise<ResultadoDeAdopcion> => adoptarDelVps(GOOGLE)

export const estadoCompartidoDeMeta = (): Promise<EstadoDeAjusteCompartido> => estadoDe(META)
export const publicarMetaEnElVps = (quien: string | null): Promise<EstadoDeAjusteCompartido> => publicar(META, quien)
export const borrarMetaDelVps = (): Promise<void> => borrarDelVps(META)
export const adoptarMetaDelVps = (): Promise<ResultadoDeAdopcion> => adoptarDelVps(META)

export const estadoCompartidoDeCompanias = (): Promise<EstadoDeAjusteCompartido> => estadoDe(COMPANIAS)
export const publicarCompaniasEnElVps = (quien: string | null): Promise<EstadoDeAjusteCompartido> => publicar(COMPANIAS, quien)
export const adoptarCompaniasDelVps = (): Promise<ResultadoDeAdopcion> => adoptarDelVps(COMPANIAS)

export const estadoCompartidoDelTicket = (): Promise<EstadoDeAjusteCompartido> => estadoDe(TICKET)
export const adoptarTicketDelVps = (): Promise<ResultadoDeAdopcion> => adoptarDelVps(TICKET)

/**
 * Publicar el encabezado del ticket es distinto de los demás, y por eso tiene su propia función.
 *
 * El resto de los ajustes los carga UNA persona: lo que tiene en pantalla es lo que manda, y pisar lo
 * del servidor es exactamente lo que se busca. El encabezado no: lo escribe cada mostrador, y cada uno
 * ve sólo el renglón de SU sucursal. Si Lanús publicara la lista entera tal como la tiene guardada,
 * mandaría también su copia de la dirección de Dock Sud —que puede ser vieja— y borraría la corrección
 * que Dock Sud hizo esta mañana, sin que nadie se entere.
 *
 * Entonces: se lee lo que hay en el servidor, se le reemplaza SÓLO el renglón de la sucursal que esta
 * persona puede tocar, y se manda esa mezcla. `sucursalPropia` en null es el superadministrador, que ve
 * y edita las cuatro: ahí no hay nada que mezclar, lo que tiene en pantalla es lo que vale.
 */
export async function publicarEncabezadoDelTicket(quien: string | null, sucursalPropia: string | null): Promise<EstadoDeAjusteCompartido> {
  if (sucursalPropia === null) return publicar(TICKET, quien)

  const local = valorCompartidoDelTicket()
  if (!local) throw new ErrorDeNegocio('No hay ningún encabezado cargado en esta computadora para mandar al servidor.')
  const vps = crearFuenteVps()
  if (!vps) throw new ErrorDeNegocio('La base del VPS no está disponible en esta computadora, así que el encabezado quedó sólo acá.')

  const mia = identidadDeSucursal(sucursalPropia)
  const guardado = await vps.leerAjuste(TICKET.clave)
  const enElServidor = filasDeEncabezado(guardado?.valor)
  const propia = local.direcciones.find((fila) => identidadDeSucursal(fila.sucursal) === mia)
  const mezcla = [...enElServidor.filter((fila) => identidadDeSucursal(fila.sucursal) !== mia), ...(propia ? [propia] : [])].sort(
    (a, b) => identidadDeSucursal(a.sucursal).localeCompare(identidadDeSucursal(b.sucursal)),
  )

  // Se adopta la mezcla acá mismo: así esta computadora queda con el encabezado bueno de las otras
  // sucursales (que quizá tenía viejo) y con lo que acaba de escribir, que es lo que se va a publicar.
  adoptarEncabezadoDelTicket({ direcciones: mezcla })
  const ficha = await vps.guardarAjuste(TICKET.clave, { direcciones: mezcla }, quien)
  const huella = huellaLocal(TICKET)
  if (ficha.huella === huella) recordarSincronizada(TICKET, huella)
  return {
    enElServidor: true,
    actualizadoEn: ficha.actualizadoEn,
    actualizadoPor: ficha.actualizadoPor,
    alDia: ficha.huella === huella,
    error: null,
  }
}

/** Las filas de un encabezado que bajó del servidor, saneadas. Cualquier cosa rara se ignora. */
function filasDeEncabezado(valor: unknown): Array<{ sucursal: string; direccion: string; telefono: string }> {
  if (!valor || typeof valor !== 'object') return []
  const crudas = (valor as { direcciones?: unknown }).direcciones
  if (!Array.isArray(crudas)) return []
  const filas: Array<{ sucursal: string; direccion: string; telefono: string }> = []
  for (const cruda of crudas) {
    if (!cruda || typeof cruda !== 'object') continue
    const fila = cruda as Record<string, unknown>
    const sucursal = typeof fila.sucursal === 'string' ? fila.sucursal.trim() : ''
    if (!sucursal) continue
    filas.push({
      sucursal,
      direccion: typeof fila.direccion === 'string' ? fila.direccion : '',
      telefono: typeof fila.telefono === 'string' ? fila.telefono : '',
    })
  }
  return filas
}

/** «AVELLANEDA» guardada a mano y «Dock Sud» del catálogo son el mismo mostrador. */
function identidadDeSucursal(nombre: string): string {
  return claveDeSucursal(sucursalCanonica(nombre) ?? nombre)
}

/**
 * Publica sin hacer ruido: si el servidor no está, se sigue igual.
 *
 * Es para los guardados que YA quedaron escritos localmente y no pueden fallar por el servidor —el
 * encabezado del ticket, el catálogo de compañías—: quien apretó «Guardar» guardó, y que el resto de
 * las computadoras se entere en el próximo arranque no es motivo para devolverle un error rojo. El
 * motivo vuelve igual, para la pantalla que quiera mostrarlo.
 */
export async function publicarSinRomper(
  cual: 'companias' | 'google' | 'meta' | 'vehiculos',
  quien: string | null,
): Promise<EstadoDeAjusteCompartido> {
  const ajuste = { companias: COMPANIAS, google: GOOGLE, meta: META, vehiculos: VEHICULOS }[cual]
  try {
    return await publicar(ajuste, quien)
  } catch (error) {
    return { ...(await estadoDe(ajuste)), error: motivo(error) }
  }
}

/** Lo mismo para el encabezado del ticket, que tiene su propia mezcla (ver arriba). */
export async function publicarTicketSinRomper(quien: string | null, sucursalPropia: string | null): Promise<EstadoDeAjusteCompartido> {
  try {
    return await publicarEncabezadoDelTicket(quien, sucursalPropia)
  } catch (error) {
    return { ...(await estadoDe(TICKET)), error: motivo(error) }
  }
}

/**
 * La adopción del arranque. No espera a nadie y no rompe nada: si el VPS no contesta, el programa abre
 * igual con lo que ya tenía.
 *
 * Cada ajuste va por su cuenta a propósito: que el servidor no tenga las listas de las compañías no
 * puede dejar a esta computadora sin las credenciales del catálogo, ni al revés.
 */
export function adoptarAjustesAlArrancar(): void {
  for (const ajuste of TODOS) {
    void adoptarDelVps(ajuste)
      .then((resultado) => {
        if (resultado.adoptadas) console.log(`[ajustes] ${resultado.detalle}`)
      })
      .catch((error) => {
        console.error(`[ajustes] No se pudo traer ${ajuste.nombre} del VPS:`, motivo(error))
      })
  }
  void adoptarReferenciasDelVps()
    .then((resultado) => {
      if (resultado.adoptadas) console.log(`[ajustes] ${resultado.detalle}`)
    })
    .catch((error) => {
      console.error('[ajustes] No se pudieron traer las listas de las compañías del VPS:', motivo(error))
    })
}
