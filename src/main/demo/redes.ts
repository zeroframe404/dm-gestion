// Redes sociales en la versión de demostración: las cuentas de Facebook e Instagram de cada sucursal,
// sus publicaciones, comentarios y mensajes privados, en memoria. En el programa de verdad todo eso lo
// guarda el VPS y es el VPS el que le habla a Meta; acá lo contesta esto, con la misma forma (es un
// pedazo de `FuenteVps`), así servicios/redes.ts no cambia más que en de dónde lo saca.
//
// Publicar, responder, ocultar y eliminar «andan» —se ve el cambio en la pantalla— pero no sale nada a
// ninguna red. Cada vez que se abre la demo arranca igual.
import { SUCURSALES } from '../../shared/sucursales'
import type {
  ActorDeRedesVps,
  ComentarioDeRedVps,
  ConversacionDeRedVps,
  CuentaDeRedesVps,
  DatosDeVinculoParaVps,
  FuenteVps,
  MensajeDeRedVps,
  PedidoDePublicacionParaVps,
  PublicacionDeRedVps,
} from '../vps/fuenteVps'
import type { PaginaConToken } from '../redes/meta'
import { ErrorDeNegocio } from '../servicios/errores'
import { listarSucursales } from '../servicios/sucursales'
import { enteroDe, esperarComoLaApi, personaDe } from './simulacion'

/** Lo que servicios/redes.ts usa del VPS. */
export type FuenteDeRedes = Pick<
  FuenteVps,
  | 'redesCuentas'
  | 'redesVincular'
  | 'redesDesvincular'
  | 'redesPublicar'
  | 'redesPublicaciones'
  | 'redesCuotaInstagram'
  | 'redesComentarios'
  | 'redesComentarioResponder'
  | 'redesComentarioOcultar'
  | 'redesComentarioEliminar'
  | 'redesConversaciones'
  | 'redesConversacionMensajes'
  | 'redesConversacionResponder'
>

function haceHoras(horas: number): string {
  return new Date(Date.now() - horas * 3_600_000).toISOString()
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** Las Páginas que «trae el login de Facebook» para una sucursal. */
export function paginasDeLaDemo(sucursal: string): PaginaConToken[] {
  const s = slug(sucursal)
  return [
    { id: `10${String(enteroDe(`pagina:${s}`, 10_000_000, 99_999_999))}`, nombre: `Seguros Demo ${sucursal}`, token: 'token-de-demostracion', instagramId: `178${enteroDe(`ig:${s}`, 10_000_000, 99_999_999)}`, instagramUsuario: `segurosdemo.${s}` },
    { id: `10${String(enteroDe(`pagina2:${s}`, 10_000_000, 99_999_999))}`, nombre: `Seguros Demo ${sucursal} — Promociones`, token: 'token-de-demostracion', instagramId: null, instagramUsuario: null },
  ]
}

// --- El estado, armado la primera vez que se pide ---------------------------------------------------------

interface Estado {
  cuentas: Map<string, CuentaDeRedesVps>
  publicaciones: PublicacionDeRedVps[]
  comentarios: ComentarioDeRedVps[]
  conversaciones: ConversacionDeRedVps[]
  mensajes: Map<string, MensajeDeRedVps[]>
}

let estado: Estado | null = null
let siguienteId = 1

function nuevoId(prefijo: string): string {
  return `${prefijo}-demo-${siguienteId++}`
}

function sucursalesDeLaDemo(): string[] {
  try {
    const locales = listarSucursales().map((s) => s.nombre)
    if (locales.length > 0) return locales
  } catch {
    // Sin base todavía: las de siempre.
  }
  return [...SUCURSALES]
}

const TEXTOS_DE_PUBLICACION = [
  '¿Sabías que con el seguro todo riesgo tenés auto sustituto? Consultanos por tu cotización sin cargo. 🚗',
  'Este fin de semana largo viajá tranquilo: revisá que tu póliza esté al día. Te esperamos en la sucursal.',
  'Asegurá tu moto desde $ 15.000 por mes. Escribinos por mensaje privado y te cotizamos en el momento.',
  '¡Nuevo horario! Atendemos de lunes a viernes de 9 a 18 y los sábados de 9 a 13.',
  'Granizo: si tu auto tiene terceros completo, fijate si tu cobertura lo incluye. Te asesoramos.',
]

const COMENTARIOS = [
  '¿Cuánto sale asegurar un Gol 2015 terceros completo?',
  'Hola! Me pasan precio por privado para una moto 110?',
  'Excelente atención, me resolvieron el siniestro en una semana 👏',
  '¿Trabajan con Galeno?',
  '¿Hacen seguro para autos de aplicación (Uber)?',
  'Me interesa, ¿dónde queda la sucursal?',
]

const PRIMEROS_MENSAJES = [
  'Hola, quería cotizar el seguro de un Cronos 2021.',
  'Buenas tardes, ¿cuándo vence mi cuota? Soy cliente.',
  'Hola, choqué ayer, ¿qué tengo que hacer para hacer la denuncia?',
  '¿Me pueden mandar la póliza por acá? La necesito para la VTV.',
]

function armarEstado(): Estado {
  const sucursales = sucursalesDeLaDemo()
  const nuevo: Estado = { cuentas: new Map(), publicaciones: [], comentarios: [], conversaciones: [], mensajes: new Map() }
  sucursales.forEach((sucursal, i) => {
    // La última queda sin vincular: así se puede mostrar cómo se vincula una cuenta.
    if (sucursales.length > 1 && i === sucursales.length - 1) return
    const pagina = paginasDeLaDemo(sucursal)[0]!
    nuevo.cuentas.set(sucursal, {
      sucursal,
      facebookPaginaId: pagina.id,
      facebookPaginaNombre: pagina.nombre,
      instagramId: pagina.instagramId,
      instagramUsuario: pagina.instagramUsuario,
      estado: 'ACTIVA',
      puedePublicarEnInstagram: true,
      vinculadoPor: 'Administrador de la demo',
      vinculadoEn: haceHoras(24 * 40),
    })
    TEXTOS_DE_PUBLICACION.forEach((texto, j) => {
      const destino = j % 2 === 0 ? 'FACEBOOK' : 'INSTAGRAM'
      const id = nuevoId('pub')
      const fallida = j === 3 && i === 0
      nuevo.publicaciones.push({
        id,
        sucursal,
        destino,
        tipoDeContenido: 'FEED',
        estado: fallida ? 'FALLIDA' : 'PUBLICADA',
        texto,
        idEnLaRed: fallida ? null : id,
        url: null,
        error: fallida ? 'Instagram rechazó la imagen: la relación de aspecto no está entre 4:5 y 1.91:1.' : null,
        creadoPor: 'Administrador de la demo',
        programadoPara: null,
        publicadoEn: fallida ? null : haceHoras(24 * (j * 3 + 1)),
        creadoEn: haceHoras(24 * (j * 3 + 1)),
      })
    })
    COMENTARIOS.forEach((mensaje, j) => {
      const respondido = j % 3 === 0
      nuevo.comentarios.push({
        id: nuevoId('com'),
        sucursal,
        plataforma: j % 2 === 0 ? 'FACEBOOK' : 'INSTAGRAM',
        autorNombre: personaDe(`comentario:${sucursal}:${j}`).split(' ').reverse().join(' '),
        mensaje,
        creadoEnMeta: haceHoras(5 + j * 9),
        estado: 'VISIBLE',
        respondido,
        puedeResponder: true,
        puedeOcultar: true,
        puedeEliminar: j % 2 === 0,
        motivoSiNoPuede: j % 2 === 0 ? null : 'Instagram no deja eliminar comentarios de otras personas desde la API: sólo ocultarlos.',
        respuestas: respondido ? [{ id: nuevoId('resp'), mensaje: '¡Hola! Te escribimos por privado. Gracias por consultar.', respondidoPor: 'Administrador de la demo', respondidoEn: haceHoras(4 + j * 9) }] : [],
      })
    })
    PRIMEROS_MENSAJES.forEach((mensaje, j) => {
      const id = nuevoId('conv')
      const ultimo = haceHoras(2 + j * 20)
      // La API de Meta sólo deja contestar dentro de las 24 horas del último mensaje del cliente.
      const puedeResponder = 2 + j * 20 < 24
      nuevo.conversaciones.push({
        id,
        sucursal,
        plataforma: j % 2 === 0 ? 'FACEBOOK' : 'INSTAGRAM',
        participanteNombre: personaDe(`conversacion:${sucursal}:${j}`).split(' ').reverse().join(' '),
        ultimoMensajeEn: ultimo,
        puedeResponder,
        motivoSiNoPuedeResponder: puedeResponder ? null : 'Pasaron más de 24 horas desde el último mensaje del cliente: Meta no deja responder desde el programa.',
      })
      nuevo.mensajes.set(id, [
        { id: nuevoId('msg'), direccion: 'ENTRANTE', mensaje, creadoEnMeta: ultimo, enviadoPor: null },
        ...(j % 2 === 1 ? [{ id: nuevoId('msg'), direccion: 'SALIENTE' as const, mensaje: '¡Hola! Sí, decime el DNI del titular y lo vemos.', creadoEnMeta: ultimo, enviadoPor: 'Administrador de la demo' }] : []),
      ])
    })
  })
  return nuevo
}

function datos(): Estado {
  estado ??= armarEstado()
  return estado
}

/** Las sucursales que ve este actor: la pedida, o todas para el superadministrador, o la suya. */
function deLaSucursal<T extends { sucursal: string }>(lista: T[], actor: ActorDeRedesVps, sucursal?: string): T[] {
  const cual = sucursal || (actor.rol === 'SUPER_ADMIN' ? null : actor.sucursal)
  return cual ? lista.filter((fila) => fila.sucursal === cual) : lista
}

function comentario(id: string): ComentarioDeRedVps {
  const encontrado = datos().comentarios.find((c) => c.id === id)
  if (!encontrado) throw new ErrorDeNegocio('Ese comentario ya no está.')
  return encontrado
}

const espera = () => esperarComoLaApi(200, 600)

export const REDES_DE_LA_DEMO: FuenteDeRedes = {
  async redesCuentas(actor) {
    await espera()
    return deLaSucursal([...datos().cuentas.values()], actor)
  },
  async redesVincular(actor, vinculo: DatosDeVinculoParaVps) {
    await espera()
    const cuenta: CuentaDeRedesVps = {
      sucursal: vinculo.sucursal,
      facebookPaginaId: vinculo.facebookPaginaId,
      facebookPaginaNombre: vinculo.facebookPaginaNombre,
      instagramId: vinculo.instagramId,
      instagramUsuario: vinculo.instagramUsuario,
      estado: 'ACTIVA',
      puedePublicarEnInstagram: Boolean(vinculo.instagramId),
      vinculadoPor: actor.nombre,
      vinculadoEn: new Date().toISOString(),
    }
    datos().cuentas.set(vinculo.sucursal, cuenta)
    return cuenta
  },
  async redesDesvincular(_actor, sucursal) {
    await espera()
    datos().cuentas.delete(sucursal)
  },
  async redesPublicar(actor, pedido: PedidoDePublicacionParaVps) {
    await esperarComoLaApi(1200, 2500)
    const sucursal = pedido.sucursal || actor.sucursal || ''
    const cuenta = datos().cuentas.get(sucursal)
    if (!cuenta) throw new ErrorDeNegocio(`La sucursal ${sucursal || '(sin sucursal)'} no tiene una cuenta vinculada: vinculala desde Administración → Redes sociales.`)
    if (pedido.destino === 'INSTAGRAM' && !cuenta.instagramId) throw new ErrorDeNegocio('Esa Página de Facebook no tiene una cuenta de Instagram profesional conectada.')
    const id = nuevoId('pub')
    const ahora = new Date().toISOString()
    const publicacion: PublicacionDeRedVps = {
      id,
      sucursal,
      destino: pedido.destino,
      tipoDeContenido: pedido.tipoDeContenido ?? 'FEED',
      estado: pedido.programarPara ? 'PROGRAMADA' : 'PUBLICADA',
      texto: pedido.texto,
      idEnLaRed: pedido.programarPara ? null : id,
      url: null,
      error: null,
      creadoPor: actor.nombre,
      programadoPara: pedido.programarPara ?? null,
      publicadoEn: pedido.programarPara ? null : ahora,
      creadoEn: ahora,
    }
    datos().publicaciones.unshift(publicacion)
    return publicacion
  },
  async redesPublicaciones(actor, sucursal) {
    await espera()
    return deLaSucursal(datos().publicaciones, actor, sucursal)
  },
  async redesCuotaInstagram(actor, sucursal) {
    await espera()
    const cual = sucursal ?? actor.sucursal ?? ''
    const hoy = new Date().toISOString().slice(0, 10)
    const usadas = datos().publicaciones.filter((p) => p.sucursal === cual && p.destino === 'INSTAGRAM' && p.creadoEn.startsWith(hoy)).length
    // Instagram deja 50 publicaciones por día y por cuenta.
    return Math.max(0, 50 - usadas)
  },
  async redesComentarios(actor, sucursal, soloSinResponder) {
    await espera()
    return deLaSucursal(datos().comentarios, actor, sucursal).filter((c) => c.estado !== 'ELIMINADO' && (!soloSinResponder || !c.respondido))
  },
  async redesComentarioResponder(actor, comentarioId, mensaje) {
    await esperarComoLaApi(500, 1200)
    const c = comentario(comentarioId)
    c.respuestas.push({ id: nuevoId('resp'), mensaje, respondidoPor: actor.nombre, respondidoEn: new Date().toISOString() })
    c.respondido = true
    return c
  },
  async redesComentarioOcultar(_actor, comentarioId, ocultar) {
    await esperarComoLaApi(400, 900)
    const c = comentario(comentarioId)
    c.estado = ocultar ? 'OCULTO' : 'VISIBLE'
    return c
  },
  async redesComentarioEliminar(_actor, comentarioId) {
    await esperarComoLaApi(400, 900)
    const c = comentario(comentarioId)
    if (!c.puedeEliminar) throw new ErrorDeNegocio(c.motivoSiNoPuede ?? 'Ese comentario no se puede eliminar.')
    c.estado = 'ELIMINADO'
  },
  async redesConversaciones(actor, sucursal) {
    await espera()
    return deLaSucursal(datos().conversaciones, actor, sucursal)
  },
  async redesConversacionMensajes(_actor, conversacionId) {
    await espera()
    return datos().mensajes.get(conversacionId) ?? []
  },
  async redesConversacionResponder(actor, conversacionId, mensaje) {
    await esperarComoLaApi(500, 1200)
    const conversacion = datos().conversaciones.find((c) => c.id === conversacionId)
    if (!conversacion) throw new ErrorDeNegocio('Esa conversación ya no está.')
    if (!conversacion.puedeResponder) throw new ErrorDeNegocio(conversacion.motivoSiNoPuedeResponder ?? 'Esa conversación no se puede responder.')
    const nuevo: MensajeDeRedVps = { id: nuevoId('msg'), direccion: 'SALIENTE', mensaje, creadoEnMeta: new Date().toISOString(), enviadoPor: actor.nombre }
    const lista = datos().mensajes.get(conversacionId) ?? []
    lista.push(nuevo)
    datos().mensajes.set(conversacionId, lista)
    conversacion.ultimoMensajeEn = nuevo.creadoEnMeta
    return nuevo
  },
}

