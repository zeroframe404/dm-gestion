// Los respaldos del GENERAL DE CLIENTES que guarda el SERVIDOR, y el botón de rebobinar.
//
// Por qué existen. Hasta la v12.4 el único respaldo era el .xlsx que esta computadora escribía en
// %APPDATA% —y subía a Drive— la primera vez que alguien abría el programa después de las 20:00.
// Eso tiene dos agujeros: depende de que alguien abra el programa (un fin de semana largo no hay
// respaldo de ningún día) y queda guardado en la máquina de la que justamente hay que tener copia.
// Desde la 12.5 el servidor, que está siempre encendido y es donde vive la base de verdad, guarda
// una foto por día; acá se los mira y, si pasó algo, se rebobina.
//
// Los dos respaldos siguen existiendo y son distintos a propósito: el .xlsx se abre en Excel sin
// nada más y sirve para mirar, y éste sirve para VOLVER.
//
// El orden de la restauración es lo único delicado del archivo y está explicado en `restaurar`.
import type { RespaldoDelVps, ResumenDeRestauracion, SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { ejecutarImportacion } from '../importacion/importador'
import { ahoraIso } from '../importacion/normalizar'
import { anotarEvento, vaciarCola } from '../sincronizacion/cola'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { crearFuenteVps, detenerSincronizacion, sincronizarAhora } from './sincronizacion'
import { enteroPositivo } from './validacion'

/** Cuántos se piden al servidor. La agencia pidió «los últimos 3» y con tres se lee de un vistazo. */
export const RESPALDOS_A_LA_VISTA = 3

const SIN_SERVIDOR = 'La base del VPS no está disponible en esta computadora, así que no hay respaldos del servidor.'

function fuente() {
  const vps = crearFuenteVps()
  if (!vps) throw new ErrorDeNegocio(SIN_SERVIDOR)
  return vps
}

export async function listarRespaldosDelVps(): Promise<RespaldoDelVps[]> {
  return (await fuente().respaldos(RESPALDOS_A_LA_VISTA)) as RespaldoDelVps[]
}

/**
 * Guarda uno ahora, sin esperar al reloj del servidor. Es idempotente por día, así que apretarlo dos
 * veces no llena la lista de copias iguales; se devuelve la lista actualizada porque es lo que la
 * pantalla necesita para redibujarse.
 */
export async function crearRespaldoEnElVps(actor: SesionUsuario): Promise<RespaldoDelVps[]> {
  await fuente().crearRespaldo(actor.nombre)
  return listarRespaldosDelVps()
}

/**
 * Rebobina la base al estado de ese respaldo. Es lo más destructivo que hace el programa, así que el
 * orden importa y cada paso está por una razón:
 *
 *   1. SE APAGA EL MOTOR de sincronización. Si sigue andando, el ciclo de subida le manda al servidor
 *      recién restaurado los cambios que quedaron encolados —justamente los que se quieren descartar—
 *      y la restauración se deshace sola a los treinta segundos.
 *   2. SE VACÍA LA COLA por lo mismo: lo pendiente de subir es de después del respaldo. El servidor ya
 *      guardó una foto del estado anterior (`ANTES_DE_RESTAURAR`), así que esto no es lo único que
 *      queda de esos cambios.
 *   3. SE RESTAURA EN EL SERVIDOR, que es la fuente de verdad desde la v12.
 *   4. SE VUELVE A IMPORTAR COMPLETO contra el servidor. La base local de esta computadora es una
 *      copia derivada, y sin este paso seguiría mostrando lo de antes hasta la próxima bajada. Es la
 *      misma reimportación de alineación que hace la migración inicial, y es idempotente.
 *   5. SE VUELVE A ENCENDER el motor.
 *
 * Las OTRAS computadoras no se enteran por acá: se enteran solas en su próxima bajada, porque el
 * servidor quedó con otro contenido. Lo que sí queda anotado es quién rebobinó y a qué respaldo.
 */
export async function restaurarRespaldoDelVps(idCrudo: unknown, actor: SesionUsuario): Promise<ResumenDeRestauracion> {
  const id = enteroPositivo(idCrudo, 'El respaldo')
  const vps = fuente()

  detenerSincronizacion()
  try {
    const pendientes = vaciarCola()
    if (pendientes > 0) {
      anotarEvento('motor', `Antes de restaurar se descartaron ${pendientes} cambios que esperaban subir.`)
    }

    const resumen = await vps.restaurarRespaldo(id, actor.nombre)
    anotarEvento(
      'motor',
      `Base restaurada al respaldo #${id}: ${resumen.pestanas} pestañas y ${resumen.filas} filas en el servidor.`,
    )

    const { id: importacionId } = db()
      .prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`)
      .get(ahoraIso()) as { id: number }
    const informe = await ejecutarImportacion({ db: db(), fuente: vps, importacionId })
    db()
      .prepare('UPDATE importaciones SET terminada_en = ?, estado = ?, informe_json = ? WHERE id = ?')
      .run(informe.terminadaEn, informe.estado, JSON.stringify(informe), importacionId)

    registrarCambio(actor, {
      accion: 'restauracion',
      tabla: 'importaciones',
      registroId: importacionId,
      campo: 'RESTAURACIÓN',
      valorAnterior: `${pendientes} cambios pendientes descartados`,
      valorNuevo: `Respaldo #${id} · ${resumen.pestanas} pestañas y ${resumen.filas} filas`,
    })

    return {
      pestanas: resumen.pestanas,
      filas: resumen.filas,
      respaldoPrevio: resumen.respaldoPrevio as RespaldoDelVps | null,
      filasLocales: informe.totales.filasCrudas,
    }
  } finally {
    // Pase lo que pase, el motor vuelve a encenderse: dejarlo apagado es dejar la computadora
    // desconectada de la agencia sin que nadie se entere.
    //
    // Un ciclo normal y no uno completo: la reimportación de acá arriba ya alineó todo contra el
    // servidor, y pedir otra bajada completa sería leer la base entera dos veces seguidas.
    await sincronizarAhora().catch(() => undefined)
  }
}
