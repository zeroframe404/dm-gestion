// «Dar de baja»: pide el motivo de la lista de siempre y una nota, y mueve la fila a Bajas del mes.
import { useEffect, useState } from 'react'
import { MOTIVOS_DE_BAJA, NOMBRE_MOTIVO_BAJA, type FilaCartera, type MotivoDeBaja } from '../../../shared/tipos'
import { AreaTexto, Boton, Dialogo, Selector } from '../../componentes/ui'

interface Props {
  fila: FilaCartera | null
  alCerrar: () => void
  alDarDeBaja: (filaId: string, nombre: string) => void
  alFallar: (mensaje: string) => void
}

export function DialogoBaja({ fila, alCerrar, alDarDeBaja, alFallar }: Props) {
  const [motivo, setMotivo] = useState<MotivoDeBaja>('VENDIO')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!fila) return
    setMotivo('VENDIO')
    setNota('')
  }, [fila])

  if (!fila) return null

  const darDeBaja = async () => {
    setGuardando(true)
    const resultado = await window.dm.cartera.darDeBaja(fila.filaId, { motivo, nota })
    setGuardando(false)
    if (resultado.ok) alDarDeBaja(fila.filaId, fila.nombre ?? 'La póliza')
    else alFallar(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Dar de baja la póliza"
      descripcion={`${fila.nombre ?? 'Sin nombre'} · ${fila.compania ?? ''} ${fila.numeroPoliza ?? ''} · ${fila.patente ?? ''}`}
      alCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" icono="cerrar" onClick={() => void darDeBaja()} cargando={guardando}>
            Dar de baja
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Selector
          etiqueta="Motivo"
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value as MotivoDeBaja)}
          opciones={MOTIVOS_DE_BAJA.map((m) => ({ valor: m, texto: NOMBRE_MOTIVO_BAJA[m] }))}
        />
        <AreaTexto
          etiqueta="Nota"
          rows={3}
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          ayuda="Queda guardada con la baja y en el historial."
        />
        <p className="text-xs text-slate-500">
          La fila sale de la planilla y pasa a <strong className="font-semibold">Bajas</strong> de este mes. Un administrador puede deshacerlo.
        </p>
      </div>
    </Dialogo>
  )
}
