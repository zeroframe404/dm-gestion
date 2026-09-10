// Diálogo de «Registrar pago»: viene con la fecha de hoy y el importe de la cuota ya cargados, así el
// caso normal es abrir y aceptar. Abajo, las dos opciones que no son el caso normal: marcar el cobro
// como IMPUTADO (se le pagó a la compañía y el cliente transfiere después) y adelantar la cuota del
// mes que viene (ver OpcionesDelPago).
import { useEffect, useState } from 'react'
import type { FilaCartera } from '../../../shared/tipos'
import { Boton, Campo, Dialogo, Selector } from '../../componentes/ui'
import { datosDeLasOpciones, opcionesParaFila, OpcionesDelPago, textoDeGuardar, type OpcionesElegidas } from '../cobranzas/OpcionesDelPago'

interface Props {
  fila: FilaCartera | null
  mediosDePago: string[]
  hoy: string
  alCerrar: () => void
  alGuardar: (fila: FilaCartera, resumen: string) => void
  alFallar: (mensaje: string) => void
}

/** El aviso que se muestra después de guardar, que dice lo que se hizo. */
export function resumenDelPago(fila: FilaCartera, opciones: OpcionesElegidas): string {
  const nombre = fila.nombre ?? 'el cliente'
  if (opciones.estadoCobro === 'IMPUTADO') return `Cuota de ${nombre} imputada: queda pendiente de cobrar.`
  if (opciones.alcance === 'AMBAS') return `Pago registrado para ${nombre}: esta cuota y la del mes que viene por adelantado.`
  if (opciones.alcance === 'ADELANTADO') return `Pago adelantado registrado para ${nombre}: la cuota del mes que viene.`
  return `Pago registrado para ${nombre}.`
}

export function DialogoPago({ fila, mediosDePago, hoy, alCerrar, alGuardar, alFallar }: Props) {
  const [fecha, setFecha] = useState(hoy)
  const [importe, setImporte] = useState('')
  const [medio, setMedio] = useState('')
  const [opciones, setOpciones] = useState<OpcionesElegidas>(opcionesParaFila(null))
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!fila) return
    setFecha(hoy)
    setImporte(fila.cuota ?? '')
    setMedio(fila.formaPago ?? mediosDePago[0] ?? '')
    setOpciones(opcionesParaFila(fila))
  }, [fila, hoy, mediosDePago])

  if (!fila) return null

  const guardar = async () => {
    setGuardando(true)
    const resultado = await window.dm.cartera.registrarPago(fila.filaId, {
      fecha,
      importe,
      medioDePago: medio,
      ...datosDeLasOpciones(opciones, fila),
    })
    setGuardando(false)
    if (resultado.ok) alGuardar(resultado.datos, resumenDelPago(fila, opciones))
    else alFallar(resultado.error)
  }

  const soloAdelanto = opciones.alcance === 'ADELANTADO'

  return (
    <Dialogo
      abierto
      titulo="Registrar pago"
      descripcion={`${fila.nombre ?? 'Sin nombre'} · ${fila.compania ?? ''} ${fila.numeroPoliza ?? ''}`}
      alCerrar={alCerrar}
      ancho="md"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton escribe variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            {textoDeGuardar(opciones, fila)}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Campo etiqueta="Fecha del pago" type="date" value={fecha} onChange={(evento) => setFecha(evento.target.value)} />
        {!soloAdelanto && (
          <Campo
            etiqueta="Importe"
            value={importe}
            onChange={(evento) => setImporte(evento.target.value)}
            ayuda="Viene con la cuota del mes; cambialo si pagó otra cosa."
          />
        )}
        <Selector
          etiqueta="Medio de pago"
          value={medio}
          onChange={(evento) => setMedio(evento.target.value)}
          opciones={[{ valor: '', texto: '(sin especificar)' }, ...mediosDePago.map((m) => ({ valor: m, texto: m }))]}
        />
        <OpcionesDelPago fila={fila} opciones={opciones} alCambiar={setOpciones} disabled={guardando} />
      </div>
    </Dialogo>
  )
}
