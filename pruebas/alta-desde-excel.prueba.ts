// Alta desde Excel: el Excel de OTRA agencia (otros nombres de hoja, otros encabezados, columnas que
// el programa no reconoce solo) → propuesta, asignación a mano, pestañas en el formato de la base,
// ensayo en memoria y publicación en una base del VPS vacía.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { AsignacionDeAlta, LibroDeAlta, TipoDeHojaDeAlta } from '../src/shared/tipos'
import { TIPOS_DE_HOJA_DE_ALTA } from '../src/shared/tipos'
import { usarBaseDeDatos } from '../src/main/db/base'
import { armarPestanasCanonicas, camposDeAlta, TIPO_DE_PESTANA, tituloDePestana } from '../src/main/importacion/altaDesdeExcel'
import { encabezadoParaAgregar, mapearEncabezados, type Campo } from '../src/main/importacion/encabezados'
import { clasificarPestana } from '../src/main/importacion/pestanas'
import { cargarLibro, ensayarAlta, publicarAlta, validarAsignacion } from '../src/main/servicios/altaDesdeExcel'
import { construirXlsx } from '../src/main/servicios/xlsx'
import { hayImportacionEnCurso, reservarImportacionAutomatica } from '../src/main/servicios/importacion'
import { publicarEnBaseVacia } from '../src/main/servicios/migracionVps'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { baseDePrueba, contar } from './ayuda'

const HOY = new Date(2026, 10, 13)

function excelDeOtraAgencia(): Buffer {
  return construirXlsx([
    {
      nombre: 'Clientes',
      encabezados: ['Apellido', 'Nombre', 'Documento', 'Celular', 'Aseguradora', 'Nº Póliza', 'Dominio', 'Marca', 'Modelo', 'Premio', 'Vto', 'Zona'],
      filas: [
        ['Gómez', 'Ana', 30111222, '11 5555-1111', 'Allianz', 'A-100', 'AB123CD', 'Ford', 'Ka', 15000, 10, 'Centro'],
        ['Pérez', 'Beto', 28999888, '11 5555-2222', 'Sancor', 'S-200', 'AC456EF', 'Fiat', 'Uno', 9800.5, 15, 'Norte'],
        // La hoja se armó pegando dos: repite los encabezados en el medio.
        ['Apellido', 'Nombre', 'Documento', 'Celular', 'Aseguradora', 'Nº Póliza', 'Dominio', 'Marca', 'Modelo', 'Premio', 'Vto', 'Zona'],
        ['Ruiz', 'Carla', '27.123.456', null, 'Allianz', 'A-300', 'AD789GH', 'VW', 'Gol', 12000, 5, null],
        [null, null, null, null, null, null, null, null, null, null, null, null],
      ],
    },
    {
      nombre: 'Bajas',
      encabezados: ['Cliente', 'DNI', 'Póliza', 'Fecha baja', 'Motivo'],
      filas: [['Díaz Juan', 20333444, 'A-050', '01/10/2026', 'Vendió el auto']],
    },
    {
      nombre: 'Siniestros',
      encabezados: ['Asegurado', 'DNI', 'Patente', 'Fecha', 'Nro siniestro', 'Descripción'],
      filas: [['Gómez Ana', 30111222, 'AB123CD', '05/09/2026', 'SIN-1', 'Choque leve']],
    },
    { nombre: 'Notas', encabezados: ['Notas internas'], filas: [['llamar a Ana']] },
  ])
}

/** La asignación que haría la persona: lo propuesto, más lo que el programa no reconoció solo. */
function asignar(libro: LibroDeAlta): AsignacionDeAlta {
  const asignacion: AsignacionDeAlta = JSON.parse(JSON.stringify(libro.sugerencia))
  const clientes = asignacion.hojas[0]!
  clientes.tipo = 'CARTERA'
  const encabezados = libro.hojas[0]!.muestra[clientes.filaEncabezados]!
  const poner = (encabezado: string, campo: string) => {
    clientes.columnas[encabezados.indexOf(encabezado)] = campo
  }
  poner('Premio', 'cuota')
  poner('Vto', 'dia_vencimiento')
  poner('Zona', 'sucursal')
  poner('Dominio', 'patente')
  poner('Aseguradora', 'compania')
  poner('Nº Póliza', 'numero_poliza')
  poner('Apellido', 'nombre')
  poner('Nombre', 'nombre')
  // La sucursal que falta en una fila se completa con un valor fijo; las dos que no son del catálogo se corrigen.
  clientes.fijos = { sucursal: 'Lanús' }
  asignacion.sucursales = { Centro: 'Dock Sud', Norte: 'Sarandí' }
  return asignacion
}

test('alta: cada campo ofrecido tiene un encabezado que el importador vuelve a leer como ese campo', () => {
  for (const tipo of TIPOS_DE_HOJA_DE_ALTA) {
    const tipoPestana = TIPO_DE_PESTANA[tipo]
    const campos = camposDeAlta(tipo).map((c) => c.campo as Campo)
    assert.ok(campos.length >= 5, `${tipo} ofrece campos`)
    // Todos juntos, como los arma el alta: cada uno tiene que caer en su campo y en su columna.
    const encabezados: string[] = []
    for (const campo of campos) {
      const encabezado = encabezadoParaAgregar(campo, tipoPestana, encabezados)
      assert.ok(encabezado, `${tipo}: el campo ${campo} tiene encabezado`)
      encabezados.push(encabezado)
    }
    const mapeo = mapearEncabezados(encabezados, tipoPestana)
    campos.forEach((campo, indice) => assert.equal(mapeo.porCampo.get(campo), indice, `${tipo}: «${encabezados[indice]}» es ${campo}`))
  }
})

test('alta: los títulos de las pestañas son los que el importador clasifica', () => {
  const esperado: Record<TipoDeHojaDeAlta, string> = { CARTERA: 'MENSUAL', BAJAS: 'BAJAS', SINIESTROS: 'SINIESTROS', PAGOS: 'PAGOS', RIESGOS_VARIOS: 'RIESGOS_VARIOS' }
  for (const tipo of TIPOS_DE_HOJA_DE_ALTA) {
    const titulo = tituloDePestana(tipo, HOY)
    assert.equal(clasificarPestana(titulo).tipo, esperado[tipo], titulo)
  }
  assert.equal(tituloDePestana('CARTERA', HOY), 'NOVIEMBRE 2026')
  assert.deepEqual(clasificarPestana('NOVIEMBRE 2026'), { tipo: 'MENSUAL', mes: 11, anio: 2026 })
})

test('alta: la propuesta reconoce las hojas por su nombre y sus encabezados', () => {
  const libro = cargarLibro(excelDeOtraAgencia(), 'otra-agencia.xlsx')
  assert.deepEqual(
    libro.hojas.map((h) => [h.nombre, h.totalFilas]),
    [
      ['Clientes', 5],
      ['Bajas', 2],
      ['Siniestros', 2],
      ['Notas', 2],
    ],
  )
  assert.deepEqual(
    libro.sugerencia.hojas.map((h) => h.tipo),
    ['CARTERA', 'BAJAS', 'SINIESTROS', null],
  )
  const clientes = libro.sugerencia.hojas[0]!
  assert.equal(clientes.filaEncabezados, 0)
  assert.equal(clientes.columnas[2], 'documento', '«Documento» se reconoce solo')
  assert.equal(libro.sugerencia.hojas[2]!.columnas[4], 'numero_siniestro')
})

test('alta: el armado junta columnas, completa valores fijos, corrige sucursales y saltea lo que no es un registro', () => {
  const libro = cargarLibro(excelDeOtraAgencia(), 'otra-agencia.xlsx')
  const { libro: leido, asignacion } = validarAsignacion(asignar(libro))
  const armado = armarPestanasCanonicas(leido, asignacion, HOY)
  assert.deepEqual(armado.faltantes, [])
  assert.deepEqual(
    armado.pestanas.map((p) => [p.titulo, p.valores.length - 1]),
    [
      ['NOVIEMBRE 2026', 3],
      ['BAJAS NOVIEMBRE 2026', 1],
      ['SINIESTROS', 1],
    ],
  )
  const cartera = armado.pestanas[0]!
  const columna = (campo: Campo) => mapearEncabezados(cartera.valores[0]!, 'MENSUAL').porCampo.get(campo)!
  assert.deepEqual(
    cartera.valores.slice(1).map((f) => [f[columna('nombre')], f[columna('sucursal')], f[columna('cuota')]]),
    [
      ['Gómez Ana', 'Dock Sud', '15000'],
      ['Pérez Beto', 'Sarandí', '9800,5'],
      ['Ruiz Carla', 'Lanús', '12000'],
    ],
  )
  assert.deepEqual([...armado.valoresDeSucursal], [['Centro', 1], ['Norte', 1], ['Lanús', 1]])

  // Una hoja que se importa sin nombre ni DNI no se puede publicar.
  const sinNombre = asignar(libro)
  sinNombre.hojas[0]!.columnas = sinNombre.hojas[0]!.columnas.map((c) => (c === 'nombre' || c === 'documento' ? null : c))
  const otro = armarPestanasCanonicas(leido, validarAsignacion(sinNombre).asignacion, HOY)
  assert.equal(otro.faltantes.length, 1)
  assert.match(otro.faltantes[0]!, /nombre o el DNI/)
})

test('alta: el ensayo importa en memoria y la publicación da lo mismo en una base vacía', async () => {
  const simulador = new VpsSimulado()
  await simulador.escuchar()
  const vps = new FuenteVps({ urlBase: simulador.url, token: simulador.token })
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  try {
    const libro = cargarLibro(excelDeOtraAgencia(), 'otra-agencia.xlsx')
    const asignacion = asignar(libro)

    // Ensayo: no toca ni el servidor ni la base de la computadora.
    const ensayo = await ensayarAlta(asignacion, HOY)
    assert.deepEqual(ensayo.faltantes, [])
    assert.notEqual(ensayo.informe.estado, 'FALLIDA', ensayo.informe.error ?? '')
    assert.equal(ensayo.informe.totales.clientes, 3, 'los clientes salen de la cartera; la baja no crea uno')
    assert.equal(ensayo.informe.totales.polizas, 3)
    assert.equal(ensayo.informe.totales.bajas, 1)
    assert.equal(ensayo.informe.totales.siniestros, 1)
    assert.deepEqual(
      ensayo.sucursalesDesconocidas.map((s) => s.valor).sort(),
      ['Centro', 'Norte'],
    )
    assert.deepEqual(ensayo.informe.sucursalesDesconocidas, {}, 'ya corregidas, la importación no encuentra ninguna rara')
    assert.equal(contar(db, 'clientes'), 0, 'el ensayo no tocó la base de la computadora')
    assert.equal((await vps.estadoBase()).inicializada, false, 'ni el servidor')

    // Publicar: carga las pestañas en la base vacía e importa.
    const resumen = await publicarAlta(asignacion, null, { vps, hoy: HOY })
    assert.equal(resumen.pestanas, 3)
    assert.equal(resumen.informe.totales.polizas, ensayo.informe.totales.polizas)
    assert.equal(contar(db, 'polizas'), 3)
    assert.equal(contar(db, 'siniestros'), 1)
    const estado = await vps.estadoBase()
    assert.equal(estado.inicializada, true)
    const estructura = await vps.estructura()
    assert.deepEqual(
      estructura.pestanas.map((p) => p.titulo),
      ['NOVIEMBRE 2026', 'BAJAS NOVIEMBRE 2026', 'SINIESTROS'],
    )
    const cartera = await vps.leerValores('NOVIEMBRE 2026')
    assert.ok(cartera[0]!.includes('_ID'), 'la importación dejó el _ID de cada fila en la base')

    // El archivo ya se olvidó, y aun volviéndolo a cargar la base ya no está vacía.
    await assert.rejects(publicarAlta(asignacion, null, { vps, hoy: HOY }), /volvé a elegirlo/)
    const otraVez = cargarLibro(excelDeOtraAgencia(), 'otra-agencia.xlsx')
    await assert.rejects(publicarAlta(asignar(otraVez), null, { vps, hoy: HOY }), /ya tiene datos/)
  } finally {
    await simulador.cerrar()
    db.close()
  }
})

test('alta: mientras se carga la base, la importación automática de la sincronización no puede arrancar', async () => {
  // Sin la reserva, apenas se confirma la base la sincronización ve filas sin _ID y corre su propia
  // importación al mismo tiempo: cada una escribía su columna _ID y quedaban pólizas inactivadas.
  const simulador = new VpsSimulado()
  await simulador.escuchar()
  const vps = new FuenteVps({ urlBase: simulador.url, token: simulador.token })
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  try {
    const libro = cargarLibro(excelDeOtraAgencia(), 'otra-agencia.xlsx')
    const { libro: leido, asignacion } = validarAsignacion(asignar(libro))
    const armado = armarPestanasCanonicas(leido, asignacion, HOY)
    const intentos: Array<boolean> = []
    const { informe } = await publicarEnBaseVacia(
      vps,
      armado.pestanas.map((p) => ({ titulo: p.titulo, oculta: false, valores: p.valores })),
      'Prueba',
      {
        alProgresar: () => {
          const automatica = reservarImportacionAutomatica(-1)
          intentos.push(automatica !== null)
          automatica?.liberar()
        },
      },
    )
    assert.ok(intentos.length > 0)
    assert.ok(intentos.every((pudo) => !pudo), 'la automática se saltea mientras dura la carga')
    assert.equal(hayImportacionEnCurso(), false, 'y al terminar la reserva se libera')
    assert.equal(informe.totales.polizasInactivadas, 0)
    const cartera = await vps.leerValores('NOVIEMBRE 2026')
    assert.equal(cartera[0]!.filter((c) => c === '_ID').length, 1, 'una sola columna _ID')
  } finally {
    await simulador.cerrar()
    db.close()
  }
})
