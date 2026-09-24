// El manual, para que no se pudra solo.
//
// Lo que se comprueba es lo que se rompe en silencio: que entre en las páginas que dice, que ningún
// módulo quede afuera —el próximo que agreguen tiene que aparecer sin que nadie se acuerde de tocar
// el manual— y que los términos del glosario sigan existiendo en la ayuda con ese nombre.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTENIDO_AYUDA } from '../src/renderer/ayuda/contenido'
import { clavesDeAyudaDe, htmlDelManual, nombreDelManual } from '../src/renderer/ayuda/manual'
import { MODULOS, MODULO_ADMINISTRACION, MODULO_API_ASEGURADORAS } from '../src/renderer/modulos'

const MANUAL = htmlDelManual({ version: '12.0.3', fecha: '29 de agosto de 2026', logo: '' })

function hojas(html: string): number {
  return html.split('<section class="hoja').length - 1
}

test('el manual es corto: entre ocho y doce páginas', () => {
  const cantidad = hojas(MANUAL)
  // Más que doce deja de ser un manual que alguien lee de una sentada, que es todo el punto.
  assert.ok(cantidad >= 8 && cantidad <= 12, `el manual quedó en ${cantidad} páginas`)
  // Y la numeración del pie tiene que coincidir con las páginas de verdad.
  // El pie de cada hoja numera sobre el total: si no coinciden, el manual dice «7 de 11» en la
  // última página, que es el error clásico de contar las páginas a mano.
  assert.ok(MANUAL.includes(`de ${cantidad}</span>`), `el pie numera sobre otro total que las ${cantidad} páginas reales`)
})

test('ningún módulo queda afuera del manual', () => {
  // Es la prueba que caza el módulo nuevo que alguien agrega sin acordarse del manual.
  for (const modulo of [...MODULOS, MODULO_API_ASEGURADORAS, MODULO_ADMINISTRACION]) {
    if (modulo.id === 'inicio') continue
    assert.ok(MANUAL.includes(`<h3>${modulo.nombre}</h3>`), `falta el módulo ${modulo.nombre} en el manual`)
  }
})

test('cada clave de ayuda pertenece a algún módulo', () => {
  // Una clave que no engancha con ningún módulo queda afuera del manual sin que nadie se entere. Hoy
  // la única fuera de convención es «imputados», que está contemplada a mano.
  const asignadas = new Set<string>()
  for (const modulo of [...MODULOS, MODULO_API_ASEGURADORAS, MODULO_ADMINISTRACION]) {
    for (const clave of clavesDeAyudaDe(modulo.id)) asignadas.add(clave)
  }
  const huerfanas = Object.keys(CONTENIDO_AYUDA).filter((clave) => !asignadas.has(clave))
  assert.deepEqual(huerfanas, [], `hay claves de ayuda que no pertenecen a ningún módulo: ${huerfanas.join(', ')}`)
})

test('el manual no inventa texto: sale de la ayuda que ya existe', () => {
  // Un par de anclas: si alguien reescribe la ayuda, el manual la sigue.
  // Clientes sí tiene ayuda propia del módulo («clientes»), y por eso su ficha sale de ahí.
  const clientes = CONTENIDO_AYUDA['clientes']
  assert.ok(clientes, 'tiene que existir la ayuda de Clientes')
  const primeraFrase = clientes.secciones[0]!.parrafos[0]!.slice(0, 60)
  assert.ok(MANUAL.includes(primeraFrase), 'la ficha de Clientes tiene que salir de su propia ayuda')

  // Y las pestañas de un módulo se nombran: es lo que después cuesta encontrar.
  assert.ok(MANUAL.includes('Planilla del mes'), 'las pestañas de Cartera tienen que estar nombradas')
})

test('el glosario no queda vacío y sus términos existen en la ayuda', () => {
  const terminos = new Set<string>()
  for (const contenido of Object.values(CONTENIDO_AYUDA)) {
    for (const concepto of contenido.conceptos ?? []) terminos.add(concepto.termino.trim())
  }
  // Los que el manual elige a mano tienen que seguir existiendo con ese nombre: si alguien renombra
  // «Semáforo» en la ayuda, el glosario del manual se quedaría corto en silencio.
  for (const esperado of ['Semáforo', 'Cobertura financiera', 'Débito automático']) {
    assert.ok(terminos.has(esperado), `el glosario del manual espera el término «${esperado}» en la ayuda`)
  }
  assert.ok(MANUAL.includes('<dl class="glosario">'))
  assert.ok(MANUAL.includes('Semáforo'))
})

test('el HTML es una hoja A4 bien armada', () => {
  assert.ok(MANUAL.startsWith('<!doctype html>'))
  assert.ok(MANUAL.includes('@page { size: A4; margin: 0; }'))
  // 296.9 y no 297: con el alto exacto, Chromium mete una hoja en blanco entre cada par.
  assert.ok(MANUAL.includes('height: 296.9mm'), 'el alto de la hoja no puede ser 297mm exactos')
  // Sin logo, la portada no deja una imagen rota.
  assert.ok(!MANUAL.includes('<img class="logo" src=""'))
  assert.equal(nombreDelManual('12.0.3'), 'DM Gestion - Manual 12.0.3.pdf')
})

test('lo que viene de la ayuda va escapado', () => {
  // El contenido de ayuda tiene comillas angulares y flechas por todos lados; lo que no puede pasar
  // es que un < de un texto abra una etiqueta.
  const conLogo = htmlDelManual({ version: '<script>', fecha: 'hoy', logo: '' })
  assert.ok(!conLogo.includes('Versión <script>'))
  assert.ok(conLogo.includes('&lt;script&gt;'))
})
