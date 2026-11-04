// TikTok en la versión de demostración: la app y la cuenta de cada sucursal y sus publicaciones, en
// memoria. En el programa de verdad todo eso lo guarda el VPS y es el VPS el que le habla a TikTok;
// acá lo contesta esto, con la misma forma (es un pedazo de `FuenteVps`).
//
// Publicar «anda» —se ve en la lista— pero no sale nada a TikTok. Cada vez que se abre la demo arranca
// igual: la primera sucursal con la cuenta vinculada, la segunda con la app cargada y sin vincular, y
// el resto sin nada, para que se vean los tres casos.
import { SUCURSALES } from '../../shared/sucursales'
import type { ActorDeRedesVps, CuentaDeTikTokVps, PublicacionDeTikTokVps } from '../vps/fuenteVps'
import type { FuenteDeTikTok } from '../servicios/tiktok'
import { ErrorDeNegocio } from '../servicios/errores'
import { esperarComoLaApi } from './simulacion'

interface Estado {
  cuentas: Map<string, CuentaDeTikTokVps>
  publicaciones: PublicacionDeTikTokVps[]
}

let estado: Estado | null = null
let siguienteId = 1

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function haceHoras(horas: number): string {
  return new Date(Date.now() - horas * 3_600_000).toISOString()
}

function cuentaSinVincular(sucursal: string, conApp: boolean): CuentaDeTikTokVps {
  return {
    sucursal,
    appCargada: conApp,
    clientKey: conApp ? `awdemo${slug(sucursal)}` : null,
    urlDeRedireccion: null,
    appCargadaPor: conApp ? 'Superadministrador de la demo' : null,
    appCargadaEn: conApp ? haceHoras(24 * 7) : null,
    estado: 'SIN_VINCULAR',
    nombre: null,
    usuario: null,
    avatarUrl: null,
    vinculadoPor: null,
    vinculadoEn: null,
  }
}

function vincular(cuenta: CuentaDeTikTokVps, quien: string): CuentaDeTikTokVps {
  return {
    ...cuenta,
    estado: 'ACTIVA',
    nombre: `Seguros Demo ${cuenta.sucursal}`,
    usuario: `segurosdemo.${slug(cuenta.sucursal)}`,
    vinculadoPor: quien,
    vinculadoEn: new Date().toISOString(),
  }
}

function datos(): Estado {
  if (estado) return estado
  const nuevo: Estado = { cuentas: new Map(), publicaciones: [] }
  SUCURSALES.forEach((sucursal, i) => {
    if (i === 0) {
      const cuenta = vincular(cuentaSinVincular(sucursal, true), 'Superadministrador de la demo')
      nuevo.cuentas.set(sucursal, { ...cuenta, vinculadoEn: haceHoras(24 * 6) })
      nuevo.publicaciones.push({
        id: `tt-demo-${siguienteId++}`,
        sucursal,
        estado: 'PUBLICADA',
        texto: '¿Sabías que con el todo riesgo tenés auto sustituto? Te contamos en 30 segundos. #seguros',
        privacidad: 'PUBLIC_TO_EVERYONE',
        archivoNombre: 'auto-sustituto.mp4',
        url: null,
        error: null,
        creadoPor: 'Superadministrador de la demo',
        programadoPara: null,
        publicadoEn: haceHoras(30),
        creadoEn: haceHoras(30),
      })
    } else if (i === 1) {
      nuevo.cuentas.set(sucursal, cuentaSinVincular(sucursal, true))
    }
  })
  estado = nuevo
  return nuevo
}

function deLaSucursal<T extends { sucursal: string }>(filas: T[], actor: ActorDeRedesVps, sucursal?: string): T[] {
  if (actor.rol === 'SUPER_ADMIN') return sucursal ? filas.filter((fila) => fila.sucursal === sucursal) : filas
  return filas.filter((fila) => fila.sucursal === actor.sucursal)
}

function sucursalDe(actor: ActorDeRedesVps, pedida?: string): string {
  const sucursal = actor.rol === 'SUPER_ADMIN' ? pedida || actor.sucursal || '' : actor.sucursal || ''
  if (actor.rol !== 'SUPER_ADMIN' && pedida && pedida !== actor.sucursal) {
    throw new ErrorDeNegocio(`No podés operar la cuenta de TikTok de otra sucursal: la tuya es «${actor.sucursal}».`)
  }
  return sucursal
}

const espera = () => esperarComoLaApi(200, 600)

export const TIKTOK_DE_LA_DEMO: FuenteDeTikTok = {
  async tiktokCuentas(actor) {
    await espera()
    return deLaSucursal([...datos().cuentas.values()], actor)
  },
  async tiktokGuardarApp(actor, app) {
    await espera()
    const actual = datos().cuentas.get(app.sucursal) ?? cuentaSinVincular(app.sucursal, false)
    const cambioDeApp = Boolean(actual.clientKey && actual.clientKey !== app.clientKey)
    const cuenta: CuentaDeTikTokVps = {
      ...(cambioDeApp ? cuentaSinVincular(app.sucursal, false) : actual),
      appCargada: true,
      clientKey: app.clientKey,
      urlDeRedireccion: app.urlDeRedireccion,
      appCargadaPor: actor.nombre,
      appCargadaEn: new Date().toISOString(),
    }
    datos().cuentas.set(app.sucursal, cuenta)
    return cuenta
  },
  async tiktokBorrarApp(_actor, sucursal) {
    await espera()
    datos().cuentas.delete(sucursal)
  },
  async tiktokVincular(actor, vinculo) {
    await esperarComoLaApi(600, 1200)
    const actual = datos().cuentas.get(vinculo.sucursal)
    if (!actual?.appCargada) throw new ErrorDeNegocio(`Todavía no está cargada la app de TikTok de «${vinculo.sucursal}».`)
    const cuenta = vincular(actual, actor.nombre)
    datos().cuentas.set(vinculo.sucursal, cuenta)
    return cuenta
  },
  async tiktokDesvincular(_actor, sucursal) {
    await espera()
    const actual = datos().cuentas.get(sucursal)
    if (actual) datos().cuentas.set(sucursal, { ...cuentaSinVincular(sucursal, actual.appCargada), clientKey: actual.clientKey, appCargadaPor: actual.appCargadaPor, appCargadaEn: actual.appCargadaEn })
  },
  async tiktokCreador(actor, sucursal) {
    await espera()
    const cuenta = datos().cuentas.get(sucursalDe(actor, sucursal))
    if (!cuenta || cuenta.estado !== 'ACTIVA') throw new ErrorDeNegocio('Todavía no hay ninguna cuenta de TikTok vinculada para esa sucursal.')
    return {
      nombre: cuenta.nombre ?? '',
      usuario: cuenta.usuario ?? '',
      avatarUrl: null,
      opcionesDePrivacidad: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
      comentariosApagados: false,
      duoApagado: false,
      stitchApagado: true,
      duracionMaximaSegundos: 600,
    }
  },
  async tiktokPublicar(actor, pedido) {
    await esperarComoLaApi(1200, 2500)
    const sucursal = sucursalDe(actor, pedido.sucursal)
    const cuenta = datos().cuentas.get(sucursal)
    if (!cuenta || cuenta.estado !== 'ACTIVA') throw new ErrorDeNegocio(`La sucursal ${sucursal || '(sin sucursal)'} no tiene una cuenta de TikTok vinculada.`)
    const ahora = new Date().toISOString()
    const programada = Boolean(pedido.programarPara)
    const publicacion: PublicacionDeTikTokVps = {
      id: `tt-demo-${siguienteId++}`,
      sucursal,
      estado: programada ? 'PROGRAMADA' : 'PUBLICADA',
      texto: pedido.texto,
      privacidad: pedido.privacidad,
      archivoNombre: pedido.archivo.nombre,
      url: null,
      error: null,
      creadoPor: actor.nombre,
      programadoPara: pedido.programarPara ?? null,
      publicadoEn: programada ? null : ahora,
      creadoEn: ahora,
    }
    datos().publicaciones.unshift(publicacion)
    return publicacion
  },
  async tiktokPublicaciones(actor, sucursal) {
    await espera()
    return deLaSucursal(datos().publicaciones, actor, sucursal)
  },
}
