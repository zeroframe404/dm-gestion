// El alta de una tarea. Se abre desde el módulo y también desde las fichas (cliente, póliza,
// siniestro, renovación, consulta o presupuesto): en ese caso el vínculo viene puesto y no se elige.
import { useState } from 'react'
import {
  PRIORIDADES_DE_TAREA,
  type DatosDeTareaCompleta,
  type FilaTarea,
  type PrioridadTarea,
} from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Selector } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'

export interface VinculoDeLaTarea {
  clienteId?: number | null
  polizaId?: number | null
  siniestroId?: number | null
  renovacionId?: number | null
  leadId?: number | null
  presupuestoId?: number | null
  /** Cómo se llama la ficha de la que cuelga, para decirlo en el diálogo. */
  texto?: string
}

interface Props {
  vinculo?: VinculoDeLaTarea
  responsables: Array<{ id: number; nombre: string }>
  sucursales: string[]
  alCerrar: () => void
  alCrear: (tarea: FilaTarea) => void
}

export function DialogoNuevaTarea({ vinculo, responsables, sucursales, alCerrar, alCrear }: Props) {
  const usuario = useUsuarioActual()
  const [datos, setDatos] = useState<DatosDeTareaCompleta>({
    titulo: '',
    detalle: '',
    // Por defecto me la pongo yo: es lo más frecuente y evita que quede sin dueño.
    responsableId: usuario.id,
    sucursal: usuario.sucursal.nombre,
    venceEl: '',
    prioridad: 'NORMAL',
    clienteId: vinculo?.clienteId ?? null,
    polizaId: vinculo?.polizaId ?? null,
    siniestroId: vinculo?.siniestroId ?? null,
    renovacionId: vinculo?.renovacionId ?? null,
    leadId: vinculo?.leadId ?? null,
    presupuestoId: vinculo?.presupuestoId ?? null,
  })
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cambiar = (cambios: Partial<DatosDeTareaCompleta>) => setDatos((previos) => ({ ...previos, ...cambios }))

  const crear = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.tareas.crear(datos)
    setGuardando(false)
    if (resultado.ok) alCrear(resultado.datos)
    else setError(resultado.error)
  }

  // Sin `.sort()`: la lista viene del servicio con las cuatro de la agencia adelante, en el orden de la
  // agencia, y ordenarla de nuevo dejaba este desplegable arrancando por «Daniel» mientras el filtro de
  // Tareas arrancaba por «Dock Sud». La sucursal de quien entró queda por si la lista todavía no llegó.
  const opcionesDeSucursal = [...new Set([...sucursales, usuario.sucursal.nombre].filter(Boolean))]

  return (
    <Dialogo
      abierto
      titulo="Nueva tarea"
      descripcion={vinculo?.texto ? `Queda vinculada a ${vinculo.texto}.` : 'Un pendiente del equipo: qué hay que hacer, a quién le toca y para cuándo.'}
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono="mas" cargando={guardando} onClick={() => void crear()}>
            Crear la tarea
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}

        <Campo
          etiqueta="Qué hay que hacer"
          value={datos.titulo}
          onChange={(e) => cambiar({ titulo: e.target.value })}
          placeholder="Llamar al perito de Sancor"
          autoFocus
        />

        <AreaTexto
          etiqueta="Descripción"
          rows={3}
          value={datos.detalle}
          onChange={(e) => cambiar({ detalle: e.target.value })}
          placeholder="Lo que haga falta para que otro pueda hacerlo sin preguntar nada."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Selector
            etiqueta="Asignada a"
            value={datos.responsableId ?? ''}
            onChange={(e) => cambiar({ responsableId: e.target.value ? Number(e.target.value) : null })}
            opciones={[{ valor: '', texto: 'Sin responsable' }, ...responsables.map((r) => ({ valor: r.id, texto: r.nombre }))]}
            ayuda="Al que elijas le aparece en la campana y en su Inicio."
          />
          <Selector
            etiqueta="Sucursal"
            value={datos.sucursal}
            onChange={(e) => cambiar({ sucursal: e.target.value })}
            opciones={opcionesDeSucursal.map((s) => ({ valor: s, texto: s }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Vence" type="date" value={datos.venceEl} onChange={(e) => cambiar({ venceEl: e.target.value })} />
          <Selector
            etiqueta="Prioridad"
            value={datos.prioridad}
            onChange={(e) => cambiar({ prioridad: e.target.value as PrioridadTarea })}
            opciones={PRIORIDADES_DE_TAREA.map((p) => ({ valor: p, texto: p }))}
          />
        </div>
      </div>
    </Dialogo>
  )
}
