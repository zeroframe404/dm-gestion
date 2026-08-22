// Pruebas de los arreglos que salieron de la revisión: cada bloque es un problema concreto que se
// encontró leyendo el código y que no tiene que volver.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { baseDePrueba, contar, filas, importar, problemasDeTipo, resumenDe, unico } from './ayuda'
import { mapearEncabezados, resolverCampo } from '../src/main/importacion/encabezados'
import { clasificarPestana, clasificarPestanas, revisarCoherenciaDePeriodos } from '../src/main/importacion/pestanas'
import { generarTextoDeInforme, informeParaArchivo } from '../src/main/importacion/informe'

// ---------------------------------------------------------------------------
// Mapeo de encabezados
// ---------------------------------------------------------------------------

test('las siglas con puntos mapean igual que sin puntos', () => {
  for (const encabezado of ['D.N.I.', 'D.N.I', 'DNI', 'dni', 'D N I', 'C.U.I.T.', 'CUIT']) {
    assert.equal(resolverCampo(encabezado, 'MENSUAL'), 'documento', `«${encabezado}» tendría que mapear a documento`)
  }
  assert.equal(resolverCampo('N° PÓLIZA', 'MENSUAL'), 'numero_poliza')
  assert.equal(resolverCampo('OB. DE COBERTURAS', 'MENSUAL'), 'observaciones')
  assert.equal(resolverCampo('F. NAC.', 'MENSUAL'), 'fecha_nacimiento')
})

test('«MARCA/MODELO» en una sola columna no queda sin mapear', () => {
  assert.equal(resolverCampo('MARCA/MODELO', 'MENSUAL'), 'modelo')
  assert.equal(resolverCampo('MARCA - MODELO', 'MENSUAL'), 'modelo')
  assert.equal(resolverCampo('MODELO/MARCA', 'MENSUAL'), 'modelo')
})

test('DNI y CUIT en columnas separadas: se usa la que tenga algo en cada fila', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'CUIT', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO'],
        ['GOMEZ PEDRO', '25.111.222', '', 'SANCOR', '100100', '$ 10.000', '10'],
        ['TRANSPORTES DEL SUR SRL', '', '30-71234567-4', 'SANCOR', '100200', '$ 80.000', '10'],
      ],
    },
  ])
  const db = baseDePrueba()
  await importar(db, hoja)

  assert.equal(contar(db, 'clientes'), 2)
  assert.equal(unico<string>(db, `SELECT documento FROM clientes WHERE nombre = 'TRANSPORTES DEL SUR SRL'`), '30-71234567-4')
  assert.equal(unico<string>(db, `SELECT documento_normalizado FROM clientes WHERE nombre = 'TRANSPORTES DEL SUR SRL'`), '30712345674')
  db.close()
})

test('«PAGO» y «FECHA DE PAGO» juntas: la fecha no se pierde detrás del «SI»', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO', 'PAGO', 'FECHA DE PAGO'],
        ['GOMEZ PEDRO', '25.111.222', 'SANCOR', '100100', '$ 10.000', '10', '', '12/08/2026'],
      ],
    },
  ])
  const db = baseDePrueba()
  await importar(db, hoja)
  assert.equal(unico<string>(db, 'SELECT pago FROM cuotas_mes'), '12/08/2026')
  assert.equal(unico<string>(db, 'SELECT pago_fecha FROM cuotas_mes'), '2026-08-12')
  db.close()
})

test('«ASEGURADO» y «TITULAR» no se pegan en un solo nombre', () => {
  const mapeo = mapearEncabezados(['ASEGURADO', 'TITULAR', 'APELLIDO', 'NOMBRE'], 'MENSUAL')
  // El primero gana el campo; TITULAR queda de respaldo, no se concatena.
  assert.equal(mapeo.porCampo.get('nombre'), 0)
  assert.deepEqual(mapeo.extras.get('nombre'), undefined)
  assert.ok((mapeo.alternativas.get('nombre') ?? []).includes(1))

  // En cambio APELLIDO + NOMBRE sí son dos partes del mismo nombre.
  const partido = mapearEncabezados(['APELLIDO', 'NOMBRE'], 'MENSUAL')
  assert.deepEqual(partido.extras.get('nombre'), [1])
})

// ---------------------------------------------------------------------------
// Clasificación de pestañas
// ---------------------------------------------------------------------------

test('una planilla mensual con algo más en el título sigue siendo mensual', () => {
  assert.equal(clasificarPestana('SEPTIEMBRE 2026 EN CARGA').tipo, 'MENSUAL')
  assert.equal(clasificarPestana('Copia de ABRIL').tipo, 'MENSUAL')
  assert.equal(clasificarPestana('01 JUNIO').tipo, 'MENSUAL')
  assert.equal(clasificarPestana('JULIO (viejo)').tipo, 'MENSUAL')
  // Dos meses en el título es ambiguo: no se arriesga.
  assert.equal(clasificarPestana('ENERO A MARZO').tipo, 'OTRA')
  // Y las que tienen palabra clave de otro tipo siguen ganando.
  assert.equal(clasificarPestana('BAJAS SEPTIEMBRE').tipo, 'BAJAS')
  assert.equal(clasificarPestana('PAGOS ENERO').tipo, 'PAGOS')
})

test('las bajas sin año toman el año de la planilla del mismo mes más cercana', () => {
  const clasificadas = clasificarPestanas(
    [
      { titulo: 'DICIEMBRE25', indice: 0 },
      { titulo: 'BAJAS DICIEMBRE', indice: 1 },
      { titulo: 'ENERO', indice: 2 },
      { titulo: 'DICIEMBRE', indice: 3 },
    ],
    2026,
    8,
  )
  const bajas = clasificadas.find((p) => p.titulo === 'BAJAS DICIEMBRE')!
  // Está pegada a DICIEMBRE25, no al diciembre siguiente.
  assert.equal(bajas.periodo, '2025-12')
})

test('detecta que los períodos no cierran cuando una pestaña quedó fuera de orden', () => {
  const clasificadas = clasificarPestanas(
    [
      { titulo: 'ENERO 2026', indice: 0 },
      { titulo: 'FEBRERO 2026', indice: 1 },
      { titulo: 'DICIEMBRE 2025', indice: 2 },
      { titulo: 'MARZO 2026', indice: 3 },
    ],
    2026,
    8,
  )
  const avisos = revisarCoherenciaDePeriodos(clasificadas, 2026, 8)
  assert.ok(avisos.length > 0)
  assert.match(avisos.join(' '), /DICIEMBRE 2025/)

  // Un año mal tipeado que deja la planilla en el futuro también se detecta.
  const futuras = clasificarPestanas([{ titulo: 'MARZO 2028', indice: 0 }], 2026, 8)
  assert.match(revisarCoherenciaDePeriodos(futuras, 2026, 8).join(' '), /todavía no llegó/)

  // Una hoja normal no genera ningún aviso.
  const normal = clasificarPestanas(
    [
      { titulo: 'DICIEMBRE25', indice: 0 },
      { titulo: 'ENERO', indice: 1 },
      { titulo: 'FEBRERO', indice: 2 },
    ],
    2026,
    8,
  )
  assert.deepEqual(revisarCoherenciaDePeriodos(normal, 2026, 8), [])
})

// ---------------------------------------------------------------------------
// Identidad: la hoja se edita entre importaciones
// ---------------------------------------------------------------------------

test('corregir el DNI en la hoja actualiza el cliente en vez de duplicarlo', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  await importar(db, hoja)
  const clientesAntes = contar(db, 'clientes')

  // A Rodríguez le habían cargado mal el DNI y lo corrigen en AGOSTO (columna B).
  const filasAgosto = hoja.filasDe('AGOSTO')
  const filaRodriguez = filasAgosto.findIndex((f) => f[0] === CLIENTES.rodriguez.nombre)
  assert.ok(filaRodriguez > 0)
  hoja.editarCelda('AGOSTO', filaRodriguez + 1, 1, '33.222.999')

  const { informe } = await importar(db, hoja)
  assert.equal(contar(db, 'clientes'), clientesAntes, 'no se puede crear un cliente nuevo por corregir el DNI')
  assert.equal(contar(db, 'clientes', `documento_normalizado = '33222999'`), 1)
  assert.equal(contar(db, 'clientes', `documento_normalizado = '${CLIENTES.rodriguez.dniPlano}'`), 0)
  assert.equal(resumenDe(informe, 'AGOSTO').registros.clientes_con_clave_corregida, 1)
  db.close()
})

test('cuando un 0KM recibe patente no aparece un vehículo nuevo al lado', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  await importar(db, hoja)
  const vehiculosAntes = contar(db, 'vehiculos')

  // El Etios de Rodríguez estaba como 0KM (columna V = DOMINIO) y ya salió patentado.
  const filaRodriguez = hoja.filasDe('AGOSTO').findIndex((f) => f[0] === CLIENTES.rodriguez.nombre)
  hoja.editarCelda('AGOSTO', filaRodriguez + 1, 21, 'AH555PP')

  await importar(db, hoja)
  assert.equal(contar(db, 'vehiculos'), vehiculosAntes, 'el 0KM patentado es el mismo vehículo')
  assert.equal(contar(db, 'vehiculos', `patente_normalizada = 'AH555PP'`), 1)
  db.close()
})

test('una póliza que recibe número no se convierte en dos pólizas', async () => {
  const encabezados = ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'DOMINIO', 'CUOTA', 'DIA DE VTO']
  const hoja = new HojaSimulada([
    { titulo: 'AGOSTO', valores: [encabezados, ['ALVAREZ RUTH', '28.444.555', 'SANCOR', '', 'AJ123KL', '$ 15.000', '10']] },
  ])
  const db = baseDePrueba()
  await importar(db, hoja)
  assert.equal(contar(db, 'polizas'), 1)

  // Llega el número de póliza de la compañía.
  hoja.editarCelda('AGOSTO', 2, 3, '556677')
  const { informe } = await importar(db, hoja)
  assert.equal(contar(db, 'polizas'), 1, 'es la misma póliza, ahora con número')
  assert.equal(contar(db, 'polizas', `numero = '556677' AND activa = 1`), 1)
  assert.equal(resumenDe(informe, 'AGOSTO').registros.polizas_con_clave_corregida, 1)
  db.close()
})

test('duplicar la pestaña del mes no le roba los _ID a la original', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  await importar(db, hoja)

  const idsAgosto = [...hoja.idsDe('AGOSTO').values()]
  // Flujo habitual: se copia AGOSTO para armar SEPTIEMBRE, con la columna _ID oculta incluida.
  const copia = hoja.filasDe('AGOSTO')
  hoja.restaurarPestana(
    Object.assign(hoja.quitarPestana('BAJAS AGOSTO'), { titulo: 'BAJAS AGOSTO' }),
  )
  const pestanas = construirHojaDePrueba()
  pestanas.push({ titulo: 'SEPTIEMBRE', valores: copia, columnas: copia[0]!.length })
  const hoja2 = new HojaSimulada(pestanas)
  // La hoja nueva ya trae los _ID de agosto en las dos pestañas.
  copia.forEach((fila, i) => {
    if (i === 0) return
    hoja2.editarCelda('AGOSTO', i + 1, copia[0]!.length - 1, fila[copia[0]!.length - 1] ?? '')
  })

  const db2 = baseDePrueba()
  await importar(db2, hoja2)
  const { informe } = await importar(db2, hoja2)

  const idsFinalesAgosto = [...hoja2.idsDe('AGOSTO').values()]
  const idsFinalesSeptiembre = [...hoja2.idsDe('SEPTIEMBRE').values()]
  assert.equal(new Set([...idsFinalesAgosto, ...idsFinalesSeptiembre]).size, idsFinalesAgosto.length + idsFinalesSeptiembre.length, 'ninguna fila puede compartir _ID con otra')
  assert.equal(informe.estado === 'COMPLETA' || informe.estado === 'CON_ERRORES', true)
  assert.ok(idsAgosto.length > 0)
  db.close()
  db2.close()
})

// ---------------------------------------------------------------------------
// Enlaces y filas raras
// ---------------------------------------------------------------------------

test('una cuota vieja con número de póliza que no existe no se engancha a otra póliza del mismo cliente', async () => {
  const encabezadosAgosto = ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'DOMINIO', 'CUOTA', 'DIA DE VTO']
  const hoja = new HojaSimulada([
    {
      titulo: 'ENERO 2026',
      valores: [
        encabezadosAgosto,
        // El mismo cliente, pero con la póliza de la MOTO, que ya no está en agosto.
        ['ALVAREZ RUTH', '28.444.555', 'SANCOR', '999999', 'A111BB', '$ 4.000', '10'],
      ],
    },
    {
      titulo: 'AGOSTO 2026',
      valores: [encabezadosAgosto, ['ALVAREZ RUTH', '28.444.555', 'SANCOR', '556677', 'AJ123KL', '$ 15.000', '10']],
    },
  ])
  const db = baseDePrueba()
  await importar(db, hoja)

  const cuotaEnero = filas<{ poliza_id: number | null }>(db, `SELECT poliza_id FROM cuotas_mes WHERE numero_poliza = '999999'`)[0]!
  assert.equal(cuotaEnero.poliza_id, null, 'la cuota de la moto no puede quedar colgada de la póliza del auto')
  db.close()
})

test('una razón social que empieza con TOTAL no se descarta como fila de totales', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO'],
        ['TOTAL AUSTRAL S.A.', '30-70999888-1', 'ZURICH', '778899', '$ 95.000', '15'],
        ['GOMEZ PEDRO', '25.111.222', 'SANCOR', '100100', '$ 10.000', '10'],
        ['TOTAL', '', '', '', '$ 105.000', ''],
      ],
    },
  ])
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.equal(contar(db, 'clientes', `nombre = 'TOTAL AUSTRAL S.A.'`), 1, 'es un cliente, no un subtotal')
  assert.equal(contar(db, 'cuotas_mes'), 2)
  assert.equal(informe.problemasPorTipo['fila de totales'], 1, 'la fila TOTAL sin datos sí es un subtotal')
  db.close()
})

test('una fila con nombre y cuota pero sin compañía entra igual como póliza', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO'],
        ['QUIROGA MARTA', '', '', '', '$ 12.000', '10'],
      ],
    },
  ])
  const db = baseDePrueba()
  await importar(db, hoja)
  assert.equal(contar(db, 'cuotas_mes'), 1, 'una fila a medio cargar es un cliente a completar, no un subtotal')
  assert.equal(contar(db, 'clientes', `nombre = 'QUIROGA MARTA'`), 1)
  db.close()
})

test('la misma póliza dos veces en el mes se avisa y no infla la cartera', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO'],
        ['GOMEZ PEDRO', '25.111.222', 'SANCOR', '100100', '$ 10.000', '10'],
        ['GOMEZ PEDRO', '25.111.222', 'SANCOR', '100100', '$ 10.000', '10'],
      ],
    },
  ])
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.equal(contar(db, 'polizas'), 1, 'la misma póliza no puede contarse dos veces en la cartera')
  assert.equal(problemasDeTipo(informe, 'póliza repetida en la planilla').length, 1)
  assert.equal(problemasDeTipo(informe, 'póliza repetida en el mes').length, 1)
  db.close()
})

test('dos personas con el mismo nombre y DNI distinto no se mezclan', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'ENERO 2026',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO'],
        // Fila vieja sin DNI: no se le puede atribuir a ninguno de los dos homónimos.
        ['PEREZ JUAN', '', 'SANCOR', '', '$ 8.000', '10'],
      ],
    },
    {
      titulo: 'AGOSTO 2026',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO'],
        ['PEREZ JUAN', '20.111.222', 'SANCOR', '200100', '$ 9.000', '10'],
        ['PEREZ JUAN', '35.999.888', 'RIVADAVIA', '200200', '$ 9.500', '10'],
      ],
    },
  ])
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.equal(contar(db, 'clientes'), 2, 'son dos personas distintas')
  assert.equal(unico<number>(db, `SELECT COUNT(*) FROM cuotas_mes WHERE periodo LIKE '%-01' AND cliente_id IS NULL`), 1, 'la fila vieja sin DNI no se le atribuye a ninguno')
  assert.ok(informe.problemas.some((p) => /homónimo/i.test(p.tipo) || /homónimo/i.test(p.detalle)))
  db.close()
})

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

test('el informe de una corrida cancelada lista igual todas las pestañas', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja, {
    estaCancelada: () => unico<number>(db, 'SELECT COUNT(DISTINCT pestana) FROM filas_crudas') >= 2,
  })

  assert.equal(informe.estado, 'CANCELADA')
  assert.equal(informe.pestanas.length, hoja.titulos().length, 'tienen que estar todas, también las omitidas')
  assert.ok(informe.pestanas.some((p) => p.estado === 'omitida'))
  assert.match(generarTextoDeInforme(informe), /«COBERTURA»/)
  db.close()
})

test('el archivo del informe se abre bien en Windows', async () => {
  const db = baseDePrueba()
  const { informe } = await importar(db, new HojaSimulada(construirHojaDePrueba()))
  const archivo = informeParaArchivo(generarTextoDeInforme(informe))

  assert.equal(archivo.charCodeAt(0), 0xfeff, 'le falta la marca de orden de bytes')
  assert.ok(archivo.includes('\r\n'), 'tiene que usar los saltos de línea de Windows')
  assert.ok(!/[^\r]\n/.test(archivo), 'no puede quedar ningún salto de línea suelto')
  assert.match(archivo, /IMPORTACIÓN/)
  db.close()
})

test('un problema sistemático no tapa a los demás en el detalle', async () => {
  // 300 filas con la misma sucursal fuera de catálogo y una sola fecha imposible al final.
  const filasHoja: string[][] = [['APELLIDO Y NOMBRE', 'DNI', 'SUCURSAL', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO', 'PAGO']]
  for (let i = 0; i < 300; i++) {
    filasHoja.push([`CLIENTE ${i}`, String(20000000 + i), 'SARANDI', 'SANCOR', String(300000 + i), '$ 10.000', '10', '05/08'])
  }
  filasHoja.push(['CLIENTE RARO', '29999999', 'DOCK SUD', 'SANCOR', '399999', '$ 10.000', '10', '31/02'])

  const hoja = new HojaSimulada([{ titulo: 'AGOSTO', valores: filasHoja, columnas: 8 }])
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.equal(informe.problemasPorTipo['sucursal fuera de catálogo'], 300, 'el conteo por tipo es siempre exacto')
  assert.ok(problemasDeTipo(informe, 'sucursal fuera de catálogo').length <= 200, 'el detalle se recorta por tipo')
  assert.equal(problemasDeTipo(informe, 'fecha de pago inválida').length, 1, 'la fecha imposible tiene que seguir estando en el detalle')
  db.close()
})
