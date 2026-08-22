// Alta de un riesgo vario. Es a propósito el formulario más corto de la aplicación: un riesgo se carga
// apenas se vende, y los papeles —número de póliza, vigencias— llegan después. Lo único obligatorio es
// el titular y la compañía; el resto se completa con doble clic en la tabla.
import { useState } from 'react'
import type { DatosDeRiesgo, ListadoRiesgos } from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Campo, Dialogo } from '../../componentes/ui'

interface Props {
  catalogos: ListadoRiesgos
  alCerrar: () => void
  alCrear: (listado: ListadoRiesgos) => void
}

const VACIO: DatosDeRiesgo = {
  clienteNombre: '',
  documento: '',
  telefono: '',
  sucursal: '',
  emision: '',
  tipoRiesgo: '',
  descripcion: '',
  compania: '',
  numeroPoliza: '',
  patente: '',
  prima: '',
  cuota: '',
  diaVencimiento: '',
  formaPago: '',
  vigenciaDesde: '',
  vigenciaHasta: '',
  observaciones: '',
}

export function DialogoNuevoRiesgo({ catalogos, alCerrar, alCrear }: Props) {
  const [datos, setDatos] = useState<DatosDeRiesgo>(VACIO)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cambiar = (cambios: Partial<DatosDeRiesgo>) => setDatos((previos) => ({ ...previos, ...cambios }))

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.riesgos.crear(datos)
    setGuardando(false)
    if (resultado.ok) alCrear(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Nuevo riesgo vario"
      descripcion="Combinado familiar, incendio, comercio, accidentes personales… Todo lo que no es automotor."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton
            variante="primario"
            icono="ok"
            onClick={() => void guardar()}
            cargando={guardando}
            disabled={!datos.clienteNombre.trim() || !datos.compania.trim()}
          >
            Cargar riesgo
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Titular" value={datos.clienteNombre} onChange={(e) => cambiar({ clienteNombre: e.target.value })} autoFocus />
          <Campo
            etiqueta="DNI/CUIT"
            value={datos.documento}
            onChange={(e) => cambiar({ documento: e.target.value })}
            ayuda="Si ya es cliente de la agencia, el riesgo queda colgado de su ficha."
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Teléfono" value={datos.telefono} onChange={(e) => cambiar({ telefono: e.target.value })} />
          <ConSugerencias
            etiqueta="Sucursal"
            lista="riesgo-sucursales"
            opciones={catalogos.sucursales}
            valor={datos.sucursal}
            alCambiar={(v) => cambiar({ sucursal: v })}
            ayuda="Vacío = la tuya."
          />
          <Campo etiqueta="Emisión" type="date" value={datos.emision} onChange={(e) => cambiar({ emision: e.target.value })} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ConSugerencias
            etiqueta="Riesgo"
            lista="riesgo-tipos"
            opciones={catalogos.tiposDeRiesgo}
            valor={datos.tipoRiesgo}
            alCambiar={(v) => cambiar({ tipoRiesgo: v })}
            ayuda="COMBINADO FAMILIAR, INCENDIO, COMERCIO…"
          />
          <ConSugerencias
            etiqueta="Compañía"
            lista="riesgo-companias"
            opciones={catalogos.companias}
            valor={datos.compania}
            alCambiar={(v) => cambiar({ compania: v })}
          />
        </div>

        <Campo etiqueta="Detalle" value={datos.descripcion} onChange={(e) => cambiar({ descripcion: e.target.value })} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="N.º de póliza" value={datos.numeroPoliza} onChange={(e) => cambiar({ numeroPoliza: e.target.value })} />
          <Campo etiqueta="Cuota" value={datos.cuota} onChange={(e) => cambiar({ cuota: e.target.value })} />
          <Campo
            etiqueta="Día de vencimiento"
            value={datos.diaVencimiento}
            onChange={(e) => cambiar({ diaVencimiento: e.target.value })}
            ayuda="El día del mes: 10, 25…"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ConSugerencias
            etiqueta="Forma de pago"
            lista="riesgo-formas"
            opciones={catalogos.formasDePago}
            valor={datos.formaPago}
            alCambiar={(v) => cambiar({ formaPago: v })}
            ayuda="TARJETA y CBU se marcan en azul."
          />
          <Campo etiqueta="Desde" type="date" value={datos.vigenciaDesde} onChange={(e) => cambiar({ vigenciaDesde: e.target.value })} />
          <Campo etiqueta="Hasta" type="date" value={datos.vigenciaHasta} onChange={(e) => cambiar({ vigenciaHasta: e.target.value })} />
        </div>

        <AreaTexto etiqueta="Observaciones" rows={2} value={datos.observaciones} onChange={(e) => cambiar({ observaciones: e.target.value })} />
      </div>
    </Dialogo>
  )
}

/** Campo con desplegable de lo que ya se usa, pero que deja escribir cualquier cosa, como la hoja. */
function ConSugerencias({
  etiqueta,
  lista,
  opciones,
  valor,
  alCambiar,
  ayuda,
}: {
  etiqueta: string
  lista: string
  opciones: string[]
  valor: string
  alCambiar: (valor: string) => void
  ayuda?: string
}) {
  return (
    <>
      <Campo etiqueta={etiqueta} list={lista} value={valor} onChange={(evento) => alCambiar(evento.target.value)} ayuda={ayuda} />
      <datalist id={lista}>
        {opciones.map((opcion) => (
          <option key={opcion} value={opcion} />
        ))}
      </datalist>
    </>
  )
}
