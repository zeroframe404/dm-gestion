// TikTok del lado de la computadora (src/main/servicios/tiktok.ts y src/main/redes/tiktok.ts): las
// reglas que se revisan antes de mandar el video al servidor y la dirección del ingreso de TikTok. Lo
// que hace el servidor (canjear el código, la cola, renovar el permiso) se prueba en
// Seguros_Daniel_Martinez (server/src/modules/redes-sociales/tiktok.service.test.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import { PERMISOS_DE_TIKTOK, urlDeAutorizacionDeTikTok } from '../src/main/redes/tiktok'
import { validarPedidoDeTikTok } from '../src/main/servicios/tiktok'

const AHORA = Date.parse('2026-11-04T12:00:00Z')

function pedido(cambios: Record<string, unknown> = {}) {
  return {
    sucursal: 'Daniel',
    texto: '  Hola #seguros  ',
    ruta: 'C:\\videos\\promo.mp4',
    privacidad: 'PUBLIC_TO_EVERYONE',
    permitirComentarios: true,
    permitirDuo: false,
    permitirStitch: false,
    contenidoPropio: false,
    contenidoDeMarca: false,
    programarPara: '',
    ...cambios,
  }
}

test('tiktok: un pedido completo pasa, con el texto recortado', () => {
  const validado = validarPedidoDeTikTok(pedido(), AHORA)
  assert.equal(validado.texto, 'Hola #seguros')
  assert.equal(validado.privacidad, 'PUBLIC_TO_EVERYONE')
  assert.equal(validado.permitirComentarios, true)
  assert.equal(validado.programarPara, '')
})

test('tiktok: sin video no hay publicación', () => {
  assert.throws(() => validarPedidoDeTikTok(pedido({ ruta: '' }), AHORA), /siempre un video/)
})

test('tiktok: la privacidad se elige, no viene por defecto', () => {
  assert.throws(() => validarPedidoDeTikTok(pedido({ privacidad: '' }), AHORA), /quién puede ver/)
  assert.throws(() => validarPedidoDeTikTok(pedido({ privacidad: 'PUBLICO' }), AHORA), /quién puede ver/)
})

test('tiktok: contenido de marca no puede ir en privado', () => {
  assert.throws(() => validarPedidoDeTikTok(pedido({ privacidad: 'SELF_ONLY', contenidoDeMarca: true }), AHORA), /contenido de marca/)
  assert.doesNotThrow(() => validarPedidoDeTikTok(pedido({ privacidad: 'SELF_ONLY', contenidoPropio: true }), AHORA))
})

test('tiktok: el texto largo y la fecha pasada se cortan antes del viaje', () => {
  assert.throws(() => validarPedidoDeTikTok(pedido({ texto: 'a'.repeat(2_201) }), AHORA), /muy largo/)
  assert.throws(() => validarPedidoDeTikTok(pedido({ programarPara: '2026-11-04T11:00:00Z' }), AHORA), /futura/)
  assert.throws(() => validarPedidoDeTikTok(pedido({ programarPara: 'mañana' }), AHORA), /no es válida/)
  assert.equal(validarPedidoDeTikTok(pedido({ programarPara: '2026-11-05T12:00:00Z' }), AHORA).programarPara, '2026-11-05T12:00:00Z')
})

test('tiktok: la dirección del ingreso lleva la app, los permisos, la vuelta y el state', () => {
  const url = new URL(urlDeAutorizacionDeTikTok('awabc123', 'https://ejemplo.com/tiktok/vuelta', 'estado-1'))
  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/')
  assert.equal(url.searchParams.get('client_key'), 'awabc123')
  assert.equal(url.searchParams.get('scope'), PERMISOS_DE_TIKTOK.join(','))
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://ejemplo.com/tiktok/vuelta')
  assert.equal(url.searchParams.get('state'), 'estado-1')
})
