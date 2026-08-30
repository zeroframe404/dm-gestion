// Riesgos varios: todo lo que no es automotor (combinado familiar, incendio, comercio…), con las
// mismas columnas de la pestaña RIESGOS VARIOS de la hoja.
//
// Se trabaja igual que la planilla del mes: doble clic en la celda para corregir, el mismo semáforo
// azul para lo que se cobra solo (TARJETA y CBU) y un alta simple. Acá no hay período —es una tabla
// sola que se corrige encima— así que no hay selector de mes ni meses de sólo lectura.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BotonEliminar } from '../../componentes/BotonEliminar'
import { esDebitoAutomatico } from '../../../shared/semaforo'
import { mismaSucursal } from '../../../shared/sucursales'
import type { CampoDeRiesgo, FilaRiesgoVario, ListadoRiesgos } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { DialogoNuevoRiesgo } from './DialogoNuevoRiesgo'

function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

interface Columna {
  campo: CampoDeRiesgo
  titulo: string
  ancho?: string
  /** Sugerencias para el desplegable de la celda (se puede escribir cualquier otra cosa). */
  opciones?: (datos: ListadoRiesgos) => string[]
  clase?: string
}

const COLUMNAS: Columna[] = [
  { campo: 'sucursal', titulo: 'Sucursal', opciones: (d) => d.sucursales },
  { campo: 'emision', titulo: 'Emisión', clase: 'whitespace-nowrap tabular-nums' },
  { campo: 'clienteNombre', titulo: 'Titular', ancho: 'min-w-52', clase: 'font-medium text-slate-900' },
  { campo: 'tipoRiesgo', titulo: 'Riesgo', opciones: (d) => d.tiposDeRiesgo },
  { campo: 'diaVencimiento', titulo: 'Día de VTO', clase: 'text-center tabular-nums' },
  { campo: 'formaPago', titulo: 'Forma de pago', opciones: (d) => d.formasDePago },
  { campo: 'compania', titulo: 'Compañía', opciones: (d) => d.companias },
  { campo: 'numeroPoliza', titulo: 'Póliza', clase: 'font-mono text-xs' },
  { campo: 'cuota', titulo: 'Cuota', clase: 'tabular-nums' },
  { campo: 'vigenciaDesde', titulo: 'Desde', clase: 'whitespace-nowrap tabular-nums' },
  { campo: 'vigenciaHasta', titulo: 'Hasta', clase: 'whitespace-nowrap tabular-nums' },
  { campo: 'telefono', titulo: 'Teléfono', clase: 'whitespace-nowrap' },
  { campo: 'observaciones', titulo: 'Obs', ancho: 'min-w-48' },
]

export function RiesgosVarios() {
  const puedeEditar = usePuedeEditar('cartera')
  const [datos, setDatos] = useState<ListadoRiesgos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [sucursal, setSucursal] = useState('')
  const [editando, setEditando] = useState<{ id: number; campo: CampoDeRiesgo } | null>(null)
  const [altaAbierta, setAltaAbierta] = useState(false)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.riesgos.listar()
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const filtradas = useMemo(() => {
    if (!datos) return []
    const texto = normalizar(busqueda)
    return datos.filas.filter((f) => {
      // La sucursal se compara con `mismaSucursal`, que es con lo que el servicio arma el desplegable:
      // además de las tildes y las mayúsculas sabe que «AVELLANEDA» y «DOCKSUD» son Dock Sud. Con el
      // texto pelado, elegir una opción que pliega dos grafías dejaba el listado vacío.
      if (sucursal && !mismaSucursal(f.sucursal, sucursal)) return false
      if (!texto) return true
      return [f.clienteNombre, f.documento, f.numeroPoliza, f.tipoRiesgo, f.compania, f.telefono].some((valor) =>
        normalizar(valor).includes(texto),
      )
    })
  }, [datos, busqueda, sucursal])

  const guardar = async (id: number, campo: CampoDeRiesgo, valor: string) => {
    setEditando(null)
    const resultado = await window.dm.riesgos.editar(id, campo, valor)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    const actualizada = resultado.datos
    setDatos((previos) => (previos ? { ...previos, filas: previos.filas.map((f) => (f.id === actualizada.id ? actualizada : f)) } : previos))
    setError(null)
  }

  if (cargando || !datos) return <Cargando />

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Titular, DNI, póliza, riesgo o teléfono…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <select
          value={sucursal}
          onChange={(evento) => setSucursal(evento.target.value)}
          aria-label="Sucursal"
          className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
        >
          <option value="">Todas las sucursales</option>
          {datos.sucursales.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500">
          {filtradas.length.toLocaleString('es-AR')} de {datos.total.toLocaleString('es-AR')} riesgos
        </span>
        {puedeEditar && (
          <Boton variante="primario" icono="mas" onClick={() => setAltaAbierta(true)} className="ml-auto">
            Nuevo riesgo
          </Boton>
        )}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {datos.avisoDeSincronizacion && <Alerta tono="aviso">{datos.avisoDeSincronizacion}</Alerta>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={cx(encabezado, 'w-10')} aria-label="Cobro" />
              {COLUMNAS.map((columna) => (
                <th key={columna.campo} className={cx(encabezado, columna.ancho)}>
                  {columna.titulo}
                </th>
              ))}
              <th className={cx(encabezado, 'w-12')} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={COLUMNAS.length + 2} className="px-3 py-10 text-center text-slate-500">
                  {datos.total === 0
                    ? 'Todavía no hay riesgos varios. Se cargan con «Nuevo riesgo» y también entran con la pestaña RIESGOS VARIOS de la base.'
                    : 'Ningún riesgo coincide con la búsqueda.'}
                </td>
              </tr>
            )}
            {filtradas.map((fila) => (
              <tr key={fila.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                <td className="px-3 py-2">
                  {/* El mismo azul de la planilla: TARJETA y CBU se cobran solos, no hay que perseguirlos. */}
                  {esDebitoAutomatico(fila.formaPago) && (
                    <span
                      title={`Se cobra solo por ${fila.formaPago}`}
                      className="inline-flex h-2.5 w-2.5 rounded-full bg-sky-500"
                      aria-label="Débito automático"
                    />
                  )}
                </td>
                {COLUMNAS.map((columna) => (
                  <td key={columna.campo} className={cx('px-3 py-2 text-slate-700', columna.clase)}>
                    <Celda
                      fila={fila}
                      campo={columna.campo}
                      opciones={columna.opciones?.(datos)}
                      editando={editando?.id === fila.id && editando.campo === columna.campo}
                      soloLectura={!puedeEditar}
                      alEditar={() => setEditando({ id: fila.id, campo: columna.campo })}
                      alCancelar={() => setEditando(null)}
                      alGuardar={(valor) => void guardar(fila.id, columna.campo, valor)}
                    />
                  </td>
                ))}
                <td className="px-3 py-2 text-right">
                  <BotonEliminar tipo="riesgo" id={fila.id} etiqueta={false} alBorrar={() => void cargar()} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">Doble clic en una celda para corregirla. Cada cambio queda en el historial y sube a la base.</p>

      {altaAbierta && (
        <DialogoNuevoRiesgo
          catalogos={datos}
          alCerrar={() => setAltaAbierta(false)}
          alCrear={(listado) => {
            setDatos(listado)
            setAltaAbierta(false)
          }}
        />
      )}
    </div>
  )
}

function Celda({
  fila,
  campo,
  opciones,
  editando,
  soloLectura,
  alEditar,
  alCancelar,
  alGuardar,
}: {
  fila: FilaRiesgoVario
  campo: CampoDeRiesgo
  opciones?: string[]
  editando: boolean
  soloLectura: boolean
  alEditar: () => void
  alCancelar: () => void
  alGuardar: (valor: string) => void
}) {
  const valor = (fila[campo] as string | null) ?? ''
  const idLista = `riesgos-${campo}`

  if (!editando) {
    return (
      <span
        onDoubleClick={soloLectura ? undefined : alEditar}
        title={valor || (soloLectura ? undefined : 'Doble clic para cargar')}
        className={cx('block w-full truncate', !soloLectura && 'cursor-text')}
      >
        {valor || <span className="text-slate-300">—</span>}
      </span>
    )
  }

  return (
    <>
      <input
        autoFocus
        defaultValue={valor}
        list={opciones && opciones.length > 0 ? idLista : undefined}
        onBlur={(evento) => alGuardar(evento.currentTarget.value)}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter') alGuardar(evento.currentTarget.value)
          if (evento.key === 'Escape') alCancelar()
        }}
        className="w-full rounded border border-marino-400 bg-white px-1 py-0.5 text-sm outline-none ring-2 ring-marino-500/30"
      />
      {opciones && opciones.length > 0 && (
        <datalist id={idLista}>
          {opciones.map((opcion) => (
            <option key={opcion} value={opcion} />
          ))}
        </datalist>
      )}
    </>
  )
}
