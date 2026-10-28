// El servidor de la versión de demostración (src/main/demo/servidor.ts): lo que tiene sembrado y los
// compañeros virtuales que mantienen vivo el chat.
//
// Lo que se cuida acá es lo que el QA de la demo encontró roto y no se ve mirando el código:
//
// - Los ajustes sembrados (comisiones, encabezado del ticket, listas del módulo Compañías) se ADOPTAN en
//   una base de verdad y, una vez adoptados, la huella local da IGUAL a la del servidor. Si no, cada
//   pantalla abría con el cartel amarillo de «desactualizada» aunque nadie hubiera tocado nada.
// - Cada usuario entra con algo sin leer, y la primera vuelta del reparto le trae el último mensaje de
//   CADA conversación (si no, la lista decía «Sin mensajes»).
// - Lucía y Jorge aparecen en línea, leen, contestan y rechazan una llamada; y se apartan si quien prueba
//   la demo entra como ellos.
// - «Leer las APIs ahora» devuelve una lectura.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import { armarDatosDeLaDemo } from '../src/main/demo/datos'
import { NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO, refirmarPlantillas } from '../src/main/demo/identidad'
import { arrancarServidorDeLaDemo, credencialesDeLaDemo, pararServidorDeLaDemo } from '../src/main/demo/servidor'
import { PuenteDeMensajes, type ActorDelPuente } from '../src/main/mensajeria/puente'
import { adoptarCompanias, valorCompartidoDeCompanias } from '../src/main/servicios/companias'
import { filasDesde } from '../src/main/servicios/estadoDeActualizaciones'
import { adoptarInstantanea, huellaDeReferencias, instantaneaDeReferencias } from '../src/main/servicios/referenciasCompartidas'
import { adoptarEncabezadoDelTicket, valorCompartidoDelTicket } from '../src/main/servicios/ticket'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import { USUARIOS_DE_LA_DEMO } from '../src/shared/demo'
import { SUCURSALES } from '../src/shared/sucursales'

/** El `fetch` de verdad, tomado al cargar el archivo (ver la misma nota en demo-datos.prueba.ts). */
const fetchDeVerdad = globalThis.fetch

function huella(valor: unknown): string {
  return createHash('sha256').update(JSON.stringify(valor)).digest('hex')
}

function actor(clave: string): ActorDelPuente {
  const usuario = USUARIOS_DE_LA_DEMO.find((u) => u.usuario === clave)!
  return { clave, nombre: usuario.nombre, rol: usuario.rol }
}

/** Espera a que `condicion` dé verdadero, preguntando seguido; falla con `que` si no llega a tiempo. */
async function esperar(que: string, condicion: () => boolean | Promise<boolean>, tope = 15_000): Promise<void> {
  const hasta = Date.now() + tope
  while (Date.now() < hasta) {
    if (await condicion()) return
    await new Promise((listo) => setTimeout(listo, 100))
  }
  assert.fail(`No pasó a tiempo: ${que}`)
}

interface Presente {
  clave: string
  conexionId: string
}

/** Una «computadora» conectada al canal en vivo, con lo que le fue llegando. */
function conectarAlCanal(url: string, token: string, clave: string) {
  const usuario = USUARIOS_DE_LA_DEMO.find((u) => u.usuario === clave)!
  const frames: Array<Record<string, unknown>> = []
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/dmg/vivo`)
  socket.onopen = () =>
    socket.send(JSON.stringify({ t: 'hola', token, actor: { clave, nombre: usuario.nombre, rol: usuario.rol, sucursal: usuario.sucursal }, app: 'prueba', versiones: {}, generacion: null }))
  socket.onmessage = (evento) => frames.push(JSON.parse(String(evento.data)))
  const presentes = (): Presente[] => {
    const ultimo = [...frames].reverse().find((frame) => frame.t === 'presencia' || frame.t === 'bienvenida')
    if (!ultimo) return []
    return (ultimo.t === 'presencia' ? ultimo.presentes : ultimo.presencia) as Presente[]
  }
  return { socket, frames, presentes }
}

test('demo: los ajustes sembrados se adoptan y quedan «al día» en una base de verdad', async (t) => {
  const fetchPuesto = globalThis.fetch
  globalThis.fetch = fetchDeVerdad
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-demo-servidor-'))
  const registrar = console.log
  console.log = () => undefined
  try {
    abrirBaseDeDatos(path.join(carpeta, 'dm.db'))
    await arrancarServidorDeLaDemo(new Date(2026, 9, 27, 10))
  } finally {
    console.log = registrar
  }
  t.after(async () => {
    globalThis.fetch = fetchPuesto
    await pararServidorDeLaDemo()
    cerrarBaseDeDatos()
    rmSync(carpeta, { recursive: true, force: true })
  })
  const db = abrirBaseDeDatos(path.join(carpeta, 'dm.db'))
  refirmarPlantillas(db, NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO)
  const fuente = new FuenteVps(credencialesDeLaDemo()!)

  // Comisiones: las doce compañías, con su porcentaje, y la huella igual después de adoptar.
  const companias = (await fuente.leerAjuste('companias'))!
  assert.ok(adoptarCompanias(companias.valor), 'adopta el catálogo de compañías')
  const local = valorCompartidoDeCompanias()!
  assert.equal(local.companias.length, 12)
  for (const compania of local.companias) assert.ok(compania.comisionPorcentaje >= 10 && compania.comisionPorcentaje <= 25, compania.nombre)
  assert.equal(huella(local), companias.huella, 'el catálogo de compañías queda al día')

  // El encabezado del ticket: las cuatro sucursales con dirección y teléfono.
  const ticket = (await fuente.leerAjuste('ticket'))!
  assert.ok(adoptarEncabezadoDelTicket(ticket.valor))
  const encabezado = valorCompartidoDelTicket()!
  assert.equal(encabezado.direcciones.length, SUCURSALES.length)
  assert.equal(huella(encabezado), ticket.huella, 'el encabezado del ticket queda al día')

  // Las listas del módulo Compañías: ninguna vacía, y la huella igual.
  const referencias = (await fuente.leerAjuste('referencias'))!
  assert.equal(adoptarInstantanea(referencias.valor).adoptadas, true)
  const instantanea = instantaneaDeReferencias()
  for (const lista of ['organizadores', 'precios', 'gruas', 'clausulas'] as const) assert.ok(instantanea[lista].length > 0, lista)
  assert.equal(huellaDeReferencias(), referencias.huella, 'las listas de las compañías quedan al día')

  // La versión de cada sucursal: las cuatro, y una con la actualización dejada para después.
  const actualizaciones = filasDesde((await fuente.leerAjuste('actualizaciones_sucursales'))?.valor)
  assert.deepEqual(actualizaciones.map((fila) => fila.sucursal).sort(), [...SUCURSALES].sort())
  assert.equal(actualizaciones.filter((fila) => fila.rechazoVersion).length, 1)

  // La app de Meta, en la forma que adopta config.ts.
  const meta = (await fuente.leerAjuste('meta'))!.valor as Record<string, unknown>
  assert.ok(meta.appId && meta.appSecret, 'la app de Meta tiene id y secreto')

  // «Leer las APIs ahora»: la lectura arranca, se ve en curso y termina con una fila nueva arriba.
  const antes = await fuente.importacionesDeVehiculos()
  assert.equal(antes.importaciones.length, 2, 'dos lecturas anteriores')
  await fuente.importarVehiculos(true)
  assert.equal((await fuente.importacionesDeVehiculos()).enCurso, true)
  const despues = await fuente.importacionesDeVehiculos()
  assert.equal(despues.enCurso, false)
  assert.equal(despues.importaciones.length, 3)
  assert.equal((despues.importaciones[0] as { estado: string }).estado, 'SIN_CAMBIOS')
})

test('demo: cada uno entra con algo sin leer y con la vista previa de todas sus conversaciones', async (t) => {
  const fetchPuesto = globalThis.fetch
  globalThis.fetch = fetchDeVerdad
  const registrar = console.log
  console.log = () => undefined
  try {
    await arrancarServidorDeLaDemo(new Date())
  } finally {
    console.log = registrar
  }
  t.after(async () => {
    globalThis.fetch = fetchPuesto
    await pararServidorDeLaDemo()
  })
  const puente = new PuenteDeMensajes(credencialesDeLaDemo()!)

  for (const usuario of USUARIOS_DE_LA_DEMO) {
    const yo = actor(usuario.usuario)
    const conversaciones = await puente.conversaciones(yo)
    const primera = await puente.novedades(yo, { desdeAcuses: null, esperaSegundos: 0 })
    // La vista previa: el último mensaje de cada conversación vino en la primera vuelta.
    for (const conversacion of conversaciones) {
      const { mensajes } = await puente.historial(yo, { conversacion: conversacion.id })
      const ultimo = mensajes.at(-1)
      if (!ultimo) continue
      assert.ok(primera.mensajes.some((m) => m.id === ultimo.id), `${usuario.usuario}: falta el último de ${conversacion.id}`)
    }
    // Algo sin leer de otro, para que el contador de la campana se vea con cualquier usuario.
    const sinLeer = primera.mensajes.filter(
      (m) => m.autorClave !== usuario.usuario && !m.acuses.some((a) => a.usuarioClave === usuario.usuario && a.leidoEn),
    )
    assert.ok(sinLeer.length >= 1, `${usuario.usuario} entra sin nada sin leer`)
    // Lo ya leído viene leído: no enciende nada.
    for (const m of primera.mensajes) {
      if (m.autorClave === usuario.usuario || sinLeer.includes(m)) continue
      assert.ok(m.acuses.some((a) => a.usuarioClave === usuario.usuario && a.leidoEn), `${usuario.usuario}: ${m.id} llega como no leído`)
    }
    // La segunda vuelta es el reparto de siempre: sólo lo pendiente.
    const segunda = await puente.novedades(yo, { desdeAcuses: null, esperaSegundos: 0 })
    assert.deepEqual(
      segunda.mensajes.map((m) => m.id).sort(),
      sinLeer.map((m) => m.id).sort(),
      `${usuario.usuario}: la segunda vuelta trae sólo lo pendiente`,
    )
  }
})

test('demo: Lucía y Jorge están en línea, leen, contestan, rechazan la llamada y se apartan si entran como ellos', async (t) => {
  const fetchPuesto = globalThis.fetch
  globalThis.fetch = fetchDeVerdad
  const registrar = console.log
  console.log = () => undefined
  try {
    await arrancarServidorDeLaDemo(new Date())
  } finally {
    console.log = registrar
  }
  const sockets: WebSocket[] = []
  t.after(async () => {
    globalThis.fetch = fetchPuesto
    for (const socket of sockets) socket.close()
    await pararServidorDeLaDemo()
  })
  const { urlBase, token } = credencialesDeLaDemo()!
  const puente = new PuenteDeMensajes({ urlBase, token })

  const martina = conectarAlCanal(urlBase, token, 'demo')
  sockets.push(martina.socket)
  await esperar('Lucía y Jorge en la presencia', () => {
    const claves = martina.presentes().map((p) => p.clave)
    return claves.includes('lucia') && claves.includes('jorge') && claves.includes('demo')
  })

  // Un mensaje a Lucía y una llamada, a la vez.
  const yo = actor('demo')
  const directa = (await puente.conversaciones(yo)).find((c) => c.tipo === 'DIRECTA' && c.participantes.some((p) => p.clave === 'lucia'))!
  await puente.novedades(yo, { desdeAcuses: null, esperaSegundos: 0 })
  const { mensaje } = await puente.enviar(yo, { id: 'prueba-a-lucia', conversacionId: directa.id, cuerpo: '¿Me pasás el número del siniestro?', enviadoEn: new Date().toISOString(), adjuntos: [] })
  martina.socket.send(JSON.stringify({ t: 'llamada', evento: { tipo: 'invitar', llamadaId: 'llamada-prueba', para: 'lucia', conversacionId: directa.id } }))

  await esperar('Lucía lee el mensaje', async () => {
    const { mensajes } = await puente.historial(yo, { conversacion: directa.id })
    return Boolean(mensajes.find((m) => m.id === mensaje.id)?.acuses.some((a) => a.usuarioClave === 'lucia' && a.leidoEn))
  })
  await esperar('Lucía rechaza la llamada', () =>
    martina.frames.some((f) => f.t === 'llamada' && (f.evento as { tipo?: string; llamadaId?: string }).tipo === 'rechazar' && (f.evento as { llamadaId?: string }).llamadaId === 'llamada-prueba'),
  )
  await esperar('Lucía contesta', async () => {
    const { mensajes } = await puente.historial(yo, { conversacion: directa.id })
    return mensajes.filter((m) => m.autorClave === 'lucia' && m.tipo !== 'LLAMADA' && new Date(m.creadoEn).getTime() > Date.now() - 60_000).length >= 1
  })

  // Quien prueba la demo entra como Lucía: la virtual se aparta y queda una sola Lucía en línea.
  const luciaDeVerdad = conectarAlCanal(urlBase, token, 'lucia')
  sockets.push(luciaDeVerdad.socket)
  await esperar('una sola Lucía', () => {
    const lucias = martina.presentes().filter((p) => p.clave === 'lucia')
    return lucias.length === 1 && luciaDeVerdad.frames.some((f) => f.t === 'bienvenida' && lucias[0]!.conexionId === f.conexionId)
  })
  // Y cuando se va, la virtual vuelve.
  luciaDeVerdad.socket.close()
  await esperar('vuelve la Lucía virtual', () => {
    const lucias = martina.presentes().filter((p) => p.clave === 'lucia')
    const deVerdad = luciaDeVerdad.frames.find((f) => f.t === 'bienvenida')?.conexionId
    return lucias.length === 1 && lucias[0]!.conexionId !== deVerdad
  })
})

test('datos de la demo: rechazos en cada sucursal, la tarea de la Hilux y observaciones en todos los siniestros', () => {
  for (const hoy of [new Date(2026, 9, 27, 10), new Date(2027, 2, 5, 10), new Date(2027, 0, 8, 10)]) {
    const datos = armarDatosDeLaDemo(hoy)
    const tabla = (titulo: string) => {
      const [encabezados, ...filas] = datos.pestanas.find((p) => p.titulo === titulo)!.valores
      return filas.map((fila) => Object.fromEntries(encabezados!.map((e, i) => [e, fila[i] ?? ''])))
    }
    const rechazos = tabla('APP RECHAZOS')
    for (const sucursal of SUCURSALES) {
      assert.ok(rechazos.some((r) => r.LOCAL === sucursal && r.ESTADO === 'PENDIENTE'), `${sucursal}: un rechazo pendiente`)
    }
    assert.equal(rechazos.filter((r) => r.LOCAL === 'Sarandí').length, 2, 'los dos de Sarandí del chat')

    const siniestros = tabla('SINIESTROS')
    const tarea = tabla('APP TAREAS').find((f) => /Hilux/.test(f.TITULO!))
    assert.ok(tarea, 'la tarea de la Hilux')
    assert.equal(tarea['ASIGNADO A'], 'Martina Demo')
    assert.equal(tarea['CREADO POR'], 'Lucía Gómez')
    assert.equal(tarea.ESTADO, 'Pendiente')
    assert.equal(new Date(`${tarea.VENCE}T12:00:00Z`).getUTCDay(), 5, 'vence un viernes')
    const siniestro = siniestros.find((s) => `SINIESTRO:${s._ID}` === tarea['VINCULO ID'])
    assert.ok(siniestro, 'la tarea cuelga de un siniestro que existe')
    assert.equal(siniestro.LOCAL, 'SARANDI')
    assert.equal(siniestro.MODELO!.startsWith('HILUX'), true)
    // Con RC no hay daño propio ni perito: la Hilux tiene una cobertura que sí los cubre.
    assert.notEqual(siniestro.COBERTURA, 'RC', 'la Hilux no es una RC')

    const comentarios = tabla('APP COMENTARIOS').filter((c) => c.TIPO === 'SINIESTRO')
    for (const s of siniestros) assert.ok(comentarios.some((c) => c.VINCULO === `SINIESTRO:${s._ID}`), `el siniestro ${s._ID} tiene observaciones`)
  }
})

test('datos de la demo: los comentarios de hoy van hacia atrás desde la hora de apertura, nunca en el futuro', () => {
  // También de madrugada y recién abierto el local: ni antes de las 00:00 ni después de ahora.
  for (const hora of [0, 8, 10, 23]) {
    const hoy = new Date(2026, 9, 27, hora, 5)
    const inicio = new Date(2026, 9, 27).getTime()
    const [encabezados, ...filas] = armarDatosDeLaDemo(hoy).pestanas.find((p) => p.titulo === 'APP COMENTARIOS')!.valores
    const columna = encabezados!.indexOf('FECHA')
    let deHoy = 0
    for (const fila of filas) {
      const momento = new Date(fila[columna]!).getTime()
      assert.ok(momento <= hoy.getTime(), `${hora} h: comentario en el futuro (${fila[columna]})`)
      if (momento >= inicio) deHoy++
    }
    assert.ok(deHoy >= 3, `${hora} h: comentarios de hoy (${deHoy})`)
  }
})
