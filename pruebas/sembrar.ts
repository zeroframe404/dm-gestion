// Siembra una carpeta de datos con la hoja simulada ya importada, para poder abrir la aplicación de
// verdad y mirarla (`npm run sembrar -- <carpeta>` y después `npm run humo -- <carpeta>`).
//
// Importa DOS veces —primero la hoja hasta julio y después con agosto— porque es lo que pasa mes a mes
// en la agencia: recién así queda una póliza dada de baja y la ficha del cliente tiene histórico.
// Además le acerca el vencimiento a un par de pólizas, para que la bandeja de renovaciones tenga algo
// que mostrar (en la hoja simulada todas vencen el 1 de enero).
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { aDia, desdeDia } from '../src/shared/polizas'
import { hoyLocal } from '../src/shared/semaforo'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import type { BaseDeDatos } from '../src/main/db/base'

/** Cuántos días desde hoy vence cada una de las primeras pólizas, para poblar la bandeja. */
const VENCIMIENTOS = [4, 12, 26, 45]

function comoTexto(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`
}

async function importarDosVeces(db: BaseDeDatos): Promise<void> {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const agosto = hoja.quitarPestana('AGOSTO')
  const bajasAgosto = hoja.quitarPestana('BAJAS AGOSTO')

  const correr = async () => {
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as {
      id: number
    }
    const informe = await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
    db.prepare('UPDATE importaciones SET terminada_en = ?, estado = ? WHERE id = ?').run(informe.terminadaEn, informe.estado, id)
  }

  await correr()
  hoja.restaurarPestana(agosto)
  hoja.restaurarPestana(bajasAgosto)
  await correr()
}

/**
 * Compañías que se renuevan a mano, para las primeras pólizas de la bandeja. En la hoja simulada todas
 * las compañías renuevan solas, y con eso la bandeja de renovaciones —que muestra sólo las manuales—
 * abriría vacía. Las que quedan con su compañía original sirven para ver el otro lado: cuántas se
 * ocultan por renovar solas.
 */
const COMPANIAS_MANUALES = ['AGROSALTA', 'RIO URUGUAY']

/** Acerca vencimientos y deja una observación de aumento, para que la bandeja muestre los dos casos. */
function prepararRenovaciones(db: BaseDeDatos): number {
  const activas = db.prepare('SELECT id FROM polizas WHERE activa = 1 ORDER BY id LIMIT ?').all(VENCIMIENTOS.length) as Array<{ id: number }>
  const hoy = aDia(hoyLocal()) ?? 0
  const actualizar = db.prepare('UPDATE polizas SET vigencia_hasta = ?, vigencia_hasta_iso = ?, observaciones = ? WHERE id = ?')
  const cambiarCompania = db.prepare('UPDATE polizas SET compania = ? WHERE id = ?')
  // La fila del mes guarda su propia copia de la compañía: si no se cambia también, la planilla y la
  // bandeja dirían cosas distintas.
  const cambiarEnLaCuota = db.prepare('UPDATE cuotas_mes SET compania = ? WHERE poliza_id = ?')

  db.transaction(() => {
    activas.forEach((poliza, i) => {
      const iso = desdeDia(hoy + (VENCIMIENTOS[i] ?? 30))
      // A la primera se le deja escrita la nota que la agencia usa: tiene que salir destacada.
      const observaciones = i === 0 ? '20% aumentar cuando se renueva' : null
      actualizar.run(comoTexto(iso), iso, observaciones, poliza.id)
      const manual = COMPANIAS_MANUALES[i]
      if (manual) {
        cambiarCompania.run(manual, poliza.id)
        cambiarEnLaCuota.run(manual, poliza.id)
      }
    })
  })()
  return activas.length
}

/**
 * Le pone un límite de antigüedad a la primera regla que haya, para que la advertencia del formulario
 * de póliza se pueda ver sin cargar nada a mano. Es una carpeta de prueba: el número es inventado, en
 * producción la matriz la carga el superadministrador con lo que dice cada compañía.
 */
function prepararReglaConLimite(db: BaseDeDatos): string | null {
  const regla = db.prepare('SELECT id, compania, cobertura FROM reglas_cobertura ORDER BY id LIMIT 1').get() as
    | { id: number; compania: string | null; cobertura: string | null }
    | undefined
  if (!regla) return null
  db.prepare('UPDATE reglas_cobertura SET antiguedad_maxima = 15 WHERE id = ?').run(regla.id)
  return `${regla.compania} · ${regla.cobertura}`
}

/**
 * Un segundo usuario, para poder probar lo que necesita dos personas: asignarle una tarea a otro y que
 * le aparezca en su Inicio y en su campana. Sin esto, la Fase 8 no se puede mirar de verdad.
 */
function sembrarSegundoUsuario(db: BaseDeDatos): string | null {
  const sucursal = db.prepare('SELECT id, nombre FROM sucursales ORDER BY id LIMIT 1 OFFSET 1').get() as
    | { id: number; nombre: string }
    | undefined
  if (!sucursal) return null
  const existente = db.prepare('SELECT nombre FROM usuarios WHERE usuario = ?').get('lucia') as { nombre: string } | undefined
  if (existente) return existente.nombre

  // La misma contraseña inicial que el usuario sembrado: es una carpeta de prueba, no producción.
  const clave = db.prepare(`SELECT clave_hash FROM usuarios WHERE usuario = 'daniel'`).get() as { clave_hash: string }
  db.prepare(
    `INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
     VALUES ('Lucía Gómez', 'lucia', ?, 'EMPLEADO', ?, 1, 0)`,
  ).run(clave.clave_hash, sucursal.id)
  return `Lucía Gómez (${sucursal.nombre})`
}

async function principal(): Promise<void> {
  const carpeta = process.argv[2]
  if (!carpeta) {
    console.error('Uso: npm run sembrar -- <carpeta>')
    process.exit(1)
  }
  const destino = path.resolve(carpeta)
  rmSync(destino, { recursive: true, force: true })
  mkdirSync(destino, { recursive: true })

  const db = abrirBaseDeDatos(path.join(destino, 'dm.db'))
  await importarDosVeces(db)
  const conVencimiento = prepararRenovaciones(db)
  const conLimite = prepararReglaConLimite(db)

  // Sin esto la aplicación exige cambiar la contraseña al entrar y la prueba de humo no llega a ninguna
  // pantalla. Es una carpeta de prueba: la contraseña sigue siendo la inicial.
  db.prepare(`UPDATE usuarios SET debe_cambiar_clave = 0 WHERE usuario = 'daniel'`).run()
  const segundoUsuario = sembrarSegundoUsuario(db)

  const cuenta = (tabla: string, condicion = '1=1') =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${condicion}`).get() as { n: number }).n

  console.log(`\nCarpeta sembrada: ${destino}`)
  console.log(`  clientes ................ ${cuenta('clientes')}`)
  console.log(`  vehículos ............... ${cuenta('vehiculos')}`)
  console.log(`  pólizas ................. ${cuenta('polizas')} (${cuenta('polizas', 'activa = 1')} activas)`)
  console.log(`  cuotas del mes .......... ${cuenta('cuotas_mes')}`)
  console.log(`  bajas ................... ${cuenta('bajas')}`)
  console.log(`  reglas de cobertura ..... ${cuenta('reglas_cobertura')}`)
  console.log(`  siniestros .............. ${cuenta('siniestros')}`)
  console.log(`  riesgos varios .......... ${cuenta('riesgos_varios')}`)
  console.log(`  ampliaciones (AMP) ...... ${cuenta('amp')} (${cuenta('amp', 'resuelto = 0')} pendientes)`)
  console.log(`  con vencimiento cercano . ${conVencimiento} (${COMPANIAS_MANUALES.length} de renovación manual: ${COMPANIAS_MANUALES.join(', ')})`)
  console.log(`  regla con antigüedad .... ${conLimite ?? 'ninguna'} (hasta 15 años)`)
  console.log(`  segundo usuario ......... ${segundoUsuario ?? 'ninguno'}`)
  console.log(`\nAbrila con:  npm run humo -- "${destino}"\n`)
  cerrarBaseDeDatos()
}

void principal()
