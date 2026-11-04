// Marketing → Redes → TikTok y Administración → Redes sociales → TikTok.
//
// Lo que hay que saber antes de tocar esto:
//
//   · Cada sucursal tiene SU app de TikTok for Developers: Client Key y Client Secret. Las carga el
//     superadministrador y viajan una única vez al servidor del VPS, que las guarda cifradas. A
//     diferencia de la app de Meta, no se copian al config.json de ninguna computadora: el que canjea
//     el código del ingreso y renueva el permiso cada 24 horas es el servidor, y es el único que las
//     necesita.
//   · Esta computadora sólo abre el ingreso de TikTok (`redes/tiktok.ts`) y le pasa al servidor el
//     código que vuelve. De ahí en más el servidor es quien publica.
//   · TikTok publica sólo VIDEO desde el programa. No programa nativo: la cola la maneja el servidor,
//     y por eso una publicación pasa por «Programada», «Enviando» y «Procesando» antes de quedar
//     «Publicada» (TikTok procesa el video de su lado y confirma después).
//   · Mientras la app no pase la revisión de TikTok, sólo se puede publicar en privado («Sólo yo»).
//     Lo explica la pantalla; acá no se adivina, se le pregunta a TikTok (`creador`).
//   · Mismo reparto de permisos que Facebook e Instagram: app y vínculo, sólo SUPER_ADMIN; publicar,
//     cualquiera con permiso de editar Marketing, en SU sucursal. El servidor vuelve a validar todo.
import { readFile } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import {
  PRIVACIDADES_DE_TIKTOK,
  type CreadorDeTikTok,
  type CuentaDeTikTok,
  type PanelDeTikTok,
  type PedidoDeTikTok,
  type PrivacidadDeTikTok,
  type PublicacionDeTikTok,
  type SesionUsuario,
} from '../../shared/tipos'
import { SUCURSALES } from '../../shared/sucursales'
import type { ActorDeRedesVps, CuentaDeTikTokVps, FuenteVps, PublicacionDeTikTokVps } from '../vps/fuenteVps'
import { esDemo } from '../canal'
import { TIKTOK_DE_LA_DEMO } from '../demo/tiktok'
import { limpiar } from '../importacion/normalizar'
import { pedirCodigoDeTikTok } from '../redes/tiktok'
import { urlDeVueltaDeTikTokDeFabrica } from './config'
import { ErrorDeNegocio } from './errores'
import { revisarArchivoParaPublicar } from './redes'
import { crearFuenteVps } from './sincronizacion'
import { objeto } from './validacion'

/** Lo que este archivo usa del VPS. La demo lo contesta en memoria (ver demo/tiktok.ts). */
export type FuenteDeTikTok = Pick<
  FuenteVps,
  | 'tiktokCuentas'
  | 'tiktokGuardarApp'
  | 'tiktokBorrarApp'
  | 'tiktokVincular'
  | 'tiktokDesvincular'
  | 'tiktokCreador'
  | 'tiktokPublicar'
  | 'tiktokPublicaciones'
>

export const LARGO_MAXIMO_DEL_TEXTO_DE_TIKTOK = 2_200

let ultimoError: string | null = null

function actorVps(actor: SesionUsuario): ActorDeRedesVps {
  return { nombre: actor.nombre, rol: actor.rol, sucursal: actor.sucursal.nombre }
}

async function fuenteDeTikTok(): Promise<FuenteDeTikTok | null> {
  return esDemo() ? TIKTOK_DE_LA_DEMO : crearFuenteVps()
}

async function exigirVps(): Promise<FuenteDeTikTok> {
  const vps = await fuenteDeTikTok()
  if (!vps) throw new ErrorDeNegocio('La base del VPS no está disponible en esta computadora: TikTok necesita conexión con el servidor.')
  return vps
}

function exigirSuperAdmin(actor: SesionUsuario): void {
  if (actor.rol !== 'SUPER_ADMIN') {
    throw new ErrorDeNegocio('Cargar la app de TikTok o vincular la cuenta de una sucursal es sólo del superadministrador.')
  }
}

function comoErrorDeNegocio(error: unknown): ErrorDeNegocio {
  return error instanceof ErrorDeNegocio ? error : new ErrorDeNegocio(error instanceof Error ? error.message : String(error))
}

function sucursalValida(sucursal: unknown): string {
  const limpia = limpiar(sucursal)
  if (!limpia) throw new ErrorDeNegocio('Elegí para qué sucursal es.')
  if (!(SUCURSALES as readonly string[]).includes(limpia)) throw new ErrorDeNegocio(`«${limpia}» no es una de las sucursales.`)
  return limpia
}

function aCuenta(cuenta: CuentaDeTikTokVps): CuentaDeTikTok {
  return {
    sucursal: cuenta.sucursal,
    appCargada: cuenta.appCargada,
    clientKey: cuenta.clientKey,
    urlDeRedireccion: cuenta.urlDeRedireccion || urlDeVueltaDeTikTokDeFabrica(),
    appCargadaPor: cuenta.appCargadaPor,
    appCargadaEn: cuenta.appCargadaEn,
    estado: cuenta.estado,
    nombre: cuenta.nombre,
    usuario: cuenta.usuario,
    avatarUrl: cuenta.avatarUrl,
    vinculadoPor: cuenta.vinculadoPor,
    vinculadoEn: cuenta.vinculadoEn,
  }
}

/** Una sucursal sin nada cargado todavía: la pantalla la muestra igual, para que se vea qué falta. */
function cuentaVacia(sucursal: string): CuentaDeTikTok {
  return {
    sucursal,
    appCargada: false,
    clientKey: null,
    urlDeRedireccion: urlDeVueltaDeTikTokDeFabrica(),
    appCargadaPor: null,
    appCargadaEn: null,
    estado: 'SIN_VINCULAR',
    nombre: null,
    usuario: null,
    avatarUrl: null,
    vinculadoPor: null,
    vinculadoEn: null,
  }
}

function aPublicacion(publicacion: PublicacionDeTikTokVps): PublicacionDeTikTok {
  return { ...publicacion }
}

// ---------------------------------------------------------------------------
// El estado
// ---------------------------------------------------------------------------

/**
 * Todo lo que necesitan las pantallas. NUNCA lanza por falta de app, de vínculo o de conexión: la
 * pestaña tiene que abrir igual y explicar qué falta.
 */
export async function panelDeTikTok(actor: SesionUsuario): Promise<PanelDeTikTok> {
  const esSuper = actor.rol === 'SUPER_ADMIN'
  // Un SUPER_ADMIN ve las cuatro sucursales (y puede elegir cualquiera); el resto, sólo la propia.
  const sucursales = esSuper ? [...SUCURSALES] : [actor.sucursal.nombre]
  const base = {
    puedeVincular: esSuper,
    sucursalPropia: actor.sucursal.nombre || null,
    urlDeRedireccionDeFabrica: urlDeVueltaDeTikTokDeFabrica(),
  }
  const vps = await fuenteDeTikTok()
  if (!vps) {
    return { ...base, cuentas: sucursales.map(cuentaVacia), ultimoError: 'La base del VPS no está disponible en esta computadora.' }
  }
  try {
    const cuentas = (await vps.tiktokCuentas(actorVps(actor))).map(aCuenta)
    return {
      ...base,
      cuentas: sucursales.map((sucursal) => cuentas.find((cuenta) => cuenta.sucursal === sucursal) ?? cuentaVacia(sucursal)),
      ultimoError,
    }
  } catch (error) {
    return { ...base, cuentas: sucursales.map(cuentaVacia), ultimoError: error instanceof Error ? error.message : String(error) }
  }
}

// ---------------------------------------------------------------------------
// La app de cada sucursal
// ---------------------------------------------------------------------------

export async function guardarAppDeTikTok(datos: unknown, actor: SesionUsuario): Promise<PanelDeTikTok> {
  exigirSuperAdmin(actor)
  const d = objeto(datos, 'Los datos de la app de TikTok')
  const sucursal = sucursalValida(d.sucursal)
  const clientKey = limpiar(d.clientKey)
  if (!clientKey) throw new ErrorDeNegocio('Falta el Client Key de la app de TikTok.')
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(clientKey)) {
    throw new ErrorDeNegocio('El Client Key no tiene la forma esperada. Copialo tal cual de developers.tiktok.com (letras y números, sin espacios).')
  }
  const clientSecret = typeof d.clientSecret === 'string' ? d.clientSecret.trim() : ''
  const vuelta = typeof d.urlDeRedireccion === 'string' ? d.urlDeRedireccion.trim() : ''
  if (vuelta && !/^https:\/\/[^\s?#]+$/i.test(vuelta)) {
    throw new ErrorDeNegocio('La dirección de vuelta de TikTok tiene que empezar con https:// y no llevar «?» ni «#»: es la que se registra en el panel de la app.')
  }
  try {
    await (await exigirVps()).tiktokGuardarApp(actorVps(actor), {
      sucursal,
      clientKey,
      clientSecret,
      // La de fábrica no se guarda: así, si algún día cambia, cambia para todas las que no cargaron otra.
      urlDeRedireccion: vuelta && vuelta !== urlDeVueltaDeTikTokDeFabrica() ? vuelta : null,
    })
  } catch (error) {
    throw comoErrorDeNegocio(error)
  }
  return panelDeTikTok(actor)
}

export async function borrarAppDeTikTok(sucursal: unknown, actor: SesionUsuario): Promise<PanelDeTikTok> {
  exigirSuperAdmin(actor)
  try {
    await (await exigirVps()).tiktokBorrarApp(actorVps(actor), sucursalValida(sucursal))
  } catch (error) {
    throw comoErrorDeNegocio(error)
  }
  return panelDeTikTok(actor)
}

// ---------------------------------------------------------------------------
// La cuenta
// ---------------------------------------------------------------------------

/** Abre el ingreso de TikTok para la sucursal y le pasa al servidor el código que vuelve. */
export async function vincularTikTok(padre: BrowserWindow | null, sucursal: unknown, actor: SesionUsuario): Promise<PanelDeTikTok> {
  exigirSuperAdmin(actor)
  const elegida = sucursalValida(sucursal)
  const vps = await exigirVps()
  const cuenta = (await vps.tiktokCuentas(actorVps(actor))).find((candidata) => candidata.sucursal === elegida)
  if (!cuenta?.appCargada || !cuenta.clientKey) {
    throw new ErrorDeNegocio(`Todavía no está cargada la app de TikTok de ${elegida}. Se carga en Administración → Redes sociales → TikTok.`)
  }
  // La MISMA dirección con la que se abre el ingreso es la que el servidor usa para canjear el código:
  // si fueran distintas, TikTok rechazaría el canje con un error que no explica nada.
  const urlDeRedireccion = cuenta.urlDeRedireccion || urlDeVueltaDeTikTokDeFabrica()
  // Demo: no hay ingreso de TikTok; el simulador acepta cualquier código.
  const codigo = esDemo() ? 'codigo-de-la-demo' : await pedirCodigoDeTikTok(cuenta.clientKey, urlDeRedireccion, padre)
  try {
    await vps.tiktokVincular(actorVps(actor), { sucursal: elegida, codigo, urlDeRedireccion })
    ultimoError = null
  } catch (error) {
    ultimoError = error instanceof Error ? error.message : String(error)
    throw comoErrorDeNegocio(error)
  }
  return panelDeTikTok(actor)
}

export async function desvincularTikTok(sucursal: unknown, actor: SesionUsuario): Promise<PanelDeTikTok> {
  exigirSuperAdmin(actor)
  try {
    await (await exigirVps()).tiktokDesvincular(actorVps(actor), sucursalValida(sucursal))
    ultimoError = null
  } catch (error) {
    throw comoErrorDeNegocio(error)
  }
  return panelDeTikTok(actor)
}

/** Qué deja hacer TikTok hoy a la cuenta de esa sucursal (o la propia). */
export async function creadorDeTikTok(actor: SesionUsuario, sucursal?: string): Promise<CreadorDeTikTok> {
  const elegida = limpiar(sucursal) || actor.sucursal.nombre
  try {
    return await (await exigirVps()).tiktokCreador(actorVps(actor), elegida)
  } catch (error) {
    throw comoErrorDeNegocio(error)
  }
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

function esPrivacidad(valor: unknown): valor is PrivacidadDeTikTok {
  return typeof valor === 'string' && (PRIVACIDADES_DE_TIKTOK as readonly string[]).includes(valor)
}

/** Las mismas reglas que aplica el servidor, para no hacer el viaje (con el video) si ya se sabe que va a fallar. */
export function validarPedidoDeTikTok(pedido: unknown, ahora = Date.now()): PedidoDeTikTok & { privacidad: PrivacidadDeTikTok } {
  const p = objeto(pedido, 'El pedido de publicación')
  const texto = typeof p.texto === 'string' ? p.texto.trim() : ''
  if (texto.length > LARGO_MAXIMO_DEL_TEXTO_DE_TIKTOK) throw new ErrorDeNegocio('El texto es muy largo: el máximo son 2.200 caracteres.')
  const ruta = typeof p.ruta === 'string' ? p.ruta.trim() : ''
  if (!ruta) throw new ErrorDeNegocio('TikTok publica siempre un video: elegí uno (.mp4 o .mov).')
  if (!esPrivacidad(p.privacidad)) throw new ErrorDeNegocio('Elegí quién puede ver el video en TikTok.')
  const contenidoDeMarca = p.contenidoDeMarca === true
  if (contenidoDeMarca && p.privacidad === 'SELF_ONLY') {
    throw new ErrorDeNegocio('TikTok no deja publicar en privado («Sólo yo») un contenido de marca: elegí otra privacidad o sacá esa marca.')
  }
  const programarPara = typeof p.programarPara === 'string' ? p.programarPara.trim() : ''
  if (programarPara && Number.isNaN(Date.parse(programarPara))) throw new ErrorDeNegocio('La fecha de programación no es válida.')
  if (programarPara && Date.parse(programarPara) <= ahora) throw new ErrorDeNegocio('La fecha de programación tiene que ser futura.')
  return {
    sucursal: limpiar(p.sucursal),
    texto,
    ruta,
    privacidad: p.privacidad,
    permitirComentarios: p.permitirComentarios === true,
    permitirDuo: p.permitirDuo === true,
    permitirStitch: p.permitirStitch === true,
    contenidoPropio: p.contenidoPropio === true,
    contenidoDeMarca,
    programarPara,
  }
}

export async function publicarEnTikTok(pedido: unknown, actor: SesionUsuario): Promise<PublicacionDeTikTok> {
  const datos = validarPedidoDeTikTok(pedido)
  const archivo = await revisarArchivoParaPublicar(datos.ruta)
  if (archivo.tipoDeArchivo !== 'VIDEO') throw new ErrorDeNegocio('TikTok publica sólo video desde el programa: elegí un .mp4 o un .mov.')
  const vps = await exigirVps()
  try {
    const publicacion = await vps.tiktokPublicar(actorVps(actor), {
      sucursal: datos.sucursal || undefined,
      texto: datos.texto,
      archivo: { nombre: archivo.nombre, tipo: archivo.tipo, contenidoBase64: (await readFile(archivo.ruta)).toString('base64') },
      privacidad: datos.privacidad,
      permitirComentarios: datos.permitirComentarios,
      permitirDuo: datos.permitirDuo,
      permitirStitch: datos.permitirStitch,
      contenidoPropio: datos.contenidoPropio,
      contenidoDeMarca: datos.contenidoDeMarca,
      programarPara: datos.programarPara || null,
    })
    ultimoError = null
    return aPublicacion(publicacion)
  } catch (error) {
    ultimoError = error instanceof Error ? error.message : String(error)
    throw comoErrorDeNegocio(error)
  }
}

export async function publicacionesDeTikTok(actor: SesionUsuario, sucursal?: string): Promise<PublicacionDeTikTok[]> {
  try {
    return (await (await exigirVps()).tiktokPublicaciones(actorVps(actor), limpiar(sucursal) || undefined)).map(aPublicacion)
  } catch {
    return []
  }
}
