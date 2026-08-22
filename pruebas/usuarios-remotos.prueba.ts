// La base de usuarios compartida de punta a punta, con un almacén en memoria que se comporta como
// GitHub (sha optimista) y un cifrador de mentira para la credencial: dos «computadoras» que
// comparten el archivo, ingreso en línea y sin internet, bootstrap explícito, conflictos, escrituras
// cortadas, revalidación de la sesión y lo que pasa cuando otra PC desactiva a alguien.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { hashSync } from 'bcryptjs'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db, type BaseDeDatos } from '../src/main/db/base'
import { cambiarClave, ingresar, salir } from '../src/main/servicios/auth'
import * as base from '../src/main/servicios/baseDeUsuarios'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { sesion } from '../src/main/servicios/sesion'
import { cambiarActivo, crearUsuario, editarUsuario, listarUsuarios, resetearClave } from '../src/main/servicios/usuarios'
import { AlmacenDeCredencial, cifradorDePrueba } from '../src/main/usuarios/credencial'
import { AlmacenEnMemoria, ErrorDelAlmacen } from '../src/main/usuarios/almacen'
import { escribirDocumento, leerDocumento } from '../src/main/usuarios/documento'
import type { EstadoDeAcceso, SesionUsuario } from '../src/shared/tipos'
import { unico } from './ayuda'

const LANUS = 2
const DANIEL_SUCURSAL = 3

function baseNueva(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    return abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
}

interface Entorno {
  almacen: AlmacenEnMemoria
  credenciales: AlmacenDeCredencial
  reloj: { ahora: Date }
  cerradas: string[]
  estados: EstadoDeAcceso[]
}

/** Carpetas temporales de credenciales: se borran al final de la corrida. */
const carpetasTemporales: string[] = []
test.after(() => {
  for (const carpeta of carpetasTemporales) rmSync(carpeta, { recursive: true, force: true })
})

function carpetaTemporal(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-cred-'))
  carpetasTemporales.push(carpeta)
  return carpeta
}

/** Una «computadora»: su carpeta de credencial y su reloj. El almacén se comparte entre PCs. */
function computadora(almacen: AlmacenEnMemoria | null, carpeta = carpetaTemporal()): Entorno {
  const credenciales = new AlmacenDeCredencial(path.join(carpeta, 'credencial.bin'), cifradorDePrueba())
  const reloj = { ahora: new Date('2026-08-22T12:00:00Z') }
  base.configurarBaseDeUsuarios({ almacen, credenciales, version: '9.9.9', nombreDeEquipo: 'PC-PRUEBA', ahora: () => reloj.ahora, memoriaSinInternetMs: 0, registrar: () => undefined })
  const cerradas: string[] = []
  const estados: EstadoDeAcceso[] = []
  base.conectarEmisor({ estado: (e) => estados.push(e), sesionActualizada: () => undefined, sesionCerrada: (m) => cerradas.push(m) })
  return { almacen: almacen ?? new AlmacenEnMemoria(), credenciales, reloj, cerradas, estados }
}

function fallaDeRed(): Error {
  const error = new Error('fetch failed') as Error & { cause?: { code: string } }
  error.cause = { code: 'ENOTFOUND' }
  return error
}

function tokenVencido(): Error {
  return new ErrorDelAlmacen('GitHub rechazó el token de la base de usuarios: no es válido o venció (HTTP 401).', 401)
}

async function rechaza(promesa: Promise<unknown>, esperado: RegExp): Promise<void> {
  await assert.rejects(promesa, (error: unknown) => {
    assert.ok(error instanceof ErrorDeNegocio, `Se esperaba ErrorDeNegocio y vino ${String(error)}`)
    assert.match(error.message, esperado)
    return true
  })
}

function actor(): SesionUsuario {
  const actual = sesion()
  assert.ok(actual, 'No hay sesión abierta')
  return actual
}

function documentoRemoto(almacen: AlmacenEnMemoria) {
  assert.ok(almacen.texto, 'El almacén no tiene archivo')
  return leerDocumento(almacen.texto)
}

function filaLocal(usuario: string) {
  return db().prepare('SELECT id, clave_hash, remoto_id, activo, sucursal_id, debe_cambiar_clave FROM usuarios WHERE usuario = ?').get(usuario) as
    | { id: number; clave_hash: string; remoto_id: number | null; activo: number; sucursal_id: number; debe_cambiar_clave: number }
    | undefined
}

/** La PC principal: daniel cambia la contraseña inicial y sube los usuarios locales a GitHub. */
async function computadoraPrincipalInicializada(almacen = new AlmacenEnMemoria()): Promise<Entorno> {
  baseNueva()
  const pc = computadora(almacen)
  await ingresar({ usuario: 'daniel', clave: 'cambiar123' })
  await cambiarClave({ claveActual: 'cambiar123', claveNueva: 'Clave-Nueva-1' }, actor())
  await base.subirLocales(actor())
  return pc
}

/** La PC principal ya inicializada y con «maria» creada; devuelve el almacén compartido. */
async function conMaria(): Promise<Entorno> {
  const pc = await computadoraPrincipalInicializada()
  await crearUsuario({ nombre: 'María Pérez', usuario: 'maria', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor())
  return pc
}

/** Una segunda PC donde maria ya ingresó con internet y eligió su contraseña (queda su credencial). */
async function computadoraDeMaria(almacen: AlmacenEnMemoria, clave = 'Temporal-123'): Promise<Entorno> {
  baseNueva()
  const pc = computadora(almacen)
  await ingresar({ usuario: 'maria', clave })
  if (clave === 'Temporal-123') await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())
  return pc
}

// ---------------------------------------------------------------------------

test('sin base compartida configurada, el ingreso y la administración siguen siendo locales', async () => {
  baseNueva()
  computadora(null)
  const abierta = await ingresar({ usuario: 'daniel', clave: 'cambiar123' })
  assert.equal(abierta.usuario, 'daniel')
  assert.equal(base.estadoDeAcceso().modo, 'local')
  assert.equal(base.estadoDeAcceso().configurada, false)
  assert.equal(base.identidadActual()?.modo, 'local')

  const creado = await crearUsuario({ nombre: 'Lucía Gómez', usuario: 'lucia', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor())
  assert.equal(creado.usuario, 'lucia')
  assert.notEqual(filaLocal('lucia')?.clave_hash, '', 'en modo local el hash vive en la tabla')
  assert.equal((await base.estadoDeUsuarios(true)).origen, 'local')
})

test('configurada pero sin inicializar: se ingresa local, y subir los usuarios exige cambiar la semilla primero', async () => {
  baseNueva()
  const pc = computadora(new AlmacenEnMemoria())
  await ingresar({ usuario: 'daniel', clave: 'cambiar123' })
  assert.equal(base.estadoDeAcceso().modo, 'sin-inicializar')
  assert.equal(base.identidadActual()?.modo, 'sin-inicializar')

  const estado = await base.estadoDeUsuarios(true)
  assert.equal(estado.origen, 'sin-inicializar')
  assert.deepEqual(estado.localesParaSubir, ['daniel'])

  // La semilla sin cambiar no se sube: sería dejar a toda la agencia con daniel/cambiar123.
  await rechaza(base.subirLocales(actor()), /contraseña inicial/)
  assert.equal(pc.almacen.escrituras, 0)

  await cambiarClave({ claveActual: 'cambiar123', claveNueva: 'Clave-Nueva-1' }, actor())
  const despues = await base.subirLocales(actor())
  assert.equal(despues.origen, 'github')
  assert.equal(pc.almacen.escrituras, 1)

  const remoto = documentoRemoto(pc.almacen)
  assert.equal(remoto.usuarios.length, 1)
  assert.equal(remoto.usuarios[0]!.usuario, 'daniel')
  assert.equal(remoto.usuarios[0]!.rol, 'SUPER_ADMIN')
  assert.equal(remoto.usuarios[0]!.sucursal, 'Daniel')
  assert.match(remoto.usuarios[0]!.claveHash, /^\$2[aby]\$/)
  assert.equal(remoto.usuarios[0]!.debeCambiarClave, false)

  const local = filaLocal('daniel')
  assert.equal(local?.clave_hash, '', 'después de subir, la contraseña ya no vive en esta computadora')
  assert.equal(local?.remoto_id, 1)
  assert.equal(unico(db(), `SELECT valor FROM configuracion WHERE clave = 'usuarios_modo'`), 'github')
  assert.equal(base.estadoDeAcceso().modo, 'en-linea')
  assert.equal(base.estadoDeAcceso().cantidad, 1)
  assert.equal(pc.credenciales.usuarioGuardado(), 'daniel')
  assert.equal(base.identidadActual()?.modo, 'en-linea')
  assert.equal(actor().id, 1)
  // El mensaje de commit deja rastro de quién, desde dónde y con qué versión.
  assert.equal(pc.almacen.escrituras, 1)
})

test('crear un usuario lo deja en GitHub con contraseña temporal, sin hash local, y entra desde otra computadora', async () => {
  const principal = await conMaria()
  const remoto = documentoRemoto(principal.almacen)
  const maria = remoto.usuarios.find((u) => u.usuario === 'maria')
  assert.ok(maria)
  assert.equal(maria.debeCambiarClave, true)
  assert.equal(maria.sucursal, 'Lanús')
  assert.equal(maria.id, 2)
  assert.equal(filaLocal('maria')?.clave_hash, '')
  assert.equal(filaLocal('maria')?.remoto_id, 2)
  assert.equal(listarUsuarios().length, 2)

  // Otra computadora, recién instalada: tiene la semilla daniel/cambiar123 y nada más.
  baseNueva()
  const segunda = computadora(principal.almacen)
  const abierta = await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
  assert.equal(abierta.debeCambiarClave, true)
  assert.equal(abierta.sucursal.nombre, 'Lanús')
  assert.equal(base.estadoDeAcceso().modo, 'en-linea')
  assert.equal(segunda.credenciales.usuarioGuardado(), null, 'con una contraseña temporal de otro no se guarda credencial')

  // La semilla local quedó enganchada al daniel de GitHub: su contraseña ya no es cambiar123.
  assert.equal(filaLocal('daniel')?.remoto_id, 1)
  assert.equal(filaLocal('daniel')?.clave_hash, '')
  salir()
  await rechaza(ingresar({ usuario: 'daniel', clave: 'cambiar123' }), /incorrectos/)
  await ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-1' })
  assert.equal(actor().rol, 'SUPER_ADMIN')
  salir()

  // maria elige su contraseña: recién ahí queda su credencial para ingresar sin internet.
  await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
  const cambiada = await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())
  assert.equal(cambiada.debeCambiarClave, false)
  assert.equal(segunda.credenciales.usuarioGuardado(), 'maria')
  assert.equal(documentoRemoto(principal.almacen).usuarios.find((u) => u.usuario === 'maria')?.debeCambiarClave, false)
})

test('sin internet entra sólo quien ingresó último con conexión, con su contraseña y sin distinguir mayúsculas, por 30 días', async () => {
  const principal = await conMaria()
  const pc = await computadoraDeMaria(principal.almacen)
  salir()

  pc.almacen.falla = fallaDeRed
  const abierta = await ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' })
  assert.equal(abierta.rol, 'EMPLEADO')
  assert.equal(abierta.sucursal.nombre, 'Lanús')
  assert.equal(base.estadoDeAcceso().modo, 'sin-internet')
  assert.equal(base.estadoDeAcceso().sesionSinConfirmar, true)
  assert.equal(base.identidadActual()?.modo, 'sin-internet')
  salir()

  await rechaza(ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-1' }), /Sin internet.*sólo puede ingresar «maria»/)
  await rechaza(ingresar({ usuario: 'maria', clave: 'otra' }), /incorrectos/)
  await ingresar({ usuario: 'MARIA', clave: 'Maria-Segura-1' })
  salir()

  pc.reloj.ahora = new Date('2026-09-25T12:00:00Z')
  await rechaza(ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' }), /30 días/)
  pc.reloj.ahora = new Date('2026-08-23T12:00:00Z')

  // GitHub responde pero mal (token vencido): mismo camino, otro mensaje, y el error queda anotado.
  pc.almacen.falla = tokenVencido
  await ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' })
  assert.equal(base.estadoDeAcceso().modo, 'error-remoto')
  assert.match(base.estadoDeAcceso().ultimoError ?? '', /token/)
  salir()
  await rechaza(ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-1' }), /no pudo acceder a la base de usuarios.*«maria»/)
})

test('sin credencial guardada no se puede ingresar sin internet, y la credencial de otra cuenta se descarta', async () => {
  const principal = await conMaria()
  baseNueva()
  const pc = computadora(principal.almacen)
  pc.almacen.falla = fallaDeRed
  await rechaza(ingresar({ usuario: 'maria', clave: 'Temporal-123' }), /primera vez.*hace falta conexión/)
  pc.almacen.falla = tokenVencido
  await rechaza(ingresar({ usuario: 'maria', clave: 'Temporal-123' }), /no pudo acceder a la base de usuarios/)
  assert.equal(base.estadoDeAcceso().usuarioGuardado, null)
})

test('sin internet no se administra; una sesión nacida sin conexión recién administra cuando se confirma', async () => {
  const pc = await computadoraPrincipalInicializada()
  pc.almacen.falla = fallaDeRed
  await rechaza(crearUsuario({ nombre: 'José Ruiz', usuario: 'jose', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor()), /conexión a internet/)
  await rechaza(cambiarClave({ claveActual: 'Clave-Nueva-1', claveNueva: 'Clave-Nueva-2' }, actor()), /conexión a internet/)
  assert.equal(pc.almacen.escrituras, 1)

  salir()
  await ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-1' })
  assert.equal(base.identidadActual()?.modo, 'sin-internet')
  pc.almacen.falla = null
  await rechaza(crearUsuario({ nombre: 'José Ruiz', usuario: 'jose', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor()), /todavía no se confirmó/)

  await base.revalidarAhora()
  assert.equal(base.identidadActual()?.modo, 'en-linea')
  assert.equal(base.estadoDeAcceso().sesionSinConfirmar, false)
  const creado = await crearUsuario({ nombre: 'José Ruiz', usuario: 'jose', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor())
  assert.equal(creado.usuario, 'jose')
  assert.equal(pc.almacen.escrituras, 2)
})

test('si otra computadora escribe en el medio se relee y reintenta; si la escritura se corta, se comprueba si quedó', async () => {
  const pc = await computadoraPrincipalInicializada()
  pc.almacen.conflictosPendientes = 2
  await crearUsuario({ nombre: 'José Ruiz', usuario: 'jose', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor())
  assert.equal(pc.almacen.escrituras, 2)
  assert.equal(documentoRemoto(pc.almacen).usuarios.filter((u) => u.usuario === 'jose').length, 1)

  pc.almacen.escriturasSinRespuesta = 1
  await crearUsuario({ nombre: 'Ana Díaz', usuario: 'ana', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor())
  assert.equal(pc.almacen.escrituras, 3, 'la escritura cortada había llegado: no se repite')
  assert.equal(documentoRemoto(pc.almacen).usuarios.filter((u) => u.usuario === 'ana').length, 1)
  assert.equal(filaLocal('ana')?.remoto_id, 3)
  assert.equal(base.estadoDeAcceso().modo, 'en-linea')
})

test('desactivar o cambiar la contraseña desde otra computadora cierra la sesión al revalidar y borra la credencial', async () => {
  const principal = await conMaria()
  const pc = await computadoraDeMaria(principal.almacen)
  assert.equal(pc.credenciales.usuarioGuardado(), 'maria')

  // Otra PC desactiva a maria.
  const documento = documentoRemoto(pc.almacen)
  pc.almacen.escribirDirecto(escribirDocumento({ ...documento, usuarios: documento.usuarios.map((u) => (u.usuario === 'maria' ? { ...u, activo: false } : u)) }))
  await base.revalidarAhora()
  assert.equal(sesion(), null)
  assert.match(pc.cerradas[0] ?? '', /desactivado/)
  assert.equal(pc.credenciales.usuarioGuardado(), null)
  assert.equal(filaLocal('maria')?.activo, 0)

  // Otra PC le cambia la contraseña: maria entra sin internet con la vieja, y al volver la red se la saca.
  const reactivado = documentoRemoto(pc.almacen)
  pc.almacen.escribirDirecto(escribirDocumento({ ...reactivado, usuarios: reactivado.usuarios.map((u) => (u.usuario === 'maria' ? { ...u, activo: true } : u)) }))
  const pc2 = await computadoraDeMaria(principal.almacen, 'Maria-Segura-1')
  const doc2 = documentoRemoto(pc2.almacen)
  pc2.almacen.escribirDirecto(escribirDocumento({ ...doc2, usuarios: doc2.usuarios.map((u) => (u.usuario === 'maria' ? { ...u, claveHash: hashSync('Otra-Clave-9', 4) } : u)) }))
  salir()
  pc2.almacen.falla = fallaDeRed
  await ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' })
  pc2.almacen.falla = null
  await base.revalidarAhora()
  assert.equal(sesion(), null)
  assert.match(pc2.cerradas[0] ?? '', /contraseña.*cambió/)

  // En línea con la contraseña vieja: no entra, y la credencial vieja se descarta.
  await rechaza(ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' }), /incorrectos/)
  assert.equal(pc2.credenciales.usuarioGuardado(), null)
  await ingresar({ usuario: 'maria', clave: 'Otra-Clave-9' })
  assert.equal(pc2.credenciales.usuarioGuardado(), 'maria')
})

test('usuario desactivado en línea: no entra y pierde la credencial; reactivado, vuelve a entrar', async () => {
  const principal = await conMaria()
  const pc = await computadoraDeMaria(principal.almacen)
  salir()
  const documento = documentoRemoto(pc.almacen)
  pc.almacen.escribirDirecto(escribirDocumento({ ...documento, usuarios: documento.usuarios.map((u) => (u.usuario === 'maria' ? { ...u, activo: false } : u)) }))
  await rechaza(ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' }), /desactivado/)
  assert.equal(pc.credenciales.usuarioGuardado(), null)
  pc.almacen.falla = fallaDeRed
  await rechaza(ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' }), /primera vez/)
})

test('renombrarse o resetear la propia contraseña actualiza la credencial; las reglas de superadministrador se conservan', async () => {
  const pc = await computadoraPrincipalInicializada()
  await rechaza(editarUsuario(1, { nombre: 'Daniel', usuario: 'daniel', rol: 'EMPLEADO', sucursalId: DANIEL_SUCURSAL }, actor()), /propio rol/)
  await rechaza(cambiarActivo(1, false, actor()), /propio usuario/)

  const editado = await editarUsuario(1, { nombre: 'Daniel M.', usuario: 'dani', rol: 'SUPER_ADMIN', sucursalId: LANUS }, actor())
  assert.equal(editado.usuario, 'dani')
  assert.equal(actor().usuario, 'dani')
  assert.equal(actor().sucursal.nombre, 'Lanús')
  assert.equal(pc.credenciales.usuarioGuardado(), 'dani')
  assert.equal(filaLocal('dani')?.remoto_id, 1)

  await resetearClave(1, 'Otra-Clave-77', actor())
  assert.equal(actor().debeCambiarClave, false)
  salir()
  pc.almacen.falla = fallaDeRed
  await ingresar({ usuario: 'dani', clave: 'Otra-Clave-77' })
  assert.equal(base.identidadActual()?.modo, 'sin-internet')
  salir()
  pc.almacen.falla = null

  // Un segundo superadministrador permite bajar de rol al primero; sin él, no.
  await ingresar({ usuario: 'dani', clave: 'Otra-Clave-77' })
  const segundo = await crearUsuario({ nombre: 'Admin Dos', usuario: 'admin2', clave: 'Temporal-123', rol: 'SUPER_ADMIN', sucursalId: LANUS }, actor())
  const desactivado = await cambiarActivo(segundo.id, false, actor())
  assert.equal(desactivado.activo, false)
  assert.equal(documentoRemoto(pc.almacen).usuarios.find((u) => u.usuario === 'admin2')?.activo, false)
  // Con admin2 desactivado, dani vuelve a ser el único superadministrador activo: no puede bajar de rol.
  await rechaza(editarUsuario(1, { nombre: 'Daniel M.', usuario: 'dani', rol: 'ADMIN', sucursalId: LANUS }, actor()), /propio rol/)
  await rechaza(crearUsuario({ nombre: 'Repetido', usuario: 'ADMIN2', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor()), /Ya existe/)
  // Resetear la contraseña de OTRO fuerza el cambio; la propia, no.
  const reseteado = await resetearClave(segundo.id, 'Temporal-999', actor())
  assert.equal(reseteado.debeCambiarClave, true)
})

test('un archivo sin superadministrador activo o de un formato desconocido se rechaza y nunca se escribe encima', async () => {
  const pc = await computadoraPrincipalInicializada()
  const escriturasAntes = pc.almacen.escrituras
  const documento = documentoRemoto(pc.almacen)
  pc.almacen.escribirDirecto(escribirDocumento({ ...documento, usuarios: documento.usuarios.map((u) => ({ ...u, activo: false })) }))
  const estado = await base.comprobarAcceso()
  assert.equal(estado.modo, 'error-remoto')
  assert.match(estado.ultimoError ?? '', /superadministrador activo/)
  assert.equal(filaLocal('daniel')?.activo, 1, 'un archivo roto no se refleja: el espejo anterior se conserva')

  pc.almacen.escribirDirecto('{"formato": 2, "usuarios": []}')
  const estado2 = await base.comprobarAcceso()
  assert.equal(estado2.modo, 'error-remoto')
  assert.match(estado2.ultimoError ?? '', /formato/)
  await rechaza(crearUsuario({ nombre: 'José Ruiz', usuario: 'jose', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor()), /No se pudo acceder|formato/)
  assert.equal(pc.almacen.escrituras, escriturasAntes)

  // Con el archivo roto, el ingreso cae a la credencial guardada (daniel la tiene desde que subió).
  salir()
  await ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-1' })
  assert.equal(base.identidadActual()?.modo, 'error-remoto')
})

test('el espejo tolera sucursales escritas distinto y si se recreó la base local la vuelve a armar desde la credencial', async () => {
  const principal = await conMaria()
  const documento = documentoRemoto(principal.almacen)
  principal.almacen.escribirDirecto(escribirDocumento({ ...documento, usuarios: documento.usuarios.map((u) => (u.usuario === 'maria' ? { ...u, sucursal: 'lanus' } : u)) }))
  await base.comprobarAcceso()
  assert.equal(unico(db(), 'SELECT COUNT(*) FROM sucursales'), 3, 'no se creó una sucursal fantasma')
  assert.equal(filaLocal('maria')?.sucursal_id, LANUS)

  const pc = await computadoraDeMaria(principal.almacen)
  salir()
  // La base local se recreó (por ejemplo, alguien borró dm.db), pero la credencial sigue.
  const carpeta = path.dirname((pc.credenciales as unknown as { ruta: string }).ruta)
  baseNueva()
  const pc2 = computadora(principal.almacen, carpeta)
  pc2.almacen.falla = fallaDeRed
  const abierta = await ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' })
  assert.equal(abierta.sucursal.nombre, 'Lanús')
  assert.equal(filaLocal('maria')?.remoto_id, 2)
  assert.equal(abierta.id, filaLocal('maria')?.id)
})

test('el vencimiento del token se informa y el ingreso sin internet con cambio de contraseña pendiente se rechaza', async () => {
  const principal = await conMaria()
  principal.almacen.vence = '2027-01-01'
  await base.comprobarAcceso()
  assert.equal(base.estadoDeAcceso().tokenVence, '2027-01-01')

  const pc = await computadoraDeMaria(principal.almacen)
  // Un administrador le resetea la contraseña desde otra PC; esta PC lo ve en una revalidación...
  const documento = documentoRemoto(pc.almacen)
  pc.almacen.escribirDirecto(escribirDocumento({ ...documento, usuarios: documento.usuarios.map((u) => (u.usuario === 'maria' ? { ...u, claveHash: hashSync('Temporal-555', 4), debeCambiarClave: true } : u)) }))
  salir()
  await base.comprobarAcceso()
  assert.equal(filaLocal('maria')?.debe_cambiar_clave, 1)
  // ...y sin internet, la credencial vieja no alcanza para entrar.
  pc.almacen.falla = fallaDeRed
  await rechaza(ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' }), /reseteó tu contraseña/)
})

test('leer y escribir el documento: validación estricta y salida estable', async () => {
  assert.throws(() => leerDocumento('no es json'), /no es un JSON válido/)
  assert.throws(() => leerDocumento('{"formato":1,"usuarios":[{"id":1,"nombre":"A","usuario":"a","claveHash":"x","rol":"JEFE","sucursal":"Lanús"}]}'), /rol «JEFE»/)
  assert.throws(() => leerDocumento('{"formato":1,"usuarios":[{"id":1,"nombre":"A","usuario":"a","claveHash":"x","rol":"ADMIN","sucursal":"Lanús"},{"id":1,"nombre":"B","usuario":"b","claveHash":"x","rol":"ADMIN","sucursal":"Lanús"}]}'), /repite el id 1/)
  assert.throws(() => leerDocumento('{"formato":1,"usuarios":[{"id":1,"nombre":"A","usuario":"ana","claveHash":"x","rol":"ADMIN","sucursal":"Lanús"},{"id":2,"nombre":"B","usuario":"ANA","claveHash":"x","rol":"ADMIN","sucursal":"Lanús"}]}'), /repite el usuario/)
  const leido = leerDocumento('{"formato":1,"usuarios":[{"id":7,"nombre":"A","usuario":"Ana","claveHash":"x","rol":"ADMIN","sucursal":" Lanús "}]}')
  assert.equal(leido.siguienteId, 8)
  assert.equal(leido.usuarios[0]!.usuario, 'ana')
  assert.equal(leido.usuarios[0]!.sucursal, 'Lanús')
  assert.equal(leido.usuarios[0]!.activo, true)
  const texto = escribirDocumento({ formato: 1, siguienteId: 9, usuarios: [leido.usuarios[0]!, { ...leido.usuarios[0]!, id: 3, usuario: 'b' }] })
  assert.ok(texto.endsWith('\n'))
  assert.ok(texto.indexOf('"usuario": "b"') < texto.indexOf('"usuario": "ana"'), 'ordenado por id')
})

test('renombrar en GitHub hacia un nombre que una fila local suelta todavía ocupa no rompe el espejo', async () => {
  const principal = await computadoraPrincipalInicializada()
  await editarUsuario(1, { nombre: 'Daniel Martínez', usuario: 'dani', rol: 'SUPER_ADMIN', sucursalId: DANIEL_SUCURSAL }, actor())

  // Una PC nueva: su «daniel» semilla no está en GitHub (allá se llama «dani») y queda suelto, con su nombre.
  baseNueva()
  computadora(principal.almacen)
  await ingresar({ usuario: 'dani', clave: 'Clave-Nueva-1' })
  assert.equal(filaLocal('dani')?.remoto_id, 1)
  assert.equal(filaLocal('daniel')?.remoto_id, null)
  assert.equal(filaLocal('daniel')?.activo, 0)

  // Desde GitHub «dani» vuelve a llamarse «daniel»: el nombre lo tiene la fila suelta, y el espejo lo resuelve.
  const editado = await editarUsuario(filaLocal('dani')!.id, { nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursalId: DANIEL_SUCURSAL }, actor())
  assert.equal(editado.usuario, 'daniel')
  assert.equal(actor().usuario, 'daniel')
  assert.equal(filaLocal('daniel')?.remoto_id, 1)
  const suelta = db().prepare(`SELECT usuario, activo FROM usuarios WHERE remoto_id IS NULL`).get() as { usuario: string; activo: number }
  assert.match(suelta.usuario, /^daniel~local\d+$/)
  assert.equal(suelta.activo, 0)
  assert.equal(base.estadoDeAcceso().modo, 'en-linea')
})

test('si se cierra la sesión mientras se guarda la contraseña, no se reabre; el cambio queda igual', async () => {
  const pc = await computadoraPrincipalInicializada()
  pc.almacen.alEscribir = () => salir()
  await rechaza(cambiarClave({ claveActual: 'Clave-Nueva-1', claveNueva: 'Clave-Nueva-2' }, actor()), /se cerró mientras se guardaba/)
  assert.equal(sesion(), null)
  pc.almacen.alEscribir = null
  await ingresar({ usuario: 'daniel', clave: 'Clave-Nueva-2' })
  assert.equal(base.identidadActual()?.modo, 'en-linea')
})

test('una sesión abierta con la tabla local se cierra cuando otra computadora inicializa la base compartida', async () => {
  const almacen = new AlmacenEnMemoria()
  baseNueva()
  const pc = computadora(almacen)
  await ingresar({ usuario: 'daniel', clave: 'cambiar123' })
  assert.equal(base.identidadActual()?.modo, 'sin-inicializar')

  // La otra PC sube su propio daniel (con otra contraseña).
  const principal = await (async () => {
    const texto = escribirDocumento({
      formato: 1,
      siguienteId: 2,
      usuarios: [{ id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', claveHash: hashSync('Clave-Otra-PC', 4), rol: 'SUPER_ADMIN', sucursal: 'Daniel', activo: true, debeCambiarClave: false, creadoEn: '', actualizadoEn: '' }],
    })
    almacen.escribirDirecto(texto)
    return almacen
  })()
  assert.ok(principal.texto)

  await base.comprobarAcceso()
  assert.equal(sesion(), null)
  assert.match(pc.cerradas[0] ?? '', /inicializó desde otra computadora/)
  assert.equal(filaLocal('daniel')?.remoto_id, 1)
  assert.equal(filaLocal('daniel')?.clave_hash, '')
  await rechaza(ingresar({ usuario: 'daniel', clave: 'cambiar123' }), /incorrectos/)
  await ingresar({ usuario: 'daniel', clave: 'Clave-Otra-PC' })
  assert.equal(base.identidadActual()?.modo, 'en-linea')
})

test('la última lectura buena sobrevive al reinicio del programa', async () => {
  const pc = await computadoraPrincipalInicializada()
  assert.ok(base.estadoDeAcceso().ultimaLecturaBuena)
  const carpeta = path.dirname(pc.credenciales.ruta)
  computadora(pc.almacen, carpeta) // como volver a abrir el programa, con la misma base
  assert.ok(base.estadoDeAcceso().ultimaLecturaBuena, 'se restaura desde la tabla configuracion')
})
