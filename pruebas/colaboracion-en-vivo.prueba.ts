// La colaboración en vivo del proceso principal, SIN socket (14.0): el espejo de los perfiles, las
// reacciones que se guardan con el mensaje, la máquina de estados de las llamadas y el foco de la
// presencia.
//
// Por qué acá y no en `vivo.prueba.ts`: allá se levantan dos computadoras con un WebSocket cada una
// contra el simulador, que es lo que prueba el PROTOCOLO —el saludo, la difusión, la reconexión—. Acá
// se prueban las decisiones que toma esta computadora sola y que ninguna prueba de punta a punta puede
// afirmar con precisión: que una versión vieja de un perfil no pisa a la nueva, que una segunda llamada
// se rechaza por ocupado sin tocar la que está en curso, que el canal caído NO corta el audio en el
// acto, y que moverse por la planilla manda un solo frame de foco con lo último. Es el mismo reparto
// que hay entre `sincronizacion-en-vivo.prueba.ts` y `vivo.prueba.ts`.
//
// El canal es de mentira a propósito (`canalDeMentira`): lo que se afirma es QUÉ frame sale, no que el
// socket lo lleve.
//
// Y al final están las reglas PURAS de la pantalla —las frases del glow, qué se guarda al salir de un
// campo, hacia dónde se abre el cajón de emojis—. Viven en archivos sin una línea de React justamente
// para poder probarse acá: el banco corre en Node pelado y no monta ningún componente.
import assert from 'node:assert/strict'
import test from 'node:test'
import { usarBaseDeDatos } from '../src/main/db/base'
import { guardarPerfil, guardarPerfiles, perfilesLocales } from '../src/main/usuarios/perfiles'
import { aplicarReaccionesRemotas, guardarConversacion, guardarMensaje, hiloDe } from '../src/main/servicios/mensajeria'
import {
  aceptarLlamada,
  colgarPorCierre,
  elCanalSeCorto,
  elCanalVolvio,
  estadoDeLaLlamada,
  invitarALlamar,
  olvidarLasLlamadas,
  recibirEventoDeLlamada,
} from '../src/main/vivo/llamadas'
import { usarCanalActivo } from '../src/main/vivo/emisor'
import { motivoDelBloqueo, seGuardaAlSalir, textoDePresencia } from '../src/renderer/componentes/presencia-reglas'
import { duracionLegible, fraseDelCorte } from '../src/renderer/componentes/llamada-reglas'
import { ALTO_DEL_CAJON_DE_EMOJIS, haciaDondeSeAbre } from '../src/renderer/pantallas/mensajes/emojis'
import { olvidarLaPresencia, reenviarElFoco, reportarFoco } from '../src/main/vivo/presencia'
import type { DelCliente, Presente } from '../src/main/vivo/protocolo'
import { claveDeCelda, claveDeFilaDeCelda, claveDeObjeto, indexarPresencia, mismaFoto } from '../src/shared/presencia'
import { obtenerIniciales } from '../src/shared/texto'
import type { SesionUsuario } from '../src/shared/tipos'
import { baseDePrueba } from './ayuda'

const ANA: SesionUsuario = {
  id: 1,
  nombre: 'Ana Ruiz',
  usuario: 'ana',
  rol: 'EMPLEADO',
  sucursal: { id: 1, nombre: 'Lanús' },
  debeCambiarClave: false,
}

const FOTO = 'data:image/jpeg;base64,' + Buffer.from('unos bytes de jpeg').toString('base64')

function esperar(ms: number): Promise<void> {
  return new Promise((seguir) => setTimeout(seguir, ms))
}

/** Un canal de mentira: anota lo que se manda. */
function canalDeMentira(): { mandados: DelCliente[]; soltar: () => void } {
  const mandados: DelCliente[] = []
  usarCanalActivo({
    enviar(mensaje) {
      mandados.push(mensaje)
      return true
    },
  })
  return { mandados, soltar: () => usarCanalActivo(null) }
}

test('perfiles: el espejo guarda la foto como bytes y la devuelve como data URL', () => {
  const db = baseDePrueba()
  usarBaseDeDatos(db)

  guardarPerfiles([
    { clave: 'ana', color: 3, foto: FOTO, version: 2, actualizadoEn: '2026-09-10T10:00:00.000Z' },
    { clave: 'beto', color: 5, foto: null, version: 1, actualizadoEn: '2026-09-10T10:00:00.000Z' },
  ])
  assert.deepEqual(perfilesLocales(), [
    { clave: 'ana', color: 3, foto: FOTO, version: 2 },
    { clave: 'beto', color: 5, foto: null, version: 1 },
  ])

  // Una versión vieja no pisa a la nueva.
  guardarPerfil({ clave: 'ana', color: 9, foto: null, version: 1, actualizadoEn: '2026-09-10T09:00:00.000Z' })
  assert.equal(perfilesLocales().find((p) => p.clave === 'ana')?.color, 3)
  guardarPerfil({ clave: 'ana', color: 9, foto: null, version: 3, actualizadoEn: '2026-09-10T11:00:00.000Z' })
  assert.equal(perfilesLocales().find((p) => p.clave === 'ana')?.color, 9)

  // La lista entera manda: el que no está, se va.
  guardarPerfiles([{ clave: 'beto', color: 5, foto: null, version: 1, actualizadoEn: '2026-09-10T10:00:00.000Z' }])
  assert.deepEqual(perfilesLocales().map((p) => p.clave), ['beto'])
  db.close()
})

test('reacciones: el hilo las muestra agrupadas y sabe cuál es mía', async () => {
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  guardarConversacion({
    id: 'c1',
    tipo: 'DIRECTA',
    titulo: null,
    participantes: [
      { clave: 'ana', nombre: 'Ana Ruiz', salioEn: null },
      { clave: 'beto', nombre: 'Beto Díaz', salioEn: null },
    ],
    creadoPor: 'ana',
    creadoEn: 'hoy',
    ultimoMensajeEn: null,
  })
  guardarMensaje(
    {
      id: 'm1',
      conversacionId: 'c1',
      orden: 1,
      autorClave: 'beto',
      autorNombre: 'Beto Díaz',
      cuerpo: 'mirá esto',
      creadoEn: 'hoy',
      enviadoEn: 'hoy',
      eliminadoEn: null,
      adjuntos: [],
      acuses: [],
      reacciones: [{ emoji: '👍', claves: ['ana', 'beto'] }],
    },
    'ana',
  )
  const hilo = await hiloDe(ANA, 1)
  assert.deepEqual(hilo.mensajes[0]!.reacciones, [
    { emoji: '👍', claves: ['ana', 'beto'], nombres: ['Ana Ruiz', 'Beto Díaz'], mia: true },
  ])

  // Lo que llega por el canal reemplaza la lista entera.
  assert.equal(aplicarReaccionesRemotas('m1', [{ emoji: '❤️', claves: ['beto'] }]), true)
  const despues = await hiloDe(ANA, 1)
  assert.deepEqual(despues.mensajes[0]!.reacciones, [
    { emoji: '❤️', claves: ['beto'], nombres: ['Beto Díaz'], mia: false },
  ])
  assert.equal(aplicarReaccionesRemotas('no-existe', []), false)

  // Y una llamada se puede guardar: el CHECK de la migración 29.
  const id = guardarMensaje(
    {
      id: 'm2',
      tipo: 'LLAMADA',
      conversacionId: 'c1',
      orden: 2,
      autorClave: 'beto',
      autorNombre: 'Beto Díaz',
      cuerpo: 'Llamada de voz · 3:12',
      creadoEn: 'hoy',
      enviadoEn: 'hoy',
      eliminadoEn: null,
      adjuntos: [],
      acuses: [],
    },
    'ana',
  )
  assert.ok(id)
  assert.equal((await hiloDe(ANA, 1)).mensajes[1]!.tipo, 'LLAMADA')
  db.close()
})

test('llamadas: una sola por computadora, y el canal caído no corta el audio en el acto', async () => {
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  guardarConversacion({
    id: 'c1',
    tipo: 'DIRECTA',
    titulo: null,
    participantes: [
      { clave: 'ana', nombre: 'Ana Ruiz', salioEn: null },
      { clave: 'beto', nombre: 'Beto Díaz', salioEn: null },
    ],
    creadoPor: 'ana',
    creadoEn: 'hoy',
    ultimoMensajeEn: null,
  })
  const canal = canalDeMentira()

  const estado = invitarALlamar(ANA, 1)
  assert.equal(estado.situacion, 'llamando')
  assert.equal(estado.con?.clave, 'beto')
  assert.deepEqual(canal.mandados.at(-1), {
    t: 'llamada',
    evento: { tipo: 'invitar', llamadaId: estado.llamadaId!, para: 'beto', conversacionId: 'c1' },
  })

  assert.throws(() => invitarALlamar(ANA, 1), /Ya hay una llamada en curso/)

  // Entra otra mientras ésta está en curso: se rechaza por ocupado sin tocar la que está.
  recibirEventoDeLlamada({ tipo: 'timbrar', llamadaId: 'otra', de: { clave: 'caro', nombre: 'Caro' }, conversacionId: 'c9' })
  assert.deepEqual(canal.mandados.at(-1), {
    t: 'llamada',
    evento: { tipo: 'rechazar', llamadaId: 'otra', motivo: 'ocupado' },
  })
  assert.equal(estadoDeLaLlamada().llamadaId, estado.llamadaId)

  recibirEventoDeLlamada({ tipo: 'aceptar', llamadaId: estado.llamadaId! })
  assert.equal(estadoDeLaLlamada().situacion, 'en-llamada')
  assert.ok(estadoDeLaLlamada().hablandoDesde)

  // El canal se cae: el audio sigue.
  elCanalSeCorto()
  await esperar(50)
  assert.equal(estadoDeLaLlamada().situacion, 'en-llamada')

  // Cerrar el programa cuelga y avisa.
  colgarPorCierre()
  assert.deepEqual(canal.mandados.at(-1), {
    t: 'llamada',
    evento: { tipo: 'colgar', llamadaId: estado.llamadaId!, motivo: 'terminada' },
  })
  assert.equal(estadoDeLaLlamada().situacion, 'libre')
  assert.equal(estadoDeLaLlamada().motivo, 'terminada')

  // Una que suena y se corta el canal antes de atender no sobrevive.
  recibirEventoDeLlamada({ tipo: 'timbrar', llamadaId: 'l2', de: { clave: 'caro', nombre: 'Caro' }, conversacionId: 'c9' })
  assert.equal(estadoDeLaLlamada().situacion, 'timbrando')
  elCanalSeCorto()
  assert.equal(estadoDeLaLlamada().situacion, 'libre')
  assert.equal(estadoDeLaLlamada().motivo, 'desconexion')

  // Y atender sin nada sonando es un error de negocio.
  assert.throws(() => aceptarLlamada(), /No hay ninguna llamada sonando/)

  olvidarLasLlamadas()
  canal.soltar()
  db.close()
})

// El agujero que dejaba a una computadora hablando sola. El aguante de los quince segundos se pensó
// para el parpadeo de wifi que se arregla ANTES de que el servidor note el cierre; pero cuando el
// socket sí se cierra, el hub cierra la llamada, libera el «ocupado» y le manda `colgar {desconexion}`
// a la otra punta, que tira abajo su `RTCPeerConnection`. La reconexión trae un `conexionId` nuevo y el
// saludo no dice una palabra de llamadas: no hay nada que retomar. Que el servidor hace eso lo prueba
// `vivo.prueba.ts` («la que se corta el cable no queda abierta»); lo que se prueba acá es que esta
// computadora saca la conclusión correcta.
test('llamadas: la llamada NO sobrevive a la reconexión del canal', async () => {
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  guardarConversacion({
    id: 'c1',
    tipo: 'DIRECTA',
    titulo: null,
    participantes: [
      { clave: 'ana', nombre: 'Ana Ruiz', salioEn: null },
      { clave: 'beto', nombre: 'Beto Díaz', salioEn: null },
    ],
    creadoPor: 'ana',
    creadoEn: 'hoy',
    ultimoMensajeEn: null,
  })
  const canal = canalDeMentira()

  const estado = invitarALlamar(ANA, 1)
  recibirEventoDeLlamada({ tipo: 'aceptar', llamadaId: estado.llamadaId! })
  assert.equal(estadoDeLaLlamada().situacion, 'en-llamada')

  // Se cae el canal: el audio sigue, porque va punto a punto y el corte todavía no está decidido.
  elCanalSeCorto()
  assert.equal(estadoDeLaLlamada().situacion, 'en-llamada')

  // Y vuelve. Antes de la corrección, acá se cancelaba el reloj y esta computadora se quedaba con la
  // barra verde puesta y el cronómetro corriendo, sin voz de nadie, sin poder llamar y rechazando por
  // «ocupado» todo lo que entrara, hasta que la persona apretara «Cortar» a mano.
  const mandadosAntes = canal.mandados.length
  elCanalVolvio()
  assert.equal(estadoDeLaLlamada().situacion, 'libre')
  assert.equal(estadoDeLaLlamada().motivo, 'desconexion')
  assert.equal(canal.mandados.length, mandadosAntes, 'no se le avisa al otro: para el hub nuevo esa llamada no existe')

  // Y sin ninguna llamada esperando, volver a conectarse no toca nada: es el saludo de todos los días.
  recibirEventoDeLlamada({ tipo: 'timbrar', llamadaId: 'l9', de: { clave: 'caro', nombre: 'Caro' }, conversacionId: 'c9' })
  elCanalVolvio()
  assert.equal(estadoDeLaLlamada().situacion, 'timbrando')

  olvidarLasLlamadas()
  canal.soltar()
  db.close()
})

test('presencia: el foco sale una sola vez con lo último y se reenvía al reconectar', async () => {
  const canal = canalDeMentira()
  reportarFoco({ tipo: 'celda', pestana: 'AGOSTO 2026', filaId: 'id-1', campo: 'cuota', editando: false })
  reportarFoco({ tipo: 'celda', pestana: 'AGOSTO 2026', filaId: 'id-1', campo: 'cuota', editando: true })
  assert.equal(canal.mandados.length, 0, 'todavía no salió nada')
  await esperar(160)
  assert.equal(canal.mandados.length, 1)
  assert.deepEqual(canal.mandados[0], {
    t: 'foco',
    foco: { tipo: 'celda', pestana: 'AGOSTO 2026', filaId: 'id-1', campo: 'cuota', editando: true },
  })

  reenviarElFoco()
  assert.equal(canal.mandados.length, 2)

  olvidarLaPresencia()
  reenviarElFoco()
  assert.equal(canal.mandados.length, 2, 'sin foco no se reenvía nada')
  canal.soltar()
})

// ---------------------------------------------------------------------------
// Lo que la pantalla hace con la presencia que llega (14.0)
// ---------------------------------------------------------------------------
//
// Estas tres son puras y viven en `shared` justamente para poder probarse acá: el banco no monta
// React, así que lo que se afirma es el cálculo —qué clave le toca a cada persona y qué dos letras
// dibuja el avatar—, no el dibujo.

/** Una conexión viva de mentira, con el foco que interese. */
function presente(clave: string, foco: Presente['foco'], color = 0): Presente {
  return { conexionId: `c-${clave}`, clave, nombre: clave.toUpperCase(), sucursal: 'Lanús', color, foco, desde: '2026-01-01T10:00:00.000Z' }
}

test('una celda enfocada también enciende el renglón entero', () => {
  const indice = indexarPresencia([presente('ana', { tipo: 'celda', pestana: 'AGOSTO 2026', filaId: 'F-9', campo: 'cuota', editando: true })])

  // La celda, que es lo que dibuja el anillo en la planilla…
  assert.deepEqual(
    indice.get(claveDeCelda('F-9', 'cuota'))?.map((p) => p.clave),
    ['ana'],
  )
  // …y la fila, que es lo que dibuja el anillo en Mora, en Deudores y en el panel de detalle. Sin
  // esto, la persona que está por tocar el renglón en Mora no vería nada.
  assert.deepEqual(
    indice.get(claveDeFilaDeCelda('F-9'))?.map((p) => p.clave),
    ['ana'],
  )
  // Y no se anota en ninguna otra celda de la misma fila.
  assert.equal(indice.get(claveDeCelda('F-9', 'nombre')), undefined)
})

test('dos personas en el mismo lugar quedan juntas y las que no tienen foco no se anotan', () => {
  const clave = claveDeObjeto('cliente', 'C-1')
  const indice = indexarPresencia([
    presente('ana', { tipo: 'objeto', objeto: 'cliente', filaId: 'C-1', editando: false }),
    presente('beto', { tipo: 'objeto', objeto: 'cliente', filaId: 'C-1', editando: true }, 1),
    // Recién conectada, todavía sin abrir nada: no puede aparecer en ningún lado de la pantalla.
    presente('caro', null, 2),
  ])

  assert.deepEqual(
    indice.get(clave)?.map((p) => p.clave),
    ['ana', 'beto'],
    'los dos que están en la ficha, en el orden en que vinieron',
  )
  // El que traba es el primero que esté editando: Ana está mirando, Beto está escribiendo.
  assert.equal(indice.get(clave)?.find((p) => p.foco?.tipo === 'objeto' && p.foco.editando)?.clave, 'beto')
  assert.equal(indice.size, 1, 'la que no tiene foco no agrega ninguna clave')
})

test('las iniciales del avatar son la primera y la última palabra, sin partir emojis', () => {
  assert.equal(obtenerIniciales('Ana Gómez'), 'AG')
  // La última y no la segunda: así se la nombra en la agencia.
  assert.equal(obtenerIniciales('María de los Ángeles Pérez'), 'MP')
  assert.equal(obtenerIniciales('  ana  '), 'A')
  assert.equal(obtenerIniciales(''), '?')
  // Un nombre pegado desde otro lado puede arrancar con un emoji: sale entero o no sale, nunca medio
  // par sustituto (ver el encabezado de shared/texto.ts).
  assert.equal(obtenerIniciales('👍 Ana Gómez'), '👍G')
})

// Las frases y la regla del guardado viven en `renderer/componentes/presencia-reglas.ts`, sin una línea
// de React, justamente para poder afirmarlas acá: el banco no monta pantallas.

test('el cartel del glow dice quién está y con qué verbo, y corta la lista en el tercero', () => {
  assert.equal(textoDePresencia([]), '', 'sin nadie no se dibuja ningún cartel')
  assert.equal(textoDePresencia([presente('ana', { tipo: 'objeto', objeto: 'cliente', filaId: 'C-1', editando: false })]), 'ANA está mirando')
  assert.equal(textoDePresencia([presente('ana', { tipo: 'objeto', objeto: 'cliente', filaId: 'C-1', editando: true })]), 'ANA está editando')

  // El verbo lo decide si ALGUNA está editando: es lo que cambia lo que se puede hacer.
  const mirando = presente('ana', { tipo: 'objeto', objeto: 'cliente', filaId: 'C-1', editando: false })
  const editando = presente('beto', { tipo: 'objeto', objeto: 'cliente', filaId: 'C-1', editando: true }, 1)
  assert.equal(textoDePresencia([mirando, editando]), 'ANA y BETO están editando')

  // Estar en el módulo no es ni mirar ni editar esto: es estar en la pantalla, nada más.
  assert.equal(textoDePresencia([presente('ana', { tipo: 'modulo', modulo: 'cartera' })]), 'ANA está mirando')

  // Del tercero en adelante se cuentan: cuatro nombres no entran en el encabezado de una ficha.
  const caro = presente('caro', { tipo: 'objeto', objeto: 'cliente', filaId: 'C-1', editando: false }, 2)
  assert.equal(textoDePresencia([mirando, editando, caro]), 'ANA y 2 más están editando')
})

test('el motivo del bloqueo nombra a la persona y dice qué hacer', () => {
  const quien = presente('ana', { tipo: 'objeto', objeto: 'cliente', filaId: 'C-1', editando: true })
  const motivo = motivoDelBloqueo(quien)
  assert.match(motivo, /^ANA está editando esto ahora mismo\./, 'arranca con el nombre: es lo primero que se busca')
  // Y dice que se destraba solo: el bloqueo es suave y esperar alcanza. Sin esto, la persona sale a
  // buscar a la otra por la agencia o llama por teléfono.
  assert.match(motivo, /probá en un ratito/)
})

test('el candado suave no decide el guardado del panel de detalle: lo decide el de cuando se entró', () => {
  // Se entró al campo con la fila libre y se tipeó: se guarda, aunque para cuando se sale otra
  // computadora ya haya entrado a la fila. El choque lo resuelve el 409 del `previo`; tirar lo escrito
  // en silencio, no.
  assert.equal(seGuardaAlSalir(false, '11-2345-6789', ''), true)
  // Se entró con la fila ya trabada (o sin permiso de edición): el campo estaba en sólo lectura y no
  // hay nada que guardar.
  assert.equal(seGuardaAlSalir(true, '11-2345-6789', ''), false)
  // Y entrar y salir sin tocar nada no escribe: cada guardado deja un renglón en el historial de la fila.
  assert.equal(seGuardaAlSalir(false, 'Pérez Juan', 'Pérez Juan'), false)
})

test('una foto de presencia que no cambia nada de lo que se dibuja se reconoce como la misma', () => {
  const enLaCelda = () => presente('ana', { tipo: 'celda', pestana: 'AGOSTO 2026', filaId: 'F-9', campo: 'cuota', editando: false })

  // El caso que importa: el servidor manda la foto ENTERA en cada cambio y casi siempre viene igual.
  assert.equal(mismaFoto([enLaCelda()], [enLaCelda()]), true, 'dos objetos distintos con lo mismo adentro')
  // `desde` es una hora y vuelve distinta en cada reconexión: mirarla haría que esto no sirviera nunca.
  assert.equal(mismaFoto([enLaCelda()], [{ ...enLaCelda(), desde: '2026-09-10T18:00:00.000Z' }]), true)

  // Y todo lo que sí se dibuja tiene que contar como un cambio.
  assert.equal(mismaFoto([enLaCelda()], []), false, 'se fue')
  assert.equal(mismaFoto([enLaCelda()], [{ ...enLaCelda(), color: 4 }]), false, 'cambió el color del anillo')
  assert.equal(mismaFoto([enLaCelda()], [{ ...enLaCelda(), nombre: 'Ana Ruiz' }]), false, 'cambió el nombre de la burbuja')
  assert.equal(
    mismaFoto([enLaCelda()], [presente('ana', { tipo: 'celda', pestana: 'AGOSTO 2026', filaId: 'F-9', campo: 'pago', editando: false })]),
    false,
    'se movió de celda',
  )
  // Pasar de mirar a editar no mueve el anillo de lugar, pero traba la fila en las otras computadoras:
  // es el cambio más importante de todos y el más fácil de dejar afuera de una comparación.
  assert.equal(
    mismaFoto([enLaCelda()], [presente('ana', { tipo: 'celda', pestana: 'AGOSTO 2026', filaId: 'F-9', campo: 'cuota', editando: true })]),
    false,
    'empezó a escribir',
  )
})

test('el cajón de emojis se abre para el lado donde hay lugar, no siempre hacia arriba', () => {
  const alto = ALTO_DEL_CAJON_DE_EMOJIS

  // La caja de escribir: está abajo de todo del hilo y arriba sobra lugar. Es donde estaba y donde se
  // queda: con lugar en los dos lados gana arriba.
  assert.equal(haciaDondeSeAbre(600, 40, alto), 'arriba')
  assert.equal(haciaDondeSeAbre(alto, alto, alto), 'arriba', 'justo justo también entra')

  // El caso que se rompía: la barra de reacciones del primer mensaje de una conversación nueva. El
  // mensaje se apoya en el borde de arriba del hilo, así que abriendo hacia arriba el cajón se salía
  // por un lugar que no se puede alcanzar desplazando (el `scrollTop` no puede ser negativo).
  assert.equal(haciaDondeSeAbre(60, 500, alto), 'abajo')

  // Y el mensaje de más abajo del hilo, con la fila de acciones pegada a la caja de escribir.
  assert.equal(haciaDondeSeAbre(500, 60, alto), 'arriba')

  // Una ventana chiquita donde no entra de ningún lado: se elige el lado más grande, que al menos deja
  // ver el buscador y unas filas de emojis en vez de una franja de treinta píxeles.
  assert.equal(haciaDondeSeAbre(100, 200, alto), 'abajo')
  assert.equal(haciaDondeSeAbre(200, 100, alto), 'arriba')
})

test('el cartel de la llamada dice por qué se cortó, y se calla cuando fui yo el que cortó', () => {
  // Las tres que la persona NO puede distinguir sola: la barra verde aparece y desaparece en menos de
  // un segundo y sin esto las tres se ven igual.
  assert.match(fraseDelCorte('ocupado')!, /hablando por teléfono/i)
  assert.match(fraseDelCorte('rechazada')!, /no puede atender/i)
  assert.match(fraseDelCorte('desconexion')!, /se cortó la conexión/i)
  assert.match(fraseDelCorte('sin-respuesta')!, /no atendió/i)

  // Y las dos que ya sabe porque las hizo ella: colgar y cancelar no dicen nada.
  assert.equal(fraseDelCorte('terminada'), null)
  assert.equal(fraseDelCorte('cancelada'), null)
  assert.equal(fraseDelCorte(null), null)
})

test('el cronómetro de la llamada se lee como el de un teléfono', () => {
  assert.equal(duracionLegible(0), '0:00')
  assert.equal(duracionLegible(9), '0:09', 'los segundos siempre con dos dígitos')
  assert.equal(duracionLegible(192), '3:12')
  assert.equal(duracionLegible(3600), '60:00', 'una hora se cuenta en minutos: no hay charla de dos')
})
