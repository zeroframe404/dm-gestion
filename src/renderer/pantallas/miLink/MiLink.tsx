// Mi link: la página pública de cada uno y lo que llega desde ella. Este archivo sólo elige la
// subpantalla según el renglón de la barra lateral (`seccion` de la navegación); cada una vive en su
// archivo y habla con el VPS por `window.dm.miLink`.
import { useEffect, useState } from 'react'
import { esSeccionDeMiLink, type SeccionDeMiLink } from '../../../shared/miLink'
import { useNavegacion } from '../../contexto/Navegacion'
import { Metricas } from './Metricas'
import { MiPagina } from './MiPagina'
import { Siniestros } from './Siniestros'
import { Solicitudes } from './Solicitudes'

export function MiLink() {
  const { seccion: pedida } = useNavegacion()
  const seccion: SeccionDeMiLink = esSeccionDeMiLink(pedida) ? pedida : 'pagina'
  // El editor queda montado una vez abierto: se autoguarda con una demora, y si se desmontara al ir a
  // mirar las solicitudes en el medio de esa demora, el último cambio se perdería.
  const [editorAbierto, setEditorAbierto] = useState(seccion === 'pagina')
  useEffect(() => {
    if (seccion === 'pagina') setEditorAbierto(true)
  }, [seccion])

  return (
    <>
      {editorAbierto && (
        <div hidden={seccion !== 'pagina'}>
          <MiPagina />
        </div>
      )}
      {seccion === 'solicitudes' && <Solicitudes />}
      {seccion === 'siniestros' && <Siniestros />}
      {seccion === 'metricas' && <Metricas />}
    </>
  )
}
