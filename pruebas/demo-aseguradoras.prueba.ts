// Las compañías de la versión de demostración (src/main/demo/aseguradoras.ts y demo/galeno.ts).
//
// Lo que se prueba es lo que hace creíble la demo delante de otra agencia: que todas las compañías
// coticen, en todas las categorías, con precios del orden de los de verdad; que el mismo vehículo dé
// siempre el mismo precio y otro vehículo dé otro; que los ajustes muevan el precio; que Galeno y ATM
// dejen emitir; y que los listados tengan filas. Nada de esto sale a internet.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { CategoriaDeCobertura, SolicitudDeCotizacion } from '../src/shared/multicotizador'
import { cotizar as cotizarEnGaleno } from '../src/main/aseguradoras/galeno/cotizacion'
import { emitir as emitirEnGaleno } from '../src/main/aseguradoras/galeno/emision'
import * as catalogosGaleno from '../src/main/aseguradoras/galeno/catalogos'
import type { DatosDeEmisionGaleno } from '../src/shared/tipos'
import { estadoDeAtmDemo, emisionDeAtmDemo } from '../src/main/demo/apis'
import { ASEGURADORAS_DE_LA_DEMO, olvidarLaSesionDeLaDemo } from '../src/main/demo/aseguradoras'
import { clienteGalenoDeLaDemo, LEGAJO_DE_LA_DEMO } from '../src/main/demo/galeno'
import { anioDeEjemplo, demorasDeLaDemo, fechaIso, patenteDe, sumarDias, VEHICULOS_DE_EJEMPLO } from '../src/main/demo/simulacion'
import { telefonoParaMostrar, whatsappDeLaDemo } from '../src/main/demo/whatsapp'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'
import { atm } from '../src/main/multicotizador/atm'
import { equidad } from '../src/main/multicotizador/equidad'
import { galeno } from '../src/main/multicotizador/galeno'
import { mercantil } from '../src/main/multicotizador/mercantil'
import { usarAseguradorasDePrueba } from '../src/main/multicotizador/registro'
import { cotizarEnAseguradora } from '../src/main/servicios/multicotizador'

demorasDeLaDemo(false)

function solicitud(vehiculo: Partial<SolicitudDeCotizacion['vehiculo']> = {}, cambios: Partial<SolicitudDeCotizacion> = {}): SolicitudResuelta {
  return {
    vehiculo: {
      tipo: 'AUTO',
      marca: 'Volkswagen',
      modelo: 'Gol Trend',
      version: '1.6 Trendline 5P',
      anio: '2019',
      codigoCatalogo: '',
      ceroKm: false,
      uso: 'PARTICULAR',
      gnc: false,
      valorGnc: null,
      rastreador: 'SIN_RASTREADOR',
      scoring: { grua: false, alarma: false, garaje: false },
      accesorios: [],
      sumaAsegurada: null,
      ...vehiculo,
    },
    tomador: {
      nombre: 'Juan',
      apellido: 'Pérez',
      dni: '30123456',
      cuit: '',
      telefono: '',
      tipoPersona: 'FISICA',
      condicionIva: 'CONSUMIDOR_FINAL',
      ingresosBrutos: 'CONSUMIDOR_FINAL',
      sexo: null,
      fechaNacimiento: '',
    },
    provincia: 'Buenos Aires',
    codigoPostal: '1870',
    localidad: 'Avellaneda',
    vigenciaDesde: fechaIso(new Date()),
    medioDePago: 'TARJETA',
    condiciones: { plan: 'SIN_PLAN', tarifa: 'SIN_DESCUENTO', comision: 'ESTANDAR', facturacion: 'MEJOR_COSTO', clausulaAjuste: '10', cuotas: 'MAXIMA' },
    codigoInfoAuto: null,
    ...cambios,
  }
}

const GOL = solicitud()
const MOTO = solicitud({ tipo: 'MOTO', marca: 'Honda', modelo: 'Wave', version: '110 S', anio: '2021' })
const HILUX = solicitud({ marca: 'Toyota', modelo: 'Hilux', version: '2.8 DC 4X4 SRV', anio: '2022', rastreador: 'LO_JACK' }, { codigoPostal: '1406', localidad: '' })

function premios(coberturas: Array<{ codigo: string; premio: number }>): Record<string, number> {
  return Object.fromEntries(coberturas.map((c) => [c.codigo, c.premio]))
}

test('demo: sólo las compañías que el programa integra de verdad, con sus ids, nombres y tipos, y todas disponibles', () => {
  const reales = [galeno, atm, mercantil, equidad]
  for (const real of reales) {
    const demo = ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === real.id)
    assert.ok(demo, real.id)
    assert.equal(demo.nombre, real.nombre)
    assert.deepEqual([...demo.tipos], [...real.tipos])
    assert.equal(demo.emite, real.emite)
  }
  // Ni Federación Patronal ni Sancor: no tienen API en el programa, no se le muestran a otra agencia.
  assert.deepEqual(ASEGURADORAS_DE_LA_DEMO.map((a) => a.id).sort(), reales.map((r) => r.id).sort())
  for (const aseguradora of ASEGURADORAS_DE_LA_DEMO) {
    assert.equal(aseguradora.noDisponible(), null, aseguradora.nombre)
    assert.ok(aseguradora.planes && aseguradora.cotizaciones && aseguradora.emisiones, aseguradora.nombre)
  }
})

test('demo: cada compañía cotiza autos, motos y pick ups en varias categorías, con precios del mercado', async () => {
  for (const [nombre, pedido] of [
    ['Gol 2019', GOL],
    ['moto 110', MOTO],
    ['Hilux 2022', HILUX],
  ] as const) {
    const cotizan = ASEGURADORAS_DE_LA_DEMO.filter((a) => a.tipos.includes(pedido.vehiculo.tipo))
    // Motos cotizan Galeno y ATM; autos, las cuatro.
    assert.ok(cotizan.length >= (pedido.vehiculo.tipo === 'MOTO' ? 2 : 4), nombre)
    for (const aseguradora of cotizan) {
      const r = await aseguradora.cotizar(pedido, {})
      const donde = `${aseguradora.nombre} / ${nombre}`
      assert.equal(r.estado, 'OK', donde)
      const categorias = new Set<CategoriaDeCobertura>(r.coberturas.map((c) => c.categoria))
      assert.ok(!categorias.has('OTRA'), `${donde}: una cobertura cayó en «Otras»`)
      assert.ok(categorias.has('RC') && categorias.has('TERCEROS_BASICO') && categorias.has('TERCEROS_COMPLETO'), donde)
      if (pedido.vehiculo.tipo === 'AUTO') assert.ok(categorias.has('TERCEROS_PREMIUM') && categorias.has('TODO_RIESGO'), donde)
      for (const c of r.coberturas) {
        assert.ok(c.premio > c.prima * 0.9 && c.premio > 0, `${donde} ${c.codigo}`)
        assert.equal(c.aseguradora, aseguradora.id)
        assert.ok(c.comision !== null && c.comision > 0, `${donde}: la comisión la saca el servicio, no el adaptador`)
        assert.ok(c.cuota !== null && c.primeraCuota !== null)
      }
      // Más cobertura, más caro: la responsabilidad civil es lo más barato y el todo riesgo lo más caro.
      const rc = r.coberturas.find((c) => c.categoria === 'RC')!.premio
      const completo = r.coberturas.find((c) => c.categoria === 'TERCEROS_COMPLETO')!.premio
      assert.ok(rc < completo, donde)
      const todoRiesgo = r.coberturas.filter((c) => c.categoria === 'TODO_RIESGO')
      for (const tr of todoRiesgo) {
        assert.ok(tr.premio > completo, donde)
        assert.match(tr.franquicia, /^\$ [\d.]+$/, donde)
      }
      assert.ok(r.ajustes.length >= 6, donde)
      assert.ok(r.descripcionVehiculo.length > 0)
      assert.ok((r.detalleTecnico as { demo?: boolean }).demo, donde)
    }
  }

  // El orden de magnitud: un Gol 2019 en Avellaneda, mensual, terceros completo.
  const galeno = ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'GALENO')!
  const gol = await galeno.cotizar(GOL, {})
  const completo = gol.coberturas.find((c) => c.categoria === 'TERCEROS_COMPLETO')!.premio
  assert.ok(completo > 40_000 && completo < 250_000, `terceros completo de un Gol 2019: ${completo}`)
})

test('demo: el mismo pedido da el mismo precio; otro vehículo, otra zona u otra compañía, otro precio', async () => {
  const [galeno, atm] = [ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'GALENO')!, ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'ATM')!]
  const una = await galeno.cotizar(GOL, {})
  const otra = await galeno.cotizar(structuredClone(GOL), {})
  assert.deepEqual(premios(una.coberturas), premios(otra.coberturas))

  const hilux = await galeno.cotizar(HILUX, {})
  assert.notDeepEqual(premios(una.coberturas), premios(hilux.coberturas))
  const completo = (r: typeof una) => r.coberturas.find((c) => c.categoria === 'TERCEROS_COMPLETO')!.premio
  assert.ok(completo(hilux) > completo(una), 'una Hilux 2022 vale más que un Gol 2019')

  const interior = await galeno.cotizar(solicitud({}, { codigoPostal: '3500', localidad: 'Resistencia' }), {})
  assert.ok(completo(interior) < completo(una), 'el Gran Buenos Aires es más caro que el interior')

  const nuevo = await galeno.cotizar(solicitud({ anio: '2024' }), {})
  assert.ok(completo(nuevo) > completo(una), 'el mismo modelo más nuevo vale más')

  const conSuma = await galeno.cotizar(solicitud({ sumaAsegurada: 30_000_000 }), {})
  assert.ok(completo(conSuma) > completo(una), 'la suma asegurada cargada manda')

  const enAtm = await atm.cotizar(GOL, {})
  assert.notEqual(completo(enAtm), completo(una))

  const conRastreo = await galeno.cotizar(solicitud({ rastreador: 'LO_JACK', scoring: { grua: false, alarma: true, garaje: true } }), {})
  assert.ok(completo(conRastreo) < completo(una), 'el rastreador y el garaje bajan el precio')
  assert.ok(conRastreo.ajustes.some((a) => a.campo === 'equipoRastreo'))

  const enEfectivo = await galeno.cotizar(solicitud({}, { medioDePago: 'EFECTIVO' }), {})
  assert.notEqual(completo(enEfectivo), completo(una))
})

test('demo: cambiar un ajuste de la compañía cambia el precio, y lo elegido vuelve como valor del ajuste', async () => {
  const galeno = ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'GALENO')!
  const base = await galeno.cotizar(GOL, {})
  const completo = (r: typeof base) => r.coberturas.find((c) => c.categoria === 'TERCEROS_COMPLETO')!

  const modo = base.ajustes.find((a) => a.campo === 'modoFacturacion')!
  assert.ok(modo.destacado)
  const semestral = modo.opciones.find((o) => o.texto === 'Semestral')!
  const enSemestral = await galeno.cotizar(GOL, { modoFacturacion: semestral.valor })
  assert.equal(enSemestral.ajustes.find((a) => a.campo === 'modoFacturacion')!.valor, semestral.valor)
  assert.ok(completo(enSemestral).premio > completo(base).premio * 4, 'seis meses salen más que un mes')
  assert.equal(enSemestral.ajustes.find((a) => a.campo === 'cuotas')!.opciones.length, 6)

  for (const campo of ['plan', 'bonificacion', 'version', 'formaDePago', 'clausulaAjuste']) {
    const ajuste = base.ajustes.find((a) => a.campo === campo)!
    const otra = ajuste.opciones.find((o) => o.valor !== ajuste.valor)!
    const cambiada = await galeno.cotizar(GOL, { [campo]: otra.valor })
    assert.equal(cambiada.ajustes.find((a) => a.campo === campo)!.valor, otra.valor, campo)
    assert.notEqual(completo(cambiada).premio, completo(base).premio, campo)
  }

  // La versión y la localidad son de ESTE vehículo y ESTE código postal.
  assert.ok(base.ajustes.find((a) => a.campo === 'version')!.porSolicitud)
  assert.ok(base.ajustes.find((a) => a.campo === 'localidad')!.porSolicitud)

  // Las condiciones del formulario ya mueven el precio solas.
  const conDescuento = await galeno.cotizar(solicitud({}, { condiciones: { ...GOL.condiciones, tarifa: 'DESCUENTO_MAXIMO' } }), {})
  assert.ok(completo(conDescuento).premio < completo(base).premio)
  assert.ok(completo(conDescuento).bonificacionPorcentaje! > 0)
})

test('demo: los vehículos viejos y los taxis traen sus avisos y dejan afuera lo que no se ofrece', async () => {
  const equidad = ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'EQUIDAD')!
  const viejo = await equidad.cotizar(solicitud({ anio: '2002' }), {})
  assert.ok(viejo.avisos.some((a) => /inspecci[oó]n previa/i.test(a)))
  assert.ok(!viejo.coberturas.some((c) => c.categoria === 'TODO_RIESGO'))

  const taxi = await equidad.cotizar(solicitud({ uso: 'TAXI' }), {})
  assert.ok(taxi.avisos.length > 0)
  assert.ok(!taxi.coberturas.some((c) => c.categoria === 'TODO_RIESGO' || c.categoria === 'TERCEROS_PREMIUM'))
  const particular = await equidad.cotizar(GOL, {})
  const rc = (r: typeof taxi) => r.coberturas.find((c) => c.categoria === 'RC')!.premio
  assert.ok(rc(taxi) > rc(particular))
})

test('demo: Galeno y ATM dejan emitir; las otras no', async () => {
  for (const aseguradora of ASEGURADORAS_DE_LA_DEMO) {
    const r = await aseguradora.cotizar(GOL, {})
    const emisiones = r.coberturas.map((c) => c.emision)
    if (aseguradora.id === 'GALENO') {
      for (const e of emisiones) {
        assert.equal(e?.tipo, 'GALENO')
        if (e?.tipo === 'GALENO') {
          assert.equal(e.rama, 4)
          assert.ok(e.solicitud > 0)
          assert.equal(e.codigoPostal, '1870')
          assert.ok(e.cobertura.premio > 0)
        }
      }
    } else if (aseguradora.id === 'ATM') {
      for (const e of emisiones) {
        assert.equal(e?.tipo, 'ATM')
        if (e?.tipo === 'ATM') {
          assert.ok(/^\d+$/.test(e.operacion))
          assert.equal(e.seccion, '3')
          assert.equal(e.iva, 'CF')
          assert.equal(e.condicionDePago, 'TARJETA')
        }
      }
    } else {
      assert.ok(emisiones.every((e) => e === null), aseguradora.nombre)
    }
  }
})

test('demo: los listados del multicotizador tienen filas, dentro del rango y del tipo pedido', async () => {
  // Sólo lo inventado: lo cotizado en las pruebas de arriba no tiene patente (ver la prueba de la sesión).
  olvidarLaSesionDeLaDemo()
  const hoy = fechaIso(new Date())
  const filtros = { desde: sumarDias(hoy, -60), hasta: hoy, tipo: null }
  let cotizaciones = 0
  let emisiones = 0
  for (const aseguradora of ASEGURADORAS_DE_LA_DEMO) {
    const planes = await aseguradora.planes!('AUTO')
    assert.ok(planes.length > 0, aseguradora.nombre)
    const filas = await aseguradora.cotizaciones!(filtros)
    cotizaciones += filas.length
    for (const fila of filas) {
      assert.ok(fila.fecha >= filtros.desde && fila.fecha <= hoy)
      assert.ok(fila.premio! > 0 && fila.numero && fila.tomador && fila.patente)
    }
    const polizas = await aseguradora.emisiones!(filtros)
    emisiones += polizas.length
    for (const fila of polizas) assert.ok(fila.poliza && fila.estado && fila.vigenciaHasta > fila.vigenciaDesde)
    // Lo mismo dos veces es lo mismo.
    assert.deepEqual(await aseguradora.cotizaciones!(filtros), filas)
  }
  assert.ok(cotizaciones > 20, `cotizaciones: ${cotizaciones}`)
  assert.ok(emisiones > 5, `emisiones: ${emisiones}`)

  const motos = await ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'GALENO')!.cotizaciones!({ ...filtros, tipo: 'MOTO' })
  assert.ok(motos.length > 0 && motos.every((fila) => fila.tipo === 'MOTO'))
  assert.deepEqual(await ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'MERCANTIL')!.cotizaciones!({ ...filtros, tipo: 'MOTO' }), [])
})

test('demo: por el servicio, la comisión no le llega a quien no ve los números de la agencia', async () => {
  usarAseguradorasDePrueba(ASEGURADORAS_DE_LA_DEMO)
  try {
    const pedido = { aseguradora: 'GALENO', solicitud: GOL, elegidos: {} }
    const conNumeros = await cotizarEnAseguradora(pedido, true)
    const sinNumeros = await cotizarEnAseguradora(pedido, false)
    assert.equal(conNumeros.estado, 'OK')
    assert.ok(conNumeros.coberturas.every((c) => c.comision !== null && c.comision > 0))
    assert.ok(sinNumeros.coberturas.every((c) => c.comision === null))
    assert.ok(!JSON.stringify(sinNumeros.detalleTecnico).includes('comision'))
    assert.deepEqual(premios(conNumeros.coberturas), premios(sinNumeros.coberturas))
  } finally {
    usarAseguradorasDePrueba(null)
  }
})

test('demo: el cliente de Galeno contesta catálogos, cotiza y emite con la forma de la API de verdad', async () => {
  const cliente = clienteGalenoDeLaDemo()
  const planes = await catalogosGaleno.planesComerciales(cliente, 4)
  assert.ok(planes.length > 0 && planes.every((p) => p.productorCodigo === LEGAJO_DE_LA_DEMO))
  const marcas = await catalogosGaleno.marcas(cliente, 4)
  const vw = marcas.find((m) => m.descripcion === 'VOLKSWAGEN')!
  const modelos = await catalogosGaleno.modelos(cliente, vw.codigo)
  const gol = modelos.find((m) => m.descripcion === 'GOL TREND')!
  const versiones = await catalogosGaleno.subModelos(cliente, vw.codigo, gol.codigo, '2019')
  assert.ok(versiones.length > 0)
  const localidades = await catalogosGaleno.codigoPostal(cliente, 4, '1870')
  assert.equal(localidades[0]?.localidad, 'AVELLANEDA')
  const modos = await catalogosGaleno.modosDeFacturacion(cliente, 4, planes[0]!.codPlanComercial)
  const condiciones = await catalogosGaleno.condicionesDePago(cliente, 4, modos[0]!.codigo)
  const formas = await catalogosGaleno.formasDePago(cliente, 4, modos[0]!.codigo, planes[0]!.codPlanComercial)
  assert.ok(modos.length > 0 && condiciones.length > 0 && formas.length > 0)

  const cotizacion = await cotizarEnGaleno(cliente, LEGAJO_DE_LA_DEMO, {
    tipoVehiculo: 'AUTO',
    planComercialCodigo: planes[0]!.codPlanComercial,
    ceroKm: false,
    idInfoAuto: null,
    marcaCodigo: vw.codigo,
    modeloCodigo: String(versiones[0]!.codigoModelo),
    subModeloCodigo: String(versiones[0]!.codigoSubModelo),
    anioFabricacion: '2019',
    tomadorTipoPersona: '1',
    tomadorNombre: 'PEREZ JUAN',
    codigoPostal: '1870',
    subCodigoPostal: localidades[0]!.subCodigoPostal,
    condicionPagoCodigo: condiciones[0]!.codigo,
    vigenciaDesde: fechaIso(new Date()),
    modoFacturacionCodigo: modos[0]!.codigo,
    formaPagoCodigo: formas[0]!.codigo,
    poseeEquipoGnc: false,
    poseeEquipoRastreo: false,
  })
  assert.ok(cotizacion.solicitud > 0)
  assert.ok(cotizacion.coberturas.length >= 5)
  assert.match(cotizacion.descripcionVehiculo, /GOL TREND/)
  const elegida = cotizacion.coberturas.find((c) => c.cobertura === 'C1')!

  const emision = await emitirEnGaleno(cliente, {
    rama: 4,
    solicitud: cotizacion.solicitud,
    instalacion: 1,
    cobertura: elegida.cobertura,
    tomador: { tipoDocumentoCodigo: '96', documentoNumero: '30123456', nombre: 'PEREZ JUAN', categoriaIVACodigo: '5', calleNombre: 'MITRE', calleNumero: '100', codigoPostal: '1870', subCodigoPostal: '1' },
    aseguradoEsTomador: true,
    vehiculo: { patente: 'AB123CD', motor: 'CFZ123456', chasis: '9BWAB45U0KT000001' },
    formaPago: {},
  } as unknown as DatosDeEmisionGaleno)
  assert.equal(emision.estadoSolicitud, 'E')
  assert.ok(emision.poliza > 0)
  assert.equal(emision.premio, elegida.premio, 'se emite por lo que se cotizó')

  // La impresión es un PDF de verdad.
  const pdf = await cliente.pedirCrudo('/api/imprimir', { metodo: 'POST', body: { tipoImpresion: 'P', poliza: String(emision.poliza), rama: 4, legajo: LEGAJO_DE_LA_DEMO } })
  assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  assert.match(await pdf.text(), /^%PDF-1\.4[\s\S]*%%EOF\n$/)
})

test('demo: lo cotizado y emitido en la sesión aparece arriba de todo en Cotizaciones y Emisiones', async () => {
  olvidarLaSesionDeLaDemo()
  const hoy = fechaIso(new Date())
  const filtros = { desde: sumarDias(hoy, -30), hasta: hoy, tipo: null }
  const [galenoDemo, atmDemo] = [ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'GALENO')!, ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'ATM')!]
  const pedido = solicitud({}, { vigenciaDesde: hoy })

  // Galeno: se cotiza en el multicotizador y se emite por su API simulada.
  const cotizada = await galenoDemo.cotizar(pedido, {})
  const completo = cotizada.coberturas.find((c) => c.categoria === 'TERCEROS_COMPLETO')!
  const emisionGaleno = completo.emision!
  assert.equal(emisionGaleno.tipo, 'GALENO')
  if (emisionGaleno.tipo !== 'GALENO') return
  const cotizaciones = await galenoDemo.cotizaciones!(filtros)
  assert.equal(cotizaciones[0]!.numero, String(emisionGaleno.solicitud))
  assert.equal(cotizaciones[0]!.tomador, 'PÉREZ JUAN')
  assert.match(cotizaciones[0]!.vehiculo, /GOL TREND/)
  assert.equal(cotizaciones[0]!.premio, completo.premio)
  // Cotizar dos veces lo mismo no lo repite.
  await galenoDemo.cotizar(structuredClone(pedido), {})
  assert.equal((await galenoDemo.cotizaciones!(filtros)).filter((c) => c.numero === String(emisionGaleno.solicitud)).length, 1)
  assert.deepEqual(await galenoDemo.cotizaciones!({ ...filtros, tipo: 'MOTO' }).then((filas) => filas.filter((c) => c.numero === String(emisionGaleno.solicitud))), [])

  const emitida = await emitirEnGaleno(clienteGalenoDeLaDemo(), {
    rama: emisionGaleno.rama,
    solicitud: emisionGaleno.solicitud,
    instalacion: 1,
    cobertura: emisionGaleno.cobertura.cobertura,
    tomador: { tipoDocumentoCodigo: '96', documentoNumero: '30123456', nombre: 'PEREZ JUAN', categoriaIVACodigo: '5', calleNombre: 'MITRE', calleNumero: '100', codigoPostal: '1870', subCodigoPostal: '1' },
    aseguradoEsTomador: true,
    vehiculo: { patente: 'ac123bd', motor: 'CFZ123456', chasis: '9BWAB45U0KT000001' },
    formaPago: {},
  } as unknown as DatosDeEmisionGaleno)
  assert.equal(emitida.premio, completo.premio)
  const polizasGaleno = await galenoDemo.emisiones!(filtros)
  assert.equal(polizasGaleno[0]!.poliza, String(emitida.poliza))
  assert.equal(polizasGaleno[0]!.patente, 'AC123BD')
  assert.equal(polizasGaleno[0]!.tomador, 'PEREZ JUAN')
  assert.equal(polizasGaleno[0]!.cobertura, completo.nombre)
  assert.equal(polizasGaleno[0]!.fechaEmision, hoy)

  // También en las consultas de Galeno y en la impresión.
  const cliente = clienteGalenoDeLaDemo()
  const porLegajo = await cliente.pedirJson<Array<{ nroPoliza: string; patente: string }>>('/api/polizas/consultaXLegajo', { metodo: 'POST', body: {} })
  assert.equal(porLegajo[0]!.nroPoliza, String(emitida.poliza))
  const pdf = await (await cliente.pedirCrudo('/api/imprimir', { metodo: 'POST', body: { tipoImpresion: 'P', poliza: String(emitida.poliza), rama: 4 } })).text()
  assert.ok(pdf.includes('AC123BD') && pdf.includes('PEREZ JUAN'), 'la póliza impresa es la emitida')

  // ATM: la operación cotizada se emite y queda en su listado.
  const enAtm = await atmDemo.cotizar(pedido, {})
  const coberturaAtm = enAtm.coberturas.find((c) => c.categoria === 'TERCEROS_COMPLETO')!
  const emisionAtm = coberturaAtm.emision!
  assert.equal(emisionAtm.tipo, 'ATM')
  if (emisionAtm.tipo !== 'ATM') return
  const resultado = await emisionDeAtmDemo({
    operacion: emisionAtm.operacion,
    cobertura: emisionAtm.cobertura,
    condicionDePago: emisionAtm.condicionDePago,
    titular: { apellido: 'Pérez Juan' },
    vehiculo: { patente: 'AC123BD', chasis: '', motor: '' },
  } as unknown as Parameters<typeof emisionDeAtmDemo>[0])
  const polizasAtm = await atmDemo.emisiones!(filtros)
  assert.equal(polizasAtm[0]!.poliza, resultado.poliza)
  assert.equal(polizasAtm[0]!.tomador, 'PÉREZ JUAN')
  assert.equal(polizasAtm[0]!.cobertura, coberturaAtm.nombre)
  // Lo de Galeno no se mezcla con lo de ATM.
  assert.ok(!polizasAtm.some((p) => p.poliza === String(emitida.poliza)))
  olvidarLaSesionDeLaDemo()
})

test('demo: patentes y años creíbles (nada de «HHH333» ni de un Cronos 2012)', async () => {
  const patentes = Array.from({ length: 300 }, (_, i) => patenteDe(`prueba:${i}`, 2012 + (i % 15)))
  for (const patente of patentes) {
    assert.match(patente, /^([A-Z]{3}\d{3}|A[A-K]\d{3}[A-Z]{2})$/, patente)
    assert.ok(!/^(.)\1\1/.test(patente) || !/(\d)\1\1$/.test(patente), `patente de juguete: ${patente}`)
  }
  assert.ok(new Set(patentes).size > 290, 'casi todas distintas')
  // La serie va con el año: una patente nueva de 2017 empieza con AB, una vieja de 2012 con K.
  assert.match(patenteDe('x', 2017), /^AB/)
  assert.match(patenteDe('x', 2012), /^K/)
  for (const vehiculo of VEHICULOS_DE_EJEMPLO) {
    for (let i = 0; i < 40; i++) {
      const anio = anioDeEjemplo(`prueba:${i}`, vehiculo, 2026)
      assert.ok(anio >= vehiculo.desde && anio <= (vehiculo.hasta ?? 2026), `${vehiculo.modelo} ${anio}`)
    }
  }
  // Y en los listados.
  olvidarLaSesionDeLaDemo()
  const hoy = fechaIso(new Date())
  for (const aseguradora of ASEGURADORAS_DE_LA_DEMO) {
    for (const fila of await aseguradora.cotizaciones!({ desde: sumarDias(hoy, -60), hasta: hoy, tipo: null })) {
      const ejemplo = VEHICULOS_DE_EJEMPLO.find((v) => fila.vehiculo.startsWith(`${v.marca} ${v.modelo} ${v.version} `))!
      assert.ok(ejemplo, fila.vehiculo)
      const anio = Number(fila.vehiculo.split(' ').at(-1))
      assert.ok(anio >= ejemplo.desde && anio <= (ejemplo.hasta ?? new Date().getFullYear()), fila.vehiculo)
    }
  }
})

test('demo: la descripción del vehículo no repite el modelo cuando la versión ya lo trae', async () => {
  const galenoDemo = ASEGURADORAS_DE_LA_DEMO.find((a) => a.id === 'GALENO')!
  const r = await galenoDemo.cotizar(solicitud({ marca: 'Volkswagen', modelo: 'Gol Trend', version: 'Gol Trend 1.6 Trendline' }), {})
  assert.equal(r.descripcionVehiculo, 'VOLKSWAGEN GOL TREND 1.6 TRENDLINE 2019')
  const sinModelo = await galenoDemo.cotizar(GOL, {})
  assert.equal(sinModelo.descripcionVehiculo, 'VOLKSWAGEN GOL TREND 1.6 TRENDLINE 5P 2019')
})

test('demo: las consultas de Galeno cuentan lo mismo (cuotas impagas = saldo vencido) y los riesgos son de una póliza', async () => {
  olvidarLaSesionDeLaDemo()
  const cliente = clienteGalenoDeLaDemo()
  const pedir = <T>(ruta: string, body: Record<string, unknown> = {}) => cliente.pedirJson<T>(ruta, { metodo: 'POST', body })
  const impagas = await pedir<Array<{ poliza: string; nroCuota: number; saldoCuota: number }>>('/api/polizas/cuotasImpagas')
  const vigentes = await pedir<Array<{ poliza: string; sumaSaldoVencido: number }>>('/api/polizas/vigentes')
  const cobradas = await pedir<Array<{ poliza: string; nroCuota: number }>>('/api/polizas/cuotasCobradas')
  assert.ok(impagas.length > 0)
  assert.deepEqual(
    impagas.map((c) => c.poliza).sort(),
    vigentes.filter((p) => p.sumaSaldoVencido > 0).map((p) => p.poliza).sort(),
  )
  for (const impaga of impagas) {
    assert.equal(vigentes.find((p) => p.poliza === impaga.poliza)!.sumaSaldoVencido, impaga.saldoCuota)
    assert.equal(cobradas.find((c) => c.poliza === impaga.poliza)!.nroCuota, impaga.nroCuota - 1, 'la cuota impaga no figura como cobrada')
  }
  const riesgos = await pedir<Array<{ nombreAsegurado: string }>>('/api/polizas/obtenerPolizasRiesgo')
  assert.equal(riesgos.length, 1)
  const una = vigentes[3]!.poliza
  assert.deepEqual((await pedir<Array<{ poliza: string }>>('/api/polizas/vigentes', { nroPoliza: una })).map((p) => p.poliza), [una])
  assert.deepEqual(await pedir('/api/polizas/obtenerPolizasRiesgo', { poliza: '999' }), [])

  // La impresión trae los datos de la póliza, con tildes y la marca de agua.
  const poliza = (await pedir<Array<{ nroPoliza: string; patente: string; nombreTomador: string }>>('/api/polizas/consultaXLegajo'))[0]!
  const pdf = await (await cliente.pedirCrudo('/api/imprimir', { metodo: 'POST', body: { tipoImpresion: 'P', poliza: poliza.nroPoliza, rama: 4 } })).text()
  assert.match(pdf, /^%PDF-1\.4[\s\S]*%%EOF\n$/)
  assert.ok(pdf.includes('/WinAnsiEncoding'))
  assert.ok(pdf.includes('DEMOSTRACI\\323N'), 'la marca de agua, con su tilde')
  assert.ok(pdf.includes(poliza.patente))
  assert.ok(/^[\x00-\x7f]*$/.test(pdf), 'sólo ASCII: las posiciones de la tabla xref dan justo')
  const xref = Number(/startxref\n(\d+)/.exec(pdf)![1])
  assert.ok(pdf.slice(xref).startsWith('xref'))
})

test('demo: las tablas de ATM tienen cantidades creíbles', () => {
  const tablas = Object.fromEntries(estadoDeAtmDemo().tablas!.tablas.map((t) => [t.tabla, t.filas]))
  assert.equal(tablas.ws_au_sexo, 2)
  assert.ok(tablas.ws_au_est_civil! <= 6 && tablas.ws_au_tipo_doc! <= 8)
  assert.ok(tablas.ws_au_infoauto! > 10_000)
})

test('demo: los enlaces de WhatsApp se reconocen para mostrar el mensaje en vez de abrirlos', () => {
  assert.deepEqual(whatsappDeLaDemo('https://wa.me/5491134559091?text=Hola%20Beatriz%2C%20te%20escribo'), { telefono: '5491134559091', texto: 'Hola Beatriz, te escribo' })
  assert.deepEqual(whatsappDeLaDemo('https://api.whatsapp.com/send?phone=5491100000000&text=hola'), { telefono: '5491100000000', texto: 'hola' })
  assert.deepEqual(whatsappDeLaDemo('https://wa.me/5491134559091'), { telefono: '5491134559091', texto: '' })
  assert.equal(whatsappDeLaDemo('https://meshcentral.com/'), null)
  assert.equal(whatsappDeLaDemo('https://example.com/wa.me/123'), null)
  assert.equal(whatsappDeLaDemo('no es una dirección'), null)
  assert.equal(telefonoParaMostrar('5491134559091'), '+54 9 11 3455-9091')
  assert.equal(telefonoParaMostrar(''), 'sin número')
})
