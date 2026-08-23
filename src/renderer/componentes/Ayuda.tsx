// Botón de ayuda contextual: se pone en cada menú, submenú o pestaña y abre un modal que explica esa
// sección con manos de yeso, más un botón para bajarla en PDF A4 y leerla o imprimirla fuera del
// programa. El contenido vive en `ayuda/contenido/*`, indexado por la misma clave que recibe este botón.
import { useState } from 'react'
import type { ContenidoDeAyuda } from '../ayuda/tipos'
import { CONTENIDO_AYUDA } from '../ayuda/contenido'
import { Icono } from './Icono'
import { Boton, cx, Dialogo } from './ui'

interface PropsBotonAyuda {
  /** Clave del contenido en `ayuda/contenido`. Si no existe, el botón no se dibuja. */
  clave: string
  /** 'oscuro' es para ponerlo sobre fondos marino oscuro, como el encabezado de Inicio. */
  variante?: 'claro' | 'oscuro'
  className?: string
}

const CLASES_VARIANTE: Record<'claro' | 'oscuro', string> = {
  claro:
    'border-slate-200 text-slate-500 hover:border-marino-300 hover:bg-marino-50 hover:text-marino-700 focus-visible:ring-marino-500/40',
  oscuro:
    'border-white/25 text-white/80 hover:border-white/40 hover:bg-white/10 hover:text-white focus-visible:ring-cielo-100/60',
}

export function BotonAyuda({ clave, variante = 'claro', className }: PropsBotonAyuda) {
  const [abierto, setAbierto] = useState(false)
  const contenido = CONTENIDO_AYUDA[clave]

  if (!contenido) {
    console.warn(`[ayuda] No hay contenido de ayuda para la clave «${clave}».`)
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Ayuda: ${contenido.titulo}`}
        title="Ayuda de esta sección"
        className={cx(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2',
          CLASES_VARIANTE[variante],
          className,
        )}
      >
        <Icono nombre="ayuda" tamano={17} />
      </button>
      <ModalAyuda contenido={contenido} abierto={abierto} alCerrar={() => setAbierto(false)} />
    </>
  )
}

function ModalAyuda({
  contenido,
  abierto,
  alCerrar,
}: {
  contenido: ContenidoDeAyuda
  abierto: boolean
  alCerrar: () => void
}) {
  const [generandoPdf, setGenerandoPdf] = useState(false)
  const [errorPdf, setErrorPdf] = useState<string | null>(null)

  const descargarPdf = async () => {
    setGenerandoPdf(true)
    setErrorPdf(null)
    try {
      const nombreDeArchivo = `Ayuda - ${contenido.titulo.replace(/[<>:"/\\|?*]/g, '-')}.pdf`
      const resultado = await window.dm.ayuda.guardarPdf({ html: htmlDeAyuda(contenido), nombreDeArchivo })
      if (!resultado.ok) setErrorPdf(resultado.error)
    } catch {
      setErrorPdf('No se pudo generar el PDF. Probá de nuevo.')
    } finally {
      setGenerandoPdf(false)
    }
  }

  return (
    <Dialogo
      abierto={abierto}
      titulo={contenido.titulo}
      descripcion={contenido.resumen}
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          {errorPdf && <span className="mr-auto self-center text-sm text-red-600">{errorPdf}</span>}
          <Boton icono="descargar" cargando={generandoPdf} onClick={() => void descargarPdf()}>
            Descargar en PDF (A4)
          </Boton>
          <Boton variante="primario" onClick={alCerrar}>
            Entendido
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {contenido.secciones.map((seccion, indice) => (
          <section key={indice}>
            <h3 className="font-display text-base font-bold text-marino-900">{seccion.titulo}</h3>
            <div className="mt-2 flex flex-col gap-2.5 text-sm leading-relaxed text-slate-700">
              {seccion.parrafos.map((parrafo, i) => (
                <p key={i}>{parrafo}</p>
              ))}
              {seccion.lista && seccion.lista.length > 0 && (
                <ul className="ml-1 flex flex-col gap-1.5">
                  {seccion.lista.map((item, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-marino-400" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}

        {contenido.conceptos && contenido.conceptos.length > 0 && (
          <section>
            <h3 className="font-display text-base font-bold text-marino-900">Conceptos para entender esta sección</h3>
            <dl className="mt-2 overflow-hidden rounded-xl border border-slate-200">
              {contenido.conceptos.map((concepto, i) => (
                <div key={i} className={cx('px-4 py-3', i % 2 === 0 ? 'bg-slate-50' : 'bg-white')}>
                  <dt className="text-sm font-semibold text-marino-800">{concepto.termino}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-slate-600">{concepto.explicacion}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </Dialogo>
  )
}

// ---------------------------------------------------------------------------
// El PDF: HTML propio para una hoja A4, en el mismo camino que ya usan el presupuesto y los reportes
// (`servicios/impresion.ts`, `printToPDF` de Electron sobre una ventana oculta sin JavaScript).
// ---------------------------------------------------------------------------

function escapar(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function htmlDeAyuda(contenido: ContenidoDeAyuda): string {
  const secciones = contenido.secciones
    .map(
      (seccion) => `
    <section>
      <h2>${escapar(seccion.titulo)}</h2>
      ${seccion.parrafos.map((parrafo) => `<p>${escapar(parrafo)}</p>`).join('\n      ')}
      ${
        seccion.lista && seccion.lista.length > 0
          ? `<ul>${seccion.lista.map((item) => `<li>${escapar(item)}</li>`).join('')}</ul>`
          : ''
      }
    </section>`,
    )
    .join('\n')

  const conceptos =
    contenido.conceptos && contenido.conceptos.length > 0
      ? `
    <section>
      <h2>Conceptos para entender esta sección</h2>
      <dl>
        ${contenido.conceptos
          .map((concepto) => `<dt>${escapar(concepto.termino)}</dt><dd>${escapar(concepto.explicacion)}</dd>`)
          .join('\n        ')}
      </dl>
    </section>`
      : ''

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapar(contenido.titulo)}</title><style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.55; color: #1c2b45; }
  header { border-bottom: 2px solid #12315d; padding-bottom: 6mm; margin-bottom: 8mm; }
  .marca { margin: 0; font-size: 8.5pt; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; color: #55627a; }
  h1 { margin: 2mm 0 0; font-size: 18pt; color: #12315d; }
  .resumen { margin: 2mm 0 0; font-size: 10.5pt; color: #55627a; }
  h2 { font-size: 12pt; color: #12315d; margin: 0 0 2.5mm; }
  section { margin-bottom: 6mm; break-inside: avoid; }
  p { margin: 0 0 2.5mm; }
  ul { margin: 2mm 0 0; padding-left: 5mm; }
  li { margin-bottom: 1.5mm; }
  dl { margin: 2mm 0 0; border: 1px solid #d7deea; border-radius: 3mm; overflow: hidden; }
  dt { background: #eef2f9; padding: 2.5mm 4mm 0.5mm; font-weight: bold; font-size: 10pt; color: #12315d; }
  dd { margin: 0; padding: 0 4mm 2.5mm; font-size: 10pt; color: #3c4a63; border-bottom: 1px solid #eef2f9; }
  dd:last-of-type { border-bottom: none; }
  footer { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #d7deea; font-size: 8.5pt; color: #7c88a0; }
</style></head><body>
  <header>
    <p class="marca">Seguros Daniel Martínez · DM Gestión · Ayuda</p>
    <h1>${escapar(contenido.titulo)}</h1>
    <p class="resumen">${escapar(contenido.resumen)}</p>
  </header>
  ${secciones}
  ${conceptos}
  <footer>Generado desde DM Gestión para leer o imprimir fuera del programa.</footer>
</body></html>`
}
