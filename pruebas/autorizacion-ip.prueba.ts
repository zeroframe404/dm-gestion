// Autorizaciones de IP: lo que manda cada computadora al VPS y cómo se reconoce el rechazo del servidor.
// Las reglas de quién pasa y quién no viven en el servidor (`server/src/modules/dmg/ips.test.ts` del repo web).
import assert from 'node:assert/strict'
import test from 'node:test'
import { CABECERA_DE_IPS_LOCALES, esRechazoDeEquipo, pareceUnaIp } from '../src/shared/autorizacionIp'
import { EquipoNoAutorizado } from '../src/main/usuarios/almacen'
import { AlmacenVps } from '../src/main/usuarios/vps'
import { encabezadosDelEquipo, ipsLocalesDelEquipo } from '../src/main/vps/equipo'
import { ErrorDelServidorVps, FuenteVps } from '../src/main/vps/fuenteVps'

const RECHAZO = {
  error: 'Esta computadora no está autorizada para conectarse al servidor de la agencia.',
  codigo: 'EQUIPO_NO_AUTORIZADO',
}

function conFetch(t: { after: (fn: () => void) => void }, responder: (url: string, opciones: RequestInit) => Response): void {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = (async (url: string | URL | Request, opciones: RequestInit = {}) => responder(String(url), opciones)) as typeof fetch
}

test('las IP locales: todas las IPv4 de las placas, con las 169.254, sin loopback ni IPv6', () => {
  const placas = {
    Ethernet: [
      { address: '192.168.1.46', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    'Ethernet 2': [{ address: '169.254.225.104', family: 'IPv4', internal: false }],
    Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    Repetida: [{ address: '192.168.1.46', family: 'IPv4', internal: false }],
  } as unknown as Parameters<typeof ipsLocalesDelEquipo>[0]
  assert.deepEqual(ipsLocalesDelEquipo(placas), ['192.168.1.46', '169.254.225.104'])
  assert.ok(CABECERA_DE_IPS_LOCALES in encabezadosDelEquipo())
})

test('reconoce el rechazo por IP y valida lo que se escribe en el formulario', () => {
  assert.equal(esRechazoDeEquipo(RECHAZO), true)
  assert.equal(esRechazoDeEquipo({ error: 'Esto lo hace únicamente el superadministrador.' }), false)
  assert.equal(pareceUnaIp('192.168.1.46'), true)
  assert.equal(pareceUnaIp(' 169.254.133.165 '), true)
  assert.equal(pareceUnaIp('192.168.1.256'), false)
  assert.equal(pareceUnaIp('PC de caja'), false)
})

test('cada pedido al VPS lleva las IP de la PC, y el rechazo llega con el mensaje del servidor', async (t) => {
  let cabeceras: Record<string, string> = {}
  conFetch(t, (_url, opciones) => {
    cabeceras = opciones.headers as Record<string, string>
    return new Response(JSON.stringify(RECHAZO), { status: 403, headers: { 'content-type': 'application/json' } })
  })
  const fuente = new FuenteVps({ urlBase: 'http://127.0.0.1:9', token: 'x' })
  await assert.rejects(
    () => fuente.ipsEstado({ clave: 'daniel', nombre: 'Daniel', rol: 'SUPER_ADMIN' }),
    (error: unknown) => error instanceof ErrorDelServidorVps && error.status === 403 && error.message === RECHAZO.error,
  )
  assert.equal(typeof cabeceras[CABECERA_DE_IPS_LOCALES], 'string')
})

test('la base de usuarios: un equipo no autorizado no es «sin internet»', async (t) => {
  conFetch(t, () => new Response(JSON.stringify(RECHAZO), { status: 403, headers: { 'content-type': 'application/json' } }))
  const almacen = new AlmacenVps({ urlBase: 'http://127.0.0.1:9', token: 'x' })
  await assert.rejects(
    () => almacen.leer(),
    (error: unknown) => error instanceof EquipoNoAutorizado && error.temporal === false && error.message === RECHAZO.error,
  )
})
