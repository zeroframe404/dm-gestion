// La beta y la estable comparten el VPS: la misma base de la agencia, los mismos usuarios, los mismos
// ajustes. Eso es lo que permite probar una novedad con datos reales, y también lo que hace que un
// error de la beta pueda llevarse puestas las PCs de la agencia.
//
// Las acciones de acá abajo no se pueden deshacer desde la beta y alcanzan a TODAS las computadoras:
// rebobinar la base del servidor a un respaldo, o migrarla desde Google. Si la beta está hablando con
// el servidor de verdad se niegan; se hacen desde la estable. Si alguien cargó en el config.json de la
// beta un servidor de pruebas (bloque `vps`, ver README «Versión beta»), ahí no hay nada que cuidar y
// se permiten.
import { esBeta } from '../canal'
import { esElVpsDeProduccion } from './config'
import { ErrorDeNegocio } from './errores'
import { credencialesDelPuente } from './sincronizacion'

export function exigirQueNoSeaLaBetaContraProduccion(accion: string): void {
  if (!esBeta()) return
  const credenciales = credencialesDelPuente()
  if (!credenciales || !esElVpsDeProduccion(credenciales.urlBase)) return
  throw new ErrorDeNegocio(
    `No se puede ${accion} desde la versión beta: está conectada a la base REAL de la agencia y esto alcanza a todas las computadoras. ` +
      'Hacelo desde DM Gestión (la versión normal) o apuntá la beta a un servidor de pruebas.',
  )
}
