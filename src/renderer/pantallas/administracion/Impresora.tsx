// Impresora: la ticketeadora térmica de 80 mm (POS-80) del mostrador. Es opcional; si no está
// configurada, cobrar funciona igual y no se imprime nada.
//
// La pantalla la abre cualquiera, con el rol que sea: la impresora es la que tiene esta PC delante y
// quien cobra es quien necesita apagarla, cambiarla o dejar de gastar papel sin esperar a nadie.
import { useCallback, useEffect, useState } from 'react'
import type { ConfigImpresora, DireccionDeSucursal } from '../../../shared/tipos'
import { Alerta, Boton, Campo, Cargando, Selector, Tarjeta, cx } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'

export function Impresora() {
  const [estado, setEstado] = useState<ConfigImpresora | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [habilitada, setHabilitada] = useState(false)
  const [preguntar, setPreguntar] = useState(true)
  const [impresora, setImpresora] = useState('')
  const [anchoMm, setAnchoMm] = useState('80')
  const [copias, setCopias] = useState(1)

  const aplicar = useCallback((config: ConfigImpresora) => {
    setEstado(config)
    setHabilitada(config.habilitada)
    setPreguntar(config.preguntar)
    setImpresora(config.impresora ?? config.predeterminada ?? '')
    setAnchoMm(String(config.anchoMm))
    setCopias(config.copias)
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await window.dm.impresora.estado()
    if (resultado.ok) aplicar(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [aplicar])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.impresora.guardar({ habilitada, preguntar, impresora, anchoMm: Number(anchoMm), copias })
    setGuardando(false)
    if (resultado.ok) {
      aplicar(resultado.datos)
      if (!habilitada) setAviso('El ticket quedó desactivado.')
      else if (preguntar) setAviso('Listo: cada pago va a preguntar si imprimir el comprobante.')
      else setAviso('Listo: cada pago que registres va a imprimir su comprobante.')
    } else {
      setError(resultado.error)
    }
  }

  /**
   * La prueba usa la configuración GUARDADA, no la del formulario: por eso el botón está apagado
   * mientras haya cambios sin guardar. Al terminar sólo se refresca el estado —para traer el último
   * error—, sin volver a escribir los campos, que pisaría lo que la persona esté editando.
   */
  const probar = async () => {
    setProbando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.impresora.prueba()
    if (resultado.ok) setAviso('Se mandó un comprobante de prueba a la impresora.')
    else setError(resultado.error)
    const refrescado = await window.dm.impresora.estado()
    if (refrescado.ok) setEstado(refrescado.datos)
    setProbando(false)
  }

  if (cargando && !estado) return <Cargando />
  if (!estado) return <div>{error && <Alerta tono="error">{error}</Alerta>}</div>

  const sinImpresoras = estado.disponibles.length === 0
  const hayCambios =
    habilitada !== estado.habilitada ||
    preguntar !== estado.preguntar ||
    impresora !== (estado.impresora ?? '') ||
    Number(anchoMm) !== estado.anchoMm ||
    copias !== estado.copias

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {estado.ultimoError && (
        <Alerta tono="aviso">
          El último ticket no se pudo imprimir: {estado.ultimoError}. El pago se guardó igual; el comprobante es lo único que falló.
        </Alerta>
      )}

      <Tarjeta
        titulo="Ticketeadora térmica"
        descripcion="Si esta PC tiene una impresora térmica de 80 mm, al registrar un pago puede salir el comprobante. Es opcional: sin configurar, cobrar funciona igual."
        acciones={
          <>
            <Boton
              icono="impresora"
              onClick={() => void probar()}
              cargando={probando}
              disabled={!estado.habilitada || !estado.impresora || hayCambios}
              title={hayCambios ? 'Guardá los cambios antes de probar: la prueba usa la configuración guardada.' : undefined}
            >
              Imprimir una prueba
            </Boton>
            <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!hayCambios}>
              Guardar
            </Boton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <input
              type="checkbox"
              checked={habilitada}
              onChange={(evento) => setHabilitada(evento.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm">
              <span className="block font-semibold text-slate-800">Imprimir un comprobante al registrar un pago</span>
              <span className="block text-slate-600">
                Sale con la dirección de la sucursal donde se cobró, la fecha y hora, el importe, el período, el titular y su
                domicilio, la compañía, la patente, la póliza y la cobertura.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <input
              type="checkbox"
              checked={preguntar}
              disabled={!habilitada}
              onChange={(evento) => setPreguntar(evento.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm">
              <span className="block font-semibold text-slate-800">Preguntar antes de imprimir cada comprobante</span>
              <span className="block text-slate-600">
                Después de guardar el pago aparece un cartel con «Imprimir» y «No imprimir». Conviene tenerlo activado: hay
                compañías que no piden ticket y así no se gasta papel de más. Sin esto, el comprobante sale solo.
              </span>
            </span>
          </label>

          {sinImpresoras ? (
            <Campo
              etiqueta="Impresora"
              value={impresora}
              onChange={(evento) => setImpresora(evento.target.value)}
              placeholder="POS-80"
              ayuda="Windows no devolvió ninguna impresora instalada. Escribí el nombre exacto tal como figura en «Dispositivos e impresoras»."
            />
          ) : (
            <Selector
              etiqueta="Impresora"
              value={impresora}
              onChange={(evento) => setImpresora(evento.target.value)}
              opciones={[{ valor: '', texto: '(elegí una)' }, ...estado.disponibles.map((nombre) => ({ valor: nombre, texto: nombre }))]}
              ayuda={estado.predeterminada ? `La predeterminada de esta PC es «${estado.predeterminada}».` : 'Las que ve esta PC.'}
            />
          )}

          <Campo
            etiqueta="Ancho del papel (mm)"
            type="number"
            min={40}
            max={120}
            value={anchoMm}
            onChange={(evento) => setAnchoMm(evento.target.value)}
            ayuda="Una POS-80 usa 80 mm. Si el ticket sale cortado o muy angosto, ajustá este número."
            className="max-w-40"
          />

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Cantidad de tickets por pago</span>
            <div className="flex max-w-64 gap-2">
              {[1, 2].map((cantidad) => (
                <button
                  key={cantidad}
                  type="button"
                  onClick={() => setCopias(cantidad)}
                  className={cx(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    copias === cantidad ? 'border-marino-500 bg-marino-50 text-marino-900 ring-2 ring-marino-500/20' : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {cantidad} {cantidad === 1 ? 'ticket' : 'tickets'}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Con «preguntar antes de imprimir» activado, se puede elegir 1 o 2 en el momento; esto es lo que sale
              marcado de entrada.
            </p>
          </div>
        </div>
      </Tarjeta>

      <NumeracionDeTickets proximoNumero={estado.proximoNumeroDeTicket} alGuardar={(config) => setEstado(config)} />

      <DireccionesDelTicket />
    </div>
  )
}

/**
 * El número correlativo que va a llevar el próximo ticket. Sube solo con cada comprobante impreso; acá
 * sólo se corrige a mano, por ejemplo después de cambiar el rollo o de una prueba de otra sucursal.
 */
function NumeracionDeTickets({ proximoNumero, alGuardar }: { proximoNumero: number; alGuardar: (config: ConfigImpresora) => void }) {
  const [valor, setValor] = useState(String(proximoNumero))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    setValor(String(proximoNumero))
  }, [proximoNumero])

  const numero = Number(valor)
  const hayCambios = Number.isInteger(numero) && numero >= 1 && numero !== proximoNumero

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.impresora.establecerNumeroDeTicket(numero)
    setGuardando(false)
    if (resultado.ok) {
      alGuardar(resultado.datos)
      setAviso('Listo: el próximo comprobante sale con ese número.')
    } else {
      setError(resultado.error)
    }
  }

  return (
    <Tarjeta
      titulo="Numeración de tickets"
      descripcion="Cada comprobante impreso lleva un número correlativo y suma uno para el siguiente. Corregilo sólo si hace falta."
      acciones={
        <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!hayCambios}>
          Guardar
        </Boton>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}
        <Campo
          etiqueta="Próximo número de ticket"
          type="number"
          min={1}
          value={valor}
          onChange={(evento) => setValor(evento.target.value)}
          className="max-w-40"
        />
      </div>
    </Tarjeta>
  )
}

/**
 * El encabezado del ticket lleva la dirección y el teléfono de la sucursal donde se cobró. Se cargan
 * acá, una fila por sucursal, y se puede agregar la de una sucursal nueva sin tocar el programa.
 */
function DireccionesDelTicket() {
  // A todo el mundo menos al superadministrador el proceso principal le manda UNA sola fila —la de la
  // sucursal en la que está asignado— y sólo le acepta esa al guardar. Acá además se le esconde el
  // «agregar una sucursal»: dar de alta la dirección de un local en el que uno no está no es algo que
  // haga falta desde el mostrador.
  const usuario = useUsuarioActual()
  const soloLaMia = usuario.rol !== 'SUPER_ADMIN'
  const [filas, setFilas] = useState<DireccionDeSucursal[] | null>(null)
  const [guardadas, setGuardadas] = useState<DireccionDeSucursal[]>([])
  const [nueva, setNueva] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const aplicar = useCallback((lista: DireccionDeSucursal[]) => {
    setFilas(lista)
    setGuardadas(lista)
  }, [])

  useEffect(() => {
    void window.dm.impresora.direcciones().then((resultado) => {
      if (resultado.ok) aplicar(resultado.datos)
      else setError(resultado.error)
    })
  }, [aplicar])

  if (!filas) {
    return (
      <Tarjeta titulo="Encabezado del ticket" descripcion="La dirección y el teléfono que encabezan el comprobante de cada sucursal.">
        {error ? <Alerta tono="error">{error}</Alerta> : <Cargando />}
      </Tarjeta>
    )
  }

  const cambiar = (indice: number, cambios: Partial<DireccionDeSucursal>) => {
    setFilas(filas.map((fila, i) => (i === indice ? { ...fila, ...cambios } : fila)))
  }

  const agregar = () => {
    const sucursal = nueva.trim()
    if (!sucursal) return
    if (filas.some((fila) => fila.sucursal.trim().toLocaleUpperCase() === sucursal.toLocaleUpperCase())) {
      setError(`«${sucursal}» ya está en la lista.`)
      return
    }
    setError(null)
    setFilas([...filas, { sucursal, direccion: '', telefono: '', enLaLista: false }])
    setNueva('')
  }

  const quitar = (indice: number) => {
    setFilas(filas.filter((_fila, i) => i !== indice))
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.impresora.guardarDirecciones(filas)
    setGuardando(false)
    if (resultado.ok) {
      aplicar(resultado.datos)
      setAviso('Encabezado guardado. Los próximos tickets salen con la dirección y el teléfono nuevos.')
    } else {
      setError(resultado.error)
    }
  }

  const hayCambios = JSON.stringify(filas) !== JSON.stringify(guardadas)

  return (
    <Tarjeta
      titulo={soloLaMia ? 'Encabezado del ticket de tu sucursal' : 'Encabezado del ticket'}
      descripcion={
        soloLaMia
          ? `Los comprobantes que salgan de esta computadora encabezan con la dirección y el teléfono de ${usuario.sucursal.nombre}. El resto del encabezado (provincia, CUIT e inicio de actividades) es igual para toda la agencia.`
          : 'Cada comprobante encabeza con la dirección y el teléfono de la sucursal donde se cobró. El resto del encabezado (provincia, CUIT e inicio de actividades) es igual para toda la agencia.'
      }
      acciones={
        <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!hayCambios}>
          Guardar encabezado
        </Boton>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}

        {filas.length === 0 && <Alerta tono="info">Todavía no hay sucursales cargadas.</Alerta>}

        {filas.map((fila, indice) => (
          <div key={`${fila.sucursal}-${indice}`} className="rounded-lg border border-slate-200 p-3">
            <span className="mb-2 block text-sm font-semibold text-slate-800">{fila.sucursal}</span>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="sm:flex-1">
                <Campo
                  etiqueta="Dirección"
                  value={fila.direccion}
                  onChange={(evento) => cambiar(indice, { direccion: evento.target.value })}
                  placeholder="Calle y número, localidad"
                  ayuda={fila.enLaLista ? undefined : 'Esta sucursal ya no está en la lista de la agencia.'}
                />
              </div>
              <div className="sm:w-64 sm:shrink-0">
                <Campo
                  etiqueta="Teléfono"
                  value={fila.telefono}
                  onChange={(evento) => cambiar(indice, { telefono: evento.target.value })}
                  placeholder="11 4083-0416"
                  ayuda="El celular de este local. Sale después de «Pcia de Buenos Aires»."
                />
              </div>
            </div>
            {!fila.enLaLista && !soloLaMia && (
              <div className="mt-1.5 flex justify-end">
                <Boton tamano="sm" variante="fantasma" icono="basura" onClick={() => quitar(indice)}>
                  Quitar esta sucursal
                </Boton>
              </div>
            )}
          </div>
        ))}

        {!soloLaMia && (
        <div className="border-t border-slate-200 pt-4">
          <Campo
            etiqueta="Agregar una sucursal"
            value={nueva}
            onChange={(evento) => setNueva(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') agregar()
            }}
            placeholder="Nombre de la sucursal"
            ayuda="Para una sucursal nueva que todavía no esté en la lista."
          />
          <div className="mt-2 flex justify-end">
            <Boton icono="mas" onClick={agregar} disabled={!nueva.trim()}>
              Agregar
            </Boton>
          </div>
        </div>
        )}
      </div>
    </Tarjeta>
  )
}
