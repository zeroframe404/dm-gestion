// La mensajería entre dos computadoras (12.8): lo que se escribe en Lanús tiene que aparecer en Dock
// Sud, con sus dos confirmaciones, sus emojis enteros y sus archivos.
//
// Las dos computadoras tienen su propia base y su propia carpeta de archivos, y hablan con el mismo
// servidor simulado. `unaVueltaDelCartero` despacha lo que está saliendo y trae lo que hay: desde la
// 14.0 esas dos mitades están separadas en el cartero de verdad —el bucle del long-poll se fue, ahora
// las dispara el canal en vivo cuando el servidor avisa `{t:'mensajes'}`— y esta función las junta
// para que la prueba pueda pedirlas de a una.
//
// Qué se prueba acá y no en el servidor: el ida y vuelta completo. Que el mensaje salga de una base y
// entre en la otra, que el acuse vuelva y mueva el tilde, que un mensaje escrito sin internet espere y
// salga solo, y que un emoji que ocupa dos unidades UTF-16 llegue igual del otro lado.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { abrirBaseDeDatos, cerrarBaseDeDatos, usarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { traerNovedadesDeMensajes, unaVueltaDelCartero } from '../src/main/mensajeria/cartero'
import { PuenteDeMensajes, usarPuenteDeMensajesDePrueba } from '../src/main/mensajeria/puente'
import { hayAdjuntosPendientes, subirAdjuntosPendientes, usarCarpetaDeAdjuntosDePrueba } from '../src/main/servicios/adjuntos'
import {
  abrirConversacionCon,
  avisosDe,
  conversacionesDe,
  contactosDe,
  encolarMensaje,
  eliminarMensajePropio,
  hiloDe,
  marcarConversacionLeida,
  reaccionarA,
  registroDeMensajes,
  zumbar,
} from '../src/main/servicios/mensajeria'
import { usarFuenteDePrueba } from '../src/main/servicios/sincronizacion'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import type { SesionUsuario } from '../src/shared/tipos'

const TOKEN = 'prueba'

// `daniel` no se da de alta: es el usuario inicial que ya siembra la base (ver db/semilla.ts), y darlo
// de alta otra vez choca contra el índice único del nombre de usuario.
const DANIEL: SesionUsuario = { id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursal: { id: 4, nombre: 'Daniel' }, debeCambiarClave: false }
const ANA: SesionUsuario = { id: 2, nombre: 'Ana', usuario: 'ana', rol: 'EMPLEADO', sucursal: { id: 2, nombre: 'Lanús' }, debeCambiarClave: false }
const BETO: SesionUsuario = { id: 3, nombre: 'Beto', usuario: 'beto', rol: 'ADMIN', sucursal: { id: 1, nombre: 'Dock Sud' }, debeCambiarClave: false }

/** El mensaje con el que se prueba todo lo de Unicode: emoji simple, emoji con ZWJ y otros alfabetos. */
const CON_EMOJIS = 'Listo lo de Gómez 👍 — la familia 👨‍👩‍👧 quedó cubierta ✅ Привет'

const temporales: string[] = []
process.on('exit', () => {
  for (const carpeta of temporales) rmSync(carpeta, { recursive: true, force: true })
})

interface Computadora {
  nombre: string
  db: BaseDeDatos
  carpeta: string
}

const abiertas: Computadora[] = []

/** Deja activas la base Y la carpeta de archivos de esa computadora: cada una tiene su disco. */
function en(pc: Computadora): void {
  usarBaseDeDatos(pc.db)
  usarCarpetaDeAdjuntosDePrueba(pc.carpeta)
}

function computadora(nombre: string): Computadora {
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  // Las dos computadoras conocen a la misma gente: es el espejo de la base de usuarios de la agencia.
  const alta = db.prepare(
    `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
     VALUES (@id, @nombre, @usuario, 'sin-clave', @rol, (SELECT id FROM sucursales WHERE nombre = @sucursal), 1, 0)`,
  )
  for (const persona of [ANA, BETO]) {
    alta.run({ id: persona.id, nombre: persona.nombre, usuario: persona.usuario, rol: persona.rol, sucursal: persona.sucursal.nombre })
  }
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-mensajes-'))
  temporales.push(carpeta)
  const pc = { nombre, db, carpeta }
  abiertas.push(pc)
  return pc
}

function cerrarTodo(): void {
  for (const pc of abiertas) pc.db.close()
  abiertas.length = 0
  usarPuenteDeMensajesDePrueba(null)
  usarFuenteDePrueba(null)
  cerrarBaseDeDatos()
}

interface Escenario {
  servidor: VpsSimulado
  lanus: Computadora
  dockSud: Computadora
}

async function dosComputadoras(): Promise<Escenario> {
  cerrarTodo()
  const servidor = new VpsSimulado({ token: TOKEN })
  await servidor.escuchar()
  usarPuenteDeMensajesDePrueba(new PuenteDeMensajes({ urlBase: servidor.url, token: TOKEN }))
  // Los archivos van y vienen por el MISMO servidor simulado, con el cliente de verdad: es lo que
  // hace que la prueba de los adjuntos signifique algo.
  usarFuenteDePrueba(new FuenteVps({ urlBase: servidor.url, token: TOKEN }))
  return { servidor, lanus: computadora('Lanús'), dockSud: computadora('Dock Sud') }
}

// ---------------------------------------------------------------------------

// Dos avisos del canal pegados. Pasa todos los días: un mensaje y el zumbido que va atrás, dos
// mensajes seguidos, o un mensaje mientras el «leído» de otra conversación dispara su propio frame. El
// servidor manda dos `{t:'mensajes'}` con milisegundos de diferencia y cada uno larga su pedido.
//
// Sin candado los dos pedidos se encimaban, y como `/mensajes/novedades` devuelve TODO lo que todavía
// no tiene acuse —y el acuse se manda recién al final— los dos traían el mismo mensaje: dos carteles de
// Windows por un mensaje, la ventana sacudida dos veces y el sonido del zumbido pisado consigo mismo.
// Hasta la 13.x lo impedía el bucle del cartero; ahora lo impide el candado de `traerNovedadesDeMensajes`.
test('dos avisos del canal pegados no traen el mismo mensaje dos veces', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Llegó el pago de Pérez' })
  await unaVueltaDelCartero(ANA)

  en(dockSud)
  const acusesAntes = servidor.llamadas.mensajesEntregados
  // Los dos avisos, sin esperarse: es exactamente lo que hace `vivo/mensajes.ts` con cada frame.
  await Promise.all([traerNovedadesDeMensajes(BETO), traerNovedadesDeMensajes(BETO)])

  // El acuse de llegada sale UNA vez. Es la marca de que el mensaje se procesó una sola vez: con los
  // dos pedidos encimados, los dos lo veían sin acusar y los dos lo acusaban (y los dos avisaban).
  assert.equal(servidor.llamadas.mensajesEntregados - acusesAntes, 1, 'el mensaje se procesó una sola vez')
  const hilo = await hiloDe(BETO, conversacionesDe(BETO)[0].id)
  assert.equal(hilo.mensajes.length, 1)
  assert.equal(avisosDe(BETO).sinLeer, 1)
})

test('un mensaje escrito en Lanús aparece en Dock Sud, con sus dos confirmaciones', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  // Ana abre la conversación y escribe.
  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  assert.equal(conversacion.titulo, 'Beto')
  const mandado = encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: CON_EMOJIS })
  assert.equal(mandado.estado, 'enCola', 'recién escrito, todavía no salió de esta computadora')

  await unaVueltaDelCartero(ANA)
  assert.equal((await hiloDe(ANA, conversacion.id)).mensajes[0].estado, 'enviado', 'el servidor ya lo tiene')

  // Beto todavía no sabe nada: su computadora no fue a buscar.
  en(dockSud)
  assert.equal(conversacionesDe(BETO).length, 0)

  // Su vuelta lo trae, y de paso confirma la llegada.
  await unaVueltaDelCartero(BETO)
  const suHilo = await hiloDe(BETO, conversacionesDe(BETO)[0].id)
  assert.equal(suHilo.mensajes.length, 1)
  assert.equal(suHilo.mensajes[0].cuerpo, CON_EMOJIS, 'el texto llega igual, emojis incluidos')
  assert.equal(suHilo.mensajes[0].mio, false)
  assert.equal(avisosDe(BETO).sinLeer, 1)

  // Y Ana ve el segundo tilde.
  en(lanus)
  await unaVueltaDelCartero(ANA)
  assert.equal((await hiloDe(ANA, conversacion.id)).mensajes[0].estado, 'entregado')

  // Beto lo abre: eso es leerlo.
  en(dockSud)
  const conversacionDeBeto = conversacionesDe(BETO)[0].id
  assert.equal(marcarConversacionLeida(BETO, conversacionDeBeto).sinLeer, 0)
  await unaVueltaDelCartero(BETO)

  en(lanus)
  await unaVueltaDelCartero(ANA)
  const final = (await hiloDe(ANA, conversacion.id)).mensajes[0]
  assert.equal(final.estado, 'leido')
  assert.equal(final.acuses.length, 1)
  assert.equal(final.acuses[0].nombre, 'Beto')
  assert.ok(final.acuses[0].leidoEn, 'el acuse dice a qué hora lo leyó')
})

test('el texto llega byte por byte: emojis, pares sustitutos y otros alfabetos', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  const casos = [
    '👍',
    '👨‍👩‍👧‍👦 la familia entera',
    '👍🏽 con tono de piel',
    '❤️ con selector de variación',
    'Ñandú, sanción, ¿cómo estás?',
    'Привет こんにちは 안녕하세요 مرحبا',
    '🚗💥 choque en Pavón y Rivadavia',
  ]

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  for (const caso of casos) encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: caso })
  await unaVueltaDelCartero(ANA)

  en(dockSud)
  await unaVueltaDelCartero(BETO)
  const recibidos = (await hiloDe(BETO, conversacionesDe(BETO)[0].id)).mensajes.map((mensaje) => mensaje.cuerpo)
  assert.deepEqual(recibidos, casos, 'nada se recortó ni se rompió en el camino')
  // Y ninguno trae el rombo del par sustituto partido.
  for (const recibido of recibidos) assert.ok(!recibido.includes('�'), `«${recibido}» llegó con un carácter roto`)
})

test('lo escrito sin internet espera en la cola y sale solo cuando vuelve', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')

  // Se corta internet de verdad: el servidor deja de atender. No se usa `errorFijo` a propósito —un
  // 503 es «el servidor contestó que no» y tiene su propia espera creciente—; lo que se prueba acá es
  // quedarse sin conexión, que NO cuenta como intento fallido y por eso sale apenas vuelve.
  const puerto = Number(new URL(servidor.url).port)
  await servidor.cerrar()
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Che, ¿lo de Pérez lo cerraste? 🤔' })
  await assert.rejects(() => unaVueltaDelCartero(ANA))
  assert.equal((await hiloDe(ANA, conversacion.id)).mensajes[0].estado, 'enCola', 'sigue esperando, no se perdió')
  assert.equal(
    (lanus.db.prepare('SELECT intentos FROM mensajes').get() as { intentos: number }).intentos,
    0,
    'sin internet no se gasta un intento: el servidor nunca dijo que no',
  )

  // Vuelve internet: sale solo, sin que nadie lo vuelva a escribir.
  await servidor.escuchar(puerto)
  await unaVueltaDelCartero(ANA)
  assert.equal((await hiloDe(ANA, conversacion.id)).mensajes[0].estado, 'enviado')

  en(dockSud)
  await unaVueltaDelCartero(BETO)
  assert.equal((await hiloDe(BETO, conversacionesDe(BETO)[0].id)).mensajes[0].cuerpo, 'Che, ¿lo de Pérez lo cerraste? 🤔')
})

test('reintentar un envío cortado no manda el mensaje dos veces', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Una sola vez' })
  await unaVueltaDelCartero(ANA)
  // Se lo devuelve a la cola a mano, como si la respuesta se hubiera perdido en el camino.
  lanus.db.prepare("UPDATE mensajes SET estado = 'enCola'").run()
  await unaVueltaDelCartero(ANA)

  en(dockSud)
  await unaVueltaDelCartero(BETO)
  assert.equal((await hiloDe(BETO, conversacionesDe(BETO)[0].id)).mensajes.length, 1, 'el id lo elige quien manda: reenviar no duplica')
})

test('un mensaje con un archivo sale recién cuando el archivo está arriba, y el otro lo puede abrir', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  const foto = new Uint8Array(Buffer.from('%PDF-1.4\n' + 'x'.repeat(3000)))

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  const mandado = encolarMensaje(ANA, {
    conversacionId: conversacion.id,
    cuerpo: 'Te mando la denuncia 📄',
    archivos: [{ nombre: 'denuncia.pdf', tipo: 'application/pdf', contenido: foto }],
  })
  assert.equal(mandado.adjuntos.length, 1)

  // Con el archivo todavía sin subir, el mensaje NO sale: si saliera, del otro lado aparecería una
  // burbuja con un archivo que no se puede abrir.
  await unaVueltaDelCartero(ANA)
  assert.equal((await hiloDe(ANA, conversacion.id)).mensajes[0].estado, 'enCola')
  assert.equal(servidor.mensajes.length, 0)

  assert.ok(hayAdjuntosPendientes(), 'el archivo está en la cola de subida de siempre')
  await subirAdjuntosPendientes(null)
  await unaVueltaDelCartero(ANA)
  assert.equal((await hiloDe(ANA, conversacion.id)).mensajes[0].estado, 'enviado')

  en(dockSud)
  await unaVueltaDelCartero(BETO)
  const recibido = (await hiloDe(BETO, conversacionesDe(BETO)[0].id)).mensajes[0]
  assert.equal(recibido.adjuntos.length, 1)
  assert.equal(recibido.adjuntos[0].nombre, 'denuncia.pdf')
  assert.equal(recibido.adjuntos[0].descargado, false, 'todavía no está en el disco de Dock Sud')
  assert.equal(recibido.adjuntos[0].enElServidor, true, 'pero se puede bajar cuando lo abran')
})

test('borrar un mensaje lo saca de la conversación y lo deja entero en el registro', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Perdón, era para otra persona' })
  await unaVueltaDelCartero(ANA)

  en(dockSud)
  await unaVueltaDelCartero(BETO)
  const suConversacion = conversacionesDe(BETO)[0].id
  assert.equal((await hiloDe(BETO, suConversacion)).mensajes[0].cuerpo, 'Perdón, era para otra persona')

  en(lanus)
  const mio = (await hiloDe(ANA, conversacion.id)).mensajes[0]
  await eliminarMensajePropio(ANA, mio.id)
  assert.equal((await hiloDe(ANA, conversacion.id)).mensajes[0].cuerpo, '', 'en el chat ya no está')

  // Y el superadministrador lo sigue viendo entero, con la marca de quién lo borró.
  const registro = await registroDeMensajes(DANIEL, { usuario: null, desde: null, hasta: null, texto: '', pagina: 1 })
  assert.equal(registro.total, 1)
  assert.equal(registro.renglones[0].cuerpo, 'Perdón, era para otra persona')
  assert.equal(registro.renglones[0].eliminadoPor, 'ana')
  assert.ok(registro.renglones[0].eliminadoEn)
})

test('el registro es del superadministrador y de nadie más', async (t) => {
  const { servidor, lanus } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Algo privado' })
  await unaVueltaDelCartero(ANA)

  const sinPermiso = { usuario: null, desde: null, hasta: null, texto: '', pagina: 1 }
  await assert.rejects(() => registroDeMensajes(ANA, sinPermiso), /superadministrador/i)
  await assert.rejects(() => registroDeMensajes(BETO, sinPermiso), /superadministrador/i)
  assert.equal((await registroDeMensajes(DANIEL, sinPermiso)).total, 1)
})

test('la conversación entre dos personas es una sola, aunque los dos la abran a la vez', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const deAna = await abrirConversacionCon(ANA, 'beto')
  en(dockSud)
  const deBeto = await abrirConversacionCon(BETO, 'ana')

  assert.equal(deAna.remotoId, deBeto.remotoId, 'las dos computadoras terminan en la misma conversación')
  assert.equal(servidor.conversaciones.size, 1)
})

test('con quién se puede hablar: los usuarios activos, menos uno mismo', async (t) => {
  const { servidor, lanus } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const contactos = contactosDe(ANA).map((contacto) => contacto.clave)
  assert.deepEqual(contactos.sort(), ['beto', 'daniel'])
  await assert.rejects(() => abrirConversacionCon(ANA, 'ana'), /uno mismo/i)
  await assert.rejects(() => abrirConversacionCon(ANA, 'nadie'), /no está en el listado/i)
})

test('en un grupo, el doble tilde en color quiere decir que lo vieron todos', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  // El grupo lo arma Ana con Beto y Daniel. Daniel no tiene computadora en esta prueba: alcanza con
  // que no acuse nada para que el mensaje no llegue nunca a «leído».
  en(lanus)
  const puente = new PuenteDeMensajes({ urlBase: servidor.url, token: TOKEN })
  const grupo = await puente.crearGrupo(
    { clave: 'ana', nombre: 'Ana', rol: 'EMPLEADO' },
    { titulo: 'Mostrador', participantes: [{ clave: 'beto', nombre: 'Beto' }, { clave: 'daniel', nombre: 'Daniel Martínez' }], id: 'grupo-1' },
  )
  await unaVueltaDelCartero(ANA)
  const local = conversacionesDe(ANA).find((conversacion) => conversacion.remotoId === grupo.id)
  assert.ok(local, 'el grupo bajó a la computadora de Ana')
  encolarMensaje(ANA, { conversacionId: local.id, cuerpo: 'Mañana abrimos a las 9 🕘' })
  await unaVueltaDelCartero(ANA)

  // Beto lo lee; Daniel no.
  en(dockSud)
  await unaVueltaDelCartero(BETO)
  const suGrupo = conversacionesDe(BETO).find((conversacion) => conversacion.remotoId === grupo.id)
  assert.ok(suGrupo)
  marcarConversacionLeida(BETO, suGrupo.id)
  await unaVueltaDelCartero(BETO)

  en(lanus)
  await unaVueltaDelCartero(ANA)
  const mensaje = (await hiloDe(ANA, local.id)).mensajes.at(-1)
  assert.ok(mensaje)
  assert.equal(mensaje.acuses.length, 2, 'un acuse por cada destinatario')
  assert.equal(mensaje.estado, 'enviado', 'uno lo leyó y el otro ni lo recibió: vale el que menos avanzó')
})

test('una computadora recién instalada ve la conversación entera, no sólo lo que llega desde ahora', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  // Ana y Beto hablan un rato desde sus dos computadoras de siempre.
  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Primero' })
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Segundo 👍' })
  await unaVueltaDelCartero(ANA)
  en(dockSud)
  await unaVueltaDelCartero(BETO)
  const deBeto = conversacionesDe(BETO)[0].id
  encolarMensaje(BETO, { conversacionId: deBeto, cuerpo: 'Tercero, dale' })
  await unaVueltaDelCartero(BETO)
  en(lanus)
  await unaVueltaDelCartero(ANA)

  // Aparece una computadora nueva y Ana entra ahí por primera vez. El reparto sólo entrega lo
  // PENDIENTE, así que sin traer el historial esta pantalla se vería vacía.
  const recienInstalada = computadora('Sarandí')
  en(recienInstalada)
  await unaVueltaDelCartero(ANA)
  const suConversacion = conversacionesDe(ANA)[0]
  assert.ok(suConversacion, 'la conversación bajó')

  const hilo = await hiloDe(ANA, suConversacion.id)
  assert.deepEqual(
    hilo.mensajes.map((mensaje) => mensaje.cuerpo),
    ['Primero', 'Segundo 👍', 'Tercero, dale'],
    'están los tres, en orden, incluidos los que escribió ella misma desde la otra computadora',
  )
  assert.equal(hilo.mensajes[0].mio, true)
  assert.equal(hilo.mensajes[2].mio, false)
})

test('se manda con la MISMA forma con la que llama la pantalla, con la lista de archivos vacía', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  // Esta prueba existe por un error de verdad: la pantalla manda SIEMPRE `archivos`, con la lista
  // vacía cuando no se arrastró nada, y el envío moría antes de mirar el texto porque el validador de
  // adjuntos —el de las pantallas donde adjuntar es la acción— trata la lista vacía como un error
  // («No elegiste ningún archivo»). No salía ni un mensaje de texto. Las pruebas no lo vieron porque
  // llamaban al servicio sin la clave `archivos`, que no es como llama la aplicación.
  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')

  const soloTexto = encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Sin adjuntos', archivos: [] })
  assert.equal(soloTexto.adjuntos.length, 0)
  // Y con las rutas vacías además, que es como llega el otro camino de la pantalla.
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Tampoco acá', archivos: [], rutas: [] })

  // Un mensaje sin texto Y sin archivos sigue siendo un error: lo vacío es vacío.
  assert.throws(
    () => encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: '   ', archivos: [] }),
    /vacío/i,
  )

  await unaVueltaDelCartero(ANA)
  en(dockSud)
  await unaVueltaDelCartero(BETO)
  const recibidos = (await hiloDe(BETO, conversacionesDe(BETO)[0].id)).mensajes.map((mensaje) => mensaje.cuerpo)
  assert.deepEqual(recibidos, ['Sin adjuntos', 'Tampoco acá'])
})

// ---------------------------------------------------------------------------
// El zumbido
// ---------------------------------------------------------------------------

test('el zumbido llega del otro lado, queda en el hilo de los dos y no lleva texto', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  const zumbido = await zumbar(ANA, conversacion.id)

  // No pasa por la cola: cuando `zumbar` devuelve, el servidor YA lo tiene. Es toda la diferencia con
  // un mensaje escrito, y es lo que hace que sirva para llamar la atención.
  assert.equal(zumbido.tipo, 'ZUMBIDO')
  assert.equal(zumbido.estado, 'enviado', 'salió en el momento, no quedó esperando al cartero')
  assert.equal(zumbido.cuerpo, '', 'un zumbido no lleva texto')
  assert.equal(zumbido.adjuntos.length, 0)

  en(dockSud)
  await unaVueltaDelCartero(BETO)
  const suHilo = await hiloDe(BETO, conversacionesDe(BETO)[0].id)
  assert.equal(suHilo.mensajes.length, 1)
  assert.equal(suHilo.mensajes[0].tipo, 'ZUMBIDO', 'del otro lado también es un zumbido y no un mensaje vacío')
  assert.equal(suHilo.mensajes[0].mio, false)
  assert.equal(suHilo.mensajes[0].autorNombre, 'Ana')
  // En la lista de conversaciones se lee como lo que es, no como «0 archivos».
  assert.equal(conversacionesDe(BETO)[0].ultimoTexto, 'Zumbido')
  // Y NO deja un globito rojo: ya se anunció mucho más fuerte que eso, y si contara, la campana
  // sonaría encima del zumbido —dos avisos pisados por una sola cosa—.
  assert.equal(conversacionesDe(BETO)[0].sinLeer, 0)
  assert.equal(avisosDe(BETO).sinLeer, 0)

  // Y tiene sus acuses como cualquier mensaje: el zumbido también se entrega.
  en(lanus)
  await unaVueltaDelCartero(ANA)
  const desdeAna = (await hiloDe(ANA, conversacion.id)).mensajes[0]
  assert.equal(desdeAna.estado, 'entregado')

  // Abrir la conversación sí lo marca leído: el que zumbó tiene que ver el tilde cuando el otro miró.
  en(dockSud)
  marcarConversacionLeida(BETO, conversacionesDe(BETO)[0].id)
  await unaVueltaDelCartero(BETO)
  en(lanus)
  await unaVueltaDelCartero(ANA)
  assert.equal((await hiloDe(ANA, conversacion.id)).mensajes[0].estado, 'leido')
})

test('no se pueden mandar dos zumbidos seguidos, y después de la espera sí', async (t) => {
  const { servidor, lanus } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  await zumbar(ANA, conversacion.id)

  await assert.rejects(() => zumbar(ANA, conversacion.id), /esperá/i, 'el segundo seguido no sale')

  // Con la espera cumplida sí. Se simula corriendo hacia atrás la hora del que ya está guardado, que
  // es lo mismo que mirar el reloj diez segundos después sin tener que esperarlos.
  servidor.esperaEntreZumbidosMs = 0
  lanus.db
    .prepare("UPDATE mensajes SET creado_en = ? WHERE tipo = 'ZUMBIDO'")
    .run(new Date(Date.now() - 60_000).toISOString())
  const segundo = await zumbar(ANA, conversacion.id)
  assert.equal(segundo.tipo, 'ZUMBIDO')
})

test('el zumbido queda en el registro del superadministrador', async (t) => {
  const { servidor, lanus } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  await zumbar(ANA, conversacion.id)

  const registro = await registroDeMensajes(DANIEL, { usuario: '', desde: null, hasta: null, texto: '', pagina: 1 })
  assert.equal(registro.renglones.length, 1)
  // El registro lo dice con todas las letras: sin esto el renglón vendría con el cuerpo vacío y el
  // superadministrador vería una fila en blanco, que es peor que no verla.
  assert.equal(registro.renglones[0].claseDeMensaje, 'ZUMBIDO')
  assert.equal(registro.renglones[0].cuerpo, '')
  assert.equal(registro.renglones[0].autorClave, 'ana')
})

test('sin conexión el zumbido no espera en la cola: avisa que no se pudo', async (t) => {
  const { servidor, lanus } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')

  // Sin puente configurado —una computadora sin la conexión del servidor cargada— mandar un mensaje
  // sigue funcionando (espera en la cola) y zumbar no: un zumbido que llega media hora tarde sacude
  // una ventana por algo que ya pasó.
  usarPuenteDeMensajesDePrueba(null)
  const escrito = encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Esto sí espera' })
  assert.equal(escrito.estado, 'enCola')
  await assert.rejects(() => zumbar(ANA, conversacion.id), /conexión/i)
})

// Las reacciones de WhatsApp (14.0). Lo que se prueba acá es la SUBIDA: que el clic en un emoji llegue
// al servidor por la ruta y con los nombres de campo que el servidor espera, y que la regla del
// interruptor —una persona reacciona UNA vez a cada mensaje— la cumplan los dos lados y no sólo el
// espejo. La bajada por el canal (que del otro lado aparezca sola) está en `vivo.prueba.ts`.
test('la reacción es un interruptor: el mismo emoji la saca y otro la reemplaza', async (t) => {
  const { servidor, lanus, dockSud } = await dosComputadoras()
  t.after(async () => {
    cerrarTodo()
    await servidor.cerrar()
  })

  en(lanus)
  const conversacion = await abrirConversacionCon(ANA, 'beto')
  encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'Llegó el pago de Pérez' })
  await unaVueltaDelCartero(ANA)

  en(dockSud)
  await unaVueltaDelCartero(BETO)
  const suConversacion = conversacionesDe(BETO)[0].id
  const mensaje = (await hiloDe(BETO, suConversacion)).mensajes[0]
  assert.deepEqual(mensaje.reacciones, [], 'todavía no reaccionó nadie')

  // Un pulgar. Vuelve la lista COMPLETA del mensaje —no el cambio— y ya viene con el nombre para el
  // globito y con `mia`, que es lo que resalta la pastilla propia.
  const conPulgar = await reaccionarA(BETO, mensaje.id, '👍')
  assert.deepEqual(conPulgar.reacciones, [{ emoji: '👍', claves: ['beto'], nombres: ['Beto'], mia: true }])
  assert.deepEqual(servidor.reaccionesDe(mensaje.remotoId!), [{ emoji: '👍', claves: ['beto'] }])

  // El mismo emoji otra vez la saca: es tocar la pastilla propia.
  assert.deepEqual((await reaccionarA(BETO, mensaje.id, '👍')).reacciones, [])
  assert.deepEqual(servidor.reaccionesDe(mensaje.remotoId!), [])

  // Y otro emoji REEMPLAZA al que había, no se suma: una persona reacciona una vez a cada mensaje.
  await reaccionarA(BETO, mensaje.id, '👍')
  const cambiada = await reaccionarA(BETO, mensaje.id, '❤️')
  assert.deepEqual(cambiada.reacciones, [{ emoji: '❤️', claves: ['beto'], nombres: ['Beto'], mia: true }])

  // `null` la saca también: es lo que manda la pantalla al tocar la pastilla propia de la fila de abajo.
  assert.deepEqual((await reaccionarA(BETO, mensaje.id, null)).reacciones, [])

  // A lo que todavía no salió de esta computadora no se le puede reaccionar: el servidor no lo conoce
  // y la pastilla quedaría puesta contra un id que no existe.
  en(lanus)
  servidor.errorFijo = { estado: 503, mensaje: 'apagado' }
  const enCola = encolarMensaje(ANA, { conversacionId: conversacion.id, cuerpo: 'esto no sale' })
  servidor.errorFijo = null
  await assert.rejects(reaccionarA(ANA, enCola.id, '👍'), /todavía no salió/)
})
