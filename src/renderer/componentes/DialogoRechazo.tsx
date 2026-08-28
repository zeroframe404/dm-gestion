// «Avisar rechazo del débito»: el botón que aprieta quien ve que a un cliente le rebotó el CBU para
// que la sucursal que lo atiende se entere y lo llame.
//
// Vive en componentes y no en una pantalla porque lo abren dos: la póliza (Pólizas → una póliza) y la
// planilla del mes, que es donde se ven las filas de débito automático todos los días.
import { useEffect, useMemo, useState } from 'react'
import { MOTIVOS_DE_RECHAZO, NOMBRE_MOTIVO_RECHAZO, type FilaRechazo, type MotivoDeRechazo, type Sucursal } from '../../shared/tipos'
import { useUsuarioActual } from '../contexto/Sesion'
import { AreaTexto, Boton, Dialogo, Selector } from './ui'

export interface PolizaARechazar {
  polizaId: number
  clienteNombre: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  formaPago: string | null
  /** La sucursal que atiende al cliente: es a la que se le avisa por omisión. */
  sucursal: string | null
}

interface Props {
  poliza: PolizaARechazar | null
  alCerrar: () => void
  alAvisar: (aviso: FilaRechazo) => void
  alFallar: (mensaje: string) => void
}

export function DialogoRechazo({ poliza, alCerrar, alAvisar, alFallar }: Props) {
  const usuario = useUsuarioActual()
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursal, setSucursal] = useState('')
  const [motivo, setMotivo] = useState<MotivoDeRechazo>('CBU RECHAZADO')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vigente = true
    void window.dm.sucursales.listar().then((resultado) => {
      if (vigente && resultado.ok) setSucursales(resultado.datos)
    })
    return () => {
      vigente = false
    }
  }, [])

  useEffect(() => {
    if (!poliza) return
    setMotivo('CBU RECHAZADO')
    setNota('')
    setSucursal(poliza.sucursal ?? usuario.sucursal.nombre)
  }, [poliza, usuario.sucursal.nombre])

  // La sucursal de la póliza puede estar escrita de una manera que no está en el catálogo (así viene de
  // la hoja de años): se agrega a la lista en vez de perderla, que es a quién de verdad hay que avisarle.
  const opciones = useMemo(() => {
    const nombres = sucursales.map((s) => s.nombre)
    const propia = poliza?.sucursal?.trim()
    if (propia && !nombres.some((n) => n.localeCompare(propia, 'es', { sensitivity: 'base' }) === 0)) nombres.unshift(propia)
    return nombres
  }, [poliza, sucursales])

  if (!poliza) return null

  const avisar = async () => {
    setGuardando(true)
    const resultado = await window.dm.rechazos.avisar(poliza.polizaId, { sucursal, motivo, nota })
    setGuardando(false)
    if (resultado.ok) alAvisar(resultado.datos)
    else alFallar(resultado.error)
  }

  const descripcion =
    [poliza.clienteNombre, poliza.compania, poliza.numeroPoliza && `N.° ${poliza.numeroPoliza}`, poliza.patente]
      .filter(Boolean)
      .join(' · ') || 'Sin datos cargados'

  return (
    <Dialogo
      abierto
      titulo="Avisar que se rechazó el débito"
      descripcion={descripcion}
      alCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="campana" onClick={() => void avisar()} cargando={guardando} disabled={!sucursal.trim()}>
            Avisar a la sucursal
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Selector
          etiqueta="Avisarle a"
          value={sucursal}
          onChange={(evento) => setSucursal(evento.target.value)}
          opciones={opciones.map((nombre) => ({ valor: nombre, texto: nombre }))}
          ayuda="La sucursal que atiende al cliente. Le aparece en la campana apenas entra."
        />
        <Selector
          etiqueta="Qué pasó"
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value as MotivoDeRechazo)}
          opciones={MOTIVOS_DE_RECHAZO.map((m) => ({ valor: m, texto: NOMBRE_MOTIVO_RECHAZO[m] }))}
        />
        <AreaTexto
          etiqueta="Nota"
          rows={3}
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          ayuda="Lo que la sucursal necesite saber para llamarlo: el mes que rebotó, si ya se lo intentó cobrar, el CBU nuevo…"
        />
        {poliza.formaPago && <p className="text-xs text-slate-500">Forma de pago cargada: {poliza.formaPago}.</p>}
        <p className="text-xs text-slate-500">
          El aviso queda en <strong className="font-semibold">Cartera → Rechazos</strong> hasta que la sucursal lo dé por resuelto, y
          viaja por la base del VPS para que llegue a su computadora.
        </p>
      </div>
    </Dialogo>
  )
}
