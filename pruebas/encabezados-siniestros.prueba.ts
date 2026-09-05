// Mapeo de encabezados de las pestañas SINIESTROS: cada bloque es un encabezado que la agencia puede
// escribir y que antes quedaba sin mapear o caía en la columna equivocada. Sin base de datos: se prueba
// directo contra resolverCampo / mapearEncabezados / encabezadoParaAgregar y clasificarPestana.
import assert from 'node:assert/strict'
import test from 'node:test'
import { encabezadoParaAgregar, mapearEncabezados, resolverCampo, type Campo } from '../src/main/importacion/encabezados'
import { clasificarPestana } from '../src/main/importacion/pestanas'

// ---------------------------------------------------------------------------
// «HECHO»: resuelto en AMP, descripción en SINIESTROS
// ---------------------------------------------------------------------------

test('«HECHO» en SINIESTROS es la descripción del hecho, no un «resuelto» que esa pestaña no tiene', () => {
  assert.equal(resolverCampo('HECHO', 'SINIESTROS'), 'descripcion')
  assert.equal(resolverCampo('Hecho', 'SINIESTROS'), 'descripcion')
  // En AMP sigue ganando el primero de la lista general.
  assert.equal(resolverCampo('HECHO', 'AMP'), 'resuelto')
  // Y en una planilla mensual no existe ni uno ni otro: sigue sin mapear, como antes.
  assert.equal(resolverCampo('HECHO', 'MENSUAL'), null)

  const mapeo = mapearEncabezados(['FECHA', 'NOMBRE', 'PATENTE', 'HECHO', 'ESTADO'], 'SINIESTROS')
  assert.equal(mapeo.porCampo.get('descripcion'), 3)
})

// ---------------------------------------------------------------------------
// «FECHA» + «FECHA SINIESTRO»: gana la que dice de qué fecha habla
// ---------------------------------------------------------------------------

test('con «FECHA» a la izquierda y «FECHA SINIESTRO» a la derecha, la fecha del siniestro es la específica', () => {
  // En SINIESTROS el ajuste de «FECHA» a secas es `fecha` (no la de carga): las dos caen en el mismo campo.
  assert.equal(resolverCampo('FECHA', 'SINIESTROS'), 'fecha')
  const mapeo = mapearEncabezados(['LOCAL', 'FECHA', 'NOMBRE', 'FECHA SINIESTRO', 'PATENTE'], 'SINIESTROS')
  assert.equal(mapeo.porCampo.get('fecha'), 3, 'la fecha del siniestro es la columna D')
  assert.equal(mapeo.columnas[1]!.campo, null, '«FECHA» se corre')
  assert.match(mapeo.columnas[1]!.nota ?? '', /más específica/)

  for (const especifica of ['FECHA DEL SINIESTRO', 'FECHA DE OCURRENCIA', 'FECHA DEL HECHO', 'F. STRO', 'FEC. SINIESTRO', 'FECHA Y HORA']) {
    const m = mapearEncabezados(['FECHA', especifica], 'SINIESTROS')
    assert.equal(m.porCampo.get('fecha'), 1, `«${especifica}» tendría que ganarle a «FECHA»`)
  }
  // Al revés (la específica primero) no cambia nada: ya era la principal.
  const alReves = mapearEncabezados(['FECHA SINIESTRO', 'FECHA'], 'SINIESTROS')
  assert.equal(alReves.porCampo.get('fecha'), 0)
})

test('la preferencia de fecha es sólo de SINIESTROS: en las otras pestañas manda el orden de las columnas', () => {
  // La lista de fechas del siniestro no puede tocar una pestaña de imputados: ahí «FECHA DE PAGO»,
  // «COBRADO» y compañía son la fecha del pago y la genérica «FECHA» (la de imputación) no les gana.
  for (const especifica of ['FECHA DE PAGO', 'FECHA PAGO', 'PAGO', 'COBRADO', 'FECHA COBRO', 'FECHA DE COBRO']) {
    const m = mapearEncabezados([especifica, 'FECHA'], 'PAGOS')
    assert.equal(m.porCampo.get('fecha'), 0, `en PAGOS «${especifica}» está primera y se queda con la fecha`)
  }
  // En AMP tampoco hay preferencia: gana la de la izquierda, esté como esté escrita.
  assert.equal(mapearEncabezados(['FECHA DEL HECHO', 'FECHA'], 'AMP').porCampo.get('fecha'), 0)
  assert.equal(mapearEncabezados(['FECHA', 'FECHA DEL HECHO'], 'AMP').porCampo.get('fecha'), 0)
})

test('dentro de SINIESTROS, «FECHA» no le gana a ninguna columna que diga cuándo ocurrió el hecho', () => {
  for (const especifica of ['OCURRIDO', 'OCURRIDO EL', 'FECHA OCURRIDO', 'FECHA DE OCURRIDO', 'FECHA EN QUE OCURRIO', 'CUANDO OCURRIO', 'CUANDO PASO']) {
    assert.equal(mapearEncabezados([especifica, 'FECHA'], 'SINIESTROS').porCampo.get('fecha'), 0, `«${especifica}» a la izquierda se queda con la fecha`)
    assert.equal(mapearEncabezados(['FECHA', especifica], 'SINIESTROS').porCampo.get('fecha'), 1, `«${especifica}» a la derecha también, porque es más específica`)
  }
  // Las que no son la fecha del hecho («FECHA IMPUTACION») no tienen preferencia: manda el orden.
  assert.equal(mapearEncabezados(['FECHA IMPUTACION', 'FECHA'], 'SINIESTROS').porCampo.get('fecha'), 0)
  assert.equal(mapearEncabezados(['FECHA', 'FECHA IMPUTACION'], 'SINIESTROS').porCampo.get('fecha'), 0)
})

test('«SINIESTRO» (el relato) + «N° SINIESTRO»: el número es el que dice número', () => {
  const mapeo = mapearEncabezados(['NOMBRE', 'SINIESTRO', 'N° SINIESTRO', 'ESTADO'], 'SINIESTROS')
  assert.equal(mapeo.porCampo.get('numero_siniestro'), 2)
  assert.equal(mapeo.columnas[1]!.campo, null)
  for (const numero of ['NRO SINIESTRO', 'NRO. DE SINIESTRO', 'NUMERO DE SINIESTRO', 'N° STRO', 'N° DENUNCIA', 'SINIESTRO N°', 'N° SINIESTRO COMPAÑIA']) {
    const m = mapearEncabezados(['SINIESTRO', numero], 'SINIESTROS')
    assert.equal(m.porCampo.get('numero_siniestro'), 1, `«${numero}» tendría que ganarle a «SINIESTRO»`)
  }
})

// ---------------------------------------------------------------------------
// Variantes de encabezado que la agencia escribe y antes quedaban sin mapear
// ---------------------------------------------------------------------------

const VARIANTES: Array<[Campo, string[]]> = [
  ['nombre', ['APELLIDO Y NOMBRES', 'APELLIDOS Y NOMBRE', 'NOMBRES Y APELLIDO', 'NOMBRE DEL ASEGURADO/A', 'APELLIDO Y NOMBRE ASEGURADO', 'NOMBRE Y APELLIDO ASEGURADO', 'APELLIDO Y NOMBRE DEL CLIENTE', 'NOMBRE Y APELLIDO DEL CLIENTE', 'CLIENTE/ASEGURADO', 'ASEGURADO/CLIENTE', 'DATOS DEL ASEGURADO', 'NOMBRE ASEG.', 'PROPIETARIO']],
  ['fecha', ['FECHA Y HORA DEL SINIESTRO', 'FECHA Y HORA', 'FECHA DEL SINIESTRO (DD/MM/AA)', 'FECHA DE OCURRENCIA DEL SINIESTRO', 'FECHA SINIESTRO/DENUNCIA', 'FECHA DEL EVENTO', 'FECHA EVENTO', 'FEC SINIESTRO', 'FEC. STRO', 'FECHA SINI']],
  ['fecha_carga', ['FECHA DE ALTA', 'FECHA ALTA', 'FECHA DE INGRESO', 'FECHA INGRESO', 'FECHA DE APERTURA', 'FECHA DE RECEPCION', 'FECHA DE RECEPCIÓN']],
  ['numero_siniestro', ['N° SINIESTRO COMPAÑIA', 'N° DE SINIESTRO', 'NRO SINIESTRO', 'NRO. DE SINIESTRO', 'NUMERO DE SINIESTRO', 'N° STRO', 'N° DENUNCIA', 'NRO DENUNCIA', 'SINIESTRO N°', 'N° RECLAMO']],
]

test('las variantes plausibles de encabezado de una pestaña SINIESTROS caen en su campo', () => {
  for (const [campo, encabezados] of VARIANTES) {
    for (const encabezado of encabezados) {
      assert.equal(resolverCampo(encabezado, 'SINIESTROS'), campo, `«${encabezado}» tendría que mapear a ${campo}`)
    }
  }
})

test('las fechas de alta e ingreso siguen siendo la de la póliza en una planilla mensual', () => {
  for (const encabezado of ['FECHA DE ALTA', 'FECHA ALTA', 'FECHA DE INGRESO', 'FECHA INGRESO']) {
    assert.equal(resolverCampo(encabezado, 'MENSUAL'), 'alta', `«${encabezado}» en MENSUAL es el alta de la póliza`)
  }
  assert.equal(resolverCampo('FECHA', 'MENSUAL'), 'pago')
  assert.equal(resolverCampo('APELLIDO Y NOMBRE', 'MENSUAL'), 'nombre')
  assert.equal(resolverCampo('PROPIETARIO', 'MENSUAL'), 'nombre')
  // «FECHA Y HORA» no es nada en una planilla mensual: no hay campo `fecha` ahí.
  assert.equal(resolverCampo('FECHA Y HORA', 'MENSUAL'), null)
})

// ---------------------------------------------------------------------------
// Las columnas que agrega la aplicación se titulan según la pestaña
// ---------------------------------------------------------------------------

test('en SINIESTROS la columna de fecha se agrega como «FECHA SINIESTRO» y la del nombre como «ASEGURADO»', () => {
  const existentes = ['LOCAL', 'FECHA DE CARGA', 'DNI', 'PATENTE', 'CIA', 'N° POLIZA', 'N° SINIESTRO', 'DESCRIPCION', 'ESTADO']
  assert.equal(encabezadoParaAgregar('fecha', 'SINIESTROS', existentes), 'FECHA SINIESTRO')
  assert.equal(encabezadoParaAgregar('nombre', 'SINIESTROS', existentes), 'ASEGURADO')
  assert.equal(encabezadoParaAgregar('documento', 'SINIESTROS', ['LOCAL', 'NOMBRE']), 'DNI/CUIT')

  // Lo que se escribe se lee de vuelta como ese campo, en la misma pestaña.
  const mapeo = mapearEncabezados([...existentes, 'FECHA SINIESTRO', 'ASEGURADO'], 'SINIESTROS')
  assert.equal(mapeo.porCampo.get('fecha'), existentes.length)
  assert.equal(mapeo.porCampo.get('fecha_carga'), 1, 'la fecha de carga sigue en su columna')
  assert.equal(mapeo.porCampo.get('nombre'), existentes.length + 1)

  // En las demás pestañas no cambia nada.
  assert.equal(encabezadoParaAgregar('fecha', 'PAGOS', ['NOMBRE', 'IMPORTE']), 'FECHA')
  assert.equal(encabezadoParaAgregar('nombre', 'PAGOS', ['FECHA', 'IMPORTE']), 'NOMBRE')
  assert.equal(encabezadoParaAgregar('fecha', 'MENSUAL', ['NOMBRE']), null, 'una planilla mensual no tiene campo fecha')
})

// ---------------------------------------------------------------------------
// Clasificación de la pestaña por su título
// ---------------------------------------------------------------------------

test('«STROS» y «DENUNCIAS» como palabra entera son pestañas de siniestros; «REGISTRO» y «MAESTRO» no', () => {
  // «STROS26» va pegado a propósito: la normalización no separa el año del título y \b no cortaba contra dígitos.
  for (const titulo of ['SINIESTROS', 'Siniestros 2026', 'STROS', 'STRO', 'STROS 2026', 'STROS26', 'DENUNCIAS', 'DENUNCIA', 'DENUNCIAS2026', 'Denuncias cia']) {
    assert.equal(clasificarPestana(titulo).tipo, 'SINIESTROS', `«${titulo}» es una pestaña de siniestros`)
  }
  for (const titulo of ['REGISTRO', 'REGISTROS', 'MAESTRO', 'MAESTROS', 'MAESTRO 2026', 'REGISTRO2026', 'REGISTROS 2026']) {
    assert.equal(clasificarPestana(titulo).tipo, 'OTRA', `«${titulo}» no es una pestaña de siniestros`)
  }
  // Las demás reglas mandan igual que antes.
  assert.equal(clasificarPestana('AGOSTO').tipo, 'MENSUAL')
  assert.equal(clasificarPestana('BAJAS AGOSTO').tipo, 'BAJAS')
  assert.equal(clasificarPestana('RIESGOS VARIOS').tipo, 'RIESGOS_VARIOS')
  assert.equal(clasificarPestana('IMPUTADOS').tipo, 'PAGOS')
  assert.equal(clasificarPestana('COBERTURA').tipo, 'COBERTURA')
  assert.equal(clasificarPestana('AMP').tipo, 'AMP')
  assert.equal(clasificarPestana('ENERO A MARZO').tipo, 'OTRA')
})
