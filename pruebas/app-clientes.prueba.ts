// La pestaña APP CLIENTES (15.4): sólo campos del cliente, nunca de una póliza puntual. Sin base de
// datos: se prueba directo contra CAMPOS_POR_TIPO / resolverCampo / clasificarPestana, igual que
// encabezados-siniestros.prueba.ts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { encabezadoParaAgregar, mapearEncabezados, resolverCampo } from '../src/main/importacion/encabezados'
import { clasificarPestana } from '../src/main/importacion/pestanas'
import { PESTANAS_DE_LA_APP } from '../src/main/sincronizacion/pestanasApp'

test('APP CLIENTES admite los campos del cliente y rechaza los de una póliza puntual', () => {
  for (const campo of ['nombre', 'documento', 'telefono', 'email', 'direccion', 'localidad', 'provincia', 'codigo_postal', 'sucursal', 'fecha_nacimiento'] as const) {
    assert.equal(resolverCampo(encabezadoParaAgregar(campo, 'APP_CLIENTES', [])!, 'APP_CLIENTES'), campo, `«${campo}» tiene que reconocerse en APP CLIENTES`)
  }
  // Lo que es de una póliza (no del cliente) no tiene sentido acá: no hay a qué póliza referirse.
  for (const encabezado of ['COMPAÑIA', 'PRIMA', 'CUOTA', 'N° POLIZA', 'PATENTE']) {
    assert.equal(resolverCampo(encabezado, 'APP_CLIENTES'), null, `«${encabezado}» no es un campo del cliente`)
  }
})

test('el título «APP CLIENTES» se clasifica como tal, y la fila de encabezados se lee de vuelta igual', () => {
  assert.equal(clasificarPestana('APP CLIENTES').tipo, 'APP_CLIENTES')

  const plantilla = PESTANAS_DE_LA_APP.find((p) => p.titulo === 'APP CLIENTES')
  assert.ok(plantilla, 'tiene que estar en las pestañas que crea la aplicación')
  const mapeo = mapearEncabezados(plantilla!.encabezados, 'APP_CLIENTES')
  for (const campo of ['nombre', 'documento', 'telefono', 'email', 'direccion', 'localidad', 'provincia', 'codigo_postal', 'sucursal', 'fecha_nacimiento']) {
    assert.ok(mapeo.porCampo.has(campo as never), `el encabezado de fábrica tiene que traer «${campo}»`)
  }
})
