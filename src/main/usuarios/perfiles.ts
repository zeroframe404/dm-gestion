// La foto y el color de cada persona de la agencia (14.0): el espejo local y el cliente del servidor.
//
// El perfil es de la PERSONA y no de la computadora. La identidad es `claveDeUsuario(usuario)`, la
// misma con la que viajan los mensajes y la presencia, así que la cara de Ana se ve igual en las cinco
// máquinas aunque su usuario local tenga otro id en cada una.
//
// Por qué hay un espejo en SQLite y no alcanza con lo que llega por el canal. Sin internet el programa
// sigue abriendo y se sigue mirando todo («ver sí, tocar no»): si las fotos vivieran sólo en memoria,
// esa pantalla mostraría iniciales grises hasta que volviera la conexión, y la lista de conversaciones
// —que es de lo primero que se abre— quedaría irreconocible. Con el espejo, lo último que se supo de
// cada persona está ahí desde el arranque.
//
// Quién manda sobre el color. El servidor: `dmg_perfiles.color` es único allá y un color tomado vuelve
// como 409. Acá NO hay UNIQUE a propósito (ver la migración 29): esto refleja lo que el servidor dice,
// y un espejo que rechaza lo que le mandan deja de reflejar.
//
// La foto viaja como `data:image/jpeg;base64,…` (así la quiere la pantalla y así la manda el canal) y
// se guarda como BLOB: son los mismos bytes ocupando un tercio menos. La traducción de ida y vuelta
// está toda acá, en un solo lugar.
import { esIndiceDePaleta } from '../../shared/paleta'
import { claveDeUsuario } from '../../shared/texto'
import type { DatosDePerfil, PerfilDeUsuario, SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { ErrorDeNegocio } from '../servicios/errores'
import { credencialesDelPuente } from '../servicios/sincronizacion'
import type { Perfil } from '../vivo/protocolo'

/**
 * El tope de la foto, contado sobre el texto de la data URL. Es el mismo del servidor: una foto de 256
 * píxeles guardada como JPEG de calidad 0,82 pesa entre 15 y 25 KB, así que 64 KB deja lugar de sobra y
 * a la vez impide que alguien mande un archivo de cámara de 6 MB por un avatar de 32 píxeles.
 */
export const TOPE_DE_LA_FOTO = 64 * 1024

/** Un pedido de perfil es chico y no se espera: si el servidor tarda más que esto, algo está mal. */
const TIEMPO_MAXIMO_MS = 15_000

const PREFIJO_JPEG = 'data:image/jpeg;base64,'

// ---------------------------------------------------------------------------
// El espejo
// ---------------------------------------------------------------------------

interface FilaDePerfil {
  clave: string
  color: number
  foto: Uint8Array | null
  version: number
}

/** Los bytes del JPEG que hay adentro de la data URL, o null si no hay foto. */
function bytesDeLaFoto(foto: string | null | undefined): Buffer | null {
  if (!foto) return null
  const base64 = foto.startsWith(PREFIJO_JPEG) ? foto.slice(PREFIJO_JPEG.length) : null
  if (base64 === null) return null
  const bytes = Buffer.from(base64, 'base64')
  return bytes.length ? bytes : null
}

/** El camino de vuelta: lo que la pantalla puede poner en un `<img src>`. */
function fotoComoDataUrl(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null
  return PREFIJO_JPEG + Buffer.from(bytes).toString('base64')
}

function guardarUno(perfil: Perfil): void {
  db()
    .prepare(
      // La versión es la que decide: dos computadoras pueden mandar el mismo perfil con un frame de
      // diferencia y el que llega segundo puede ser el más viejo. El servidor numera cada cambio
      // justamente para poder resolver esto sin mirar relojes.
      `INSERT INTO perfiles (clave, color, foto, version, actualizado_en)
       VALUES (@clave, @color, @foto, @version, @actualizado_en)
       ON CONFLICT(clave) DO UPDATE SET
         color = excluded.color,
         foto = excluded.foto,
         version = excluded.version,
         actualizado_en = excluded.actualizado_en
       WHERE excluded.version >= perfiles.version`,
    )
    .run({
      clave: claveDeUsuario(perfil.clave),
      color: Number(perfil.color) || 0,
      foto: bytesDeLaFoto(perfil.foto),
      version: Number(perfil.version) || 1,
      actualizado_en: perfil.actualizadoEn || new Date().toISOString(),
    })
}

/**
 * La lista entera que vino en el saludo del canal. Se guarda como lo que es —la lista COMPLETA de la
 * agencia— así que lo que acá sobra se borra: una persona que ya no está en el servidor tampoco tiene
 * que seguir apareciendo con su color reservado en esta computadora.
 */
export function guardarPerfiles(lista: Perfil[]): void {
  const base = db()
  base.transaction(() => {
    for (const perfil of lista) guardarUno(perfil)
    const claves = lista.map((perfil) => claveDeUsuario(perfil.clave))
    if (!claves.length) {
      base.prepare('DELETE FROM perfiles').run()
      return
    }
    base
      .prepare(`DELETE FROM perfiles WHERE clave NOT IN (${claves.map(() => '?').join(', ')})`)
      .run(...claves)
  })()
}

/** Una persona cambió su foto o su color, acá o en otra computadora. */
export function guardarPerfil(perfil: Perfil): void {
  guardarUno(perfil)
}

/** Todo lo que esta computadora sabe de las caras de la agencia, con la foto lista para mostrar. */
export function perfilesLocales(): PerfilDeUsuario[] {
  const filas = db()
    .prepare('SELECT clave, color, foto, version FROM perfiles ORDER BY clave')
    .all() as FilaDePerfil[]
  return filas.map((fila) => ({
    clave: fila.clave,
    color: fila.color,
    foto: fotoComoDataUrl(fila.foto),
    version: fila.version,
  }))
}

// ---------------------------------------------------------------------------
// El servidor
// ---------------------------------------------------------------------------

function limpiarLosDatos(datos: DatosDePerfil): { color?: number; foto?: string | null } {
  const cuerpo: { color?: number; foto?: string | null } = {}
  if (datos.color !== undefined) {
    if (!esIndiceDePaleta(datos.color)) throw new ErrorDeNegocio('Ese color no está en la paleta de la agencia.')
    cuerpo.color = datos.color
  }
  if (datos.foto !== undefined) {
    if (datos.foto === null || datos.foto === '') {
      cuerpo.foto = null
    } else {
      // El recorte y el achique los hace la pantalla (un canvas de 256×256): acá se controla nada más
      // que lo que llega sea lo que se espera, porque esto viaja al servidor y de ahí a las otras
      // cuatro computadoras.
      if (!datos.foto.startsWith(PREFIJO_JPEG)) {
        throw new ErrorDeNegocio('La foto de perfil tiene que ser un JPEG.')
      }
      if (datos.foto.length > TOPE_DE_LA_FOTO) {
        throw new ErrorDeNegocio('La foto de perfil es demasiado grande. Probá con una imagen más chica.')
      }
      cuerpo.foto = datos.foto
    }
  }
  if (cuerpo.color === undefined && cuerpo.foto === undefined) {
    throw new ErrorDeNegocio('No hay nada para cambiar en el perfil.')
  }
  return cuerpo
}

function mensajeDelServidor(json: unknown, siNoDice: string): string {
  if (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string') {
    return (json as { error: string }).error
  }
  return siNoDice
}

/**
 * Manda el cambio al servidor y devuelve el perfil que quedó.
 *
 * El actor viaja en el cuerpo como en toda la mensajería: el token del puente es uno solo para las
 * cinco computadoras y lo que dice QUIÉN está haciendo el cambio es esto. El servidor lo vuelve a
 * controlar de todos modos —el perfil de otra persona sólo lo toca un administrador—; acá no se decide
 * nada, se dice quién pide.
 */
async function pedirAlServidor(ruta: string, actor: SesionUsuario, datos: DatosDePerfil): Promise<Perfil> {
  const credenciales = credencialesDelPuente()
  if (!credenciales) {
    throw new ErrorDeNegocio('Esta computadora todavía no tiene configurado el servidor de la agencia.')
  }
  const cuerpo = limpiarLosDatos(datos)

  const bruta = await fetch(credenciales.urlBase.replace(/\/+$/, '') + ruta, {
    method: 'PUT',
    headers: { authorization: `Bearer ${credenciales.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      actor: { clave: claveDeUsuario(actor.usuario), nombre: actor.nombre, rol: actor.rol },
      ...cuerpo,
    }),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  })

  let json: unknown = null
  try {
    json = await bruta.json()
  } catch {
    // Una respuesta ilegible con código de éxito es una conexión cortada por la mitad: se trata como
    // lo que es, un pedido que no se sabe si entró.
    if (bruta.ok) throw new ErrorDeNegocio('La respuesta del servidor se cortó a la mitad. Probá de nuevo.')
  }

  if (bruta.status < 200 || bruta.status >= 300) {
    // El 409 del color tomado llega con su propio texto («Ese color ya lo está usando Ana»): se muestra
    // tal cual, que es la única forma de que la persona sepa qué elegir.
    throw new ErrorDeNegocio(mensajeDelServidor(json, `El servidor rechazó el cambio de perfil (error ${bruta.status}).`))
  }

  const perfil = (json as { perfil?: Perfil } | null)?.perfil
  if (!perfil || typeof perfil.clave !== 'string') {
    throw new ErrorDeNegocio('El servidor contestó algo que no se entiende al guardar el perfil.')
  }
  return perfil
}

/**
 * Cambia MI foto o MI color. Vuelve el perfil ya guardado en el espejo.
 *
 * El aviso a las otras computadoras no sale de acá: el servidor difunde `{t:'perfil'}` por el canal y
 * les llega a las cinco (a ésta incluida). Lo que se guarda acá es para que la pantalla no tenga que
 * esperar ese ida y vuelta para mostrar la cara nueva.
 */
export async function subirMiPerfil(actor: SesionUsuario, datos: DatosDePerfil): Promise<PerfilDeUsuario> {
  const perfil = await pedirAlServidor('/api/dmg/perfiles/mio', actor, datos)
  guardarPerfil(perfil)
  return aPerfilDeUsuario(perfil)
}

/**
 * Cambia el perfil de OTRA persona. Es de administradores: sirve para la foto del que no se la carga y
 * para desempatar colores cuando dos personas quieren el mismo. Quién puede hacerlo lo controlan el
 * canal IPC y el servidor; acá sólo se manda.
 */
export async function subirPerfilDe(actor: SesionUsuario, clave: unknown, datos: DatosDePerfil): Promise<PerfilDeUsuario> {
  const deQuien = claveDeUsuario(clave)
  if (!deQuien) throw new ErrorDeNegocio('No se sabe de quién es el perfil que se quiere cambiar.')
  const perfil = await pedirAlServidor(`/api/dmg/perfiles/${encodeURIComponent(deQuien)}`, actor, datos)
  guardarPerfil(perfil)
  return aPerfilDeUsuario(perfil)
}

function aPerfilDeUsuario(perfil: Perfil): PerfilDeUsuario {
  return {
    clave: claveDeUsuario(perfil.clave),
    color: Number(perfil.color) || 0,
    foto: perfil.foto ?? null,
    version: Number(perfil.version) || 1,
  }
}
