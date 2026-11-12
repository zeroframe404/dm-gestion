// La cuenta por persona contra el servidor (18.2), de punta a punta: el servicio de usuarios de verdad,
// el `AlmacenVps` de verdad y el simulador del servidor con las sesiones prendidas, que hace lo mismo
// que el servidor real (comprueba la contraseña, da un token por persona, tapa los hashes ajenos y deja
// escribir la lista según el rol). No sale a internet.
//
// Lo que estas pruebas cuidan es lo que cambió para la gente y lo que NO tenía que cambiar:
//
//   - con internet, quien ingresa queda identificado ante el servidor y todo viaja con SU token;
//   - el superadministrador sigue administrando aunque ya no vea los hashes de los demás;
//   - cada uno sigue pudiendo cambiar su contraseña, y eso no lo deja afuera;
//   - una contraseña que el servidor rechaza no entra por la credencial guardada;
//   - sin internet se sigue entrando como antes, y la sesión se pide sola cuando vuelve;
//   - contra un servidor que todavía no tiene sesiones, todo sigue como en la 18.1.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { compareSync } from 'bcryptjs'
import { HASH_OCULTO, VpsSimulado } from '../scripts/vps-simulado.mjs'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import { cambiarClave, ingresar, salir } from '../src/main/servicios/auth'
import * as base from '../src/main/servicios/baseDeUsuarios'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { sesion } from '../src/main/servicios/sesion'
import { crearUsuario, resetearClave } from '../src/main/servicios/usuarios'
import { AlmacenDeCredencial, cifradorDePrueba } from '../src/main/usuarios/credencial'
import { leerDocumento } from '../src/main/usuarios/documento'
import { AlmacenVps } from '../src/main/usuarios/vps'
import { haySesionDelServidor, tokenParaElServidor } from '../src/main/vps/sesionDelServidor'
import type { SesionUsuario } from '../src/shared/tipos'

const LANUS = 2
const COMPARTIDO = 'Bearer prueba'

const carpetas: string[] = []
test.after(() => {
  cerrarBaseDeDatos()
  for (const carpeta of carpetas) rmSync(carpeta, { recursive: true, force: true })
})

function carpetaTemporal(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-sesion-'))
  carpetas.push(carpeta)
  return carpeta
}

interface Computadora {
  cerradas: string[]
  carpeta: string
}

/**
 * Una «computadora» nueva hablando con ese servidor: su base local vacía, su credencial y su almacén.
 * Con `carpeta` es la misma computadora que se volvió a abrir (conserva la credencial guardada).
 */
function computadora(urlBase: string, carpeta = carpetaTemporal()): Computadora {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
  const cerradas: string[] = []
  base.configurarBaseDeUsuarios({
    almacen: new AlmacenVps({ urlBase, token: 'prueba', registrar: () => undefined }),
    credenciales: new AlmacenDeCredencial(path.join(carpeta, 'credencial.bin'), cifradorDePrueba()),
    version: '18.2.0',
    nombreDeEquipo: 'PC-PRUEBA',
    memoriaSinInternetMs: 0,
    registrar: () => undefined,
  })
  base.conectarEmisor({ estado: () => undefined, sesionActualizada: () => undefined, sesionCerrada: (motivo) => cerradas.push(motivo) })
  return { cerradas, carpeta }
}

function actor(): SesionUsuario {
  const actual = sesion()
  assert.ok(actual, 'No hay sesión abierta')
  return actual
}

async function rechaza(promesa: Promise<unknown>, esperado: RegExp): Promise<void> {
  await assert.rejects(promesa, (error: unknown) => {
    assert.ok(error instanceof ErrorDeNegocio, `Se esperaba ErrorDeNegocio y vino ${String(error)}`)
    assert.match(error.message, esperado)
    return true
  })
}

/** Deja pasar los pedidos que el programa manda sin esperar (avisarle al servidor que se salió). */
async function unMomento(): Promise<void> {
  await new Promise((listo) => setTimeout(listo, 60))
}

function usuariosDelServidor(simulador: VpsSimulado) {
  assert.ok(simulador.usuarios, 'El servidor no tiene lista de usuarios')
  return leerDocumento(simulador.usuarios.texto).usuarios
}

function delServidor(simulador: VpsSimulado, usuario: string) {
  const encontrado = usuariosDelServidor(simulador).find((candidato) => candidato.usuario === usuario)
  assert.ok(encontrado, `El servidor no tiene a «${usuario}»`)
  return encontrado
}

/** Con qué llave salió cada pedido desde `desde` en adelante. */
function llaves(simulador: VpsSimulado, desde: number): string[] {
  return simulador.intercambios.slice(desde).map((intercambio) => `${intercambio.metodo} ${intercambio.ruta} ${intercambio.autorizacion?.startsWith('Bearer dmgs_') ? 'SESION' : 'COMPARTIDO'}`)
}

/**
 * Un servidor con sesiones y una agencia ya armada: «daniel» (superadministrador, `Clave-De-Daniel-1`) y
 * «maria» (empleada de Lanús, con la contraseña temporal `Temporal-123` que le puso daniel).
 */
async function conAgencia(correr: (simulador: VpsSimulado, urlBase: string) => Promise<void>, opciones: { sesiones?: boolean } = {}): Promise<void> {
  const simulador = new VpsSimulado({ token: 'prueba', sesiones: opciones.sesiones ?? true })
  const urlBase = await simulador.escuchar()
  try {
    computadora(urlBase)
    await ingresar({ usuario: 'daniel', clave: 'cambiar123' })
    await cambiarClave({ claveActual: 'cambiar123', claveNueva: 'Clave-De-Daniel-1' }, actor())
    await base.subirLocales(actor())
    await crearUsuario({ nombre: 'María Pérez', usuario: 'maria', clave: 'Temporal-123', rol: 'EMPLEADO', sucursalId: LANUS }, actor())
    salir()
    await unMomento()
    await correr(simulador, urlBase)
  } finally {
    salir()
    await unMomento()
    await simulador.cerrar()
  }
}

// ---------------------------------------------------------------------------

test('con internet, quien ingresa queda identificado ante el servidor y todo viaja con su token', async () => {
  await conAgencia(async (simulador, urlBase) => {
    computadora(urlBase)
    const antes = simulador.intercambios.length

    const abierta = await ingresar({ usuario: 'daniel', clave: 'Clave-De-Daniel-1' })

    assert.equal(abierta.rol, 'SUPER_ADMIN')
    assert.equal(haySesionDelServidor(), true)
    assert.equal(base.identidadActual()?.modo, 'en-linea')
    // Antes de ingresar no hay otra llave que la compartida: con ella la computadora nueva mira si el
    // servidor tiene usuarios y pide la sesión. Desde ahí, todo viaja con la sesión de daniel.
    assert.deepEqual(llaves(simulador, antes), ['GET /api/dmg/usuarios COMPARTIDO', 'POST /api/dmg/sesion COMPARTIDO', 'GET /api/dmg/usuarios SESION'])
    assert.equal(simulador.sesiones.size, 1)
    const [abiertaEnElServidor] = [...simulador.sesiones.values()]
    assert.deepEqual({ equipo: abiertaEnElServidor.equipo, app: abiertaEnElServidor.app }, { equipo: 'PC-PRUEBA', app: '18.2.0' })
    // Y la usan también la grilla, la mensajería y el canal: todos preguntan acá con qué llave hablar.
    assert.match(tokenParaElServidor(urlBase, 'prueba'), /^dmgs_/)
    assert.equal(tokenParaElServidor('https://otro-servidor.example', 'prueba'), 'prueba', 'el token de una sesión no se le manda a otro servidor')

    salir()
    await unMomento()
    assert.equal(haySesionDelServidor(), false)
    assert.equal(simulador.sesiones.size, 0, 'al salir, la sesión se cierra también en el servidor')
  })
})

test('el superadministrador sigue administrando aunque ya no reciba los hashes de los demás', async () => {
  await conAgencia(async (simulador, urlBase) => {
    const hashDeMaria = delServidor(simulador, 'maria').claveHash
    computadora(urlBase)
    await ingresar({ usuario: 'daniel', clave: 'Clave-De-Daniel-1' })
    const leido = base.ultimoDocumentoLeido()
    assert.equal(leido?.usuarios.find((u) => u.usuario === 'maria')?.claveHash, HASH_OCULTO, 'el hash de otra persona no llega a esta computadora')

    await crearUsuario({ nombre: 'Beto Gómez', usuario: 'beto', clave: 'Temporal-456', rol: 'ADMIN', sucursalId: LANUS }, actor())

    assert.equal(delServidor(simulador, 'maria').claveHash, hashDeMaria, 'guardar la lista no le pisó la contraseña a nadie')
    assert.equal(compareSync('Temporal-456', delServidor(simulador, 'beto').claveHash), true)
    assert.equal(compareSync('Clave-De-Daniel-1', delServidor(simulador, 'daniel').claveHash), true)

    const maria = base.idLocalDelRemoto(delServidor(simulador, 'maria').id)
    assert.ok(maria)
    await resetearClave(maria, 'Otra-Temporal-9', actor())
    assert.equal(compareSync('Otra-Temporal-9', delServidor(simulador, 'maria').claveHash), true, 'resetearle la contraseña a otro sí la cambia')
    assert.equal(delServidor(simulador, 'maria').debeCambiarClave, true)
  })
})

test('cada uno cambia su propia contraseña, sigue adentro y no toca nada más', async () => {
  await conAgencia(async (simulador, urlBase) => {
    const hashDeDaniel = delServidor(simulador, 'daniel').claveHash
    const pc = computadora(urlBase)
    const abierta = await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
    assert.equal(abierta.debeCambiarClave, true)

    await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())

    assert.equal(compareSync('Maria-Segura-1', delServidor(simulador, 'maria').claveHash), true)
    assert.equal(delServidor(simulador, 'maria').debeCambiarClave, false)
    assert.equal(delServidor(simulador, 'maria').rol, 'EMPLEADO')
    assert.equal(delServidor(simulador, 'daniel').claveHash, hashDeDaniel, 'el hash tapado de daniel volvió tapado y el servidor conservó el suyo')
    // La sesión con la que cambió la contraseña sigue valiendo: la próxima comprobación no la echa.
    await base.revalidarAhora()
    assert.equal(sesion()?.usuario, 'maria')
    assert.equal(haySesionDelServidor(), true)
    assert.deepEqual(pc.cerradas, [])

    // Y con la credencial que quedó guardada entra después sin internet, como siempre.
    salir()
    await unMomento()
    simulador.errorFijo = { estado: 500, mensaje: 'el servidor está caído' }
    computadora(urlBase, pc.carpeta)
    const sinInternet = await ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' })
    assert.equal(sinInternet.usuario, 'maria')
    assert.equal(haySesionDelServidor(), false)
    assert.equal(base.estadoDeAcceso().sesionSinConfirmar, true)
  })
})

test('una contraseña que el servidor rechaza no entra, ni por la credencial guardada', async () => {
  await conAgencia(async (simulador, urlBase) => {
    // maria ingresa en su computadora y le queda la credencial guardada con «Maria-Segura-1».
    const pc = computadora(urlBase)
    await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
    await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())
    salir()
    await unMomento()

    // Desde otra computadora, daniel le resetea la contraseña.
    computadora(urlBase)
    await ingresar({ usuario: 'daniel', clave: 'Clave-De-Daniel-1' })
    const maria = base.idLocalDelRemoto(delServidor(simulador, 'maria').id)
    assert.ok(maria)
    await resetearClave(maria, 'Reseteada-77', actor())
    salir()
    await unMomento()

    // De vuelta en la de maria, con internet y la contraseña de antes.
    computadora(urlBase, pc.carpeta)
    assert.equal(base.estadoDeAcceso().usuarioGuardado, 'maria')
    await rechaza(ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' }), /Usuario o contraseña incorrectos/)
    assert.equal(sesion(), null)
    assert.equal(haySesionDelServidor(), false)
    assert.equal(llaves(simulador, 0).at(-1), 'POST /api/dmg/sesion COMPARTIDO', 'con el «no» del servidor alcanza: después no se baja la lista para comparar acá')
    assert.equal(base.estadoDeAcceso().usuarioGuardado, null, 'la credencial guardada era de la contraseña vieja: se borra')

    // Y sin internet tampoco entra con la vieja: ya no hay credencial.
    simulador.errorFijo = { estado: 500, mensaje: 'el servidor está caído' }
    await rechaza(ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' }), /hace falta conexión|no hay ninguna credencial/)
  })
})

test('si a alguien lo desactivan con la sesión abierta, se le cierra con el motivo', async () => {
  await conAgencia(async (simulador, urlBase) => {
    const pc = computadora(urlBase)
    await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
    await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())

    // Otra computadora (acá, el servidor directamente) la desactiva.
    assert.ok(simulador.usuarios)
    const documento = JSON.parse(simulador.usuarios.texto) as { usuarios: Array<{ usuario: string; activo: boolean }> }
    documento.usuarios.find((u) => u.usuario === 'maria')!.activo = false
    simulador.usuarios = { ...simulador.usuarios, texto: JSON.stringify(documento), version: simulador.usuarios.version + 1 }

    await base.revalidarAhora()

    assert.equal(sesion(), null)
    assert.equal(haySesionDelServidor(), false)
    assert.equal(pc.cerradas.length, 1)
    assert.match(pc.cerradas[0]!, /desactivado/)
    await rechaza(ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' }), /desactivado/)
  })
})

test('sin internet se entra con la credencial guardada, y la sesión se pide sola cuando vuelve', async () => {
  await conAgencia(async (simulador, urlBase) => {
    const pc = computadora(urlBase)
    await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
    await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())
    salir()
    await unMomento()

    simulador.errorFijo = { estado: 500, mensaje: 'el servidor está caído' }
    computadora(urlBase, pc.carpeta)
    await ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' })
    assert.equal(haySesionDelServidor(), false)
    assert.equal(base.estadoDeAcceso().sesionSinConfirmar, true)

    simulador.errorFijo = null
    await base.revalidarAhora()

    assert.equal(sesion()?.usuario, 'maria')
    assert.equal(haySesionDelServidor(), true, 'al volver la conexión quedó identificada ante el servidor sin volver a tipear nada')
    assert.equal(base.estadoDeAcceso().sesionSinConfirmar, false)
    assert.equal(simulador.sesiones.size, 1)
  })
})

test('si mientras estaba sin internet le cambiaron la contraseña, al volver la conexión queda afuera', async () => {
  await conAgencia(async (simulador, urlBase) => {
    const pc = computadora(urlBase)
    await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
    await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())
    salir()
    await unMomento()

    computadora(urlBase)
    await ingresar({ usuario: 'daniel', clave: 'Clave-De-Daniel-1' })
    const maria = base.idLocalDelRemoto(delServidor(simulador, 'maria').id)
    assert.ok(maria)
    await resetearClave(maria, 'Reseteada-77', actor())
    salir()
    await unMomento()

    simulador.errorFijo = { estado: 500, mensaje: 'el servidor está caído' }
    const deNuevo = computadora(urlBase, pc.carpeta)
    await ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' })
    assert.equal(sesion()?.usuario, 'maria', 'sin internet no hay forma de saberlo: entra con lo que tenía guardado')

    simulador.errorFijo = null
    await base.revalidarAhora()

    assert.equal(sesion(), null)
    assert.equal(deNuevo.cerradas.length, 1)
    assert.match(deNuevo.cerradas[0]!, /contraseña de tu usuario cambió/)
    assert.equal(base.estadoDeAcceso().usuarioGuardado, null)
  })
})

test('cuando el servidor exige sesión, una computadora nueva ingresa igual y el token compartido ya no baja la lista', async () => {
  await conAgencia(async (simulador, urlBase) => {
    simulador.exigirSesion = true
    const pc = computadora(urlBase)

    // Lo que hace la pantalla de ingreso al abrirse: no puede leer la lista, y no lo muestra como una falla.
    const estado = await base.comprobarAcceso()
    assert.equal(estado.modo, 'en-linea')
    assert.equal(estado.ultimoError, null)
    assert.equal(await base.prepararIngreso(), 'compartida', 'no cae al ingreso local de una instalación nueva')

    const abierta = await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
    assert.equal(abierta.usuario, 'maria')
    assert.equal(haySesionDelServidor(), true)
    await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())
    assert.equal(compareSync('Maria-Segura-1', delServidor(simulador, 'maria').claveHash), true)
    assert.deepEqual(pc.cerradas, [])

    const conElCompartido = await fetch(`${urlBase}/api/dmg/usuarios`, { headers: { authorization: COMPARTIDO } })
    assert.equal(conElCompartido.status, 401)
    assert.equal(((await conElCompartido.json()) as { codigo?: string }).codigo, 'sesion_requerida')
  })
})

test('si el servidor cierra la sesión (y exige una), la de acá se cierra avisando, sin borrar la credencial', async () => {
  await conAgencia(async (simulador, urlBase) => {
    simulador.exigirSesion = true
    const pc = computadora(urlBase)
    await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
    await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())

    simulador.sesiones.clear()
    await base.revalidarAhora()

    assert.equal(sesion(), null)
    assert.equal(haySesionDelServidor(), false)
    assert.equal(pc.cerradas.length, 1)
    assert.match(pc.cerradas[0]!, /se cerró desde el servidor/)
    assert.equal(base.estadoDeAcceso().usuarioGuardado, 'maria', 'su contraseña sigue siendo buena: puede volver a ingresar, también sin internet')
    await ingresar({ usuario: 'maria', clave: 'Maria-Segura-1' })
    assert.equal(haySesionDelServidor(), true)
  })
})

test('contra un servidor que todavía no tiene sesiones, todo sigue como antes', async () => {
  await conAgencia(
    async (simulador, urlBase) => {
      const pc = computadora(urlBase)
      const antes = simulador.intercambios.length

      const abierta = await ingresar({ usuario: 'maria', clave: 'Temporal-123' })
      await cambiarClave({ claveActual: 'Temporal-123', claveNueva: 'Maria-Segura-1' }, actor())

      assert.equal(abierta.usuario, 'maria')
      assert.equal(haySesionDelServidor(), false)
      assert.equal(base.identidadActual()?.modo, 'en-linea')
      assert.equal(compareSync('Maria-Segura-1', delServidor(simulador, 'maria').claveHash), true)
      assert.equal(llaves(simulador, antes).every((llave) => llave.endsWith('COMPARTIDO')), true)
      await base.revalidarAhora()
      assert.equal(sesion()?.usuario, 'maria')
      assert.deepEqual(pc.cerradas, [])
    },
    { sesiones: false },
  )
})
