// Corre el importador contra una COPIA DESCARGADA de la hoja (una carpeta con un CSV por pestaña),
// sin credenciales y sin tocar Google. Sirve para probar con los datos reales antes de conectar la
// cuenta de servicio: el `_ID` se escribe sobre la copia en memoria, nunca sobre la hoja.
//
//   npm run prueba:copia -- <carpeta>             corre la importación y guarda el informe
//   npm run prueba:copia -- <carpeta> --analizar  sólo analiza los encabezados de cada pestaña
//   npm run prueba:copia -- <carpeta> --dos-veces la corre dos veces y verifica que no duplique nada
//   npm run prueba:copia -- <carpeta> --cartera   mide la planilla del mes y compara el semáforo
//   npm run prueba:copia -- <carpeta> --sync      mide un ciclo de sincronización con la hoja entera
//
// La carpeta tiene que tener un `mapeo.json` con [{ nombre, archivo }] y los CSV al lado.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { mapearEncabezados } from '../src/main/importacion/encabezados'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { generarTextoDeInforme, informeParaArchivo } from '../src/main/importacion/informe'
import { ahoraIso, limpiar } from '../src/main/importacion/normalizar'
import { clasificarPestana } from '../src/main/importacion/pestanas'
import { editarCelda, planillaDelMes } from '../src/main/servicios/cartera'
import { cuantasPendientes } from '../src/main/sincronizacion/cola'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import type { SesionUsuario } from '../src/shared/tipos'
import { calcularAlerta, type ColorAlerta } from '../src/shared/semaforo'
import { HojaSimulada, type PestanaSimulada } from './hoja-simulada'

/** CSV como lo exporta Google: comillas dobles, celdas con saltos de línea adentro. */
export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let enComillas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"'
          i++
        } else enComillas = false
      } else celda += c
    } else if (c === '"') enComillas = true
    else if (c === ',') {
      fila.push(celda)
      celda = ''
    } else if (c === '\n') {
      fila.push(celda)
      filas.push(fila)
      fila = []
      celda = ''
    } else if (c !== '\r') celda += c
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda)
    filas.push(fila)
  }
  // Google no devuelve las filas vacías del final: la copia tampoco.
  while (filas.length > 0 && (filas[filas.length - 1] ?? []).every((v) => limpiar(v) === '')) filas.pop()
  return filas
}

interface EntradaMapeo {
  nombre: string
  archivo: string
}

function cargarCopia(carpeta: string): PestanaSimulada[] {
  const mapeo = JSON.parse(readFileSync(path.join(carpeta, 'mapeo.json'), 'utf8')) as EntradaMapeo[]
  return mapeo.map((entrada) => {
    const valores = parsearCsv(readFileSync(path.join(carpeta, entrada.archivo), 'utf8'))
    const ancho = valores.reduce((maximo, f) => Math.max(maximo, f.length), 0)
    return { titulo: entrada.nombre, valores, columnas: Math.max(ancho, 26) }
  })
}

/** Cuántos campos del modelo reconoce cada una de las primeras filas de la pestaña. */
function analizar(pestanas: PestanaSimulada[]): void {
  console.log('\nDónde está la fila de encabezados de cada pestaña')
  console.log('(campos reconocidos por fila; la fila 1 es la que hoy usa el importador)\n')
  for (const p of pestanas) {
    const tipo = clasificarPestana(p.titulo).tipo
    const puntajes: string[] = []
    for (let r = 0; r < Math.min(6, p.valores.length); r++) {
      const mapeo = mapearEncabezados(p.valores[r] ?? [], tipo)
      puntajes.push(`f${r + 1}:${String(mapeo.porCampo.size).padStart(2)}`)
    }
    const mejor = puntajes.reduce((a, b) => (Number(a.split(':')[1]) >= Number(b.split(':')[1]) ? a : b))
    const alerta = !mejor.startsWith('f1:') && Number(mejor.split(':')[1]) > 0 ? '  ← los encabezados NO están en la fila 1' : ''
    console.log(`  ${p.titulo.padEnd(20)} ${String(tipo).padEnd(15)} ${puntajes.join('  ')}${alerta}`)
  }
}

function baseNueva(ruta: string): BaseDeDatos {
  // Siempre desde cero: la copia en CSV no puede guardar los _ID que se escriben en memoria, así que
  // reusar la base de una corrida anterior duplicaría todo. Para probar la re-importación está --dos-veces.
  for (const sufijo of ['', '-wal', '-shm']) if (existsSync(ruta + sufijo)) rmSync(ruta + sufijo)
  // Se abre como la base de la aplicación (la instancia única) para poder usar los servicios de Cartera.
  cerrarBaseDeDatos()
  return abrirBaseDeDatos(ruta)
}

async function principal(): Promise<void> {
  const [carpeta, ...opciones] = process.argv.slice(2)
  if (!carpeta) {
    console.error('Falta la carpeta con la copia. Uso: npm run prueba:copia -- <carpeta> [--analizar]')
    process.exitCode = 1
    return
  }
  const pestanas = cargarCopia(carpeta)
  console.log(`Copia cargada: ${pestanas.length} pestañas, ${pestanas.reduce((n, p) => n + p.valores.length, 0).toLocaleString('es-AR')} filas.`)

  if (opciones.includes('--analizar')) {
    analizar(pestanas)
    return
  }

  const hoja = new HojaSimulada(pestanas, { titulo: 'GENERAL DE CLIENTES (copia local)' })
  const rutaBase = path.join(carpeta, 'dm-copia.db')
  const db = baseNueva(rutaBase)

  const correr = async (silencioso = false) => {
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    let ultimoMensaje = ''
    return ejecutarImportacion({
      db,
      fuente: hoja,
      importacionId: id,
      alProgresar: (progreso) => {
        if (!silencioso && progreso.mensaje !== ultimoMensaje) {
          ultimoMensaje = progreso.mensaje
          console.log(`  ${String(progreso.porcentaje).padStart(3)}%  ${progreso.mensaje}`)
        }
      },
    })
  }

  const TABLAS = ['clientes', 'vehiculos', 'polizas', 'cuotas_mes', 'bajas', 'riesgos_varios', 'siniestros', 'pagos', 'reglas_cobertura', 'filas_crudas']
  const contarTodo = () => Object.fromEntries(TABLAS.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]))

  const informe = await correr()

  if (opciones.includes('--dos-veces')) {
    const antes = contarTodo()
    console.log('\nSegunda corrida sobre la misma hoja y la misma base…')
    const segundo = await correr(true)
    const despues = contarTodo()
    let todoIgual = true
    console.log('\n  tabla                antes    después')
    for (const tabla of TABLAS) {
      const igual = antes[tabla] === despues[tabla]
      if (!igual) todoIgual = false
      console.log(`  ${igual ? 'ok ' : 'MAL'} ${tabla.padEnd(18)} ${String(antes[tabla]).padStart(6)}  ${String(despues[tabla]).padStart(9)}`)
    }
    const idsNuevos = segundo.pestanas.reduce((n, r) => n + r.idsNuevos, 0)
    const idsExistentes = segundo.pestanas.reduce((n, r) => n + r.idsExistentes, 0)
    console.log(`\n  _ID nuevos en la segunda corrida: ${idsNuevos} (tienen que ser 0) · reusados: ${idsExistentes}`)
    console.log(`  Pólizas inactivadas en la segunda corrida: ${segundo.totales.polizasInactivadas} (tienen que ser 0)`)
    console.log(todoIgual && idsNuevos === 0 ? '\n  ✔ Volver a importar no duplicó ni cambió nada.' : '\n  ✖ La segunda corrida cambió la base.')
    db.close()
    return
  }

  if (opciones.includes('--sync')) {
    await medirSincronizacion(hoja)
    db.close()
    return
  }

  if (opciones.includes('--cartera')) {
    medirCartera(db)
    db.close()
    return
  }

  const texto = generarTextoDeInforme(informe)
  const rutaInforme = path.join(carpeta, 'informe.txt')
  writeFileSync(rutaInforme, informeParaArchivo(texto), 'utf8')

  const t = informe.totales
  console.log(`\nEstado: ${informe.estado}`)
  console.log(`Clientes ${t.clientes} · vehículos ${t.vehiculos} · pólizas activas ${t.polizas} · cuotas ${t.cuotasMes} · bajas ${t.bajas}`)
  console.log(`Riesgos ${t.riesgosVarios} · siniestros ${t.siniestros} · pagos ${t.pagos} · reglas ${t.reglasCobertura} · filas crudas ${t.filasCrudas}`)
  console.log(`\nDatos raros por tipo:`)
  for (const [tipo, cantidad] of Object.entries(informe.problemasPorTipo).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(cantidad).padStart(6)}  ${tipo}`)
  }
  console.log(`\nInforme completo: ${rutaInforme}`)
  console.log(`Base de la copia:  ${rutaBase}`)
  db.close()
}

void principal()

/**
 * Mide cuánto tarda la planilla con los datos reales y compara el semáforo contra la columna ALERTA
 * que la agencia ya calcula en la hoja (la pestaña JULIO la tiene).
 */
function medirCartera(db: BaseDeDatos): void {
  const arranque = Date.now()
  const planilla = planillaDelMes(null)
  const tardo = Date.now() - arranque
  console.log(`
Planilla de ${planilla.periodo}: ${planilla.filas.length.toLocaleString('es-AR')} filas en ${tardo} ms`)
  console.log(`Meses disponibles: ${planilla.periodos.length} · sólo lectura: ${planilla.soloLectura}`)

  const contar = (filas: typeof planilla.filas, hoy: string) => {
    const cuenta: Record<string, number> = {}
    for (const fila of filas) {
      const alerta = calcularAlerta(
        {
          periodo: fila.periodo,
          diaVencimiento: fila.diaVencimientoNumero,
          pagada: Boolean(fila.pagoFecha) || fila.pagoRegistrado,
          formaPago: fila.formaPago,
          diasCobertura: fila.diasCobertura,
        },
        hoy,
      )
      cuenta[alerta.color] = (cuenta[alerta.color] ?? 0) + 1
    }
    return cuenta
  }

  console.log('\nColores del mes abierto (mirado hoy):')
  for (const [color, cantidad] of Object.entries(contar(planilla.filas, planilla.hoy))) {
    console.log(`  ${String(cantidad).padStart(6)}  ${color}`)
  }

  // --- Comparación contra la columna ALERTA de la hoja, en la pestaña que la tiene.
  const conAlerta = db
    .prepare(`SELECT periodo, COUNT(*) AS n FROM filas_crudas WHERE tipo_pestana = 'MENSUAL' AND datos_json LIKE '%"ALERTA"%' GROUP BY periodo ORDER BY n DESC LIMIT 1`)
    .get() as { periodo: string; n: number } | undefined
  if (!conAlerta) {
    console.log('\n(Ninguna pestaña de la hoja trae la columna ALERTA para comparar.)')
    return
  }

  const delMes = planillaDelMes(conAlerta.periodo)
  const crudasPorId = new Map(
    (db.prepare('SELECT fila_id, datos_json FROM filas_crudas WHERE periodo = ?').all(conAlerta.periodo) as Array<{ fila_id: string; datos_json: string }>).map(
      (f) => [f.fila_id, JSON.parse(f.datos_json) as Record<string, string>],
    ),
  )

  /** La hoja escribe «🔴 VENCIDO», «🟢 AL DÍA», «🔵 DÉBITO AUTOMÁTICO». */
  const colorDeLaHoja = (texto: string): ColorAlerta | null => {
    if (texto.includes('🟢')) return 'verde'
    if (texto.includes('🔵')) return 'azul'
    if (texto.includes('🟡')) return 'amarillo'
    if (texto.includes('🟠')) return 'naranja'
    if (texto.includes('🔴')) return 'rojo'
    return null
  }

  let comparadas = 0
  let iguales = 0
  const diferencias = new Map<string, number>()
  for (const fila of delMes.filas) {
    const cruda = crudasPorId.get(fila.filaId)
    const enLaHoja = cruda ? colorDeLaHoja(cruda['ALERTA'] ?? '') : null
    if (!enLaHoja) continue
    const mio = calcularAlerta(
      {
        periodo: fila.periodo,
        diaVencimiento: fila.diaVencimientoNumero,
        pagada: Boolean(fila.pagoFecha) || fila.pagoRegistrado,
        formaPago: fila.formaPago,
        diasCobertura: fila.diasCobertura,
      },
      delMes.hoy,
    ).color
    comparadas++
    if (mio === enLaHoja) iguales++
    else diferencias.set(`hoja ${enLaHoja} → app ${mio}`, (diferencias.get(`hoja ${enLaHoja} → app ${mio}`) ?? 0) + 1)
  }

  console.log(`
Semáforo comparado contra la columna ALERTA de «${conAlerta.periodo}»:`)
  console.log(`  ${iguales.toLocaleString('es-AR')} de ${comparadas.toLocaleString('es-AR')} coinciden (${((iguales / comparadas) * 100).toFixed(1)} %)`)
  for (const [caso, cantidad] of [...diferencias].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(cantidad).padStart(6)}  ${caso}`)
  }
}

const USUARIO_DE_PRUEBA: SesionUsuario = {
  id: 1,
  nombre: 'Prueba',
  usuario: 'prueba',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

/** Cuánto tarda y cuántas llamadas usa un ciclo de sincronización con la hoja de verdad. */
async function medirSincronizacion(hoja: HojaSimulada): Promise<void> {
  const motor = new MotorDeSincronizacion({ crearFuente: () => hoja, importar: async () => undefined })
  motor.encender()

  const antesBajada = { ...hoja.llamadas }
  let arranque = Date.now()
  const bajada = await motor.ciclarBajada()
  const tardoBajada = Date.now() - arranque
  const llamadasBajada =
    hoja.llamadas.estructura - antesBajada.estructura + (hoja.llamadas.leerVarias - antesBajada.leerVarias) + (hoja.llamadas.leerValores - antesBajada.leerValores)

  console.log(`
Bajada del ciclo automático: ${tardoBajada} ms · ${llamadasBajada} llamadas a Google`)
  console.log(
    `  ${bajada?.pestanasLeidas ?? 0} pestañas · ${bajada?.filasCambiadas ?? 0} filas cambiadas · ${bajada?.filasNuevas ?? 0} nuevas · ${bajada?.filasQueYaNoEstan ?? 0} que ya no están`,
  )

  // Bajada completa: todas las pestañas.
  const antesCompleta = { ...hoja.llamadas }
  arranque = Date.now()
  const completa = await motor.ciclarBajada(true)
  const tardoCompleta = Date.now() - arranque
  const llamadasCompleta =
    hoja.llamadas.estructura - antesCompleta.estructura + (hoja.llamadas.leerVarias - antesCompleta.leerVarias) + (hoja.llamadas.leerValores - antesCompleta.leerValores)
  console.log(`Bajada completa (25 pestañas, 28.000 filas): ${tardoCompleta} ms · ${llamadasCompleta} llamadas`)
  console.log(`  ${completa?.filasCambiadas ?? 0} filas cambiadas (tendrían que ser 0 si nadie tocó nada)`)

  // Subida de una tanda grande.
  const filas = planillaDelMes(null).filas.slice(0, 200)
  for (const fila of filas) editarCelda(fila.filaId, 'observaciones', 'prueba de sincronización', USUARIO_DE_PRUEBA)
  console.log(`
Cola con ${cuantasPendientes()} cambios locales.`)

  const antesSubida = { ...hoja.llamadas }
  arranque = Date.now()
  const subidas = await motor.ciclarSubida()
  const tardoSubida = Date.now() - arranque
  const llamadasSubida =
    hoja.llamadas.leerVarias - antesSubida.leerVarias + (hoja.llamadas.escribirCeldas - antesSubida.escribirCeldas) + (hoja.llamadas.agregarFilas - antesSubida.agregarFilas)
  console.log(`Subida de ${subidas} cambios: ${tardoSubida} ms · ${llamadasSubida} llamadas`)
  console.log(`Quedan ${cuantasPendientes()} pendientes.`)

  // Y el ciclo siguiente no tiene que ver nada como cambiado.
  const despues = await motor.ciclarBajada()
  console.log(`
Ciclo siguiente: ${despues?.filasCambiadas ?? 0} filas cambiadas (0 = la subida dejó la base al día)`)
  motor.apagar()
}
