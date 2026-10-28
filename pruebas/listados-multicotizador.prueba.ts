// Los listados del Multicotizador contra una base de verdad: lo que no sale de la API de una compañía
// sale de la base (los presupuestos, las pólizas), marcado; y lo de una compañía que contestó por su
// API no se repite desde la base.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import type { CotizadorDeAseguradora } from '../src/main/multicotizador/aseguradora'
import { usarAseguradorasDePrueba } from '../src/main/multicotizador/registro'
import { cotizacionesDelMulticotizador, emisionesDelMulticotizador } from '../src/main/servicios/listadosDelMulticotizador'
import { crearPresupuesto } from '../src/main/servicios/presupuestos'
import { usarFuenteDePrueba } from '../src/main/servicios/sincronizacion'
import type { SesionUsuario } from '../src/shared/tipos'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

async function baseImportada(): Promise<void> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
  await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
  usarFuenteDePrueba(hoja)
}

function compania(cambios: Partial<CotizadorDeAseguradora>): CotizadorDeAseguradora {
  return {
    id: 'PRUEBA',
    nombre: 'Prueba',
    tipos: ['AUTO', 'MOTO'],
    emite: false,
    noDisponible: () => null,
    async cotizar() {
      throw new Error('No se cotiza en esta prueba.')
    },
    ...cambios,
  }
}

function fecha(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('listados: las cotizaciones sin API salen de los presupuestos, marcadas; las de la API no se repiten', async (t) => {
  t.after(() => {
    usarAseguradorasDePrueba(null)
    usarFuenteDePrueba(null)
    cerrarBaseDeDatos()
  })
  await baseImportada()
  crearPresupuesto(
    {
      leadId: null,
      clienteId: null,
      clienteNombre: 'IBAÑEZ MARCELA',
      telefono: '',
      documento: '',
      sucursal: '',
      patente: 'AB123CD',
      marca: 'HONDA',
      modelo: 'WAVE',
      anio: '2020',
      tipoVehiculo: 'Particular',
      sumaAsegurada: '',
      observaciones: 'Cotizado con el multicotizador. Moto.',
      opciones: [
        { compania: 'SANCOR', cobertura: 'TERCEROS COMPLETO', precio: '$ 52.400', comentario: '' },
        { compania: 'GALENO', cobertura: 'C1', precio: '$ 47.900', comentario: '' },
        { compania: 'MERCANTIL ANDINA', cobertura: 'TODO RIESGO', precio: '$ 91.300', comentario: '' },
      ],
    },
    DANIEL,
  )
  usarAseguradorasDePrueba([
    compania({
      id: 'GALENO',
      nombre: 'Galeno',
      async cotizaciones() {
        return [{ tipo: 'AUTO', numero: '900', fecha: fecha(0), tomador: 'Ana', vehiculo: '', patente: '', cobertura: '', premio: null, sumaAsegurada: null, vigenciaDesde: '', vigenciaHasta: '' }]
      },
    }),
    compania({ id: 'MERCANTIL', nombre: 'Mercantil Andina' }),
  ])

  const listado = await cotizacionesDelMulticotizador({ desde: fecha(-10), hasta: fecha(0), tipo: null }, true)
  const resumen = listado.filas.map((fila) => [fila.origen, fila.nombreAseguradora, fila.cobertura || fila.numero])
  assert.deepEqual(
    resumen.sort(),
    [
      ['API', 'Galeno', '900'],
      ['VPS', 'Mercantil Andina', 'TODO RIESGO'],
      ['VPS', 'SANCOR', 'TERCEROS COMPLETO'],
    ].sort(),
  )
  const mercantil = listado.filas.find((fila) => fila.nombreAseguradora === 'Mercantil Andina')!
  assert.equal(mercantil.tipo, 'MOTO')
  assert.match(mercantil.motivoVps ?? '', /no viene de la API de Mercantil Andina/)
  assert.match(mercantil.motivoVps ?? '', /su API no da el listado de cotizaciones/)
  const sancor = listado.filas.find((fila) => fila.nombreAseguradora === 'SANCOR')!
  assert.match(sancor.motivoVps ?? '', /SANCOR no tiene una API conectada/)

  // Con el filtro de autos, la moto de la base queda afuera.
  const autos = await cotizacionesDelMulticotizador({ desde: fecha(-10), hasta: fecha(0), tipo: 'AUTO' }, true)
  assert.deepEqual(
    autos.filas.map((fila) => fila.origen),
    ['API'],
  )
})

test('listados: sin ninguna API de emisiones, todo sale de la base y cada fila dice por qué', async (t) => {
  t.after(() => {
    usarAseguradorasDePrueba(null)
    usarFuenteDePrueba(null)
    cerrarBaseDeDatos()
  })
  await baseImportada()
  usarAseguradorasDePrueba([compania({ id: 'GALENO', nombre: 'Galeno', noDisponible: () => 'Falta la cuenta.' })])
  const listado = await emisionesDelMulticotizador({ desde: '2026-01-01', hasta: '2026-12-31', tipo: null }, true)
  assert.ok(listado.filas.length > 0)
  assert.ok(listado.filas.every((fila) => fila.origen === 'VPS' && /base de datos del VPS/.test(fila.motivoVps ?? '')))
  assert.match(listado.fuentes[0]?.motivoVps ?? '', /no está configurada en este programa \(Falta la cuenta\)/)
})
