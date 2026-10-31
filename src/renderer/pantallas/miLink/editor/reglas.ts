// Las reglas del editor de «Mi página»: lo mismo que valida el servidor
// (`server/src/modules/milink/milink.contenido.ts` en Seguros_Daniel_Martinez), dicho antes de mandar.
//
// POR QUÉ SE REPITE ACÁ. El servidor es el que decide (contesta 400 con el motivo y eso se muestra
// tal cual), pero el editor se autoguarda cada vez que se deja de escribir: sin estas reglas, borrar
// el nombre para escribir otro mandaría un pedido que vuelve rechazado, y el cartel rojo aparecería
// en el medio de la frase. Con ellas, mientras falte algo queda «Sin guardar» con el motivo y no se
// manda nada. Los textos son los mismos del servidor, así la persona lee lo mismo venga de donde venga.
import {
  LIMITES_DE_MI_LINK,
  PATRON_DE_DIRECCION,
  DIRECCIONES_RESERVADAS,
  esDireccionValida,
  type ContenidoDeMiLink,
  type MiLink,
  type TipoDeContacto,
} from '../../../../shared/miLink'

/** Lo que se edita: lo mismo que viaja en `CambiosDeMiLink`, menos el candado (lo lleva el editor). */
export interface Borrador {
  direccion: string
  publicada: boolean
  contenido: ContenidoDeMiLink
}

export function borradorDe(link: MiLink): Borrador {
  return { direccion: link.direccion, publicada: link.publicada, contenido: link.contenido }
}

/**
 * El id fijo con el que la página cuenta los clicks del botón «Denunciar un siniestro». No es un
 * bloque editable, pero comparte el espacio de ids: un contacto con este id se contaría como el botón.
 */
export const ID_DEL_BOTON_DE_SINIESTROS = 'siniestros'

/** Ids de bloque: los mismos del servidor (`[a-z0-9-]{1,40}`), únicos en toda la página. */
export function idsUsados(contenido: ContenidoDeMiLink): Set<string> {
  return new Set([
    ID_DEL_BOTON_DE_SINIESTROS,
    ...contenido.contacto.map((bloque) => bloque.id),
    ...contenido.coberturas.map((bloque) => bloque.id),
    ...contenido.links.map((bloque) => bloque.id),
  ])
}

/**
 * Un id nuevo que se lee: «whatsapp», «auto», «link»; y si ya está, «auto-2», «auto-3»… Se usa el tipo
 * y no un número al azar porque es lo que se ve en las métricas cuando un bloque se borró y su
 * etiqueta ya no se puede buscar en la página.
 */
export function idNuevo(base: string, contenido: ContenidoDeMiLink): string {
  const usados = idsUsados(contenido)
  const limpio = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'bloque'
  if (!usados.has(limpio)) return limpio
  for (let n = 2; ; n++) {
    const candidato = `${limpio}-${n}`
    if (!usados.has(candidato)) return candidato
  }
}

/** Mueve un elemento un lugar para arriba (-1) o para abajo (+1). Fuera de rango, la lista igual. */
export function mover<T>(lista: readonly T[], indice: number, delta: -1 | 1): T[] {
  const destino = indice + delta
  if (destino < 0 || destino >= lista.length) return [...lista]
  const copia = [...lista]
  const [elemento] = copia.splice(indice, 1)
  copia.splice(destino, 0, elemento!)
  return copia
}

/** Solo http y https, igual que el servidor: lo que va en un `href` público no puede ser `javascript:`. */
export function esUrlWeb(valor: string): boolean {
  try {
    const url = new URL(valor)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** «miweb.com.ar» → «https://miweb.com.ar»: la gente pega el dominio sin el esquema. */
export function urlConEsquema(texto: string): string {
  const limpio = texto.trim()
  if (!limpio || /^[a-z][a-z0-9+.-]*:/i.test(limpio)) return limpio
  return `https://${limpio}`
}

/**
 * Si con ese dato la página puede armar el link del contacto. El servidor NO rechaza un contacto que
 * no sirve (lo guarda y no lo muestra, para no perder lo que se escribió): por eso se avisa acá, que
 * es donde se puede corregir. Mismas reglas que `enlaceDeContacto` de `milink.pagina.ts`.
 */
export function problemaDeContacto(tipo: TipoDeContacto, crudo: string): string | null {
  const valor = crudo.trim()
  if (!valor) return 'Falta el dato del contacto.'
  if (valor.length > LIMITES_DE_MI_LINK.valorDeContacto) {
    return `El dato puede tener hasta ${LIMITES_DE_MI_LINK.valorDeContacto} caracteres.`
  }
  const esSitio = (texto: string) =>
    /^[a-z][a-z0-9+.-]*:/i.test(texto) ? esUrlWeb(texto) : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(texto)
  const esPerfil = (patron: RegExp) => esSitio(valor) || patron.test(valor.replace(/^@/, ''))
  switch (tipo) {
    case 'whatsapp':
    case 'telefono':
      return valor.replace(/\D/g, '').length >= 6 ? null : 'Escribí el número completo, con la característica.'
    case 'email':
      return /^[^\s@<>"'(),;:\\]+@[^\s@<>"'(),;:\\]+\.[^\s@<>"'(),;:\\]+$/.test(valor) ? null : 'Ese mail no parece completo.'
    case 'instagram':
      return esPerfil(/^[A-Za-z0-9._]{1,30}$/) ? null : 'Escribí tu usuario (@usuario) o pegá el link de tu perfil.'
    case 'facebook':
      return esPerfil(/^[A-Za-z0-9.-]{1,50}$/) ? null : 'Escribí tu usuario o pegá el link de tu página.'
    case 'tiktok':
      return esPerfil(/^[A-Za-z0-9._]{1,24}$/) ? null : 'Escribí tu usuario (@usuario) o pegá el link de tu perfil.'
    case 'web':
      return esSitio(valor) ? null : 'Escribí la dirección del sitio, por ejemplo miweb.com.ar.'
    case 'direccion':
      return null
  }
}

/** Por qué una dirección no sirve, o null. Los textos del servidor (`motivoDeDireccionInvalida`). */
export function motivoDeDireccion(valor: string): string | null {
  if (valor.length < 3) return 'La dirección tiene que tener al menos 3 caracteres.'
  if (valor.length > 40) return 'La dirección puede tener hasta 40 caracteres.'
  if (DIRECCIONES_RESERVADAS.includes(valor)) return 'Esa dirección está reservada para el sitio. Probá con otra.'
  if (!PATRON_DE_DIRECCION.test(valor) || !esDireccionValida(valor)) {
    return 'La dirección solo puede tener minúsculas, números y guiones (sin guiones al principio, al final ni dos seguidos).'
  }
  return null
}

/**
 * La dirección mientras se escribe: minúsculas, sin tildes y con guiones en vez de espacios. No se
 * sacan los guiones de las puntas: quien está escribiendo «daniel-» va a seguir con «martinez».
 */
export function direccionEscrita(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40)
}

function largo(texto: string): number {
  return texto.trim().length
}

/**
 * El primer problema del contenido, o null si el servidor lo va a aceptar. Va en el orden en que se ve
 * la página (nombre, línea, contacto, coberturas, links) para que el motivo apunte a lo de más arriba.
 */
export function problemaDelContenido(contenido: ContenidoDeMiLink): string | null {
  const l = LIMITES_DE_MI_LINK
  if (largo(contenido.nombre) < 1) return 'Falta tu nombre.'
  if (largo(contenido.nombre) > l.nombre) return `Tu nombre puede tener hasta ${l.nombre} caracteres.`
  if (largo(contenido.bio) > l.bio) return `La línea sobre vos puede tener hasta ${l.bio} caracteres.`
  if (contenido.contacto.length > l.contactos) return `Puede haber hasta ${l.contactos} contactos.`
  if (contenido.coberturas.length > l.coberturas) return `Puede haber hasta ${l.coberturas} coberturas.`
  if (contenido.links.length > l.links) return `Puede haber hasta ${l.links} links.`
  for (const [i, bloque] of contenido.contacto.entries()) {
    if (largo(bloque.valor) < 1) return `Falta el dato del contacto ${i + 1}.`
    if (largo(bloque.valor) > l.valorDeContacto) return `El dato del contacto ${i + 1} puede tener hasta ${l.valorDeContacto} caracteres.`
  }
  for (const [i, bloque] of contenido.coberturas.entries()) {
    if (largo(bloque.titulo) < 1) return `Falta el título de la cobertura ${i + 1}.`
    if (largo(bloque.titulo) > l.tituloDeCobertura) return `El título de la cobertura ${i + 1} puede tener hasta ${l.tituloDeCobertura} caracteres.`
    if (largo(bloque.descripcion) > l.descripcionDeCobertura) {
      return `La descripción de la cobertura ${i + 1} puede tener hasta ${l.descripcionDeCobertura} caracteres.`
    }
  }
  for (const [i, bloque] of contenido.links.entries()) {
    if (largo(bloque.titulo) < 1) return `Falta el título del link ${i + 1}.`
    if (largo(bloque.titulo) > l.tituloDeLink) return `El título del link ${i + 1} puede tener hasta ${l.tituloDeLink} caracteres.`
    if (largo(bloque.url) < 1) return `Falta la dirección del link ${i + 1}.`
    if (largo(bloque.url) > l.urlDeLink) return `La dirección del link ${i + 1} puede tener hasta ${l.urlDeLink} caracteres.`
    if (!esUrlWeb(bloque.url.trim())) return `La dirección del link ${i + 1} tiene que empezar con http:// o https://.`
  }
  if (!/^#[0-9a-f]{6}$/i.test(contenido.diseno.color)) return 'El color tiene que ser un código como #6d4aff.'
  return null
}
