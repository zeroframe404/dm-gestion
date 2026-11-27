// La zona «Cargar desde la póliza (PDF)» de «Nuevo cliente»: elige el archivo, se lo manda a la IA para
// que lo lea y le devuelve a la pantalla lo leído, para REVISAR. No guarda nada.
//
// Si la lectura falla (sin clave, sin internet, el PDF no se entiende, no es de auto ni de moto) se avisa con un
// mensaje claro y la persona sigue con el formulario de siempre: nada de lo que haya tipeado se pierde.
import { useRef, useState } from 'react'
import { MAXIMO_DEL_PDF_EN_BYTES, PDF_PESADO_EN_BYTES, type PolizaLeida } from '../../../shared/lecturaDePoliza'
import { Alerta, Boton } from '../../componentes/ui'

export interface PdfElegido {
  nombre: string
  contenido: Uint8Array
}

interface Props {
  /** Se leyó el PDF: la pantalla completa el formulario con esto. */
  alLeer: (leida: PolizaLeida, pdf: PdfElegido) => void
  /** Ya hay algo leído: el botón pasa a «Elegir otro PDF». */
  yaLeido: boolean
  deshabilitado?: boolean
}

export function CargaDesdePdf({ alLeer, yaLeido, deshabilitado = false }: Props) {
  const entrada = useRef<HTMLInputElement>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Cuántos MB pesa el PDF que se está leyendo, si es pesado: subirlo tarda y hay que decirlo. */
  const [megasDelPesado, setMegasDelPesado] = useState<number | null>(null)

  const elegir = async (archivo: File | undefined) => {
    if (!archivo || leyendo) return
    setError(null)
    if (archivo.size > MAXIMO_DEL_PDF_EN_BYTES) {
      setError(`El PDF pesa más de ${MAXIMO_DEL_PDF_EN_BYTES / 1024 / 1024} MB y no se puede leer. Cargá los datos a mano.`)
      return
    }
    setMegasDelPesado(archivo.size > PDF_PESADO_EN_BYTES ? Math.round(archivo.size / 1024 / 1024) : null)
    setLeyendo(true)
    try {
      const contenido = new Uint8Array(await archivo.arrayBuffer())
      const resultado = await window.dm.clientes.leerPoliza({ nombre: archivo.name, contenido })
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      alLeer(resultado.datos, { nombre: archivo.name, contenido })
    } catch {
      setError('No se pudo leer el archivo. Probá elegirlo de nuevo.')
    } finally {
      setLeyendo(false)
      // Para poder elegir el mismo archivo dos veces seguidas.
      if (entrada.current) entrada.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-marino-200 bg-marino-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-bold text-marino-800">Cargar desde la póliza (PDF)</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            La IA lee el PDF de una póliza de auto o de moto y completa el cliente, el vehículo y la póliza. Revisá los datos antes de crear. El PDF se envía a Anthropic para leerlo.
          </p>
        </div>
        <Boton icono="subir" onClick={() => entrada.current?.click()} cargando={leyendo} disabled={deshabilitado || leyendo}>
          {leyendo ? 'Leyendo la póliza…' : yaLeido ? 'Elegir otro PDF' : 'Elegir PDF'}
        </Boton>
        <input
          ref={entrada}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label="PDF de la póliza"
          onChange={(evento) => void elegir(evento.target.files?.[0])}
        />
      </div>
      {leyendo && megasDelPesado !== null && (
        <Alerta tono="info">Es un PDF pesado ({megasDelPesado} MB): subirlo y leerlo puede tardar unos minutos. No cierres esta ventana.</Alerta>
      )}
      {error && <Alerta tono="error">{error}</Alerta>}
    </div>
  )
}
