// «Compartir»: el link para copiar y el atajo para mandarlo por WhatsApp.
//
// WhatsApp se abre con `sistema:abrirEnlace`, el mismo camino que usa el resto del programa para abrir
// algo en el navegador (y que en la demo muestra el mensaje en vez de abrir un chat de verdad). No va
// por `miLink:abrirPagina`: esa es sólo para la página propia y le agrega `?vista=duenio`.
import { useState } from 'react'
import { Alerta, Boton, Dialogo } from '../../../componentes/ui'

export function DialogoCompartir({ url, publicada, alCerrar }: { url: string; publicada: boolean; alCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      setError('No se pudo copiar el link. Seleccionalo y copialo a mano.')
    }
  }

  const porWhatsapp = async () => {
    const texto = `Te paso mi página para cotizar tu seguro: ${url}`
    const resultado = await window.dm.sistema.abrirEnlace(`https://wa.me/?text=${encodeURIComponent(texto)}`)
    if (!resultado.ok) setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Compartir tu página"
      descripcion="Pegalo en tu estado de WhatsApp, en la bio de Instagram o en la firma del mail."
      alCerrar={alCerrar}
      pie={
        <Boton variante="fantasma" onClick={alCerrar}>
          Cerrar
        </Boton>
      }
    >
      <div className="flex flex-col gap-4">
        {!publicada && (
          <Alerta tono="aviso">
            Tu página todavía no está publicada: quien entre al link va a ver «Esta página no está disponible». Tocá <strong>Publicar</strong> cuando esté
            lista.
          </Alerta>
        )}
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={url}
            onFocus={(evento) => evento.currentTarget.select()}
            aria-label="Link de tu página"
            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-800 outline-none focus:border-marino-500 focus:ring-2 focus:ring-marino-500/25"
          />
          <Boton variante="primario" icono={copiado ? 'ok' : 'enlace'} onClick={() => void copiar()}>
            {copiado ? '¡Copiado!' : 'Copiar'}
          </Boton>
        </div>
        <Boton icono="mensaje" onClick={() => void porWhatsapp()} className="self-start">
          Mandar por WhatsApp
        </Boton>
        {error && <Alerta tono="error">{error}</Alerta>}
      </div>
    </Dialogo>
  )
}
