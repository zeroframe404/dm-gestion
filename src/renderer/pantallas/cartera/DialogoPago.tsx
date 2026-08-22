// Mini diálogo de «Registrar pago»: viene con la fecha de hoy y el importe de la cuota ya cargados,
// así el caso normal es abrir y aceptar.
import { useEffect, useState } from 'react'
import type { FilaCartera } from '../../../shared/tipos'
import { Boton, Campo, Dialogo, Selector } from '../../componentes/ui'

interface Props {
  fila: FilaCartera | null
  mediosDePago: string[]
  hoy: string
  alCerrar: () => void
  alGuardar: (fila: FilaCartera) => void
  alFallar: (mensaje: string) => void
}

export function DialogoPago({ fila, mediosDePago, hoy, alCerrar, alGuardar, alFallar }: Props) {
  const [fecha, setFecha] = useState(hoy)
  const [importe, setImporte] = useState('')
  const [medio, setMedio] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!fila) return
    setFecha(hoy)
    setImporte(fila.cuota ?? '')
    setMedio(fila.formaPago ?? mediosDePago[0] ?? '')
  }, [fila, hoy, mediosDePago])

  if (!fila) return null

  const guardar = async () => {
    setGuardando(true)
    const resultado = await window.dm.cartera.registrarPago(fila.filaId, { fecha, importe, medioDePago: medio })
    setGuardando(false)
    if (resultado.ok) alGuardar(resultado.datos)
    else alFallar(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Registrar pago"
      descripcion={`${fila.nombre ?? 'Sin nombre'} · ${fila.compania ?? ''} ${fila.numeroPoliza ?? ''}`}
      alCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando}>
            Guardar pago
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Campo etiqueta="Fecha del pago" type="date" value={fecha} onChange={(evento) => setFecha(evento.target.value)} />
        <Campo
          etiqueta="Importe"
          value={importe}
          onChange={(evento) => setImporte(evento.target.value)}
          ayuda="Viene con la cuota del mes; cambialo si pagó otra cosa."
        />
        <Selector
          etiqueta="Medio de pago"
          value={medio}
          onChange={(evento) => setMedio(evento.target.value)}
          opciones={[{ valor: '', texto: '(sin especificar)' }, ...mediosDePago.map((m) => ({ valor: m, texto: m }))]}
        />
      </div>
    </Dialogo>
  )
}
