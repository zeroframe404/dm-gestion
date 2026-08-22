// Módulo Clientes: el listado de toda la cartera y la ficha de una persona, en la misma pantalla.
//
// El listado NO se desmonta cuando se abre una ficha: queda escondido con `hidden`. Quien atiende el
// teléfono busca una vez y abre tres o cuatro fichas seguidas desde esa misma búsqueda; si al volver
// perdiera el filtro y la posición de la tabla tendría que buscar de nuevo cada vez. Son 2.100 filas
// virtualizadas, así que dejarlas montadas no cuesta nada.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilaCliente, FiltrosClientes, ListadoClientes } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx, Etiqueta } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { TablaVirtual, type ColumnaTabla } from '../../componentes/TablaVirtual'
import { DialogoNuevoCliente } from './DialogoNuevoCliente'
import { FichaDelCliente } from './FichaCliente'

const FILTROS_VACIOS: FiltrosClientes = { busqueda: '', sucursal: '', compania: '', deuda: '' }

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
  const [texto, setTexto] = useState(busquedaInicial)
  const [filtros, setFiltros] = useState<FiltrosClientes>({ ...FILTROS_VACIOS, busqueda: busquedaInicial })
  const [datos, setDatos] = useState<ListadoClientes | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)

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

  const hayFiltros = Boolean(filtros.busqueda || filtros.sucursal || filtros.compania || filtros.deuda)

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
      titulo: 'Deuda',
      ancho: 140,
      celda: (fila) =>
        fila.conDeuda ? (
          <Etiqueta tono="peligro">Con deuda</Etiqueta>
        ) : fila.polizasActivas > 0 ? (
          <Etiqueta tono="exito">Al día</Etiqueta>
        ) : (
          // Sin pólizas activas no hay cuota que deber: decir «al día» sería mentirle a quien mira.
          <Etiqueta tono="neutro">Sin pólizas</Etiqueta>
        ),
    },
  ]

  const conDeuda = datos?.filas.filter((fila) => fila.conDeuda).length ?? 0

  return (
    <div className={cx('flex min-h-0 flex-1 flex-col gap-3 p-6', oculto && 'hidden')} aria-hidden={oculto || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Contador etiqueta="Clientes" valor={datos?.total ?? 0} />
        <Contador etiqueta="Con deuda" valor={conDeuda} tono="rojo" titulo="De los que se están viendo: tienen alguna cuota del mes abierto sin pagar y sin débito automático." />
        <div className="ml-auto flex items-center gap-2">
          <Boton icono="cargando" onClick={() => void cargar(filtros)} disabled={cargando}>
            Actualizar
          </Boton>
          <Boton variante="primario" icono="mas" onClick={() => setDialogoAbierto(true)}>
            Nuevo cliente
          </Boton>
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
        <select
          value={filtros.deuda}
          onChange={(evento) => setFiltros((previos) => ({ ...previos, deuda: evento.target.value as FiltrosClientes['deuda'] }))}
          aria-label="Deuda"
          className={cx(
            'h-9 rounded-lg border bg-white px-2 text-sm',
            filtros.deuda ? 'border-marino-400 font-semibold text-marino-800' : 'border-slate-300 text-slate-700',
          )}
        >
          <option value="">Deuda: todos</option>
          <option value="con">Sólo con deuda</option>
          <option value="sin">Sólo al día</option>
        </select>
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

function Contador({ etiqueta, valor, tono = 'neutro', titulo }: { etiqueta: string; valor: number; tono?: 'neutro' | 'rojo'; titulo?: string }) {
  const clases = tono === 'rojo' ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-900'
  return (
    <div title={titulo} className={cx('rounded-lg border px-3 py-1.5', clases)}>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="ml-2 font-display text-lg font-extrabold tabular-nums">{valor.toLocaleString('es-AR')}</span>
    </div>
  )
}

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
