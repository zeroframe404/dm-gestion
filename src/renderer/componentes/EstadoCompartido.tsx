// El renglón que dice si lo que hay en esta computadora es lo mismo que tiene el resto.
//
// Todos los ajustes que viajan al VPS —la conexión con Google, la app de Meta, el catálogo de
// vehículos, el catálogo de compañías, el encabezado del ticket— necesitan decir exactamente lo mismo
// y con las mismas palabras, así que se dice una sola vez acá. Los cuatro estados posibles:
//
//   sin servidor        esta versión no habla con el VPS (desarrollo): sólo vale en esta computadora.
//   con error           el servidor no contestó. No es grave: lo local quedó guardado igual.
//   sin publicar        el servidor todavía no tiene nada; el resto de las máquinas no lo tiene.
//   al día / distinto   lo de acá coincide (o no) con lo que van a adoptar las demás.
import type { EstadoDeAjusteCompartido } from '../../shared/tipos'
import { Alerta, haceCuanto } from './ui'

interface Props {
  estado: EstadoDeAjusteCompartido | null | undefined
  /** Cómo se llama esto en la frase: «la conexión con Google», «el encabezado del ticket». */
  nombre: string
  /**
   * Qué hay que hacer para que el resto lo tenga, cuando acá hay algo que el servidor no tiene. Sin
   * esto se usa la frase general: la carga el superadministrador.
   */
  comoSeCarga?: string
}

export function EstadoCompartido({ estado, nombre, comoSeCarga }: Props) {
  if (!estado) return null

  if (estado.error) {
    return (
      <Alerta tono="aviso">
        {nombre.charAt(0).toLocaleUpperCase('es-AR') + nombre.slice(1)} quedó guardado en esta computadora, pero no se pudo
        hablar con el servidor para que lo tenga el resto: {estado.error} Se vuelve a intentar solo al abrir el programa.
      </Alerta>
    )
  }

  if (!estado.enElServidor) {
    return (
      <Alerta tono="info">
        El servidor todavía no tiene {nombre}, así que las otras computadoras siguen con lo suyo.{' '}
        {comoSeCarga ?? 'Lo carga el superadministrador una sola vez.'}
      </Alerta>
    )
  }

  const cuando = estado.actualizadoEn ? haceCuanto(estado.actualizadoEn) : null
  const quien = estado.actualizadoPor ? ` por ${estado.actualizadoPor}` : ''

  if (estado.alDia) {
    return (
      <Alerta tono="exito">
        Esta computadora tiene lo mismo que el servidor{cuando ? `, cargado ${cuando}${quien}` : quien}. El resto lo adopta
        al abrir el programa.
      </Alerta>
    )
  }

  return (
    <Alerta tono="aviso">
      Lo que hay en esta computadora es distinto de lo que tiene el servidor{cuando ? ` (cargado ${cuando}${quien})` : quien}
      . Guardando de nuevo se manda lo de acá para todas; al abrir el programa se adopta lo del servidor.
    </Alerta>
  )
}
