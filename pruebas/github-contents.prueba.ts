// El cliente de la API Contents de GitHub contra el simulador local: crear, leer con ETag, el candado
// del sha, los tokens rechazados (y el anterior como respaldo), los límites y el tiempo máximo.
// No sale a internet.
import assert from 'node:assert/strict'
import test from 'node:test'
import { GitHubSimulado } from '../scripts/github-simulado.mjs'
import { esFallaDeRed } from '../src/main/servicios/red'
import { ErrorDeConflicto, ErrorDelAlmacen } from '../src/main/usuarios/almacen'
import { AlmacenGitHub } from '../src/main/usuarios/github'

const REPO = 'zeroframe404/dm-gestion-datos'

async function conSimulador(opciones: ConstructorParameters<typeof GitHubSimulado>[0], correr: (simulador: GitHubSimulado, urlBase: string) => Promise<void>): Promise<void> {
  const simulador = new GitHubSimulado(opciones)
  const urlBase = await simulador.escuchar()
  try {
    await correr(simulador, urlBase)
  } finally {
    await simulador.cerrar()
  }
}

test('sin archivo devuelve null sólo si el repositorio responde; si el repo no existe, es un error de configuración', async () => {
  await conSimulador({ tokens: ['t1'] }, async (simulador, urlBase) => {
    const almacen = new AlmacenGitHub({ repo: REPO, tokens: ['t1'], urlBase })
    assert.equal(await almacen.leer(), null)
    assert.deepEqual(simulador.pedidos, [`GET /repos/${REPO}/contents/usuarios.json`, `GET /repos/${REPO}`])

    simulador.guion.sinRepo = true
    await assert.rejects(almacen.leer(), (error: unknown) => error instanceof ErrorDelAlmacen && error.estado === 404 && /repositorio de datos/.test(error.message))
  })
})

test('crear, leer con ETag (304) y actualizar con el sha; UTF-8 de ida y vuelta', async () => {
  await conSimulador({ tokens: ['t1'], vence: '2027-03-01' }, async (simulador, urlBase) => {
    const almacen = new AlmacenGitHub({ repo: REPO, tokens: ['t1'], urlBase })
    const texto = '{"formato":1,"usuarios":[{"nombre":"Lucía Ñandú «Dock Sud»","sucursal":"Lanús"}]}\n'
    const sha1 = await almacen.escribir(texto, null, 'Usuarios: prueba')
    assert.equal(sha1, simulador.sha)
    assert.deepEqual(simulador.commits, ['Usuarios: prueba'])

    const lectura = await almacen.leer()
    assert.ok(lectura)
    assert.equal(lectura.texto, texto)
    assert.equal(lectura.sha, sha1)
    assert.equal(almacen.vencimientoDelToken(), '2027-03-01')

    // Segunda lectura: va con If-None-Match y GitHub responde 304 sin contenido; el cliente devuelve la
    // MISMA lectura que tenía en caché (misma referencia), no una bajada nueva.
    const primera = simulador.intercambios.at(-1)
    assert.equal(primera?.estado, 200)
    assert.equal(primera?.cabeceras['if-none-match'], undefined)
    const relectura = await almacen.leer()
    const segunda = simulador.intercambios.at(-1)
    assert.equal(segunda?.estado, 304)
    assert.equal(segunda?.cabeceras['if-none-match'], simulador.etag)
    assert.equal(relectura, lectura)
    assert.equal(simulador.intercambios.length, 3, 'PUT de creación, GET 200 y GET 304: nada más')

    const sha2 = await almacen.escribir(texto.replace('Lanús', 'Daniel'), sha1, 'Usuarios: cambio')
    assert.notEqual(sha2, sha1)
    assert.match((await almacen.leer())!.texto, /Daniel/)
  })
})

test('escribir con un sha viejo es un conflicto, y crear algo que ya existe también', async () => {
  await conSimulador({ tokens: ['t1'] }, async (simulador, urlBase) => {
    const almacen = new AlmacenGitHub({ repo: REPO, tokens: ['t1'], urlBase })
    const sha = await almacen.escribir('{"a":1}', null, 'm')
    simulador.escribirDirecto('{"a":2}') // otra computadora
    await assert.rejects(almacen.escribir('{"a":3}', sha, 'm'), ErrorDeConflicto)
    await assert.rejects(almacen.escribir('{"a":3}', null, 'm'), ErrorDeConflicto)
  })
})

test('token rechazado: prueba el anterior; si ninguno sirve, el error no incluye el token', async () => {
  await conSimulador({ tokens: ['viejo'] }, async (simulador, urlBase) => {
    const conRespaldo = new AlmacenGitHub({ repo: REPO, tokens: ['nuevo-secreto', 'viejo'], urlBase })
    simulador.escribirDirecto('{"a":1}')
    assert.equal((await conRespaldo.leer())!.texto, '{"a":1}')
    // Después del primer 401 se queda con el token que funcionó: no vuelve a probar el rechazado.
    const pedidosAntes = simulador.pedidos.length
    await conRespaldo.leer()
    assert.equal(simulador.pedidos.length, pedidosAntes + 1)

    const sinRespaldo = new AlmacenGitHub({ repo: REPO, tokens: ['nuevo-secreto'], urlBase })
    await assert.rejects(sinRespaldo.leer(), (error: unknown) => {
      assert.ok(error instanceof ErrorDelAlmacen)
      assert.equal(error.estado, 401)
      assert.doesNotMatch(error.message, /nuevo-secreto/)
      assert.match(error.message, /token.*no es válido o venció/)
      return true
    })
  })
})

test('límite de pedidos y errores del servidor son temporales; un 403 de permisos no', async () => {
  await conSimulador({ tokens: ['t1'] }, async (simulador, urlBase) => {
    const almacen = new AlmacenGitHub({ repo: REPO, tokens: ['t1'], urlBase })
    simulador.escribirDirecto('{"a":1}')

    simulador.guion.fallasIniciales = [{ estado: 403, mensaje: 'API rate limit exceeded', cabeceras: { 'x-ratelimit-remaining': '0' } }]
    await assert.rejects(almacen.leer(), (error: unknown) => error instanceof ErrorDelAlmacen && error.temporal && /limitó temporalmente/.test(error.message))

    simulador.guion.fallasIniciales = [502]
    simulador.fallasUsadas = 0
    await assert.rejects(almacen.leer(), (error: unknown) => error instanceof ErrorDelAlmacen && error.temporal && error.estado === 502)

    simulador.guion.fallasIniciales = [{ estado: 403, mensaje: 'Resource not accessible by personal access token' }]
    simulador.fallasUsadas = 0
    await assert.rejects(almacen.leer(), (error: unknown) => error instanceof ErrorDelAlmacen && !error.temporal && /no tiene permiso/.test(error.message))
  })
})

test('sin respuesta dentro del tiempo máximo, o sin servidor, es una falla de red (no un error de GitHub)', async () => {
  await conSimulador({ tokens: ['t1'] }, async (simulador, urlBase) => {
    simulador.guion.colgar = true
    const almacen = new AlmacenGitHub({ repo: REPO, tokens: ['t1'], urlBase, tiempoMaximoLecturaMs: 150 })
    await assert.rejects(almacen.leer(), (error: unknown) => esFallaDeRed(error))
  })
  const sinServidor = new AlmacenGitHub({ repo: REPO, tokens: ['t1'], urlBase: 'http://127.0.0.1:9', tiempoMaximoLecturaMs: 2000 })
  await assert.rejects(sinServidor.leer(), (error: unknown) => esFallaDeRed(error))
})
