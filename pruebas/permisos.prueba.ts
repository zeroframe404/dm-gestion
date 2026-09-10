// Los permisos por rol: los valores por defecto (que son los de siempre), lo que pasa al recortarlos,
// dónde se guardan según haya o no base compartida, y que la matriz viaje entre computadoras.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db } from '../src/main/db/base'
import { ingresar } from '../src/main/servicios/auth'
import * as base from '../src/main/servicios/baseDeUsuarios'
import { cambiarClave } from '../src/main/servicios/auth'
import { ErrorDeNegocio, SinConexion } from '../src/main/servicios/errores'
import {
  conectarAvisoDePermisos,
  exigirEdicion,
  exigirVista,
  guardarPermisos,
  matrizDePermisos,
  matrizVigente,
  misPermisos,
  olvidarLoConocido,
  puedeEditar,
  puedeVer,
} from '../src/main/servicios/permisos'
import { establecerSesion, sesion } from '../src/main/servicios/sesion'
import { AlmacenEnMemoria } from '../src/main/usuarios/almacen'
import { AlmacenDeCredencial, cifradorDePrueba } from '../src/main/usuarios/credencial'
import { escribirDocumento, leerDocumento } from '../src/main/usuarios/documento'
import { CanalEnVivo, usarCanal } from '../src/main/vivo/canal'
import { normalizarMatriz, permisosPorDefecto, type MatrizPermisos } from '../src/shared/permisos'
import type { SesionUsuario } from '../src/shared/tipos'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

const ANA: SesionUsuario = { ...DANIEL, id: 2, nombre: 'Ana Ruiz', usuario: 'ana', rol: 'ADMIN' }
const MARIA: SesionUsuario = { ...DANIEL, id: 3, nombre: 'María Pérez', usuario: 'maria', rol: 'EMPLEADO' }

const carpetasTemporales: string[] = []
test.after(() => {
  for (const carpeta of carpetasTemporales) rmSync(carpeta, { recursive: true, force: true })
})

function carpetaTemporal(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-permisos-'))
  carpetasTemporales.push(carpeta)
  return carpeta
}

/** Base nueva en memoria, sin base de usuarios compartida: la matriz vive en `configuracion`. */
function baseLocal(): void {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
  base.configurarBaseDeUsuarios({ almacen: null, credenciales: null, registrar: () => undefined })
  olvidarLoConocido()
  establecerSesion(DANIEL)
}

/** Una «computadora» con base compartida, como en usuarios-remotos.prueba.ts. */
function computadora(almacen: AlmacenEnMemoria): void {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
  base.configurarBaseDeUsuarios({
    almacen,
    credenciales: new AlmacenDeCredencial(path.join(carpetaTemporal(), 'credencial.bin'), cifradorDePrueba()),
    version: '9.9.9',
    nombreDeEquipo: 'PC-PRUEBA',
    memoriaSinInternetMs: 0,
    registrar: () => undefined,
  })
  olvidarLoConocido()
}

function actor(): SesionUsuario {
  const actual = sesion()
  assert.ok(actual, 'No hay sesión abierta')
  return actual
}

/** La PC principal con la base compartida ya inicializada y daniel adentro. */
async function computadoraPrincipal(almacen = new AlmacenEnMemoria()): Promise<AlmacenEnMemoria> {
  computadora(almacen)
  await ingresar({ usuario: 'daniel', clave: 'cambiar123' })
  await cambiarClave({ claveActual: 'cambiar123', claveNueva: 'Clave-Nueva-1' }, actor())
  await base.subirLocales(actor())
  return almacen
}

async function rechaza(promesa: Promise<unknown>, esperado: RegExp): Promise<void> {
  await assert.rejects(promesa, (error: unknown) => {
    assert.ok(error instanceof ErrorDeNegocio, `Se esperaba ErrorDeNegocio y vino ${String(error)}`)
    assert.match(error.message, esperado)
    return true
  })
}

function conSesion<T>(usuario: SesionUsuario, accion: () => T): T {
  establecerSesion(usuario)
  try {
    return accion()
  } finally {
    establecerSesion(DANIEL)
  }
}

// ---------------------------------------------------------------------------
// Los valores por defecto son los de siempre
// ---------------------------------------------------------------------------

test('sin configurar nada, cada rol puede exactamente lo que podía antes de que existiera la matriz', () => {
  baseLocal()

  // El superadministrador, todo, y no está en la matriz.
  assert.equal(puedeEditar(DANIEL, 'administracion'), true)
  assert.equal(puedeEditar(DANIEL, 'cartera'), true)

  // El administrador entra a todo, incluida Administración.
  assert.equal(puedeEditar(ANA, 'administracion'), true)
  assert.equal(puedeEditar(ANA, 'cobranzas'), true)

  // El empleado trabaja el día a día y no entra a Administración.
  assert.equal(puedeEditar(MARIA, 'cartera'), true)
  assert.equal(puedeEditar(MARIA, 'clientes'), true)
  assert.equal(puedeVer(MARIA, 'administracion'), false)
  assert.equal(puedeEditar(MARIA, 'administracion'), false)

  assert.deepEqual(misPermisos(MARIA).areas, permisosPorDefecto().EMPLEADO)
  assert.equal(misPermisos(DANIEL).areas.administracion, 'editar')
})

test('normalizarMatriz completa lo que falta y descarta lo que no entiende', () => {
  const matriz = normalizarMatriz({ EMPLEADO: { cartera: 'ver', marketing: 'inventado', noExiste: 'editar' }, JEFE: {} })
  assert.equal(matriz.EMPLEADO.cartera, 'ver')
  assert.equal(matriz.EMPLEADO.marketing, 'editar', 'un nivel desconocido queda en el valor por defecto')
  assert.equal(matriz.EMPLEADO.administracion, 'ninguno')
  assert.equal(matriz.ADMIN.cartera, 'editar')
  assert.deepEqual(normalizarMatriz(null), permisosPorDefecto())
  assert.deepEqual(normalizarMatriz('cualquier cosa'), permisosPorDefecto())
})

// ---------------------------------------------------------------------------
// Recortar permisos
// ---------------------------------------------------------------------------

test('sin base compartida los permisos se guardan en esta computadora y valen enseguida', async () => {
  baseLocal()
  const recortada = permisosPorDefecto()
  recortada.EMPLEADO.cobranzas = 'ver'
  recortada.EMPLEADO.marketing = 'ninguno'

  const guardada = await guardarPermisos(recortada, DANIEL)
  assert.equal(guardada.origen, 'local')
  assert.equal(guardada.puedeEditar, true)
  assert.ok(guardada.actualizadoEn, 'queda anotado cuándo se guardó')

  assert.equal(puedeVer(MARIA, 'cobranzas'), true)
  assert.equal(puedeEditar(MARIA, 'cobranzas'), false)
  assert.equal(puedeVer(MARIA, 'marketing'), false)
  // Al administrador no le cambió nada.
  assert.equal(puedeEditar(ANA, 'cobranzas'), true)

  // Y sobrevive a reabrir la pantalla: quedó escrito en la base, no en memoria.
  assert.equal(matrizVigente().EMPLEADO.cobranzas, 'ver')
  const fila = db().prepare(`SELECT valor FROM configuracion WHERE clave = 'permisos_roles'`).get() as { valor: string }
  assert.equal((JSON.parse(fila.valor) as MatrizPermisos).EMPLEADO.marketing, 'ninguno')

  // El cambio queda en el historial, como cualquier otro.
  const historial = db().prepare(`SELECT campo, valor_nuevo FROM historial WHERE accion = 'permisos'`).all() as Array<{
    campo: string
    valor_nuevo: string
  }>
  assert.equal(historial.length, 1)
  assert.equal(historial[0]!.campo, 'Permisos de EMPLEADO')
  assert.match(historial[0]!.valor_nuevo, /Cobranzas: Ver y editar → Sólo ver/)
  assert.match(historial[0]!.valor_nuevo, /Marketing: Ver y editar → Sin acceso/)
})

test('exigirVista y exigirEdicion frenan lo que no corresponde y explican por qué', async () => {
  baseLocal()
  const recortada = permisosPorDefecto()
  recortada.EMPLEADO.cobranzas = 'ver'
  recortada.EMPLEADO.marketing = 'ninguno'
  await guardarPermisos(recortada, DANIEL)

  conSesion(MARIA, () => {
    // Ver alcanza para mirar, no para tocar.
    assert.equal(exigirVista('cobranzas').usuario, 'maria')
    assert.throws(() => exigirEdicion('cobranzas'), (error: unknown) => {
      assert.ok(error instanceof ErrorDeNegocio)
      assert.match(error.message, /No tenés permiso para modificar Cobranzas/)
      return true
    })
    // Sin acceso no se entra ni a mirar.
    assert.throws(() => exigirVista('marketing'), /No tenés permiso para entrar a Marketing/)
    // Con varias áreas alcanza con tener una: la ficha del cliente cobra una cuota de la planilla.
    assert.equal(exigirEdicion('marketing', 'cartera').usuario, 'maria')
  })

  // El superadministrador nunca se queda afuera.
  conSesion(DANIEL, () => {
    assert.equal(exigirEdicion('marketing').rol, 'SUPER_ADMIN')
  })
})

// El otro candado de `exigir()`, el que la 14.0 puso al lado del rol: «ver sí, tocar no». Sin él
// vuelve en silencio el comportamiento de la 13.x —se guarda local, la cola espera y al volver internet
// sube con el `previo` viejo, pisando lo que otro mostrador escribió mientras tanto—, y no hay ninguna
// otra prueba que lo note: `vivo.prueba.ts` llama a `exigirConexion()` contra la clase, nunca a través
// de `exigirEdicion`, que es el renglón que los une.
test('sin canal en vivo se puede mirar pero no tocar', async () => {
  baseLocal()
  const recortada = permisosPorDefecto()
  recortada.EMPLEADO.marketing = 'ninguno'
  await guardarPermisos(recortada, DANIEL)
  try {
    // La computadora sin internet: hay puente configurado (el VPS de la agencia) y el socket cerrado.
    // No se llama a `arrancar()`, así que no se abre nada: alcanza con que el canal exista y esté caído.
    usarCanal(new CanalEnVivo({ credenciales: { urlBase: 'http://vps-de-la-agencia.invalido', token: 'x' } }))
    conSesion(MARIA, () => {
      // Mirar sigue andando: la copia local está y la gente tiene que poder atender el mostrador.
      assert.equal(exigirVista('cartera').usuario, 'maria')
      assert.throws(() => exigirEdicion('cartera'), SinConexion, 'sin canal no se escribe')
      // El orden importa: a quien NO tiene permiso hay que decirle que no tiene permiso, no que no hay
      // internet, porque eso lo manda a reiniciar el router por algo que no se le va a arreglar nunca.
      assert.throws(() => exigirEdicion('marketing'), /No tenés permiso para modificar Marketing/)
    })

    // Sin puente configurado —la máquina de desarrollo y el resto de este banco— no se exige nada:
    // ahí no hay servidor al que conectarse y trabar el programa entero no protegería a nadie.
    usarCanal(new CanalEnVivo({ credenciales: null }))
    conSesion(MARIA, () => {
      assert.equal(exigirEdicion('cartera').usuario, 'maria')
    })
  } finally {
    usarCanal(null)
  }
})

test('sin sesión abierta no se exige permiso: primero hay que ingresar', () => {
  baseLocal()
  establecerSesion(null)
  assert.throws(() => exigirVista('cartera'), /iniciar sesión/)
  establecerSesion(DANIEL)
})

test('sólo el superadministrador puede cambiar la matriz, y no se acepta cualquier cosa', async () => {
  baseLocal()
  await rechaza(guardarPermisos(permisosPorDefecto(), ANA), /sólo el superadministrador/i)
  await rechaza(guardarPermisos(null, DANIEL), /no tienen la forma esperada/)
  await rechaza(guardarPermisos({}, DANIEL), /están vacíos/)
  await rechaza(guardarPermisos({ EMPLEADO: {} }, DANIEL), /están vacíos/)

  // Guardar lo mismo que ya regía no ensucia el historial.
  await guardarPermisos(permisosPorDefecto(), DANIEL)
  const { total } = db().prepare(`SELECT COUNT(*) AS total FROM historial WHERE accion = 'permisos'`).get() as { total: number }
  assert.equal(total, 0)
})

test('la pantalla avisa cuando la matriz la cambió otro y no puede editarla quien no es superadministrador', async () => {
  baseLocal()
  assert.equal(matrizDePermisos(ANA).puedeEditar, false)
  assert.equal(matrizDePermisos(DANIEL).puedeEditar, true)
})

// ---------------------------------------------------------------------------
// Con base de usuarios compartida
// ---------------------------------------------------------------------------

test('con base compartida la matriz viaja en usuarios.json y llega a las demás computadoras', async () => {
  const almacen = await computadoraPrincipal()
  const recortada = permisosPorDefecto()
  recortada.EMPLEADO.metricas = 'ninguno'
  recortada.ADMIN.marketing = 'ver'
  const guardada = await guardarPermisos(recortada, actor())
  assert.equal(guardada.origen, 'compartida')

  // Quedó escrita en el archivo compartido, al lado de los usuarios.
  assert.ok(almacen.texto)
  const remoto = leerDocumento(almacen.texto)
  assert.equal(remoto.permisos.EMPLEADO.metricas, 'ninguno')
  assert.equal(remoto.permisos.ADMIN.marketing, 'ver')
  assert.equal(remoto.usuarios.length, 1, 'guardar permisos no toca la lista de usuarios')

  // Otra computadora que lee el mismo archivo trabaja con la misma matriz.
  computadora(almacen)
  await ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-1' })
  assert.equal(puedeVer(MARIA, 'metricas'), false)
  assert.equal(puedeEditar(ANA, 'marketing'), false)
  assert.equal(puedeVer(ANA, 'marketing'), true)
  assert.equal(matrizDePermisos(actor()).origen, 'compartida')
})

test('la copia local deja trabajar con los permisos correctos aunque todavía no se haya podido leer GitHub', async () => {
  const almacen = await computadoraPrincipal()
  const recortada = permisosPorDefecto()
  recortada.EMPLEADO.reportes = 'ninguno'
  await guardarPermisos(recortada, actor())

  const copia = db().prepare(`SELECT valor FROM configuracion WHERE clave = 'permisos_roles'`).get() as { valor: string }
  assert.equal((JSON.parse(copia.valor) as MatrizPermisos).EMPLEADO.reportes, 'ninguno')

  // El programa arranca de nuevo en esta misma computadora: sigue trabajando contra la base
  // compartida (`usaBaseCompartida()` es true porque la base local recuerda el modo), pero todavía no
  // pudo leer el archivo. Es el caso del ingreso sin internet, y ahí manda la copia local.
  base.configurarBaseDeUsuarios({
    almacen,
    credenciales: new AlmacenDeCredencial(path.join(carpetaTemporal(), 'credencial.bin'), cifradorDePrueba()),
    memoriaSinInternetMs: 0,
    registrar: () => undefined,
  })
  olvidarLoConocido()
  assert.equal(base.usaBaseCompartida(), true, 'la computadora sigue en modo compartido')
  assert.equal(base.ultimoDocumentoLeido(), null, 'todavía no se leyó el archivo')
  assert.equal(puedeVer(MARIA, 'reportes'), false, 'la copia local manda mientras no se pueda leer GitHub')
})

test('la fecha de «última actualización» no se mueve por abrir el programa', async () => {
  const almacen = await computadoraPrincipal()
  const recortada = permisosPorDefecto()
  recortada.EMPLEADO.metricas = 'ver'
  await guardarPermisos(recortada, actor())
  const cuandoCambio = matrizDePermisos(actor()).actualizadoEn
  assert.ok(cuandoCambio)

  // Arranca de nuevo y vuelve a leer el archivo: la matriz es la misma, así que la fecha no se toca.
  base.configurarBaseDeUsuarios({
    almacen,
    credenciales: new AlmacenDeCredencial(path.join(carpetaTemporal(), 'credencial.bin'), cifradorDePrueba()),
    memoriaSinInternetMs: 0,
    registrar: () => undefined,
  })
  olvidarLoConocido()
  await base.comprobarAcceso()
  matrizVigente()
  assert.equal(matrizDePermisos(DANIEL).actualizadoEn, cuandoCambio, 'abrir el programa no es cambiar la matriz')
})

test('cuando otra computadora cambia la matriz, la pantalla se entera al bajar el archivo', async () => {
  const almacen = await computadoraPrincipal()
  const avisos: MatrizPermisos[] = []
  conectarAvisoDePermisos((permisos) => avisos.push(permisos))
  try {
    // La primera lectura fija la línea de base: es la que la pantalla ya pidió al montarse.
    matrizVigente()
    assert.equal(avisos.length, 0)

    // Otra computadora guarda una matriz nueva: acá sólo aparece el archivo cambiado en GitHub.
    const documento = leerDocumento(almacen.texto ?? '')
    documento.permisos.EMPLEADO.metricas = 'ninguno'
    almacen.escribirDirecto(escribirDocumento(documento))

    // Es lo que hace la revalidación de la sesión cada 15 minutos.
    await base.comprobarAcceso()
    assert.equal(avisos.length, 1, 'la revalidación tiene que avisar aunque nadie haya pedido un permiso')
    assert.equal(avisos[0]!.EMPLEADO.metricas, 'ninguno')
    assert.equal(puedeVer(MARIA, 'metricas'), false)

    // Y no se avisa de gusto: releer lo mismo no vuelve a disparar.
    await base.comprobarAcceso()
    matrizVigente()
    assert.equal(avisos.length, 1)
  } finally {
    conectarAvisoDePermisos(null)
  }
})

test('guardar la matriz avisa una sola vez, no una por cada camino', async () => {
  baseLocal()
  const avisos: MatrizPermisos[] = []
  conectarAvisoDePermisos((permisos) => avisos.push(permisos))
  try {
    matrizVigente()
    const recortada = permisosPorDefecto()
    recortada.EMPLEADO.tareas = 'ver'
    await guardarPermisos(recortada, DANIEL)
    assert.equal(avisos.length, 1)
    assert.equal(avisos[0]!.EMPLEADO.tareas, 'ver')
  } finally {
    conectarAvisoDePermisos(null)
  }
})

test('un usuarios.json de una versión anterior (sin permisos) se lee con los valores por defecto', () => {
  const documento = leerDocumento(
    JSON.stringify({
      formato: 1,
      siguienteId: 2,
      usuarios: [
        {
          id: 1,
          nombre: 'Daniel Martínez',
          usuario: 'daniel',
          claveHash: '$2a$04$abcdefghijklmnopqrstuv',
          rol: 'SUPER_ADMIN',
          sucursal: 'Daniel',
          activo: true,
          debeCambiarClave: false,
        },
      ],
    }),
  )
  assert.deepEqual(documento.permisos, permisosPorDefecto())

  // Y al escribirlo de vuelta el archivo ya sale con la matriz explícita.
  const texto = escribirDocumento(documento)
  assert.ok(texto.includes('"permisos"'))
  assert.deepEqual(leerDocumento(texto).permisos, permisosPorDefecto())
})

test('los permisos configurados sin base compartida suben con los usuarios al inicializarla', async () => {
  // Primero se trabaja en local (todavía no se subió nada) y se recorta un permiso.
  baseLocal()
  const recortada = permisosPorDefecto()
  recortada.EMPLEADO.leads = 'ver'
  await guardarPermisos(recortada, DANIEL)

  // Y recién ahí se inicializa la base compartida desde esta misma computadora.
  const almacen = new AlmacenEnMemoria()
  base.configurarBaseDeUsuarios({
    almacen,
    credenciales: new AlmacenDeCredencial(path.join(carpetaTemporal(), 'credencial.bin'), cifradorDePrueba()),
    memoriaSinInternetMs: 0,
    registrar: () => undefined,
  })
  await ingresar({ usuario: 'daniel', clave: 'cambiar123' })
  await cambiarClave({ claveActual: 'cambiar123', claveNueva: 'Clave-Nueva-1' }, actor())
  await base.subirLocales(actor())

  assert.ok(almacen.texto)
  assert.equal(leerDocumento(almacen.texto).permisos.EMPLEADO.leads, 'ver')
})
