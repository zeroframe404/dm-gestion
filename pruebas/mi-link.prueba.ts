// Mi link: el contrato compartido con el servidor (la dirección, la sugerida, la página recién creada)
// y el servicio del proceso principal contra el simulador del VPS, que contesta con las mismas formas y
// los mismos «no» que `server/src/modules/milink` (409 del candado, 403 de lo ajeno, 400 del estado).
//
// Lo que no se prueba acá: la validación entera del contenido y la página HTML. Viven en el servidor y
// tienen sus pruebas allá (milink.contenido.test.ts, milink.pagina.test.ts).
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db } from '../src/main/db/base'
import { ErrorDeNegocio, SinConexion } from '../src/main/servicios/errores'
import {
  actualizarDenunciaDeMiLink,
  actualizarSolicitudDeMiLink,
  bajarArchivoDeMiLink,
  denunciasDeMiLink,
  direccionLibreDeMiLink,
  direccionParaAbrir,
  guardarMiLink,
  metricasDeMiLink,
  miLinkPropio,
  nombreTemporalDeArchivo,
  PaginaDesactualizada,
  solicitudesDeMiLink,
  usuariosDeMiLink,
} from '../src/main/servicios/miLink'
import {
  contenidoInicial,
  direccionSugerida,
  esDireccionValida,
  esSeccionDeMiLink,
  filtrosVaciosDeMiLink,
  LIMITES_DE_MI_LINK,
} from '../src/shared/miLink'
import type { SesionUsuario } from '../src/shared/tipos'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'Daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}
const MARIA: SesionUsuario = { ...DANIEL, id: 3, nombre: 'María Pérez', usuario: 'maria', rol: 'EMPLEADO' }

const carpetas: string[] = []
test.after(() => {
  for (const carpeta of carpetas) rmSync(carpeta, { recursive: true, force: true })
})

async function rechaza(promesa: Promise<unknown>, esperado: RegExp, clase: new (...args: never[]) => Error = ErrorDeNegocio): Promise<void> {
  await assert.rejects(promesa, (error: unknown) => {
    assert.ok(error instanceof clase, `Se esperaba ${clase.name} y vino ${String(error)}`)
    assert.match((error as Error).message, esperado)
    return true
  })
}

/** Un simulador escuchando y el proceso principal apuntado a él, como hacen las otras pruebas del VPS. */
async function conSimulador(prueba: (simulador: VpsSimulado) => Promise<void>): Promise<void> {
  const simulador = new VpsSimulado()
  await simulador.escuchar()
  process.env.DM_GESTION_VPS_URL = simulador.url
  try {
    await prueba(simulador)
  } finally {
    delete process.env.DM_GESTION_VPS_URL
    await simulador.cerrar()
  }
}

// ---------------------------------------------------------------------------
// El contrato
// ---------------------------------------------------------------------------

test('la dirección: minúsculas, números y guiones, 3 a 40, sin reservadas', () => {
  for (const buena of ['daniel', 'daniel-martinez', 'dm1', 'a'.repeat(40), 'lanus-2']) {
    assert.equal(esDireccionValida(buena), true, buena)
  }
  for (const mala of ['', 'ab', 'a'.repeat(41), 'Daniel', '-daniel', 'daniel-', 'dan--iel', 'dan iel', 'josé', 'api', 'admin', 'p']) {
    assert.equal(esDireccionValida(mala), false, mala)
  }
})

test('la dirección sugerida sale del nombre y siempre es válida', () => {
  assert.equal(direccionSugerida('Daniel Adrián Martínez'), 'daniel-adrian-martinez')
  assert.equal(direccionSugerida('  María  José  Peña '), 'maria-jose-pena')
  assert.equal(direccionSugerida('Ñandú'), 'nandu')
  // Muy corta: se completa en vez de devolver algo que el servidor rechazaría.
  assert.equal(direccionSugerida('Al'), 'al-dm')
  assert.equal(direccionSugerida(''), 'productor-dm')
  // Muy larga: se corta en 40 y sin guion colgando.
  const larga = direccionSugerida('Juan Carlos Bartolomé de las Mercedes Fernández Montenegro')
  assert.ok(larga.length <= 40 && !larga.endsWith('-'), larga)
  for (const nombre of ['Daniel Adrián Martínez', 'Al', '', 'Juan Carlos Bartolomé de las Mercedes Fernández Montenegro', '***']) {
    assert.equal(esDireccionValida(direccionSugerida(nombre)), true, `«${nombre}» → «${direccionSugerida(nombre)}»`)
  }
})

test('la página recién creada: nombre, auto y moto, siniestros y el color de la agencia', () => {
  const contenido = contenidoInicial('  Daniel Martínez  ')
  assert.equal(contenido.v, 1)
  assert.equal(contenido.nombre, 'Daniel Martínez')
  assert.deepEqual(
    contenido.coberturas.map((cobertura) => cobertura.tipo),
    ['auto', 'moto'],
  )
  assert.equal(contenido.siniestros, true)
  assert.equal(contenido.usarFoto, true)
  assert.deepEqual(contenido.contacto, [])
  assert.deepEqual(contenido.links, [])
  assert.match(contenido.diseno.color, /^#[0-9a-f]{6}$/)
  // Sin nombre no queda vacío (el servidor exige 1..80), y uno larguísimo se corta.
  assert.equal(contenidoInicial('   ').nombre, 'Mi página')
  assert.equal(contenidoInicial('x'.repeat(200)).nombre.length, LIMITES_DE_MI_LINK.nombre)
  // Los ids de bloque siguen la forma que valida el servidor.
  for (const cobertura of contenido.coberturas) assert.match(cobertura.id, /^[a-z0-9-]{1,40}$/)
})

test('las secciones de la sublista', () => {
  for (const seccion of ['pagina', 'solicitudes', 'siniestros', 'metricas']) assert.equal(esSeccionDeMiLink(seccion), true)
  assert.equal(esSeccionDeMiLink('otra'), false)
  assert.equal(esSeccionDeMiLink(undefined), false)
})

// ---------------------------------------------------------------------------
// Lo que el proceso principal decide solo
// ---------------------------------------------------------------------------

test('«Ver mi página» sólo abre páginas de Mi link, y siempre como dueño', () => {
  assert.equal(direccionParaAbrir('https://dmartinezseguros.com/p/daniel', null), 'https://dmartinezseguros.com/p/daniel?vista=duenio')
  // Lo que traiga de query o fragmento se descarta: la única marca que viaja es la del dueño.
  assert.equal(direccionParaAbrir('https://dmartinezseguros.com/p/daniel?x=1#y', null), 'https://dmartinezseguros.com/p/daniel?vista=duenio')
  // El servidor configurado (el de pruebas, el de la demo) también.
  assert.equal(direccionParaAbrir('http://127.0.0.1:4000/p/daniel', 'http://127.0.0.1:4000'), 'http://127.0.0.1:4000/p/daniel?vista=duenio')
  for (const mala of [
    'https://otro-sitio.com/p/daniel',
    'https://dmartinezseguros.com/admin',
    'https://dmartinezseguros.com/p/daniel/foto',
    'https://usuario:clave@dmartinezseguros.com/p/daniel',
    'http://dmartinezseguros.com/p/daniel',
    'file:///C:/Windows/system32/calc.exe',
    'javascript:alert(1)',
    'no es una url',
    42,
  ]) {
    assert.equal(direccionParaAbrir(mala, 'http://127.0.0.1:4000'), null, String(mala))
  }
})

test('el nombre del adjunto en la temporal: con el id adelante y sin caracteres peligrosos', () => {
  const jpg = 'image/jpeg'
  assert.equal(nombreTemporalDeArchivo({ id: 'abc-123', nombre: 'IMG_0001.jpg', tipo: jpg }), 'abc-123-IMG_0001.jpg')
  // Lo eligió un desconocido: nada de subir carpetas ni de nombres que Windows no acepta.
  assert.equal(nombreTemporalDeArchivo({ id: 'abc', nombre: '..\\..\\Windows\\win.ini', tipo: jpg }), 'abc-win.jpg')
  assert.equal(nombreTemporalDeArchivo({ id: 'abc', nombre: '../../etc/passwd', tipo: 'application/pdf' }), 'abc-passwd.pdf')
  assert.equal(nombreTemporalDeArchivo({ id: 'abc', nombre: 'a<b>c:"d|e?*.pdf', tipo: 'application/pdf' }), 'abc-a-b-c--d-e--.pdf')
  assert.equal(nombreTemporalDeArchivo({ id: '../x', nombre: '', tipo: 'image/png' }), 'x-archivo.png')
})

test('el adjunto se abre con la extensión de su tipo, nunca con la que eligió quien lo subió', () => {
  // Un multipart con filename «foto.jpg.exe» y Content-Type image/jpeg: el servidor lo guarda así.
  // Si conservara «.exe», `shell.openPath` lo ejecutaría en la PC de la agencia.
  for (const nombre of ['x.jpg.exe', 'x.hta', 'x.bat', 'x.js', 'x.vbs', 'x.lnk', 'x.html', 'x.exe.', 'x.exe ']) {
    const final = nombreTemporalDeArchivo({ id: 'abc', nombre, tipo: 'image/jpeg' })
    assert.ok(final.endsWith('.jpg'), `${nombre} → ${final}`)
    assert.equal(path.extname(final), '.jpg', nombre)
  }
  assert.equal(nombreTemporalDeArchivo({ id: 'abc', nombre: 'x.jpg.exe', tipo: 'image/jpeg' }), 'abc-x.jpg.jpg')
  // Un tipo que no es imagen ni PDF no se escribe en la PC.
  for (const tipo of ['application/x-msdownload', 'text/html', '', 'constructor', 'toString']) {
    assert.throws(() => nombreTemporalDeArchivo({ id: 'abc', nombre: 'x.pdf', tipo }), /no se abre por seguridad/, tipo)
  }
})

test('sin servidor, Mi link lo dice con un mensaje claro', async () => {
  delete process.env.DM_GESTION_VPS_URL
  await rechaza(miLinkPropio(DANIEL), /necesita conexión con el servidor/)
})

test('el servidor que no contesta vuelve como «sin conexión», no como error inesperado', async () => {
  // Un puerto donde no escucha nadie: el fetch falla por red. El editor lo necesita marcado (ipc.ts lo
  // devuelve con `codigo: 'sin-conexion'`) para esperar y volver a guardar solo en vez de pedir «Reintentar».
  const simulador = new VpsSimulado()
  await simulador.escuchar()
  const url = simulador.url
  await simulador.cerrar()
  process.env.DM_GESTION_VPS_URL = url
  try {
    await rechaza(miLinkPropio(DANIEL), /No se pudo hablar con el servidor de la agencia/, SinConexion)
  } finally {
    delete process.env.DM_GESTION_VPS_URL
  }
})

// ---------------------------------------------------------------------------
// Contra el simulador
// ---------------------------------------------------------------------------

test('crear, guardar con el candado y chocar con otra computadora', async () => {
  await conSimulador(async (simulador) => {
    assert.equal(await miLinkPropio(DANIEL), null)
    assert.deepEqual(await direccionLibreDeMiLink(DANIEL, 'Daniel-Martinez'), { libre: true, motivo: null })
    const reservada = await direccionLibreDeMiLink(DANIEL, 'admin')
    assert.equal(reservada.libre, false)
    assert.match(reservada.motivo ?? '', /reservada/)

    const creada = await guardarMiLink(DANIEL, {
      version: null,
      direccion: ' Daniel-Martinez ',
      publicada: false,
      contenido: contenidoInicial(DANIEL.nombre),
    })
    // La clave es el login en minúscula, no el id local.
    assert.equal(creada.usuarioClave, 'daniel')
    assert.equal(creada.direccion, 'daniel-martinez')
    assert.equal(creada.version, 1)
    assert.equal(creada.url, 'https://dmartinezseguros.com/p/daniel-martinez')
    assert.equal(simulador.miLinks.get('daniel')?.usuarioNombre, 'Daniel Martínez')

    const guardada = await guardarMiLink(DANIEL, { ...creada, publicada: true, contenido: { ...creada.contenido, bio: 'Productor asesor' } })
    assert.equal(guardada.version, 2)
    assert.equal(guardada.publicada, true)
    assert.equal((await miLinkPropio(DANIEL))?.contenido.bio, 'Productor asesor')

    // Otra computadora guardó encima de la versión 1: vuelve marcado para que la pantalla recargue.
    await rechaza(guardarMiLink(DANIEL, { ...creada, publicada: true }), /Otra computadora/, PaginaDesactualizada)
    // Crear de nuevo cuando ya existe también es «otra computadora».
    await rechaza(guardarMiLink(DANIEL, { ...creada, version: null }), /Otra computadora/, PaginaDesactualizada)

    // La dirección de otro es un 409 distinto: se corrige la dirección, no se recarga la página.
    const deOtro = await direccionLibreDeMiLink(MARIA, 'daniel-martinez')
    assert.equal(deOtro.libre, false)
    await assert.rejects(
      guardarMiLink(MARIA, { version: null, direccion: 'daniel-martinez', publicada: false, contenido: contenidoInicial(MARIA.nombre) }),
      (error: unknown) => {
        assert.ok(error instanceof ErrorDeNegocio && !(error instanceof PaginaDesactualizada), String(error))
        // El texto del servidor, sin el envoltorio «El servidor del VPS rechazó la operación…».
        assert.equal(error.message, 'Esa dirección ya la tiene otra persona de la agencia. Probá con otra.')
        return true
      },
    )
    // Un 400 del servidor también llega con su motivo, tal cual.
    await rechaza(guardarMiLink(MARIA, { version: null, direccion: 'x', publicada: false, contenido: contenidoInicial('María') }), /^La dirección tiene que tener al menos 3 caracteres\.$/)
  })
})

test('solicitudes: las propias, las de todos sólo para administradores, y el seguimiento', async () => {
  await conSimulador(async (simulador) => {
    const { solicitudes } = simulador.sembrarMiLink({
      solicitudes: [
        {
          usuarioClave: 'maria',
          cobertura: 'auto',
          nombre: 'Juan Pérez',
          telefono: '11 4444-5555',
          vehiculo: { tipo: 'AUTO', marca: 'FIAT', modelo: 'CRONOS', version: '1.3 DRIVE', anio: 2022, codigoCatalogo: '' },
          creadaEn: '2026-10-20T15:00:00.000Z',
        },
        { usuarioClave: 'maria', cobertura: 'hogar', coberturaTitulo: 'Seguro de hogar', nombre: 'Ana Gómez', creadaEn: '2026-10-25T15:00:00.000Z' },
        { usuarioClave: 'daniel', cobertura: 'moto', nombre: 'Pedro Díaz', creadaEn: '2026-10-26T15:00:00.000Z' },
      ],
    })

    const propias = await solicitudesDeMiLink(MARIA, filtrosVaciosDeMiLink())
    assert.deepEqual(
      propias.map((solicitud) => solicitud.nombre),
      ['Ana Gómez', 'Juan Pérez'],
      'las de María, las más nuevas primero',
    )
    assert.equal(propias[1]!.canal, 'COTIZADOR')
    assert.equal(propias[0]!.canal, 'FORMULARIO')

    // Filtros: texto (también por marca del vehículo), estado y rango de fechas.
    assert.deepEqual((await solicitudesDeMiLink(MARIA, { ...filtrosVaciosDeMiLink(), texto: 'cronos' })).map((s) => s.nombre), ['Juan Pérez'])
    assert.deepEqual((await solicitudesDeMiLink(MARIA, { ...filtrosVaciosDeMiLink(), desde: '2026-10-21', hasta: '2026-10-25' })).map((s) => s.nombre), ['Ana Gómez'])
    // Un día que no existe lo rechaza el servidor (ida y vuelta no da el mismo día), y el simulador igual.
    await rechaza(solicitudesDeMiLink(MARIA, { ...filtrosVaciosDeMiLink(), desde: '2026-02-30' }), /«desde» no es válida/)

    // Ver lo de otros es de administradores: el servidor dice que no y llega su texto.
    await rechaza(solicitudesDeMiLink(MARIA, { ...filtrosVaciosDeMiLink(), usuario: 'todos' }), /^Solo un administrador puede ver lo de otras personas\.$/)
    assert.equal((await solicitudesDeMiLink(DANIEL, { ...filtrosVaciosDeMiLink(), usuario: 'todos' })).length, 3)
    assert.equal((await solicitudesDeMiLink(DANIEL, { ...filtrosVaciosDeMiLink(), usuario: 'MARIA' })).length, 2)

    // El seguimiento: estado y nota, sólo el dueño o un administrador.
    const deJuan = solicitudes[0]!.id
    const contactada = await actualizarSolicitudDeMiLink(MARIA, deJuan, { estado: 'CONTACTADA', nota: '  Lo llamo el lunes ' })
    assert.equal(contactada.estado, 'CONTACTADA')
    assert.equal(contactada.nota, 'Lo llamo el lunes')
    assert.equal((await actualizarSolicitudDeMiLink(DANIEL, deJuan, { estado: 'COTIZADA' })).estado, 'COTIZADA')
    const dePedro = solicitudes[2]!.id
    await rechaza(actualizarSolicitudDeMiLink(MARIA, dePedro, { estado: 'CERRADA' }), /dueña de la página o un administrador/)
    // Un estado inventado no sale de esta computadora.
    await rechaza(actualizarSolicitudDeMiLink(MARIA, deJuan, { estado: 'INVENTADO' }), /Ese estado no existe/)
    await rechaza(actualizarSolicitudDeMiLink(MARIA, '00000000-0000-4000-8000-000000000000', { estado: 'CERRADA' }), /no existe/)
  })
})

test('denuncias: el listado con sus adjuntos y bajar uno a la carpeta temporal', async () => {
  await conSimulador(async (simulador) => {
    const { denuncias } = simulador.sembrarMiLink({
      denuncias: [
        {
          usuarioClave: 'maria',
          tipo: 'choque',
          nombre: 'Juan Pérez',
          patente: 'AB123CD',
          descripcion: 'Me chocaron de atrás en un semáforo.',
          hayTercero: true,
          archivos: [{ nombre: '../../foto del choque.jpg', tipo: 'image/jpeg', contenido: Buffer.from('JPEG DE PRUEBA') }],
        },
      ],
    })
    const listadas = await denunciasDeMiLink(MARIA, { ...filtrosVaciosDeMiLink(), texto: 'ab123' })
    assert.equal(listadas.length, 1)
    assert.equal(listadas[0]!.archivos.length, 1)
    assert.equal(listadas[0]!.archivos[0]!.tamano, 14)

    const cargada = await actualizarDenunciaDeMiLink(MARIA, denuncias[0]!.id, { estado: 'CARGADA' })
    assert.equal(cargada.estado, 'CARGADA')
    await rechaza(actualizarDenunciaDeMiLink(MARIA, denuncias[0]!.id, { estado: 'COTIZADA' }), /Ese estado no existe/)

    const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-mi-link-'))
    carpetas.push(carpeta)
    const ruta = await bajarArchivoDeMiLink(MARIA, listadas[0]!.archivos[0]!, carpeta)
    assert.equal(path.dirname(ruta), carpeta, 'el nombre que eligió el cliente no saca el archivo de la carpeta')
    assert.ok(existsSync(ruta))
    assert.equal(readFileSync(ruta, 'utf8'), 'JPEG DE PRUEBA')

    // El adjunto de otra persona no lo baja un empleado.
    const otra = simulador.sembrarMiLink({ denuncias: [{ usuarioClave: 'daniel', archivos: [{ contenido: 'PDF' }] }] }).denuncias[0]!
    await rechaza(bajarArchivoDeMiLink(MARIA, otra.archivos[0]!, carpeta), /dueña de la página o un administrador/)
  })
})

test('métricas: todos los días del rango, rankings y visitantes por día', async () => {
  await conSimulador(async (simulador) => {
    const ahora = new Date()
    const ayer = new Date(ahora.getTime() - 86_400_000)
    const haceUnAnio = new Date(ahora.getTime() - 365 * 86_400_000)
    simulador.sembrarMiLink({
      eventos: [
        { usuarioClave: 'maria', visitante: 'aaaaaaaa', origen: 'instagram', dispositivo: 'celular', ocurridoEn: ahora.toISOString() },
        { usuarioClave: 'maria', visitante: 'aaaaaaaa', origen: 'instagram', dispositivo: 'celular', ocurridoEn: ahora.toISOString() },
        { usuarioClave: 'maria', visitante: 'aaaaaaaa', origen: 'google', dispositivo: 'escritorio', ocurridoEn: ayer.toISOString() },
        { usuarioClave: 'maria', evento: 'click', bloque: 'wa', bloqueEtiqueta: 'WhatsApp', ocurridoEn: ahora.toISOString() },
        { usuarioClave: 'maria', evento: 'click', bloque: 'auto', bloqueEtiqueta: 'Seguro de auto', ocurridoEn: ahora.toISOString() },
        { usuarioClave: 'maria', evento: 'click', bloque: 'wa', bloqueEtiqueta: 'WhatsApp', ocurridoEn: ayer.toISOString() },
        // Fuera del rango y de otra persona: no cuentan.
        { usuarioClave: 'maria', ocurridoEn: haceUnAnio.toISOString() },
        { usuarioClave: 'daniel', ocurridoEn: ahora.toISOString() },
      ],
      solicitudes: [{ usuarioClave: 'maria' }],
    })

    const metricas = await metricasDeMiLink(MARIA, 7, '')
    assert.equal(metricas.porDia.length, 7, 'el gráfico trae todos los días, también los vacíos')
    assert.equal(metricas.porDia[6]!.dia, metricas.hasta)
    assert.equal(metricas.porDia[0]!.dia, metricas.desde)
    assert.equal(metricas.visitas, 3)
    // El mismo visitante hoy (dos veces) y ayer: dos pares (visitante, día).
    assert.equal(metricas.visitantes, 2)
    assert.equal(metricas.clicks, 3)
    assert.equal(metricas.clicksPorVisita, 1)
    assert.deepEqual(metricas.bloques, [
      { etiqueta: 'WhatsApp', valor: 2 },
      { etiqueta: 'Seguro de auto', valor: 1 },
    ])
    assert.deepEqual(metricas.origenes, [
      { etiqueta: 'Instagram', valor: 2 },
      { etiqueta: 'Google', valor: 1 },
    ])
    assert.deepEqual(metricas.dispositivos, [
      { etiqueta: 'Celular', valor: 2 },
      { etiqueta: 'Escritorio', valor: 1 },
    ])
    assert.equal(metricas.solicitudes, 1)
    assert.equal(metricas.denuncias, 0)

    // Un rango inventado cae en 30, como en el servidor.
    assert.equal((await metricasDeMiLink(MARIA, 45, '')).porDia.length, 30)
    await rechaza(metricasDeMiLink(MARIA, 30, 'todos'), /Solo un administrador/)
    assert.equal((await metricasDeMiLink(DANIEL, 90, 'todos')).visitas, 4)
  })
})

test('el filtro «Usuario» sale de la base local: sólo los activos, con su clave', () => {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
  try {
    // La base nueva trae a Daniel (la semilla). Se suman una activa con el login en mayúsculas y una
    // dada de baja, directo en la tabla: crearlas por el servicio pediría la base compartida.
    const sucursal = (db().prepare('SELECT id FROM sucursales LIMIT 1').get() as { id: number }).id
    const insertar = db().prepare(
      `INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave) VALUES (?, ?, 'x', 'EMPLEADO', ?, ?, 0)`,
    )
    insertar.run('Ana Ruiz', 'Ana.Ruiz', sucursal, 1)
    insertar.run('Beto Baja', 'beto', sucursal, 0)
    assert.deepEqual(usuariosDeMiLink(), [
      { clave: 'ana.ruiz', nombre: 'Ana Ruiz' },
      { clave: 'daniel', nombre: 'Daniel Martínez' },
    ])
  } finally {
    cerrarBaseDeDatos()
  }
})
