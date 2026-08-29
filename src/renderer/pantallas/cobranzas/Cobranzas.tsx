// Módulo Cobranzas: la caja del día por sucursal, la mora, la rendición mensual contra las compañías
// y las comisiones estimadas. Imputados es la misma pantalla que la subpestaña de Cartera.
import { useEffect, useMemo, useState } from 'react'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'
import { useNavegacion } from '../../contexto/Navegacion'
import { useUsuarioActual } from '../../contexto/Sesion'
import { CajaDelDia } from './CajaDelDia'
import { Comisiones } from './Comisiones'
import { Imputados } from './Imputados'
import { Mora } from './Mora'

type IdSeccion = 'caja' | 'mora' | 'imputados' | 'comisiones'

export function Cobranzas() {
  const usuario = useUsuarioActual()
  const { parametros, limpiarParametros } = useNavegacion()

  // Las comisiones son información de la agencia, no del mostrador: sólo las ven los administradores.
  // El proceso principal lo vuelve a controlar en cada llamado.
  const secciones = useMemo<ItemDePestana<IdSeccion>[]>(() => {
    const lista: ItemDePestana<IdSeccion>[] = [
      { id: 'caja', nombre: 'Caja del día', icono: 'billete', ayuda: 'cobranzas.caja', excel: 'pagos' },
      { id: 'mora', nombre: 'Mora', icono: 'alerta', ayuda: 'cobranzas.mora', excel: 'mora' },
      { id: 'imputados', nombre: 'Imputados', icono: 'tabla', ayuda: 'imputados' },
    ]
    if (usuario.rol !== 'EMPLEADO') lista.push({ id: 'comisiones', nombre: 'Comisiones', icono: 'porcentaje', ayuda: 'cobranzas.comisiones' })
    return lista
  }, [usuario.rol])

  const [seccionActiva, setSeccionActiva] = useState<IdSeccion>('caja')
  const seccion = secciones.some((s) => s.id === seccionActiva) ? seccionActiva : 'caja'

  // Otro módulo puede abrir Cobranzas pidiendo una subpestaña puntual.
  useEffect(() => {
    const pedida = parametros.seccion
    if (!pedida) return
    if (secciones.some((s) => s.id === pedida)) setSeccionActiva(pedida as IdSeccion)
    limpiarParametros()
  }, [parametros.seccion, limpiarParametros, secciones])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarraDePestanas
        etiqueta="Secciones de cobranzas"
        prefijo="cobranzas"
        items={secciones}
        activa={seccion}
        alElegir={setSeccionActiva}
      />

      <div
        id={`panel-cobranzas-${seccion}`}
        role="tabpanel"
        aria-labelledby={`tab-cobranzas-${seccion}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {seccion === 'caja' && <CajaDelDia />}
        {seccion === 'mora' && <Mora />}
        {seccion === 'imputados' && <Imputados />}
        {seccion === 'comisiones' && <Comisiones />}
      </div>
    </div>
  )
}
