// «Descargar el manual»: el PDF corto que explica el programa entero.
//
// Está en dos lados a propósito: en Inicio, que es donde va a estar mirando alguien que recién
// empieza, y en Administración → Acerca de, que es donde se busca cuando ya se sabe que existe.
//
// El HTML lo arma `ayuda/manual.ts` y el PDF sale por el mismo camino que la ayuda de una pantalla:
// `ayuda:guardarPdf` → una ventana oculta → `printToPDF`. No hay un segundo mecanismo que mantener.
import { useState } from 'react'
import { htmlDelManual, nombreDelManual } from '../ayuda/manual'
import { Boton } from './ui'

export function BotonManual({ variante = 'secundario' }: { variante?: 'secundario' | 'fantasma' }) {
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const descargar = async () => {
    setGenerando(true)
    setError(null)
    try {
      const info = await window.dm.app.info()
      const version = info.ok ? info.datos.version : ''
      // El logo se trae recién ahora: son unos kilobytes que no tienen por qué estar en el arranque.
      const { logoDelManual } = await import('../ayuda/recursosDelManual')
      const html = htmlDelManual({
        version,
        fecha: new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }),
        logo: await logoDelManual(),
      })
      const resultado = await window.dm.ayuda.guardarPdf({ html, nombreDeArchivo: nombreDelManual(version) })
      if (!resultado.ok) setError(resultado.error)
    } catch {
      setError('No se pudo generar el manual. Probá de nuevo.')
    } finally {
      setGenerando(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-sm text-red-600">{error}</span>}
      <Boton variante={variante} icono="descargar" cargando={generando} onClick={() => void descargar()}>
        Descargar el manual
      </Boton>
    </span>
  )
}
