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
import { estadoDeAutorizaciones, pedirAutorizacion, resolverAutorizacion } from '../src/main/servicios/autorizaciones'
import {
  asignarRolDeUsuario,
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
import { nivelConcedido, vencimientoDe, type SolicitudDeAutorizacion } from '../src/shared/autorizaciones'
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
  assert.match(historial[0]!.valor_nuevo, /Cobranzas: Permitido → Solo lectura/)
  assert.match(historial[0]!.valor_nuevo, /Marketing: Permitido → Sin permiso/)
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

// ---------------------------------------------------------------------------
// Roles propios de la agencia
// ---------------------------------------------------------------------------

/** La matriz con un rol «Caja» (parte de Usuario) que sólo trabaja Cobranzas y mira Clientes. */
function conRolCaja(): MatrizPermisos {
  const matriz = permisosPorDefecto()
  const permisos = { ...matriz.EMPLEADO }
  for (const area of Object.keys(permisos) as Array<keyof typeof permisos>) permisos[area] = 'ninguno'
  permisos.cobranzas = 'editar'
  permisos.clientes = 'ver'
  matriz.personalizados.push({ id: 'caja', nombre: 'Caja', base: 'EMPLEADO', permisos })
  matriz.opciones.caja = { puedeSolicitar: true, puedeResolver: false }
  return matriz
}

test('un rol propio rige para quien lo tiene asignado y los demás no cambian', async () => {
  baseLocal()
  await guardarPermisos(conRolCaja(), DANIEL)
  await asignarRolDeUsuario(DANIEL, 'maria', 'caja')

  assert.equal(puedeEditar(MARIA, 'cobranzas'), true)
  assert.equal(puedeVer(MARIA, 'clientes'), true)
  assert.equal(puedeEditar(MARIA, 'clientes'), false)
  assert.equal(puedeVer(MARIA, 'siniestros'), false)
  const mios = misPermisos(MARIA)
  assert.equal(mios.rolNombre, 'Caja')
  assert.equal(mios.rol, 'EMPLEADO', 'el rol de base sigue siendo el del usuario: de ahí salen los controles que no son de la tabla')
  assert.equal(mios.puedeSolicitar, true)
  assert.equal(mios.puedeResolver, false)

  // Otro usuario con el mismo rol integrado no se entera.
  const OTRA: SesionUsuario = { ...MARIA, id: 9, usuario: 'otra', nombre: 'Otra Persona' }
  assert.equal(puedeEditar(OTRA, 'siniestros'), true)
  assert.equal(misPermisos(OTRA).rolNombre, 'Usuario')
  // Quien no tiene rol propio ve su rol integrado, y el superadministrador siempre todo.
  assert.equal(misPermisos(DANIEL).areas.siniestros, 'editar')
})

test('no se puede borrar un rol que tiene gente, ni repetir ni reusar nombres', async () => {
  baseLocal()
  await guardarPermisos(conRolCaja(), DANIEL)
  await asignarRolDeUsuario(DANIEL, 'maria', 'caja')

  const sinElRol = permisosPorDefecto()
  await rechaza(guardarPermisos(sinElRol, DANIEL), /lo tienen maria/)
  assert.equal(matrizVigente().personalizados.length, 1, 'no se borró')

  const repetido = conRolCaja()
  repetido.personalizados.push({ ...repetido.personalizados[0]!, id: 'caja2', nombre: 'caja' })
  await rechaza(guardarPermisos(repetido, DANIEL), /dos roles/)
  const reservado = conRolCaja()
  reservado.personalizados[0]!.nombre = 'Administrador'
  await rechaza(guardarPermisos(reservado, DANIEL), /ya existe/)

  // Sacándole el rol a la persona ya se puede borrar.
  await asignarRolDeUsuario(DANIEL, 'maria', null)
  assert.equal(misPermisos(MARIA).rolNombre, 'Usuario')
  await guardarPermisos(sinElRol, DANIEL)
  assert.equal(matrizVigente().personalizados.length, 0)
})

test('guardar permisos desde una pantalla vieja no pisa las asignaciones ni cambia la base de un rol', async () => {
  baseLocal()
  await guardarPermisos(conRolCaja(), DANIEL)
  await asignarRolDeUsuario(DANIEL, 'maria', 'caja')

  const vieja = conRolCaja() // sin asignaciones, como la pantalla que se abrió antes de asignar
  vieja.personalizados[0]!.base = 'ADMIN'
  vieja.personalizados[0]!.permisos.cobranzas = 'ver'
  await guardarPermisos(vieja, DANIEL)

  assert.equal(matrizVigente().asignaciones.maria, 'caja')
  assert.equal(matrizVigente().personalizados[0]!.base, 'EMPLEADO')
  assert.equal(puedeEditar(MARIA, 'cobranzas'), false)
})

test('la asignación acompaña al usuario si le cambian el nombre de usuario', async () => {
  baseLocal()
  await guardarPermisos(conRolCaja(), DANIEL)
  await asignarRolDeUsuario(DANIEL, 'maria', 'caja')
  await asignarRolDeUsuario(DANIEL, 'maria.perez', 'caja', 'maria')
  assert.deepEqual(matrizVigente().asignaciones, { 'maria.perez': 'caja' })
})

test('los roles propios y las asignaciones viajan en usuarios.json y los lee otra computadora', async () => {
  const almacen = await computadoraPrincipal()
  await guardarPermisos(conRolCaja(), actor())
  await asignarRolDeUsuario(actor(), 'maria', 'caja')

  const remoto = leerDocumento(almacen.texto!)
  assert.equal(remoto.permisos.personalizados[0]!.nombre, 'Caja')
  assert.equal(remoto.permisos.asignaciones.maria, 'caja')

  computadora(almacen)
  await ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-1' })
  assert.equal(puedeEditar(MARIA, 'cobranzas'), true)
  assert.equal(puedeVer(MARIA, 'siniestros'), false)
})

test('un usuarios.json sin roles propios ni autorizaciones se lee igual', () => {
  const matriz = normalizarMatriz({ ADMIN: {}, EMPLEADO: { cartera: 'ver' } })
  assert.deepEqual(matriz.personalizados, [])
  assert.deepEqual(matriz.asignaciones, {})
  assert.equal(matriz.opciones.ADMIN!.puedeResolver, true)
  assert.equal(matriz.opciones.EMPLEADO!.puedeSolicitar, false)
  // Una asignación a un rol que no existe se descarta.
  assert.deepEqual(normalizarMatriz({ asignaciones: { maria: 'fantasma' } }).asignaciones, {})
})

// ---------------------------------------------------------------------------
// Autorizaciones puntuales
// ---------------------------------------------------------------------------

/** El Usuario no ve Marketing y puede pedir; el Administrador resuelve (valor por defecto). */
async function conPedidosHabilitados(): Promise<void> {
  const matriz = permisosPorDefecto()
  matriz.EMPLEADO.marketing = 'ninguno'
  matriz.EMPLEADO.cobranzas = 'ver'
  matriz.opciones.EMPLEADO = { puedeSolicitar: true, puedeResolver: false }
  await guardarPermisos(matriz, DANIEL)
}

test('quien puede solicitar pide un módulo, se le concede y el acceso se suma a su rol', async () => {
  baseLocal()
  await conPedidosHabilitados()
  assert.equal(puedeVer(MARIA, 'marketing'), false)

  const pedido = await pedirAutorizacion(MARIA, { area: 'marketing', nivel: 'ver', motivo: 'Necesito mirar los segmentos' })
  assert.equal(pedido.mias.length, 1)
  assert.equal(pedido.mias[0]!.estado, 'pendiente')

  // Ana (administrador) lo ve en sus pendientes y contesta con un mensaje.
  const deAna = await estadoDeAutorizaciones(ANA, false)
  assert.equal(deAna.puedeResolver, true)
  assert.equal(deAna.pendientes.length, 1)
  assert.equal(deAna.pendientes[0]!.motivo, 'Necesito mirar los segmentos')
  await resolverAutorizacion(ANA, { id: deAna.pendientes[0]!.id, decision: 'ver', mensaje: 'Sólo hasta que termines el informe', duracion: 'hoy' })

  // María ya puede mirar Marketing, pero no tocarlo, y la respuesta con el mensaje le llega.
  assert.equal(puedeVer(MARIA, 'marketing'), true)
  assert.equal(puedeEditar(MARIA, 'marketing'), false)
  assert.equal(misPermisos(MARIA).areas.marketing, 'ver')
  const deMaria = await estadoDeAutorizaciones(MARIA, false)
  assert.equal(deMaria.mias[0]!.estado, 'concedida')
  assert.equal(deMaria.mias[0]!.mensaje, 'Sólo hasta que termines el informe')
  assert.equal(deMaria.mias[0]!.resueltaPor, 'Ana Ruiz')
  assert.equal(deMaria.pendientes.length, 0, 'no ve los pedidos de los demás')

  // Después pide poder escribir, y ahora sí lectura y escritura.
  await pedirAutorizacion(MARIA, { area: 'marketing', nivel: 'editar', motivo: '' })
  const otra = (await estadoDeAutorizaciones(DANIEL, false)).pendientes[0]!
  await resolverAutorizacion(DANIEL, { id: otra.id, decision: 'editar', mensaje: '', duracion: 'hora' })
  assert.equal(puedeEditar(MARIA, 'marketing'), true)
})

test('una autorización denegada no abre nada y deja el mensaje', async () => {
  baseLocal()
  await conPedidosHabilitados()
  await pedirAutorizacion(MARIA, { area: 'marketing', nivel: 'editar', motivo: '' })
  const pendiente = (await estadoDeAutorizaciones(ANA, false)).pendientes[0]!
  await resolverAutorizacion(ANA, { id: pendiente.id, decision: 'ninguno', mensaje: 'Eso lo ve sólo Daniel', duracion: 'hoy' })

  assert.equal(puedeVer(MARIA, 'marketing'), false)
  const mias = (await estadoDeAutorizaciones(MARIA, false)).mias
  assert.equal(mias[0]!.estado, 'denegada')
  assert.equal(mias[0]!.mensaje, 'Eso lo ve sólo Daniel')
  // Ya no está pendiente: no se puede resolver de nuevo.
  await rechaza(resolverAutorizacion(ANA, { id: pendiente.id, decision: 'ver', mensaje: '', duracion: 'hoy' }), /ya lo resolvió/)
})

test('las reglas de quién pide, quién resuelve y hasta dónde', async () => {
  baseLocal()
  await conPedidosHabilitados()
  // Ana no tiene tildado «puede solicitar».
  await rechaza(pedirAutorizacion(ANA, { area: 'marketing', nivel: 'ver', motivo: '' }), /no puede pedir/)
  // María no puede resolver.
  await pedirAutorizacion(MARIA, { area: 'marketing', nivel: 'ver', motivo: '' })
  const pendiente = (await estadoDeAutorizaciones(ANA, false)).pendientes[0]!
  await rechaza(resolverAutorizacion(MARIA, { id: pendiente.id, decision: 'ver', mensaje: '', duracion: 'hoy' }), /no puede resolver/)
  // Un pedido por módulo a la vez, y no se pide lo que ya se tiene.
  await rechaza(pedirAutorizacion(MARIA, { area: 'marketing', nivel: 'editar', motivo: '' }), /pedido pendiente/)
  await rechaza(pedirAutorizacion(MARIA, { area: 'cartera', nivel: 'editar', motivo: '' }), /no hace falta pedirlo/)
  await rechaza(pedirAutorizacion(MARIA, { area: 'inventado', nivel: 'ver', motivo: '' }), /Elegí a qué módulo/)

  // Un rol que resuelve no puede dar más de lo que él mismo tiene en el módulo.
  const matriz = matrizVigente()
  matriz.ADMIN.marketing = 'ninguno'
  await guardarPermisos(matriz, DANIEL)
  await rechaza(resolverAutorizacion(ANA, { id: pendiente.id, decision: 'ver', mensaje: '', duracion: 'hoy' }), /vos mismo no lo tenés/)
  // Pero el superadministrador sí, y no se puede resolver el propio pedido.
  await resolverAutorizacion(DANIEL, { id: pendiente.id, decision: 'ver', mensaje: '', duracion: 'hoy' })
  assert.equal(puedeVer(MARIA, 'marketing'), true)
})

test('una autorización sólo sube el nivel: no le saca a nadie lo que ya tenía', async () => {
  baseLocal()
  await conPedidosHabilitados()
  await pedirAutorizacion(MARIA, { area: 'cobranzas', nivel: 'editar', motivo: '' })
  const pendiente = (await estadoDeAutorizaciones(ANA, false)).pendientes[0]!
  // Concede «solo lectura» sobre un módulo que ya tenía en «solo lectura»: nada cambia.
  await resolverAutorizacion(ANA, { id: pendiente.id, decision: 'ver', mensaje: '', duracion: 'hoy' })
  assert.equal(puedeVer(MARIA, 'cobranzas'), true)
  assert.equal(puedeEditar(MARIA, 'cobranzas'), false)
  assert.equal(puedeEditar(MARIA, 'cartera'), true, 'lo demás sigue como estaba')
})

test('las concesiones vencen y la duración se calcula bien', () => {
  const solicitud: SolicitudDeAutorizacion = {
    id: 'a', usuario: 'maria', nombre: 'María', area: 'marketing', nivelPedido: 'editar', motivo: '', creadaEn: '2026-01-01T10:00:00.000Z',
    estado: 'concedida', nivelOtorgado: 'editar', resueltaPor: 'Ana', resueltaEn: '2026-01-01T10:05:00.000Z', mensaje: '',
    venceEn: '2026-01-01T11:00:00.000Z', vista: false,
  }
  const antes = Date.parse('2026-01-01T10:30:00.000Z')
  const despues = Date.parse('2026-01-01T11:00:01.000Z')
  assert.equal(nivelConcedido([solicitud], 'MARIA', 'marketing', antes), 'editar')
  assert.equal(nivelConcedido([solicitud], 'maria', 'marketing', despues), 'ninguno')
  assert.equal(nivelConcedido([solicitud], 'maria', 'cartera', antes), 'ninguno')
  assert.equal(nivelConcedido([solicitud], 'otra', 'marketing', antes), 'ninguno')
  const ahora = new Date('2026-03-10T09:15:00')
  assert.equal(Date.parse(vencimientoDe('cuatroHoras', ahora)) - ahora.getTime(), 4 * 3_600_000)
  const fin = new Date(vencimientoDe('hoy', ahora))
  assert.equal(fin.getDate(), 10)
  assert.equal(fin.getHours(), 23)
})

test('con base compartida los pedidos viajan en usuarios.json y otra computadora los ve', async () => {
  const almacen = await computadoraPrincipal()
  const matriz = permisosPorDefecto()
  matriz.EMPLEADO.marketing = 'ninguno'
  matriz.opciones.EMPLEADO = { puedeSolicitar: true, puedeResolver: false }
  await guardarPermisos(matriz, actor())

  await pedirAutorizacion({ ...MARIA, id: actor().id }, { area: 'marketing', nivel: 'ver', motivo: 'Para el informe' })
  const remoto = leerDocumento(almacen.texto!)
  assert.equal(remoto.autorizaciones.length, 1)
  assert.equal(remoto.autorizaciones[0]!.usuario, 'maria')
  assert.equal(remoto.usuarios.length, 1, 'no toca la lista de usuarios')

  // Daniel lo resuelve desde otra computadora y María lo ve al volver a leer.
  computadora(almacen)
  await ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-1' })
  const pendiente = (await estadoDeAutorizaciones(actor(), false)).pendientes[0]!
  await resolverAutorizacion(actor(), { id: pendiente.id, decision: 'editar', mensaje: 'Dale', duracion: 'semana' })
  assert.equal(leerDocumento(almacen.texto!).autorizaciones[0]!.estado, 'concedida')
  assert.equal(puedeEditar(MARIA, 'marketing'), true)
})
