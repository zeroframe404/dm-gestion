// Pruebas de los arreglos que salieron de la revisión: cada bloque es un problema concreto que se
// encontró leyendo el código y que no tiene que volver.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { baseDePrueba, contar, filas, importar, problemasDeTipo, resumenDe, unico } from './ayuda'
import { cerrarBaseDeDatos, usarBaseDeDatos } from '../src/main/db/base'
import { mapearEncabezados, resolverCampo } from '../src/main/importacion/encabezados'
import { clasificarPestana, clasificarPestanas, revisarCoherenciaDePeriodos } from '../src/main/importacion/pestanas'
import { generarTextoDeInforme, informeParaArchivo } from '../src/main/importacion/informe'
import { rutaDeAdjunto, usarCarpetaDeAdjuntosDePrueba } from '../src/main/servicios/carpetaDeAdjuntos'
import { bajarCambios } from '../src/main/sincronizacion/bajada'
import { leerContexto } from '../src/main/sincronizacion/hoja'

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
  // La hoja nueva ya trae los _ID de agosto en las dos pestañas, con su encabezado «_ID» y todo:
  // es la columna oculta que viaja con la copia.
  copia.forEach((fila, i) => {
    hoja2.editarCelda('AGOSTO', i + 1, copia[0]!.length - 1, fila[copia[0]!.length - 1] ?? '')
  })

  const db2 = baseDePrueba()
  await importar(db2, hoja2)
  const { informe } = await importar(db2, hoja2)

  const idsFinalesAgosto = [...hoja2.idsDe('AGOSTO').values()]
  const idsFinalesSeptiembre = [...hoja2.idsDe('SEPTIEMBRE').values()]
  assert.equal(new Set([...idsFinalesAgosto, ...idsFinalesSeptiembre]).size, idsFinalesAgosto.length + idsFinalesSeptiembre.length, 'ninguna fila puede compartir _ID con otra')
  // El original se queda con los suyos aunque la copia sea la planilla más nueva y se procese primero:
  // el dueño de un _ID es la pestaña del período más viejo que lo lleva, según la grilla.
  assert.deepEqual(idsFinalesAgosto, idsAgosto, 'AGOSTO conserva exactamente sus _ID; los nuevos son para la copia')
  assert.equal(informe.estado === 'COMPLETA' || informe.estado === 'CON_ERRORES', true)
  assert.ok(idsAgosto.length > 0)
  db.close()
  db2.close()
})

test('renombrar una pestaña no le cambia el _ID a ninguna fila ni escribe nada en la base (12.6)', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  await importar(db, hoja)
  const idsAntes = [...hoja.idsDe('AGOSTO').values()]
  const cuotasAntes = contar(db, 'cuotas_mes', `periodo = '2026-08' AND dada_de_baja = 0`)
  const escriturasAntes = hoja.llamadas.escribirColumna

  // La agencia le pone el año a la pestaña. Hasta la 12.5 esta base recordaba los _ID en «AGOSTO» y,
  // al verlos en «AGOSTO 2026», les inventaba otros y los escribía en la base compartida: en todas las
  // demás computadoras la fila vieja desaparecía (baja fantasma) y la nueva aparecía (cuota repetida).
  hoja.restaurarPestana(Object.assign(hoja.quitarPestana('AGOSTO'), { titulo: 'AGOSTO 2026' }))
  const { informe } = await importar(db, hoja)

  assert.deepEqual([...hoja.idsDe('AGOSTO 2026').values()], idsAntes, 'todos los _ID siguen siendo los mismos')
  assert.equal(hoja.llamadas.escribirColumna, escriturasAntes, 'no se escribió ningún _ID')
  assert.equal(problemasDeTipo(informe, '_ID de otra pestaña').length, 0)
  assert.equal(contar(db, 'cuotas_mes', `periodo = '2026-08' AND dada_de_baja = 0`), cuotasAntes, 'la planilla del mes tiene las mismas filas')
  assert.equal(contar(db, 'cuotas_mes', `periodo = '2026-08' AND dada_de_baja = 1`), 0, 'ninguna cuota quedó como baja fantasma')
  assert.equal(contar(db, 'filas_crudas', `pestana = 'AGOSTO 2026' AND en_la_hoja = 1`), idsAntes.length, 'las filas ahora viven en la pestaña renombrada')
  assert.equal(contar(db, 'filas_crudas', `pestana = 'AGOSTO'`), 0)
  db.close()
})

test('con dos planillas del mismo mes gana la que más filas tiene en la base, sin importar qué cuotas tenía esta computadora (12.6)', async () => {
  // Primero esta computadora conoce sólo una copia chica del mes («AGOSTO 2026», con tres filas)…
  const pestanas = construirHojaDePrueba()
  const agosto = pestanas.find((p) => p.titulo === 'AGOSTO')!
  const copiaChica = { titulo: 'AGOSTO 2026', valores: agosto.valores.slice(0, 4).map((fila) => [...fila]), columnas: agosto.columnas }
  const hojaChica = new HojaSimulada([...pestanas.filter((p) => p.titulo !== 'AGOSTO'), copiaChica])
  const db = baseDePrueba()
  await importar(db, hojaChica)
  assert.equal(contar(db, 'cuotas_mes', `periodo = '2026-08' AND pestana = 'AGOSTO 2026'`), 3)

  // …y después aparece la planilla completa a la izquierda. Hasta la 12.5 se quedaba con la copia,
  // porque era la que tenía las cuotas en ESTA base, mientras otra computadora se quedaba con la
  // completa: cada una con una planilla distinta del mismo mes, para siempre.
  const hojaCompleta = new HojaSimulada([...pestanas.filter((p) => p.titulo !== 'AGOSTO'), agosto, { ...copiaChica, valores: hojaChica.filasDe('AGOSTO 2026') }])
  const { informe } = await importar(db, hojaCompleta)
  assert.ok(informe.avisos.some((aviso) => aviso.includes('se toma «AGOSTO»') && aviso.includes('«AGOSTO 2026»')), `se toma la completa: ${informe.avisos.join(' | ')}`)
  assert.equal(contar(db, 'cuotas_mes', `periodo = '2026-08' AND pestana = 'AGOSTO' AND dada_de_baja = 0`), agosto.valores.length - 1)
  assert.equal(contar(db, 'cuotas_mes', `periodo = '2026-08' AND pestana = 'AGOSTO 2026'`), 0, 'las cuotas de la copia se sacaron')
  db.close()
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
  // 300 filas con la misma sucursal fuera de catálogo («BERAZATEGUI» no es ninguna de las cuatro) y
  // una sola fecha imposible al final.
  const filasHoja: string[][] = [['APELLIDO Y NOMBRE', 'DNI', 'SUCURSAL', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO', 'PAGO']]
  for (let i = 0; i < 300; i++) {
    filasHoja.push([`CLIENTE ${i}`, String(20000000 + i), 'BERAZATEGUI', 'SANCOR', String(300000 + i), '$ 10.000', '10', '05/08'])
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

// ---------------------------------------------------------------------------
// La bajada: una pestaña que vuelve vacía, y el costo de mirar miles de filas
// ---------------------------------------------------------------------------

const ENC_ADJUNTOS = ['FECHA', 'TIPO', 'VINCULO', 'DESCRIPCION', 'NOMBRE', 'CATEGORIA', 'ARCHIVO', 'TAMANO', 'SHA256', 'CARGADO POR', 'SUBIDO', '_ID']

/** Una carpeta temporal para los archivos de los adjuntos, que se limpia al salir. */
function carpetaDeAdjuntosTemporal(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-correcciones-'))
  process.on('exit', () => rmSync(carpeta, { recursive: true, force: true }))
  return carpeta
}

test('una pestaña de adjuntos que vuelve vacía no borra los adjuntos locales; un borrado de a uno sí (ADJ-08)', async () => {
  const hoja = new HojaSimulada([...construirHojaDePrueba(), { titulo: 'APP ADJUNTOS', valores: [ENC_ADJUNTOS] }])
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  usarCarpetaDeAdjuntosDePrueba(carpetaDeAdjuntosTemporal())
  await importar(db, hoja)

  // Dos fotos de un siniestro, cargadas desde otra computadora: llegan por la bajada, no por la importación.
  const siniestro = filas<{ id: number; fila_id: string }>(db, 'SELECT id, fila_id FROM siniestros WHERE fila_id IS NOT NULL ORDER BY id LIMIT 1')[0]!
  for (const n of [1, 2]) {
    hoja.agregarFila('APP ADJUNTOS', ['2026-09-01', 'SINIESTRO', `SINIESTRO:${siniestro.fila_id}`, '', `foto-${n}.jpg`, 'FOTOS', `srv-${n}`, '100', '', 'Fede', '2026-09-01T10:00:00.000Z', `ADJ:srv-${n}`])
  }
  const contexto = await leerContexto(hoja)
  const llegada = await bajarCambios(hoja, contexto, ['APP ADJUNTOS'])
  assert.equal(llegada.filasNuevas, 2)
  assert.equal(llegada.necesitaImportacion, false, 'los adjuntos se incorporan sin importación completa')
  assert.equal(contar(db, 'siniestro_adjuntos', `siniestro_id = ${siniestro.id}`), 2)
  // Esta computadora ya los bajó: tiene el archivo en su disco.
  const archivos: string[] = []
  for (const n of [1, 2]) {
    const relativa = `${siniestro.id}/foto-${n}.jpg`
    mkdirSync(path.dirname(rutaDeAdjunto(relativa)), { recursive: true })
    writeFileSync(rutaDeAdjunto(relativa), 'foto')
    db.prepare('UPDATE siniestro_adjuntos SET archivo = ? WHERE fila_id = ?').run(relativa, `ADJ:srv-${n}`)
    archivos.push(rutaDeAdjunto(relativa))
  }

  // La pestaña vuelve VACÍA (un respaldo restaurado, una pestaña recreada): hasta ahora la bajada lo
  // leía como «se borraron todos los adjuntos» y tiraba los archivos de todas las computadoras.
  hoja.borrarFila('APP ADJUNTOS', 3)
  hoja.borrarFila('APP ADJUNTOS', 2)
  assert.equal(hoja.filasDe('APP ADJUNTOS').length, 1, 'quedó sólo el encabezado')
  const eventosAntes = contar(db, 'eventos_sync')
  const vacia = await bajarCambios(hoja, contexto, ['APP ADJUNTOS'])
  assert.equal(vacia.filasQueYaNoEstan, 0, 'ninguna fila se da por desaparecida')
  assert.equal(contar(db, 'siniestro_adjuntos', `siniestro_id = ${siniestro.id}`), 2, 'los adjuntos siguen en la base')
  assert.ok(archivos.every((archivo) => existsSync(archivo)), 'y los archivos siguen en el disco')
  assert.equal(contar(db, 'filas_crudas', `pestana = 'APP ADJUNTOS' AND en_la_hoja = 1`), 2, 'las filas siguen dadas por presentes')
  assert.equal(contar(db, 'eventos_sync'), eventosAntes + 1, 'queda un aviso en la bitácora, uno solo por pestaña')
  assert.match(unico<string>(db, 'SELECT detalle FROM eventos_sync ORDER BY id DESC LIMIT 1'), /APP ADJUNTOS/)
  assert.deepEqual(vacia.pestanasVaciasIgnoradas, ['APP ADJUNTOS'], 'el resultado dice qué pestaña quedó con los borrados congelados')
  // Mientras siga vacía no se repite el aviso en cada ciclo (el carril rápido pasa cada 30 segundos),
  // pero el resultado lo sigue diciendo en TODOS los ciclos: si no, después de unos minutos no queda
  // ninguna señal de que esa pestaña dejó de propagar borrados.
  const otroCiclo = await bajarCambios(hoja, contexto, ['APP ADJUNTOS'])
  assert.equal(contar(db, 'eventos_sync'), eventosAntes + 1)
  assert.deepEqual(otroCiclo.pestanasVaciasIgnoradas, ['APP ADJUNTOS'])

  // Una pestaña recreada puede volver hasta sin la fila de encabezados. Esa lectura, que la bajada
  // decide ignorar, tampoco puede pisar el mapeo del contexto (lo comparte la subida, y dura cinco
  // minutos): si quedara sin encabezados ni columna _ID, lo que se subiera después iría a ciegas.
  const enElContexto = contexto.porTitulo.get('APP ADJUNTOS')!
  const columnaIdAntes = enElContexto.layout?.mapeo.columnaId ?? null
  assert.equal(typeof columnaIdAntes, 'number', 'la pestaña tenía su columna _ID mapeada')
  hoja.borrarFila('APP ADJUNTOS', 1)
  assert.equal(hoja.filasDe('APP ADJUNTOS').length, 0, 'la pestaña volvió del todo vacía')
  const sinEncabezados = await bajarCambios(hoja, contexto, ['APP ADJUNTOS'])
  assert.equal(sinEncabezados.filasQueYaNoEstan, 0)
  assert.equal(enElContexto.layout?.mapeo.columnaId ?? null, columnaIdAntes, 'el mapeo del contexto queda como estaba')
  assert.ok((enElContexto.layout?.mapeo.encabezados ?? []).length > 0, 'y con sus encabezados')
  hoja.agregarFila('APP ADJUNTOS', ENC_ADJUNTOS)

  // La pestaña vuelve con sus filas: nada cambió, y el aviso queda listo para la próxima vez.
  for (const n of [1, 2]) {
    hoja.agregarFila('APP ADJUNTOS', ['2026-09-01', 'SINIESTRO', `SINIESTRO:${siniestro.fila_id}`, '', `foto-${n}.jpg`, 'FOTOS', `srv-${n}`, '100', '', 'Fede', '2026-09-01T10:00:00.000Z', `ADJ:srv-${n}`])
  }
  const devuelta = await bajarCambios(hoja, contexto, ['APP ADJUNTOS'])
  assert.equal(devuelta.filasNuevas, 0)
  assert.equal(devuelta.filasCambiadas, 0)
  assert.deepEqual(devuelta.pestanasVaciasIgnoradas, [], 'con sus filas de vuelta no hay nada congelado')

  // Un borrado común —una sola foto— sí se aplica: la fila se va con su archivo, la otra queda.
  hoja.borrarFila('APP ADJUNTOS', 2)
  const unBorrado = await bajarCambios(hoja, contexto, ['APP ADJUNTOS'])
  assert.equal(unBorrado.filasQueYaNoEstan, 1)
  assert.equal(contar(db, 'siniestro_adjuntos', `siniestro_id = ${siniestro.id}`), 1)
  assert.equal(existsSync(archivos[0]!), false, 'el archivo de la foto borrada se fue')
  assert.equal(existsSync(archivos[1]!), true, 'el de la otra sigue')

  // Y borrar la ÚLTIMA que quedaba también se aplica, aunque la pestaña quede vacía: con una sola
  // fila conocida no se distingue de un respaldo restaurado, y con el corte en «0 conocidas» ese
  // borrado no viajaría nunca más (la pestaña quedaría vacía para siempre). Por eso el corte está en
  // «más de una»: si alguien lo cambia a «más de cero», esta prueba lo frena.
  const eventosAntesDelUltimo = contar(db, 'eventos_sync')
  hoja.borrarFila('APP ADJUNTOS', 2)
  assert.equal(hoja.filasDe('APP ADJUNTOS').length, 1, 'quedó sólo el encabezado')
  const ultimoBorrado = await bajarCambios(hoja, contexto, ['APP ADJUNTOS'])
  assert.equal(ultimoBorrado.filasQueYaNoEstan, 1, 'el borrado de la última fila sí se propaga')
  assert.deepEqual(ultimoBorrado.pestanasVaciasIgnoradas, [], 'y no se lo trata como pestaña que volvió vacía')
  assert.equal(contar(db, 'siniestro_adjuntos', `siniestro_id = ${siniestro.id}`), 0)
  assert.equal(existsSync(archivos[1]!), false, 'el archivo de la última foto también se fue')
  assert.equal(contar(db, 'eventos_sync'), eventosAntesDelUltimo, 'y no se anota ningún aviso de pestaña vacía')

  // Y una bajada normal sigue aplicando los campos que cambiaron en otra pestaña.
  const filaSiniestro = hoja.filasDe('SINIESTROS').findIndex((f) => f.includes('CHOQUE EN CADENA'))
  assert.ok(filaSiniestro > 0)
  hoja.editarCelda('SINIESTROS', filaSiniestro + 1, hoja.encabezadosDe('SINIESTROS').indexOf('DESCRIPCION'), 'CHOQUE EN CADENA EN LA AUTOPISTA')
  const conCampo = await bajarCambios(hoja, contexto, ['SINIESTROS'])
  assert.equal(conCampo.filasCambiadas, 1)
  assert.equal(conCampo.camposAplicados, 1)
  assert.equal(contar(db, 'siniestros', `descripcion = 'CHOQUE EN CADENA EN LA AUTOPISTA'`), 1)
  usarCarpetaDeAdjuntosDePrueba(null)
  cerrarBaseDeDatos()
})

test('una bajada sobre 3000 filas sin cambios no relee el JSON de cada una, y aplica la única que cambió (R4)', async (t) => {
  const encabezados = ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO', 'OBSERVACIONES']
  const filasHoja: string[][] = [encabezados]
  for (let i = 0; i < 3000; i++) {
    filasHoja.push([`CLIENTE ${i}`, String(20000000 + i), 'SANCOR', String(300000 + i), '$ 10.000', '10', ''])
  }
  const hoja = new HojaSimulada([{ titulo: 'AGOSTO', valores: filasHoja, columnas: encabezados.length }])
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  await importar(db, hoja)
  assert.equal(contar(db, 'cuotas_mes'), 3000)
  const contexto = await leerContexto(hoja)

  // Lo que se mide no es el reloj (en una máquina cargada eso es una prueba que falla sola) sino qué
  // consulta arma la bajada y cuántas veces lee el JSON: se espía `prepare` desde acá.
  const preparadas: string[] = []
  let lecturasDeJson = 0
  const prepararDeVerdad = db.prepare.bind(db)
  const espiar = (sql: string): unknown => {
    preparadas.push(sql)
    const preparada = prepararDeVerdad(sql)
    if (!/SELECT datos_json FROM filas_crudas WHERE fila_id/i.test(sql)) return preparada
    return new Proxy(preparada, {
      get(destino, propiedad) {
        const valor = Reflect.get(destino, propiedad, destino) as unknown
        if (typeof valor !== 'function') return valor
        const metodo = valor as (...argumentos: unknown[]) => unknown
        return (...argumentos: unknown[]): unknown => {
          if (propiedad === 'get') lecturasDeJson++
          return metodo.apply(destino, argumentos)
        }
      },
    })
  }
  Object.assign(db, { prepare: espiar })

  // Ciclos sin cambios: lo que cuesta es armar `conocidas`; el JSON de las filas no hace falta.
  const arranque = Date.now()
  for (let i = 0; i < 5; i++) {
    const sinCambios = await bajarCambios(hoja, contexto, ['AGOSTO'])
    assert.equal(sinCambios.filasCambiadas, 0)
    assert.equal(sinCambios.filasNuevas, 0)
  }
  t.diagnostic(`cinco bajadas sin cambios sobre 3000 filas: ${Date.now() - arranque} ms`)

  const deLasConocidas = preparadas.filter((sql) => /FROM filas_crudas WHERE pestana = \?/i.test(sql))
  assert.equal(deLasConocidas.length, 1, 'la consulta de `conocidas` se prepara una sola vez para toda la corrida')
  assert.ok(!/datos_json/i.test(deLasConocidas[0]!), `«conocidas» no puede traer el JSON de las 3000 filas: ${deLasConocidas[0]}`)
  assert.equal(lecturasDeJson, 0, 'sin cambios no se lee el JSON de ninguna fila')

  // Cambia una sola observación en la hoja: se aplica esa y nada más.
  hoja.editarCelda('AGOSTO', 1501, encabezados.indexOf('OBSERVACIONES'), 'LLAMAR EL LUNES')
  const unaSola = await bajarCambios(hoja, contexto, ['AGOSTO'])
  assert.equal(unaSola.filasCambiadas, 1)
  assert.equal(unaSola.camposAplicados, 1)
  assert.equal(unaSola.filasQueYaNoEstan, 0)
  assert.equal(contar(db, 'cuotas_mes', `observaciones = 'LLAMAR EL LUNES'`), 1)
  assert.equal(unico<string>(db, `SELECT cliente_nombre FROM cuotas_mes WHERE observaciones = 'LLAMAR EL LUNES'`), 'CLIENTE 1499')
  assert.equal(lecturasDeJson, 1, 'el JSON se lee sólo para la fila cuya huella cambió')
  Object.assign(db, { prepare: prepararDeVerdad })
  cerrarBaseDeDatos()
})
