// Módulo Clientes: el listado de toda la cartera y la ficha de una persona, en la misma pantalla.
//
// El listado NO se desmonta cuando se abre una ficha: queda escondido con `hidden`. Quien atiende el
// teléfono busca una vez y abre tres o cuatro fichas seguidas desde esa misma búsqueda; si al volver
// perdiera el filtro y la posición de la tabla tendría que buscar de nuevo cada vez. Son 2.100 filas
// virtualizadas, así que dejarlas montadas no cuesta nada.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilaCliente, FiltroEstadoCliente, FiltrosClientes, ListadoClientes, ResumenDeClientes } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx, Etiqueta } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { useNavegacion } from '../../contexto/Navegacion'
import { usePuedeEditar } from '../../contexto/Permisos'
import { TablaVirtual, type ColumnaTabla } from '../../componentes/TablaVirtual'
import { DialogoDeudores } from './DialogoDeudores'
import { DialogoNuevoCliente } from './DialogoNuevoCliente'
import { FichaDelCliente } from './FichaCliente'

const FILTROS_VACIOS: FiltrosClientes = { busqueda: '', sucursal: '', compania: '', estado: '' }

/**
 * Las vistas de la cartera, en el orden en que se miran: primero cuántos hay, después quiénes están
 * al día, quiénes deben y quiénes se fueron. «Sin pólizas» sólo aparece si hay alguno: son altas a
 * las que todavía no se les cargó la primera póliza, y en una cartera normal no hay ninguno.
 */
const ESTADOS: Array<{ id: FiltroEstadoCliente; etiqueta: string; ayuda: string; contar: (resumen: ResumenDeClientes) => number }> = [
  { id: '', etiqueta: 'Todos', ayuda: 'Toda la cartera, con la búsqueda y los filtros puestos.', contar: (r) => r.todos },
  {
    id: 'activos-sin-deuda',
    etiqueta: 'Activos sin deuda',
    ayuda: 'Tienen alguna póliza activa y ninguna cuota del mes abierto sin pagar.',
    contar: (r) => r.activosSinDeuda,
  },
  {
    id: 'activos-con-deuda',
    etiqueta: 'Activos con deuda',
    ayuda: 'Tienen alguna cuota del mes abierto sin pagar que no se cobra sola (no cuentan débito, CBU ni tarjeta).',
    contar: (r) => r.activosConDeuda,
  },
  { id: 'bajas', etiqueta: 'Bajas', ayuda: 'Tuvieron pólizas y no les queda ninguna activa.', contar: (r) => r.bajas },
  {
    id: 'sin-polizas',
    etiqueta: 'Sin pólizas',
    ayuda: 'Están dados de alta pero todavía no tienen ninguna póliza cargada.',
    contar: (r) => r.sinPolizas,
  },
]

const RESUMEN_VACIO: ResumenDeClientes = { todos: 0, activosSinDeuda: 0, activosConDeuda: 0, bajas: 0, sinPolizas: 0 }

/** Cuánto se espera después de la última tecla antes de pedirle el listado al proceso principal. */
const RETARDO_BUSQUEDA = 250

export function Clientes() {
  const { parametros, limpiarParametros } = useNavegacion()
  const [clienteAbierto, setClienteAbierto] = useState<number | null>(null)
  const [busquedaInicial, setBusquedaInicial] = useState('')

  // Otro módulo puede abrir directamente la ficha de alguien (`ir('clientes', { clienteId })`).
  // Los parámetros son de un solo uso: se consumen acá y se limpian, así volver a la solapa Clientes
  // más tarde no vuelve a abrir la misma ficha.
  useEffect(() => {
    if (parametros.clienteId === undefined && parametros.busqueda === undefined) return
    if (parametros.clienteId !== undefined) setClienteAbierto(parametros.clienteId)
    if (parametros.busqueda !== undefined) setBusquedaInicial(parametros.busqueda)
    limpiarParametros()
  }, [parametros.clienteId, parametros.busqueda, limpiarParametros])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListadoDeClientes
        oculto={clienteAbierto !== null}
        busquedaInicial={busquedaInicial}
        alAbrirCliente={(id) => setClienteAbierto(id)}
      />
      {clienteAbierto !== null && (
        <FichaDelCliente
          // La clave fuerza a rearmar la ficha al saltar de un cliente a otro: si no, quedaría el
          // formulario de Datos del anterior mientras llega la ficha nueva.
          key={clienteAbierto}
          clienteId={clienteAbierto}
          alVolver={() => setClienteAbierto(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

function ListadoDeClientes({
  oculto,
  busquedaInicial,
  alAbrirCliente,
}: {
  oculto: boolean
  busquedaInicial: string
  alAbrirCliente: (clienteId: number) => void
}) {
  const puedeEditar = usePuedeEditar('clientes')
  const [texto, setTexto] = useState(busquedaInicial)
  const [filtros, setFiltros] = useState<FiltrosClientes>({ ...FILTROS_VACIOS, busqueda: busquedaInicial })
  const [datos, setDatos] = useState<ListadoClientes | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [deudoresAbierto, setDeudoresAbierto] = useState(false)

  // Si otro módulo manda una búsqueda ya empezada, se refleja en el cuadro y dispara la consulta.
  useEffect(() => {
    if (!busquedaInicial) return
    setTexto(busquedaInicial)
    setFiltros((previos) => ({ ...previos, busqueda: busquedaInicial }))
  }, [busquedaInicial])

  // El buscador filtra en el proceso principal (son 2.100 clientes y sus pólizas), así que se espera
  // un cuarto de segundo desde la última tecla: escribir «rodriguez» dispara una consulta, no nueve.
  useEffect(() => {
    if (texto === filtros.busqueda) return
    const temporizador = window.setTimeout(() => setFiltros((previos) => ({ ...previos, busqueda: texto })), RETARDO_BUSQUEDA)
    return () => window.clearTimeout(temporizador)
  }, [texto, filtros.busqueda])

  // Las respuestas pueden llegar desordenadas (una búsqueda corta tarda más que la larga que la
  // siguió): sólo se acepta la del último pedido.
  const pedido = useRef(0)

  const cargar = useCallback(async (aplicar: FiltrosClientes) => {
    const mio = ++pedido.current
    setCargando(true)
    const resultado = await window.dm.clientes.listar(aplicar)
    if (mio !== pedido.current) return
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    // Cambiar la búsqueda o un filtro es empezar otra cosa: el aviso de la última alta ya no aplica.
    setAviso(null)
    void cargar(filtros)
  }, [cargar, filtros])

  const hayFiltros = Boolean(filtros.busqueda || filtros.sucursal || filtros.compania || filtros.estado)

  const columnas: Array<ColumnaTabla<FilaCliente>> = [
    {
      id: 'nombre',
      titulo: 'Nombre y apellido',
      ancho: 280,
      fija: true,
      celda: (fila) => (
        // Botón de verdad además de la fila clicable: así se llega con el teclado, que es como
        // trabaja quien tiene una mano en el teléfono.
        <button
          type="button"
          onClick={(evento) => {
            evento.stopPropagation()
            alAbrirCliente(fila.id)
          }}
          title={`Abrir la ficha de ${fila.nombre}`}
          className="block w-full truncate text-left font-medium text-slate-900 hover:text-marino-700 focus-visible:outline-none focus-visible:underline"
        >
          {fila.nombre}
        </button>
      ),
    },
    { id: 'documento', titulo: 'DNI/CUIT', ancho: 130, celda: (fila) => <span className="truncate tabular-nums">{fila.documento ?? '—'}</span> },
    { id: 'telefono', titulo: 'Teléfono', ancho: 140, celda: (fila) => <span className="truncate tabular-nums">{fila.telefono ?? '—'}</span> },
    { id: 'sucursal', titulo: 'Sucursal', ancho: 150, celda: (fila) => <span className="truncate">{fila.sucursal ?? '—'}</span> },
    {
      id: 'polizas',
      titulo: 'Pólizas activas',
      ancho: 110,
      alinear: 'centro',
      celda: (fila) => <span className={cx('tabular-nums', fila.polizasActivas === 0 && 'text-slate-400')}>{fila.polizasActivas}</span>,
    },
    {
      id: 'vehiculos',
      titulo: 'Vehículos',
      ancho: 100,
      alinear: 'centro',
      celda: (fila) => <span className={cx('tabular-nums', fila.vehiculos === 0 && 'text-slate-400')}>{fila.vehiculos}</span>,
    },
    {
      id: 'deuda',
      titulo: 'Estado',
      ancho: 140,
      celda: (fila) =>
        // Sin pólizas activas no hay cuota que deber: decir «al día» sería mentirle a quien mira, y
        // el que se fue no es lo mismo que el que todavía no tiene nada cargado.
        fila.estado === 'BAJA' ? (
          <Etiqueta tono="neutro">Baja</Etiqueta>
        ) : fila.estado === 'SIN POLIZAS' ? (
          <Etiqueta tono="neutro">Sin pólizas</Etiqueta>
        ) : fila.conDeuda ? (
          <Etiqueta tono="peligro">Con deuda</Etiqueta>
        ) : (
          <Etiqueta tono="exito">Al día</Etiqueta>
        ),
    },
  ]

  const resumen = datos?.resumen ?? RESUMEN_VACIO

  return (
    <div className={cx('flex min-h-0 flex-1 flex-col gap-3 p-6', oculto && 'hidden')} aria-hidden={oculto || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Estado del cliente">
          {ESTADOS.map((estado) => {
            if (estado.id === 'sin-polizas' && resumen.sinPolizas === 0 && filtros.estado !== 'sin-polizas') return null
            const elegido = filtros.estado === estado.id
            const cuantos = estado.contar(resumen)
            return (
              <button
                key={estado.id || 'todos'}
                type="button"
                aria-pressed={elegido}
                // El nombre y el número van en dos renglones: el nombre accesible los junta.
                aria-label={`${estado.etiqueta}: ${cuantos}`}
                title={estado.ayuda}
                onClick={() => setFiltros((previos) => ({ ...previos, estado: estado.id }))}
                className={cx(
                  'rounded-lg border px-3 py-1.5 text-left transition-colors',
                  elegido ? 'border-marino-500 bg-marino-700 text-white shadow-marca' : 'border-slate-200 bg-white text-slate-700 hover:border-marino-300 hover:bg-marino-50',
                )}
              >
                <span className={cx('text-[11px] font-bold uppercase tracking-[0.12em]', elegido ? 'text-cielo-100' : 'text-slate-500')}>
                  {estado.etiqueta}
                </span>
                <span className="ml-2 font-display text-lg font-extrabold tabular-nums">{cuantos.toLocaleString('es-AR')}</span>
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Boton icono="cargando" onClick={() => void cargar(filtros)} disabled={cargando}>
            Actualizar
          </Boton>
          <Boton icono="lupa" onClick={() => setDeudoresAbierto(true)} title="Buscar deudores por sucursal, compañía, forma de pago y día de vencimiento">
            Buscar deudores
          </Boton>
          {puedeEditar && (
            <Boton variante="primario" icono="mas" onClick={() => setDialogoAbierto(true)}>
              Nuevo cliente
            </Boton>
          )}
          <BotonAyuda clave="clientes" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            aria-label="Buscar clientes"
            placeholder="Buscar por nombre, DNI, patente, póliza o teléfono…"
            className="h-9 w-96 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25"
          />
        </div>
        <FiltroDesplegable
          etiqueta="Sucursal"
          valor={filtros.sucursal}
          opciones={datos?.sucursales ?? []}
          alCambiar={(valor) => setFiltros((previos) => ({ ...previos, sucursal: valor }))}
        />
        <FiltroDesplegable
          etiqueta="Compañía"
          valor={filtros.compania}
          opciones={datos?.companias ?? []}
          alCambiar={(valor) => setFiltros((previos) => ({ ...previos, compania: valor }))}
        />
        {hayFiltros && (
          <Boton
            tamano="sm"
            variante="fantasma"
            icono="cerrar"
            onClick={() => {
              setTexto('')
              setFiltros(FILTROS_VACIOS)
            }}
          >
            Limpiar
          </Boton>
        )}
        <span className="ml-auto text-sm text-slate-500" role="status">
          {cargando && !datos ? (
            'Buscando…'
          ) : datos ? (
            <>
              <strong className="font-semibold text-slate-700 tabular-nums">{datos.filas.length.toLocaleString('es-AR')}</strong>
              {datos.filas.length === 1 ? ' cliente' : ' clientes'} de {datos.total.toLocaleString('es-AR')}
              {cargando && ' · actualizando…'}
            </>
          ) : null}
        </span>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      {cargando && !datos ? (
        <Cargando texto="Buscando clientes…" />
      ) : (
        <TablaVirtual
          filas={datos?.filas ?? []}
          columnas={columnas}
          claveDe={(fila) => String(fila.id)}
          alHacerClic={(fila) => alAbrirCliente(fila.id)}
          vacio={
            hayFiltros ? (
              <>
                <p className="font-medium text-slate-700">Ningún cliente coincide con lo que buscaste.</p>
                <p className="mt-1">
                  Probá con el apellido solo, con el DNI sin puntos o con la patente sin guiones, o limpiá los filtros para ver la cartera entera.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-700">Todavía no hay clientes cargados.</p>
                <p className="mt-1">
                  Se cargan solos al traer la hoja desde <strong className="font-semibold">Administración → Importar desde Google</strong>, o de a uno con
                  «Nuevo cliente».
                </p>
              </>
            )
          }
        />
      )}

      <DialogoDeudores abierto={deudoresAbierto} alCerrar={() => setDeudoresAbierto(false)} />

      <DialogoNuevoCliente
        abierto={dialogoAbierto}
        alCerrar={() => setDialogoAbierto(false)}
        alCrear={(cliente) => {
          setDialogoAbierto(false)
          setAviso(`${cliente.nombre} quedó dado de alta. Cargale la primera póliza desde su ficha.`)
          void cargar(filtros)
          alAbrirCliente(cliente.id)
        }}
        alAbrirExistente={(clienteId) => {
          setDialogoAbierto(false)
          alAbrirCliente(clienteId)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function FiltroDesplegable({
  etiqueta,
  valor,
  opciones,
  alCambiar,
}: {
  etiqueta: string
  valor: string
  opciones: string[]
  alCambiar: (valor: string) => void
}) {
  return (
    <select
      value={valor}
      onChange={(evento) => alCambiar(evento.target.value)}
      aria-label={etiqueta}
      className={cx(
        'h-9 max-w-52 rounded-lg border bg-white px-2 text-sm',
        valor ? 'border-marino-400 font-semibold text-marino-800' : 'border-slate-300 text-slate-700',
      )}
    >
      <option value="">{etiqueta}: todas</option>
      {opciones.map((opcion) => (
        <option key={opcion} value={opcion}>
          {opcion}
        </option>
      ))}
    </select>
  )
}
