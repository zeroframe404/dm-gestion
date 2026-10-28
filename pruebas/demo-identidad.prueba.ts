// Con qué nombre sale la agencia en lo que genera el programa (src/main/demo/identidad.ts y
// renderer/agencia.ts).
//
// Lo que se prueba son las dos puntas de la regla de la demo: en la versión de la agencia todo sigue
// diciendo «Seguros Daniel Martínez», exactamente como antes; en la demo, nada de lo que se le muestra a
// otra agencia (el presupuesto, las plantillas de WhatsApp, el manual) sale firmado con ese nombre.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import {
  firmarPlantillasDeLaDemo,
  NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO,
  nombreDeLaAgencia,
  refirmarPlantillas,
} from '../src/main/demo/identidad'
import { nombreDeLaAseguradora } from '../src/main/servicios/presupuestos'
import { htmlDelManual } from '../src/renderer/ayuda/manual'
import { nombreDeLaAgencia as nombreEnLaPantalla } from '../src/renderer/agencia'
import { FIRMA_DE_LOS_MENSAJES, PLANTILLA_AVISO_POR_DEFECTO, plantillaDeAvisoFirmada } from '../src/shared/tipos'

function baseNueva() {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    return abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
}

function textos(base: ReturnType<typeof baseNueva>): Map<string, string> {
  const filas = base.prepare('SELECT clave, texto FROM plantillas_mensaje ORDER BY clave').all() as { clave: string; texto: string }[]
  return new Map(filas.map((fila) => [fila.clave, fila.texto]))
}

test('en la versión de la agencia el nombre y la plantilla de fábrica no cambiaron', () => {
  // El texto, tal cual estaba escrito antes de que la firma pasara a ser un parámetro.
  assert.equal(
    PLANTILLA_AVISO_POR_DEFECTO,
    'Hola {nombre}, te recordamos que el {vencimiento} vence la cuota de tu seguro por ${cuota}. Cualquier duda escribinos. Seguros Daniel Martínez.',
  )
  // Afuera de Electron el canal es el estable: es lo que ve la agencia.
  assert.equal(nombreDeLaAgencia(), 'Seguros Daniel Martínez')
  assert.equal(nombreDeLaAseguradora(), 'SEGUROS DANIEL MARTÍNEZ')
  assert.equal(nombreEnLaPantalla('estable'), 'Seguros Daniel Martínez')
  assert.equal(nombreEnLaPantalla('beta'), 'Seguros Daniel Martínez')
  assert.equal(nombreEnLaPantalla(), 'Seguros Daniel Martínez', 'sin saber el canal, el de la agencia')
})

test('la demo se presenta con el nombre de demostración, el mismo en las dos puntas', () => {
  assert.equal(nombreDeLaAgencia(true), NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO)
  assert.equal(nombreEnLaPantalla('demo'), NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO)
  assert.ok(!plantillaDeAvisoFirmada(NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO).includes('Daniel'))
  assert.ok(plantillaDeAvisoFirmada(NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO).includes('${cuota}'), 'las variables quedan como estaban')
})

test('en la demo las cuatro plantillas sembradas dejan de estar firmadas por la agencia', () => {
  const base = baseNueva()
  const antes = textos(base)
  assert.equal(antes.size, 4)
  for (const texto of antes.values()) assert.ok(texto.endsWith(`${FIRMA_DE_LOS_MENSAJES}.`), 'la migración las siembra firmadas')

  assert.equal(refirmarPlantillas(base, NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO), 4)
  const despues = textos(base)
  for (const [clave, texto] of despues) {
    assert.ok(!texto.includes('Daniel'), `«${clave}» no nombra a la agencia`)
    assert.ok(texto.endsWith(`${NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO}.`), `«${clave}» firma la demo`)
    // Fuera de la firma, el mensaje es el mismo.
    assert.equal(texto.replace(NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO, FIRMA_DE_LOS_MENSAJES), antes.get(clave))
  }
  assert.equal(despues.get('aviso_vencimiento'), plantillaDeAvisoFirmada(NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO))

  // La segunda vez no encuentra nada que cambiar.
  assert.equal(refirmarPlantillas(base, NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO), 0)
  cerrarBaseDeDatos()
})

test('lo que alguien escribió a mano en una plantilla no se toca', () => {
  const base = baseNueva()
  base.prepare(`UPDATE plantillas_mensaje SET texto = 'Hola {nombre}, saludos de la oficina.' WHERE clave = 'bienvenida'`).run()
  assert.equal(refirmarPlantillas(base, NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO), 3)
  assert.equal(textos(base).get('bienvenida'), 'Hola {nombre}, saludos de la oficina.')
  cerrarBaseDeDatos()
})

test('fuera de la demo, firmar las plantillas no hace nada', () => {
  const base = baseNueva()
  const antes = textos(base)
  firmarPlantillasDeLaDemo()
  assert.deepEqual(textos(base), antes)
  assert.equal(refirmarPlantillas(base, FIRMA_DE_LOS_MENSAJES), 0)
  cerrarBaseDeDatos()
})

test('el manual sale a nombre de la agencia, o de la demo si se lo pide', () => {
  const datos = { version: '17.0.0', fecha: '27 de octubre de 2026' }
  const deLaAgencia = htmlDelManual(datos)
  assert.equal(deLaAgencia.split('Seguros Daniel Martínez').length - 1 >= 3, true, 'portada, pie de cada hoja y firma')

  const deLaDemo = htmlDelManual({ ...datos, agencia: NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO })
  assert.ok(!deLaDemo.includes('Daniel Martínez'))
  assert.ok(deLaDemo.includes(`<p class="portada-marca">${NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO}</p>`))
})
