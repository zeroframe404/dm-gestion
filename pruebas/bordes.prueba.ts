// Casos límite y situaciones feas de una hoja de 16 años: permisos, filas movidas, _ID pegados,
// planillas a medio cargar, filas borradas y pestañas con nombres inesperados.
import assert from 'node:assert/strict'
import test from 'node:test'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { baseDePrueba, contar, importar, problemasDeTipo, resumenDe, unico } from './ayuda'

test('si la cuenta de servicio es de sólo lectura, avisa claro y no deja la base a medias', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba(), { soloLectura: true })
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  // No se puede escribir el _ID: sin _ID no hay forma de re-importar sin duplicar, así que nada se guarda.
  assert.notEqual(informe.estado, 'COMPLETA')
  assert.equal(contar(db, 'clientes'), 0)
  assert.equal(contar(db, 'polizas'), 0)
  assert.equal(contar(db, 'filas_crudas'), 0)

  const textoDelProblema = [informe.error ?? '', ...informe.avisos, ...informe.problemas.map((p) => p.detalle)].join(' ')
  assert.match(textoDelProblema, /permis|editor|acceso/i, 'el informe tiene que explicar que falta permiso de edición')

  db.close()
})

test('mover una fila de lugar no crea un duplicado: manda el _ID, no la posición', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  await importar(db, hoja)

  const antes = {
    crudas: contar(db, 'filas_crudas'),
    cuotas: contar(db, 'cuotas_mes'),
    clientes: contar(db, 'clientes'),
    polizas: contar(db, 'polizas'),
  }
  const idsAntes = [...hoja.idsDe('AGOSTO').values()].sort()

  // Alguien ordena la planilla alfabéticamente: las filas cambian de lugar con su _ID puesto.
  const filas = hoja.filasDe('AGOSTO')
  const encabezado = filas[0]!
  const datos = filas.slice(1).reverse()
  const columnaId = hoja.columnaIdDe('AGOSTO')
  while (hoja.filasDe('AGOSTO').length > 0) hoja.borrarFila('AGOSTO', 1)
  hoja.agregarFila('AGOSTO', encabezado)
  for (const fila of datos) hoja.agregarFila('AGOSTO', fila)

  const { informe } = await importar(db, hoja)
  assert.equal(resumenDe(informe, 'AGOSTO').idsNuevos, 0, 'reordenar filas no puede generar _ID nuevos')
  assert.equal(resumenDe(informe, 'AGOSTO').idsExistentes, datos.length)
  assert.equal(contar(db, 'filas_crudas'), antes.crudas)
  assert.equal(contar(db, 'cuotas_mes'), antes.cuotas)
  assert.equal(contar(db, 'clientes'), antes.clientes)
  assert.equal(contar(db, 'polizas'), antes.polizas)
  assert.deepEqual([...hoja.idsDe('AGOSTO').values()].sort(), idsAntes)
  assert.ok(columnaId >= 0)

  db.close()
})

test('un _ID copiado y pegado en otra fila se detecta y se reemplaza', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  await importar(db, hoja)

  const columnaId = hoja.columnaIdDe('AGOSTO')
  const ids = [...hoja.idsDe('AGOSTO').entries()]
  const [filaOrigen, idOrigen] = ids[0]!
  const [filaDestino] = ids[1]!
  // El usuario copió la fila 2 sobre la 3, incluido su _ID oculto.
  hoja.editarCelda('AGOSTO', filaDestino, columnaId, idOrigen)

  const { informe } = await importar(db, hoja)
  const repetidos = problemasDeTipo(informe, '_ID repetido')
  assert.equal(repetidos.length, 1)
  assert.equal(repetidos[0]!.pestana, 'AGOSTO')
  assert.equal(resumenDe(informe, 'AGOSTO').idsNuevos, 1, 'la fila copiada tiene que recibir un _ID nuevo')

  // Los dos _ID finales son distintos y no se perdió ninguna fila.
  const finales = [...hoja.idsDe('AGOSTO').values()]
  assert.equal(new Set(finales).size, finales.length)
  assert.ok(filaOrigen < filaDestino)

  db.close()
})

test('una planilla nueva a medio cargar no borra la cartera', async () => {
  const pestanas = construirHojaDePrueba()
  // SEPTIEMBRE existe, tiene encabezados válidos, pero sólo se cargaron dos clientes de los siete.
  const agosto = pestanas.find((p) => p.titulo === 'AGOSTO')!
  pestanas.push({
    titulo: 'SEPTIEMBRE',
    valores: [agosto.valores[0]!, agosto.valores[1]!, agosto.valores[2]!],
    columnas: agosto.columnas,
  })
  const hoja = new HojaSimulada(pestanas)
  const db = baseDePrueba()

  // Primera corrida sin SEPTIEMBRE para tener la cartera completa.
  const septiembre = hoja.quitarPestana('SEPTIEMBRE')
  await importar(db, hoja)
  assert.equal(contar(db, 'polizas', 'activa = 1'), 7)

  // Ahora aparece SEPTIEMBRE con 2 pólizas de 7: el freno de seguridad no deja inactivar nada.
  hoja.restaurarPestana(septiembre)
  const { informe } = await importar(db, hoja)
  assert.equal(informe.pestanaMasNueva, 'SEPTIEMBRE')
  assert.equal(informe.totales.polizasInactivadas, 0)
  assert.equal(contar(db, 'polizas', 'activa = 1'), 7, 'una planilla a medio cargar no puede vaciar la cartera')
  assert.ok(informe.avisos.some((a) => /por seguridad/i.test(a)), 'tiene que quedar avisado en el informe')

  db.close()
})

test('una fila borrada de la hoja se marca en la base y deja de contarse como vigente', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  await importar(db, hoja)

  const idsAntes = [...hoja.idsDe('AGOSTO').values()]
  const cuotasAntes = contar(db, 'cuotas_mes')

  // El usuario borra una fila de AGOSTO (se equivocó al cargarla).
  hoja.borrarFila('AGOSTO', 3)
  const { informe } = await importar(db, hoja)

  const idsDespues = new Set(hoja.idsDe('AGOSTO').values())
  const borrado = idsAntes.find((id) => !idsDespues.has(id))!
  assert.ok(borrado, 'la prueba tiene que haber borrado alguna fila')

  // La fila sigue en la base como histórico, pero marcada como que ya no está en la hoja.
  assert.equal(contar(db, 'cuotas_mes'), cuotasAntes, 'no se borran datos históricos')
  assert.equal(contar(db, 'filas_crudas', `fila_id = '${borrado}' AND en_la_hoja = 0`), 1, 'la fila borrada tiene que quedar marcada')
  assert.equal(informe.totales.filasQueYaNoEstan, 1)

  db.close()
})

test('dos columnas con el mismo encabezado no se pisan en silencio', async () => {
  const pestanas = construirHojaDePrueba({ hastaMes: 0, conPestanasEspeciales: false })
  pestanas.push({
    titulo: 'ENERO',
    valores: [
      ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'CUOTA', 'OBS', 'OB. DE COBERTURAS'],
      ['TORRES MARIO', '25.111.222', 'SANCOR', '123123', '$ 10.000', '$ 99.999', 'primera nota', 'segunda nota'],
    ],
  })
  const hoja = new HojaSimulada(pestanas)
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  const columnas = resumenDe(informe, 'ENERO').columnas
  assert.equal(columnas[4]!.campo, 'cuota')
  assert.equal(columnas[5]!.campo, null)
  assert.match(columnas[5]!.nota ?? '', /repite el campo cuota/)

  // La cuota que vale es la primera; las dos observaciones se suman.
  assert.equal(unico<string>(db, `SELECT cuota FROM cuotas_mes WHERE numero_poliza = '123123'`), '$ 10.000')
  assert.equal(unico<string>(db, `SELECT observaciones FROM cuotas_mes WHERE numero_poliza = '123123'`), 'primera nota | segunda nota')

  db.close()
})

test('una pestaña nueva desconocida se informa en vez de ignorarse', async () => {
  const pestanas = construirHojaDePrueba()
  pestanas.push({ titulo: 'PRESUPUESTOS 2026', valores: [['CLIENTE', 'MONTO'], ['NN', '$ 1.000']] })
  const hoja = new HojaSimulada(pestanas)
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.ok(informe.avisos.some((a) => /PRESUPUESTOS 2026/.test(a)), 'una pestaña sin mapeo tiene que quedar avisada')
  // Igual se guarda completa en filas crudas: no se pierde nada.
  assert.equal(contar(db, 'filas_crudas', `pestana = 'PRESUPUESTOS 2026'`), 1)

  db.close()
})

// ---------------------------------------------------------------------------
// Dos pestañas del mismo mes: la planilla salía duplicada entera
// ---------------------------------------------------------------------------

/** La hoja de prueba con una copia de AGOSTO puesta donde la deja Google: pegada a la derecha. */
function conAgostoDuplicado(tituloDeLaCopia: string): HojaSimulada {
  const pestanas = construirHojaDePrueba()
  const posicion = pestanas.findIndex((p) => p.titulo === 'AGOSTO')
  const agosto = pestanas[posicion]!
  pestanas.splice(posicion + 1, 0, {
    titulo: tituloDeLaCopia,
    valores: agosto.valores.map((fila) => [...fila]),
    columnas: agosto.columnas,
  })
  return new HojaSimulada(pestanas)
}

test('dos pestañas del mismo mes no duplican la planilla: se lee una sola', async () => {
  const db = baseDePrueba()
  // «AGOSTO» y «AGOSTO 2026» conviviendo: es lo que queda cuando se duplica la pestaña del mes para
  // armar el siguiente y la copia se renombra con el año. Las dos resuelven a 2026-08.
  const { informe } = await importar(db, conAgostoDuplicado('AGOSTO 2026'))

  // Sólo una escribe cuotas: si escribieran las dos, cada póliza tendría dos filas del mismo mes y la
  // planilla mostraría todo repetido, que es exactamente lo que se veía.
  const cuotas = unico<number>(db, `SELECT COUNT(*) FROM cuotas_mes WHERE periodo = '2026-08'`)
  const polizas = unico<number>(db, `SELECT COUNT(DISTINCT poliza_id) FROM cuotas_mes WHERE periodo = '2026-08' AND poliza_id IS NOT NULL`)
  assert.equal(cuotas, polizas, 'una cuota por póliza en el mes, no dos')
  assert.equal(unico<string>(db, `SELECT DISTINCT pestana FROM cuotas_mes WHERE periodo = '2026-08'`), 'AGOSTO', 'manda la de más a la izquierda')

  // Los renglones de la copia no se pierden: quedan enteros en los datos crudos, así que borrar o
  // renombrar la pestaña en Google alcanza para volver atrás.
  assert.ok(unico<number>(db, `SELECT COUNT(*) FROM filas_crudas WHERE pestana = 'AGOSTO 2026'`) > 0)

  const texto = [...informe.avisos, ...informe.problemas.map((p) => p.detalle)].join(' ')
  assert.match(texto, /más de una planilla mensual para 2026-08/i, 'el informe lo dice')
  assert.match(texto, /AGOSTO 2026/, 'y nombra la que se ignoró')

  db.close()
})

test('la copia que aparece después no suma cuotas: manda la pestaña que ya tenía el mes', async () => {
  // Primero la hoja sana, con la copia sacada: AGOSTO queda con sus cuotas y con sus _ID escritos.
  const hoja = conAgostoDuplicado('AGOSTO 2026')
  const copia = hoja.quitarPestana('AGOSTO 2026')
  const db = baseDePrueba()
  await importar(db, hoja)
  const antes = unico<number>(db, `SELECT COUNT(*) FROM cuotas_mes WHERE periodo = '2026-08'`)
  assert.ok(antes > 0)

  // Y ahora aparece la copia en la misma hoja. La pestaña que ya tiene las cuotas del mes es la que
  // sigue mandando, y los renglones de la copia no entran a la planilla.
  hoja.restaurarPestana(copia)
  await importar(db, hoja)
  assert.equal(unico<number>(db, `SELECT COUNT(*) FROM cuotas_mes WHERE periodo = '2026-08'`), antes, 'no se sumaron cuotas repetidas')
  assert.equal(unico<string>(db, `SELECT DISTINCT pestana FROM cuotas_mes WHERE periodo = '2026-08'`), 'AGOSTO')

  db.close()
})
