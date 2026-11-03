// Mi link: la página pública de cada sucursal y lo que llega desde ella. Este archivo sólo elige la
// subpantalla según el renglón de la barra lateral (`seccion` de la navegación); cada una vive en su
// archivo y habla con el VPS por `window.dm.miLink`.
//
// Hay una página por sucursal: cada usuario trabaja la de la suya. El superadministrador, en cambio,
// entra a «Mi página» por la lista de todas las sucursales y desde ahí abre la que quiere configurar.
import { useCallback, useEffect, useState } from 'react'
import { esSeccionDeMiLink, type SeccionDeMiLink, type SucursalesDeMiLink } from '../../../shared/miLink'
import { Boton } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { ListaDeSucursales } from './ListaDeSucursales'
import { Metricas } from './Metricas'
import { MiPagina } from './MiPagina'
import { Siniestros } from './Siniestros'
import { Solicitudes } from './Solicitudes'

export function MiLink() {
  const { seccion: pedida } = useNavegacion()
  const seccion: SeccionDeMiLink = esSeccionDeMiLink(pedida) ? pedida : 'pagina'
  const [sucursales, setSucursales] = useState<SucursalesDeMiLink | null>(null)
  // El superadministrador empieza en la lista; al abrir una sucursal pasa al editor.
  const [enLista, setEnLista] = useState(true)
  // El editor queda montado una vez abierto: se autoguarda con una demora, y si se desmontara al ir a
  // mirar las solicitudes en el medio de esa demora, el último cambio se perdería.
  const [editorAbierto, setEditorAbierto] = useState(false)

  const recargarSucursales = useCallback(async () => {
    const resultado = await window.dm.miLink.sucursales()
    if (resultado.ok) setSucursales(resultado.datos)
  }, [])

  useEffect(() => {
    void recargarSucursales()
  }, [recargarSucursales])

  const puedeElegir = sucursales?.puedeElegir ?? false
  const mostrarLista = puedeElegir && enLista
  useEffect(() => {
    if (seccion === 'pagina' && sucursales && !mostrarLista) setEditorAbierto(true)
  }, [seccion, sucursales, mostrarLista])

  const abrirSucursal = async (nombre: string): Promise<string | null> => {
    const resultado = await window.dm.miLink.elegirSucursal(nombre)
    if (!resultado.ok) return resultado.error
    setSucursales(resultado.datos)
    setEnLista(false)
    return null
  }

  const volverALista = () => {
    setEnLista(true)
    setEditorAbierto(false)
    void recargarSucursales()
  }

  return (
    <>
      {seccion === 'pagina' && mostrarLista && sucursales && (
        <ListaDeSucursales sucursales={sucursales.sucursales} elegida={sucursales.elegida} alAbrir={abrirSucursal} />
      )}
      {editorAbierto && sucursales && (
        <div hidden={seccion !== 'pagina' || mostrarLista}>
          {puedeElegir && (
            <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-2 xl:px-8">
              <Boton tamano="sm" icono="flechaIzquierda" onClick={volverALista}>
                Todas las sucursales
              </Boton>
              <span className="text-sm text-slate-600">
                Configurando la página de <strong className="text-slate-900">{sucursales.elegida}</strong>
              </span>
            </div>
          )}
          {/* La `key` la rearma de cero si se abre otra sucursal: otro borrador, otro candado. */}
          <MiPagina key={sucursales.elegida} sucursal={sucursales.elegida} />
        </div>
      )}
      {seccion === 'solicitudes' && <Solicitudes />}
      {seccion === 'siniestros' && <Siniestros />}
      {seccion === 'metricas' && <Metricas />}
    </>
  )
}
