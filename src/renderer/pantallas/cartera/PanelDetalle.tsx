// Panel lateral con el resto de las columnas de la fila (las que no entran en la tabla) y su historial.
import { useEffect, useState } from 'react'
import type { CampoEditable, EntradaHistorial, FilaCartera } from '../../../shared/tipos'
import type { ResultadoDeEliminacion } from '../../../shared/eliminacion'
import { Icono } from '../../componentes/Icono'
import { cx } from '../../componentes/ui'
import { BotonEliminar, usePuedeEliminar } from '../../componentes/BotonEliminar'

interface Props {
  fila: FilaCartera
  soloLectura: boolean
  alCerrar: () => void
  alGuardar: (campo: CampoEditable, valor: string) => void
  /** Se borró la fila de la planilla. Sólo lo puede hacer un superadministrador. */
  alBorrar: (resultado: ResultadoDeEliminacion) => void
}

const GRUPOS: Array<{ titulo: string; campos: Array<{ campo: CampoEditable; etiqueta: string }> }> = [
  {
    titulo: 'Cliente',
    campos: [
      { campo: 'nombre', etiqueta: 'Nombre y apellido' },
      { campo: 'documento', etiqueta: 'DNI/CUIT' },
      { campo: 'telefono', etiqueta: 'Teléfono' },
      { campo: 'email', etiqueta: 'Email' },
      { campo: 'direccion', etiqueta: 'Dirección' },
      { campo: 'localidad', etiqueta: 'Localidad' },
      { campo: 'sucursal', etiqueta: 'Sucursal' },
    ],
  },
  {
    titulo: 'Vehículo',
    campos: [
      { campo: 'vehiculo', etiqueta: 'Vehículo' },
      { campo: 'marca', etiqueta: 'Marca' },
      { campo: 'modelo', etiqueta: 'Modelo' },
      { campo: 'anio', etiqueta: 'Año' },
      { campo: 'patente', etiqueta: 'Patente' },
      { campo: 'motor', etiqueta: 'Motor' },
      { campo: 'chasis', etiqueta: 'Chasis' },
      { campo: 'uso', etiqueta: 'Uso' },
      { campo: 'color', etiqueta: 'Color' },
    ],
  },
  {
    titulo: 'Póliza',
    campos: [
      { campo: 'compania', etiqueta: 'Compañía' },
      { campo: 'numeroPoliza', etiqueta: 'Póliza' },
      { campo: 'propuesta', etiqueta: 'Propuesta' },
      { campo: 'cobertura', etiqueta: 'Cobertura' },
      { campo: 'prima', etiqueta: 'Prima' },
      { campo: 'productor', etiqueta: 'Productor' },
      { campo: 'vigenciaDesde', etiqueta: 'Desde' },
      { campo: 'vigenciaHasta', etiqueta: 'Hasta' },
    ],
  },
  {
    titulo: 'Este mes',
    campos: [
      { campo: 'cuota', etiqueta: 'Cuota' },
      { campo: 'diaVencimiento', etiqueta: 'Fecha de venc' },
      { campo: 'formaPago', etiqueta: 'Forma de pago' },
      { campo: 'aviso', etiqueta: 'OB. avisos' },
      { campo: 'avisarVto', etiqueta: 'Avisar vto' },
      { campo: 'pago', etiqueta: 'Cuando pago' },
      { campo: 'observaciones', etiqueta: 'Observaciones' },
    ],
  },
]

export function PanelDetalle({ fila, soloLectura, alCerrar, alGuardar, alBorrar }: Props) {
  const [historial, setHistorial] = useState<EntradaHistorial[]>([])
  const [verHistorial, setVerHistorial] = useState(false)

  useEffect(() => {
    if (!verHistorial) return
    let vigente = true
    void window.dm.cartera.historialDeFila(fila.filaId).then((resultado) => {
      if (vigente && resultado.ok) setHistorial(resultado.datos)
    })
    return () => {
      vigente = false
    }
  }, [fila.filaId, verHistorial])

  useEffect(() => {
    setVerHistorial(false)
    setHistorial([])
  }, [fila.filaId])

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold text-slate-900">{fila.nombre ?? 'Sin nombre'}</p>
          <p className="truncate text-xs text-slate-500">
            {fila.compania ?? '—'} · {fila.numeroPoliza ?? 'sin póliza'} · {fila.patente ?? 'sin patente'}
          </p>
        </div>
        <button type="button" aria-label="Cerrar el detalle" onClick={alCerrar} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <Icono nombre="cerrar" tamano={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {GRUPOS.map((grupo) => (
          <section key={grupo.titulo} className="mb-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{grupo.titulo}</p>
            <dl className="flex flex-col gap-1">
              {grupo.campos.map(({ campo, etiqueta }) => (
                <div key={campo} className="grid grid-cols-[9rem_1fr] items-center gap-2">
                  <dt className="truncate text-xs text-slate-500">{etiqueta}</dt>
                  <dd>
                    <input
                      defaultValue={(fila[campo as keyof FilaCartera] as string | null) ?? ''}
                      key={`${fila.filaId}-${campo}-${(fila[campo as keyof FilaCartera] as string | null) ?? ''}`}
                      readOnly={soloLectura}
                      onBlur={(evento) => {
                        const valor = evento.currentTarget.value
                        if (!soloLectura && valor !== (((fila[campo as keyof FilaCartera] as string | null) ?? ''))) alGuardar(campo, valor)
                      }}
                      className={cx(
                        'w-full rounded border border-transparent px-1.5 py-1 text-sm text-slate-800',
                        soloLectura ? 'bg-slate-50' : 'hover:border-slate-300 focus:border-marino-400 focus:outline-none focus:ring-2 focus:ring-marino-500/25',
                      )}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <section>
          <button
            type="button"
            onClick={() => setVerHistorial((v) => !v)}
            className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-800"
          >
            <Icono nombre={verHistorial ? 'ojoTachado' : 'ojo'} tamano={13} />
            Historial de la fila
          </button>
          {verHistorial &&
            (historial.length === 0 ? (
              <p className="text-xs text-slate-400">Todavía no se tocó nada en esta fila desde la aplicación.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {historial.map((entrada) => (
                  <li key={entrada.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                    <p className="font-semibold text-slate-800">
                      {entrada.campo} <span className="font-normal text-slate-500">· {entrada.usuarioNombre}</span>
                    </p>
                    <p className="truncate">
                      {entrada.valorAnterior ? <s className="text-slate-400">{entrada.valorAnterior}</s> : <span className="text-slate-400">(vacío)</span>}
                      {' → '}
                      <strong className="font-semibold">{entrada.valorNuevo ?? '(vacío)'}</strong>
                    </p>
                    <p className="text-[11px] text-slate-400">{new Date(entrada.fecha).toLocaleString('es-AR')}</p>
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </div>

      {/* La papelera va al pie y separada del resto: es lo único de este panel que no se deshace. Para
          quien no es superadministrador no se dibuja nada, ni el pie. */}
      <PieDeBorrado fila={fila} alBorrar={alBorrar} />
    </aside>
  )
}

function PieDeBorrado({ fila, alBorrar }: { fila: FilaCartera; alBorrar: Props['alBorrar'] }) {
  if (!usePuedeEliminar('cuota')) return null
  return (
    <footer className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
      <p className="text-xs text-slate-500">Borra esta fila del mes, no la póliza.</p>
      <BotonEliminar tipo="cuota" id={fila.cuotaId} alBorrar={alBorrar} />
    </footer>
  )
}
