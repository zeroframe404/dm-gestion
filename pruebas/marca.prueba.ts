// La marca configurable (src/shared/marca.ts y el cambio de firma de src/main/demo/identidad.ts).
// El guardado en config.json no se prueba acá (ese archivo no existe fuera de Electron): sí lo que decide
// qué se acepta, cómo se arma la paleta y que la firma vieja de las plantillas pase a la nueva.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import { cambiarFirmaDePlantillas } from '../src/main/demo/identidad'
import { bytesDelLogo, esMarcaDeFabrica, MARCA_DE_FABRICA, MAXIMO_DE_LOGO_EN_BYTES, normalizarMarca, variablesDeColor } from '../src/shared/marca'

const PNG_CHICO = 'data:image/png;base64,iVBORw0KGgo='

test('sin nada cargado, o con basura, vuelve la marca de fábrica', () => {
  assert.deepEqual(normalizarMarca(undefined), MARCA_DE_FABRICA)
  assert.deepEqual(normalizarMarca('hola'), MARCA_DE_FABRICA)
  assert.deepEqual(normalizarMarca({ nombre: '   ', agencia: 5, color: 'rojo', logo: 'http://x/y.png' }), MARCA_DE_FABRICA)
  assert.ok(esMarcaDeFabrica(normalizarMarca({})))
})

test('se aceptan un nombre, un color y un logo válidos; el nombre se limpia y se acota', () => {
  const marca = normalizarMarca({ nombre: '  Mi   Gestión ', agencia: 'Seguros Pérez', color: '#1D4ED8', logo: PNG_CHICO })
  assert.deepEqual(marca, { nombre: 'Mi Gestión', agencia: 'Seguros Pérez', color: '#1d4ed8', logo: PNG_CHICO })
  assert.equal(esMarcaDeFabrica(marca), false)
  assert.equal(normalizarMarca({ nombre: 'x'.repeat(200) }).nombre.length, 40)
})

test('el logo: sólo imágenes en base64 y con tope de peso', () => {
  assert.equal(normalizarMarca({ logo: 'data:text/html;base64,PGI+' }).logo, null, 'un HTML no es un logo')
  assert.equal(normalizarMarca({ logo: 'data:image/svg+xml;utf8,<svg onload=x>' }).logo, null)
  const grande = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((MAXIMO_DE_LOGO_EN_BYTES * 4) / 3) + 8)
  assert.ok(bytesDelLogo(grande) > MAXIMO_DE_LOGO_EN_BYTES)
  assert.equal(normalizarMarca({ logo: grande }).logo, null)
})

test('la paleta: el 600 es el color elegido, y de ahí hacia el 50 aclara y hacia el 950 oscurece', () => {
  const v = variablesDeColor('#235ba8')
  assert.equal(v['--color-marino-600'], '#235ba8')
  assert.equal(Object.keys(v).length, 11)
  const luz = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
  const pasos = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((p) => luz(v[`--color-marino-${p}`]))
  for (let i = 1; i < pasos.length; i++) assert.ok(pasos[i] < pasos[i - 1], 'cada paso es más oscuro que el anterior')
})

test('al cambiar el nombre de la agencia, las plantillas con la firma vieja pasan a la nueva', () => {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const filas = () => (db.prepare('SELECT texto FROM plantillas_mensaje').all() as { texto: string }[]).map((f) => f.texto)

  const cambiadas = cambiarFirmaDePlantillas(db, MARCA_DE_FABRICA.agencia, 'Seguros Pérez')
  assert.ok(cambiadas > 0)
  assert.ok(filas().some((t) => t.includes('Seguros Pérez.')))
  assert.ok(filas().every((t) => !t.includes(`${MARCA_DE_FABRICA.agencia}.`)))
  assert.equal(cambiarFirmaDePlantillas(db, 'Seguros Pérez', 'Seguros Pérez'), 0, 'misma firma: nada que hacer')
  // Y se puede volver.
  cambiarFirmaDePlantillas(db, 'Seguros Pérez', MARCA_DE_FABRICA.agencia)
  assert.ok(filas().every((t) => !t.includes('Seguros Pérez.')))
})
