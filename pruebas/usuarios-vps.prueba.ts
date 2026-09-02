// La base de usuarios servida por el VPS, contra el simulador local. No sale a internet.
//
// Es la contracara de github-contents.prueba.ts: el mismo contrato (`AlmacenRemoto`) contra el otro
// servidor. Lo que hay que sostener acá son cuatro cosas y las cuatro tienen su prueba:
//
//   1. Crear, leer y actualizar con el candado de la versión, con el UTF-8 intacto.
//   2. Escribir con una versión vieja se rechaza como conflicto, igual que el sha de GitHub.
//   3. Los errores del servidor se traducen a lo que el servicio de usuarios sabe manejar: un token
//      rechazado no es lo mismo que un servidor caído, y ninguno de los dos es «no hay internet».
//   4. La mudanza desde GitHub ocurre UNA vez, sola, y sólo si el VPS todavía no tiene documento.
import assert from 'node:assert/strict'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { esFallaDeRed } from '../src/main/servicios/red'
import { AlmacenEnMemoria, ErrorDeConflicto, ErrorDelAlmacen } from '../src/main/usuarios/almacen'
import { AlmacenVps } from '../src/main/usuarios/vps'

async function conSimulador(correr: (simulador: VpsSimulado, urlBase: string) => Promise<void>): Promise<void> {
  const simulador = new VpsSimulado({ token: 'prueba' })
  const urlBase = await simulador.escuchar()
  try {
    await correr(simulador, urlBase)
  } finally {
    await simulador.cerrar()
  }
}

const DOCUMENTO = '{"formato":1,"usuarios":[{"nombre":"Lucía Ñandú «Dock Sud»","sucursal":"Lanús"}]}\n'

test('sin documento devuelve null; después crear, leer y actualizar con la versión', async () => {
  await conSimulador(async (simulador, urlBase) => {
    const almacen = new AlmacenVps({ urlBase, token: 'prueba' })
    assert.equal(await almacen.leer(), null, 'una agencia que todavía no inicializó la base no tiene documento')

    const version1 = await almacen.escribir(DOCUMENTO, null, 'Usuarios: prueba')
    const lectura = await almacen.leer()
    assert.ok(lectura)
    assert.equal(lectura.texto, DOCUMENTO, 'el UTF-8 vuelve igual: tildes, ñ y comillas angulares')
    assert.equal(lectura.sha, version1)

    const version2 = await almacen.escribir(DOCUMENTO.replace('Lanús', 'Daniel'), version1, 'Usuarios: cambio')
    assert.notEqual(version2, version1, 'cada escritura mueve la versión')
    const relectura = await almacen.leer()
    assert.equal(relectura?.texto.includes('Daniel'), true)
    assert.equal(relectura?.sha, version2)
    assert.deepEqual(simulador.mensajesDeUsuarios, ['Usuarios: prueba', 'Usuarios: cambio'])
  })
})

test('escribir con una versión vieja es un conflicto, no una escritura que pisa', async () => {
  await conSimulador(async (simulador, urlBase) => {
    const almacen = new AlmacenVps({ urlBase, token: 'prueba' })
    const version1 = await almacen.escribir(DOCUMENTO, null, 'Usuarios: prueba')
    await almacen.escribir(DOCUMENTO.replace('Lanús', 'Sarandí'), version1, 'Usuarios: otra computadora')

    await assert.rejects(
      almacen.escribir(DOCUMENTO.replace('Lanús', 'Daniel'), version1, 'Usuarios: llegué segundo'),
      (error: unknown) => error instanceof ErrorDeConflicto,
    )
    assert.equal(simulador.usuarios?.texto.includes('Sarandí'), true, 'la que llegó primera es la que queda')
  })
})

test('crear cuando otra computadora ya lo creó también es un conflicto', async () => {
  await conSimulador(async (_simulador, urlBase) => {
    const almacen = new AlmacenVps({ urlBase, token: 'prueba' })
    await almacen.escribir(DOCUMENTO, null, 'Usuarios: inicialización')
    await assert.rejects(
      almacen.escribir(DOCUMENTO, null, 'Usuarios: inicialización desde otra PC'),
      (error: unknown) => error instanceof ErrorDeConflicto,
    )
  })
})

test('el token rechazado y el servidor sin configurar NO son «sin internet»', async () => {
  await conSimulador(async (simulador, urlBase) => {
    const conTokenMalo = new AlmacenVps({ urlBase, token: 'el-que-no-es' })
    await assert.rejects(conTokenMalo.leer(), (error: unknown) => {
      assert.ok(error instanceof ErrorDelAlmacen)
      assert.equal(error.estado, 401)
      assert.equal(error.temporal, false, 'reintentar con el token equivocado no lo arregla')
      assert.equal(esFallaDeRed(error), false)
      return true
    })

    // 503 es el puente sin DMG_SYNC_TOKEN en el .env del servidor: tampoco se reintenta, porque el
    // mensaje que trae es el único que dice qué hay que hacer.
    simulador.errorFijo = { estado: 503, mensaje: 'falta DMG_SYNC_TOKEN en el .env del VPS' }
    const almacen = new AlmacenVps({ urlBase, token: 'prueba' })
    await assert.rejects(almacen.leer(), (error: unknown) => {
      assert.ok(error instanceof ErrorDelAlmacen)
      assert.equal(error.estado, 503)
      assert.equal(error.temporal, false)
      assert.match(error.message, /DMG_SYNC_TOKEN/)
      return true
    })
  })
})

test('un 5xx sí es temporal: se trata como «probá en un rato», no como un error de configuración', async () => {
  await conSimulador(async (simulador, urlBase) => {
    simulador.errorFijo = { estado: 502, mensaje: 'nginx' }
    const almacen = new AlmacenVps({ urlBase, token: 'prueba' })
    await assert.rejects(almacen.leer(), (error: unknown) => {
      assert.ok(error instanceof ErrorDelAlmacen)
      assert.equal(error.temporal, true)
      return true
    })
  })
})

test('un servidor que no contesta es «sin internet», no un error del servidor', async () => {
  // Puerto cerrado: el ingreso tiene que caer en la credencial guardada, no dar un error de negocio.
  const almacen = new AlmacenVps({ urlBase: 'http://127.0.0.1:9', token: 'prueba', tiempoMaximoLecturaMs: 2000 })
  await assert.rejects(almacen.leer(), (error: unknown) => {
    assert.equal(esFallaDeRed(error), true)
    return true
  })
})

test('la mudanza desde GitHub: se copia una sola vez y sólo si el VPS está vacío', async () => {
  await conSimulador(async (simulador, urlBase) => {
    const github = new AlmacenEnMemoria(DOCUMENTO)
    const anotado: string[] = []
    const almacen = new AlmacenVps({ urlBase, token: 'prueba', semilla: github, registrar: (m) => anotado.push(m) })

    const primera = await almacen.leer()
    assert.equal(primera?.texto, DOCUMENTO, 'la primera lectura devuelve lo que acaba de mudar')
    assert.equal(simulador.usuarios?.texto, DOCUMENTO, 'y quedó en el servidor')
    assert.equal(github.lecturas, 1)
    assert.match(anotado.join('\n'), /se mudó/)

    // De acá en más el documento sale del VPS y GitHub no se vuelve a tocar, ni siquiera después de
    // que el documento del servidor cambie.
    await almacen.escribir(DOCUMENTO.replace('Lanús', 'Daniel'), primera!.sha, 'Usuarios: cambio')
    const segunda = await almacen.leer()
    assert.equal(segunda?.texto.includes('Daniel'), true)
    assert.equal(github.lecturas, 1, 'la semilla se lee una sola vez, no en cada arranque')
  })
})

test('sin nada en GitHub, la mudanza no inventa un documento vacío', async () => {
  await conSimulador(async (simulador, urlBase) => {
    const github = new AlmacenEnMemoria(null)
    const almacen = new AlmacenVps({ urlBase, token: 'prueba', semilla: github })
    assert.equal(await almacen.leer(), null, 'no hay documento en ningún lado: «sin-inicializar», como antes')
    assert.equal(simulador.usuarios, null, 'y el servidor sigue vacío: nadie subió una base de mentira')
  })
})

test('la URL tiene que ser https (o el simulador local): un http suelto no se acepta', () => {
  assert.throws(() => new AlmacenVps({ urlBase: 'http://dmartinezseguros.com', token: 'x' }), /https/)
  assert.doesNotThrow(() => new AlmacenVps({ urlBase: 'https://dmartinezseguros.com', token: 'x' }))
  assert.doesNotThrow(() => new AlmacenVps({ urlBase: 'http://127.0.0.1:4321', token: 'x' }))
})
