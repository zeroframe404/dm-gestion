// «Buscar clientes»: el diálogo que arma la lista de a quién hay que cobrarle, acotada como se acota
// en el mostrador —Todos/Vencidos/Pagos arriba de todo, y después sucursal, compañía, forma de pago y
// los días del mes que se tilden— y lista para exportar a Excel o a un .txt.
//
// Los días se tildan de a uno y en cualquier orden («los que vencen el 1, el 3 y el 5»), que es la
// razón de ser de esta pantalla: eso no se puede pedir con un desplegable ni con un rango de fechas.
// Cada día muestra cuántas deudas tiene, así se tilda sabiendo dónde hay algo.
//
// Una fila es una CUOTA impaga, no una persona: quien tiene dos pólizas atrasadas debe dos veces y
// hay que cobrarle las dos. Arriba se dice cuántas personas distintas son.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import {
  DEUDORES_SIN_FILTROS,
  type FilaDeudor,
  type FiltroEstadoDeDeuda,
  type FiltrosDeudores,
  type FormatoDeDeudores,
  type ListadoDeudores,
} from '../../../shared/tipos'
import { TablaVirtual, type ColumnaTabla } from '../../componentes/TablaVirtual'
import { NOMBRE_RAMA, type Rama } from '../../../shared/ramas'
import { Alerta, Boton, Cargando, cx, Dialogo } from '../../componentes/ui'
import { pesos } from '../cobranzas/formato'

const DIAS_DEL_MES = Array.from({ length: 31 }, (_, i) => i + 1)

export function DialogoDeudores({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const [filtros, setFiltros] = useState<FiltrosDeudores>(DEUDORES_SIN_FILTROS)
  const [datos, setDatos] = useState<ListadoDeudores | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState<FormatoDeDeudores | null>(null)
  // El primer resultado define el mes: se arranca por el mes abierto, que es lo que se está cobrando.
  const [mesElegido, setMesElegido] = useState(false)

  /**
   * Los filtros se cambian SIEMPRE a partir de los anteriores, nunca del valor que tenía el render.
   * Tildar dos días seguidos rápido entra en el mismo ciclo de React: calculando la lista nueva con
   * la de afuera, el segundo clic pisaba al primero y el día se perdía.
   */
  const cambiar = useCallback((cambios: Partial<FiltrosDeudores> | ((previos: FiltrosDeudores) => Partial<FiltrosDeudores>)) => {
    setAviso(null)
    setFiltros((previos) => ({ ...previos, ...(typeof cambios === 'function' ? cambios(previos) : cambios) }))
  }, [])

  // Al cerrar se olvida todo: la próxima vez se abre limpio, sobre el mes abierto.
  useEffect(() => {
    if (abierto) return
    setFiltros(DEUDORES_SIN_FILTROS)
    setDatos(null)
    setError(null)
    setAviso(null)
    setMesElegido(false)
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setCargando(true)
    const reloj = window.setTimeout(async () => {
      const resultado = await window.dm.clientes.deudores(filtros)
      if (!vigente) return
      if (!resultado.ok) {
        setError(resultado.error)
        setCargando(false)
        return
      }
      // La primera consulta es la que trae los meses que hay. Se arranca por el mes abierto —que es el
      // que se está cobrando— y recién ahí se pinta: si no, se vería un parpadeo con todos los meses.
      if (!mesElegido) {
        const abiertoAhora = resultado.datos.periodos.find((periodo) => periodo.esElActual)
        setMesElegido(true)
        if (abiertoAhora) {
          setFiltros((previos) => ({ ...previos, periodo: abiertoAhora.periodo }))
          return
        }
      }
      setDatos(resultado.datos)
      setError(null)
      setCargando(false)
    }, 150)
    return () => {
      vigente = false
      window.clearTimeout(reloj)
    }
  }, [abierto, filtros, mesElegido])

  async function exportar(formato: FormatoDeDeudores) {
    setExportando(formato)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.clientes.exportarDeudores(filtros, formato, null)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Guardado en ${resultado.datos.ruta}`)
    setExportando(null)
  }

  const columnas = useMemo<Array<ColumnaTabla<FilaDeudor>>>(() => {
    const columnas: Array<ColumnaTabla<FilaDeudor>> = [
      { id: 'nombre', titulo: 'Cliente', ancho: 210, fija: true, celda: (fila) => <span className="truncate font-medium text-slate-900">{fila.nombre ?? '—'}</span> },
      { id: 'documento', titulo: 'DNI/CUIT', ancho: 110, celda: (fila) => <span className="truncate tabular-nums">{fila.documento ?? '—'}</span> },
      { id: 'telefono', titulo: 'Teléfono', ancho: 120, celda: (fila) => <span className="truncate tabular-nums">{fila.telefono ?? '—'}</span> },
      { id: 'sucursal', titulo: 'Sucursal', ancho: 110, celda: (fila) => <span className="truncate">{fila.sucursal ?? '—'}</span> },
      { id: 'compania', titulo: 'Compañía', ancho: 140, celda: (fila) => <span className="truncate">{fila.compania ?? '—'}</span> },
      { id: 'poliza', titulo: 'Póliza', ancho: 110, celda: (fila) => <span className="truncate tabular-nums">{fila.numeroPoliza ?? '—'}</span> },
      { id: 'formaPago', titulo: 'Forma de pago', ancho: 120, celda: (fila) => <span className="truncate">{fila.formaPago ?? '—'}</span> },
      {
        id: 'dia',
        titulo: 'Día',
        ancho: 52,
        alinear: 'centro',
        celda: (fila) => (fila.diaVencimiento === null ? <span className="text-slate-400">—</span> : <span className="tabular-nums">{fila.diaVencimiento}</span>),
      },
      {
        id: 'cuota',
        titulo: 'Cuota',
        ancho: 110,
        alinear: 'derecha',
        celda: (fila) => <span className="tabular-nums">{fila.cuotaMonto === null ? (fila.cuota ?? '—') : pesos(fila.cuotaMonto)}</span>,
      },
      {
        id: 'estado',
        titulo: 'Estado',
        ancho: 140,
        celda: (fila) => (
          <span
            title={fila.vencimiento ? `Vence el ${fila.vencimiento}` : 'La fila no tiene día de vencimiento cargado'}
            className={cx('truncate text-xs font-semibold', fila.vencida ? 'text-red-700' : 'text-slate-500')}
          >
            {textoDelAtraso(fila)}
          </span>
        ),
      },
    ]
    // La columna del mes sólo tiene sentido mirando todos los meses: con un mes elegido, repetiría el
    // mismo valor en todas las filas y le robaría lugar al resto.
    if (!filtros.periodo) {
      columnas.push({ id: 'mes', titulo: 'Mes', ancho: 120, celda: (fila) => <span className="truncate text-slate-500">{nombreDePeriodo(fila.periodo)}</span> })
    }
    return columnas
  }, [filtros.periodo])

  const hayResultados = (datos?.filas.length ?? 0) > 0
  const porFormaDePago = filtros.formasDePago.length > 0
  // «Pagos» ya pide justamente las que se cobran solas: el checkbox de abajo queda de más.
  const incluidasPorOtroLado = porFormaDePago || filtros.estado === 'PAGOS'

  return (
    <Dialogo
      abierto={abierto}
      ancho="xl"
      titulo="Buscar clientes"
      descripcion="Todos, Pagos o Vencidos, y encima sucursal, compañía, forma de pago y los días del mes que quieras: aparecen las cuotas impagas que cumplen con todo eso, para llamar o para exportar."
      alCerrar={alCerrar}
      pie={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600" role="status">
            {datos ? (
              <>
                <strong className="font-semibold text-slate-800 tabular-nums">{datos.filas.length.toLocaleString('es-AR')}</strong>
                {datos.filas.length === 1 ? ' deuda' : ' deudas'} de{' '}
                <strong className="font-semibold text-slate-800 tabular-nums">{datos.clientes.toLocaleString('es-AR')}</strong>
                {datos.clientes === 1 ? ' cliente' : ' clientes'} · {pesos(datos.total)}
                {datos.sinImporte > 0 && ` · ${datos.sinImporte} sin importe`}
              </>
            ) : (
              'Buscando…'
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Boton icono="descargar" onClick={() => void exportar('txt')} cargando={exportando === 'txt'} disabled={!hayResultados || exportando !== null}>
              Exportar .txt
            </Boton>
            <Boton
              variante="primario"
              icono="descargar"
              onClick={() => void exportar('xlsx')}
              cargando={exportando === 'xlsx'}
              disabled={!hayResultados || exportando !== null}
            >
              Exportar .xlsx
            </Boton>
            <Boton variante="fantasma" onClick={alCerrar}>
              Cerrar
            </Boton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleDeEstado valor={filtros.estado} alCambiar={(v) => cambiar({ estado: v })} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="font-medium">Mes</span>
            <select
              value={filtros.periodo}
              onChange={(evento) => cambiar({ periodo: evento.target.value })}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800"
            >
              <option value="">Todos los meses</option>
              {(datos?.periodos ?? []).map((periodo) => (
                <option key={periodo.periodo} value={periodo.periodo}>
                  {nombreDePeriodo(periodo.periodo)}
                  {periodo.esElActual ? ' (abierto)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label
            className={cx('flex items-center gap-2 text-sm', incluidasPorOtroLado ? 'text-slate-400' : 'text-slate-700')}
            title={
              porFormaDePago
                ? 'No hace falta: al tildar una forma de pago se busca exactamente ésa, se cobre sola o no.'
                : filtros.estado === 'PAGOS'
                  ? 'No hace falta: «Pagos» ya pide justamente las que se cobran solas.'
                  : 'Débito automático, CBU y tarjeta se cobran solos: por eso no cuentan como deuda salvo que se pidan.'
            }
          >
            <input
              type="checkbox"
              checked={incluidasPorOtroLado || filtros.incluirDebito}
              disabled={incluidasPorOtroLado}
              onChange={(evento) => cambiar({ incluirDebito: evento.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-marino-700 focus:ring-marino-500/40"
            />
            Incluir las que se cobran solas
          </label>
          {(filtros.estado !== '' ||
            filtros.sucursales.length > 0 ||
            filtros.companias.length > 0 ||
            porFormaDePago ||
            filtros.ramas.length > 0 ||
            filtros.dias.length > 0) && (
            <Boton
              tamano="sm"
              variante="fantasma"
              icono="cerrar"
              onClick={() => cambiar({ estado: '', sucursales: [], companias: [], formasDePago: [], ramas: [], dias: [], incluirDebito: false })}
            >
              Limpiar filtros
            </Boton>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <GrupoDeChips
            etiqueta="Sucursal"
            opciones={datos?.sucursales ?? []}
            elegidas={filtros.sucursales}
            alAlternar={(valor) => cambiar((previos) => ({ sucursales: alternar(previos.sucursales, valor) }))}
          />
          <GrupoDeChips
            etiqueta="Compañía"
            opciones={datos?.companias ?? []}
            elegidas={filtros.companias}
            alAlternar={(valor) => cambiar((previos) => ({ companias: alternar(previos.companias, valor) }))}
          />
          <GrupoDeChips
            etiqueta="Forma de pago"
            opciones={datos?.formasDePago ?? []}
            elegidas={filtros.formasDePago}
            alAlternar={(valor) => cambiar((previos) => ({ formasDePago: alternar(previos.formasDePago, valor) }))}
          />
          {/* La rama sale del tipo del vehículo y de la categoría del catálogo: una pick up cargada
              desde «Nueva póliza» entra en «Pick up» aunque su tipo diga AUTO. Ver src/shared/ramas.ts. */}
          <GrupoDeChips
            etiqueta="Rama"
            opciones={datos?.ramas ?? []}
            elegidas={filtros.ramas}
            textoDe={(valor) => NOMBRE_RAMA[valor as Rama] ?? valor}
            alAlternar={(valor) => cambiar((previos) => ({ ramas: alternar(previos.ramas, valor) }))}
          />
        </div>

        <fieldset className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <legend className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">Días de vencimiento</legend>
            <span className="text-xs text-slate-500">
              {filtros.dias.length === 0 ? 'Sin tildar ninguno entran todos los días.' : `Tildados: ${filtros.dias.join(', ')}`}
            </span>
            <div className="ml-auto flex gap-1">
              <Boton tamano="sm" variante="fantasma" onClick={() => cambiar({ dias: [] })} disabled={filtros.dias.length === 0}>
                Ninguno
              </Boton>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1">
            {DIAS_DEL_MES.map((dia) => {
              const cuantas = datos?.porDia[dia] ?? 0
              const tildado = filtros.dias.includes(dia)
              return (
                <button
                  key={dia}
                  type="button"
                  aria-pressed={tildado}
                  // Con el número y el contador uno debajo del otro, el texto del botón se lee «101»:
                  // el nombre accesible tiene que decirlo aparte.
                  aria-label={`Día ${dia}: ${cuantas === 1 ? '1 deuda' : `${cuantas} deudas`}`}
                  title={cuantas === 1 ? '1 deuda vence ese día' : `${cuantas} deudas vencen ese día`}
                  onClick={() => cambiar((previos) => ({ dias: alternar(previos.dias, dia).sort((a, b) => a - b) }))}
                  className={cx(
                    'flex h-11 flex-col items-center justify-center rounded-md border text-sm font-semibold transition-colors',
                    tildado
                      ? 'border-marino-500 bg-marino-700 text-white'
                      : cuantas > 0
                        ? 'border-slate-300 bg-white text-slate-700 hover:border-marino-300 hover:bg-marino-50'
                        : 'border-slate-200 bg-white text-slate-300 hover:border-slate-300',
                  )}
                >
                  <span className="tabular-nums leading-none">{dia}</span>
                  <span className={cx('text-[10px] font-medium leading-none', tildado ? 'text-cielo-100' : 'text-slate-400')}>{cuantas}</span>
                </button>
              )
            })}
          </div>
          {(datos?.sinDia ?? 0) > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              {datos!.sinDia} deuda(s) sin día de vencimiento cargado en la planilla: con días tildados quedan afuera.
            </p>
          )}
        </fieldset>

        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}

        {!datos && cargando ? (
          <Cargando texto="Buscando deudores…" />
        ) : (
          <div className="flex h-[38vh] min-h-56 flex-col">
            <TablaVirtual
              filas={datos?.filas ?? []}
              columnas={columnas}
              claveDe={(fila) => fila.filaId}
              vacio={
                <>
                  <p className="font-medium text-slate-700">Ninguna cuota impaga cumple con eso.</p>
                  <p className="mt-1">Probá con menos días tildados, con otra compañía o mirando todos los meses.</p>
                </>
              }
            />
          </div>
        )}
      </div>
    </Dialogo>
  )
}

const OPCIONES_DE_ESTADO: Array<{ valor: FiltroEstadoDeDeuda; etiqueta: string; ayuda: string }> = [
  { valor: '', etiqueta: 'Todos', ayuda: 'Todas las cuotas impagas, sin importar cómo se cobren.' },
  {
    valor: 'VENCIDOS',
    etiqueta: 'Vencidos',
    ayuda: 'Sólo las que ya pasaron su fecha de vencimiento.',
  },
  {
    valor: 'PAGOS',
    etiqueta: 'Pagos',
    ayuda: 'Las que se cobran solas (débito, CBU, tarjeta, Mercado Pago): no hace falta llamarlas.',
  },
]

/** TODOS | PAGOS | VENCIDOS: el filtro rápido de arriba de todo, uno tildado a la vez. */
function ToggleDeEstado({ valor, alCambiar }: { valor: FiltroEstadoDeDeuda; alCambiar: (valor: FiltroEstadoDeDeuda) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1" role="group" aria-label="Estado de la deuda">
      {OPCIONES_DE_ESTADO.map((opcion) => {
        const elegido = valor === opcion.valor
        return (
          <button
            key={opcion.valor || 'todos'}
            type="button"
            aria-pressed={elegido}
            title={opcion.ayuda}
            onClick={() => alCambiar(opcion.valor)}
            className={cx(
              'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
              elegido ? 'bg-marino-700 text-white shadow-marca' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            {opcion.etiqueta}
          </button>
        )
      })}
    </div>
  )
}

function textoDelAtraso(fila: FilaDeudor): string {
  if (fila.diasDeAtraso === null) return 'Sin vencimiento'
  if (fila.diasDeAtraso > 0) return `Vencida hace ${fila.diasDeAtraso} ${fila.diasDeAtraso === 1 ? 'día' : 'días'}`
  if (fila.diasDeAtraso === 0) return 'Vence hoy'
  return `Vence en ${-fila.diasDeAtraso} ${fila.diasDeAtraso === -1 ? 'día' : 'días'}`
}

/** Agrega o saca un valor de una lista de tildados. */
function alternar<T>(lista: T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((otro) => otro !== valor) : [...lista, valor]
}

/** Un grupo de valores que se tildan de a varios: sin ninguno tildado entran todos. */
function GrupoDeChips({
  etiqueta,
  opciones,
  elegidas,
  textoDe,
  alAlternar,
}: {
  etiqueta: string
  opciones: string[]
  elegidas: string[]
  /** Cómo se lee la opción, cuando el valor guardado no es lo que se muestra («PICK UP» → «Pick up»). */
  textoDe?: (opcion: string) => string
  alAlternar: (opcion: string) => void
}) {
  return (
    <fieldset className="rounded-lg border border-slate-200 bg-white p-2">
      <legend className="px-1 text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{etiqueta}</legend>
      {opciones.length === 0 ? (
        <p className="px-1 py-2 text-xs text-slate-400">Sin valores para elegir.</p>
      ) : (
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto p-1">
          {opciones.map((opcion) => {
            const tildada = elegidas.includes(opcion)
            return (
              <button
                key={opcion}
                type="button"
                aria-pressed={tildada}
                onClick={() => alAlternar(opcion)}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                  tildada
                    ? 'border-marino-500 bg-marino-700 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-marino-300 hover:bg-marino-50',
                )}
              >
                {textoDe ? textoDe(opcion) : opcion}
              </button>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
