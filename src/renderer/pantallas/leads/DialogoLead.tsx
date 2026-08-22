// El formulario de una consulta, para cargarla y para corregirla. Es el mismo diálogo en los dos
// casos: lo que se pregunta cuando entra la consulta es exactamente lo que después se corrige.
//
// Corto a propósito. Cuando alguien llama preguntando un precio, lo que se sabe es el nombre, el
// teléfono y qué quiere asegurar; pedir más es garantizar que nadie lo cargue.
import { useState } from 'react'
import {
  ESTADOS_DE_LEAD,
  NOMBRE_ORIGEN_LEAD,
  ORIGENES_DE_LEAD,
  type DatosDeLead,
  type EstadoLead,
  type FichaLead,
  type FilaLead,
  type OrigenDeLead,
} from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Selector } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'

interface Props {
  /** La consulta que se está corrigiendo, o null si es una nueva. */
  lead: FilaLead | null
  sucursales: string[]
  alCerrar: () => void
  alGuardar: (ficha: FichaLead) => void
}

export function DialogoLead({ lead, sucursales, alCerrar, alGuardar }: Props) {
  const usuario = useUsuarioActual()
  const [datos, setDatos] = useState<DatosDeLead>({
    nombre: lead?.nombre ?? '',
    telefono: lead?.telefono ?? '',
    // La sucursal por defecto es la de quien está atendiendo: es donde entró la consulta.
    sucursal: lead?.sucursal ?? usuario.sucursal.nombre,
    interes: lead?.interes ?? '',
    tipoVehiculo: lead?.tipoVehiculo ?? '',
    origen: lead?.origen ?? 'WHATSAPP',
    estado: lead?.estado ?? 'NUEVO',
    documento: lead?.documento ?? '',
    email: lead?.email ?? '',
    nota: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cambiar = (cambios: Partial<DatosDeLead>) => setDatos((previos) => ({ ...previos, ...cambios }))

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = lead ? await window.dm.leads.editar(lead.id, datos) : await window.dm.leads.crear(datos)
    setGuardando(false)
    if (resultado.ok) alGuardar(resultado.datos)
    else setError(resultado.error)
  }

  const opcionesDeSucursal = [...new Set([usuario.sucursal.nombre, ...sucursales, datos.sucursal].filter(Boolean))].sort()

  return (
    <Dialogo
      abierto
      titulo={lead ? 'Editar la consulta' : 'Nueva consulta'}
      descripcion={
        lead
          ? 'Corregí lo que haga falta. Lo que cambies viaja también a la pestaña APP LEADS de la hoja.'
          : 'Con el nombre, el teléfono y qué quiere asegurar alcanza; el resto se completa mientras se habla.'
      }
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono={lead ? 'ok' : 'mas'} cargando={guardando} onClick={() => void guardar()}>
            {lead ? 'Guardar' : 'Cargar la consulta'}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Nombre"
            value={datos.nombre}
            onChange={(e) => cambiar({ nombre: e.target.value })}
            placeholder="Como se presentó"
            autoFocus
          />
          <Campo
            etiqueta="Teléfono"
            value={datos.telefono}
            onChange={(e) => cambiar({ telefono: e.target.value })}
            placeholder="11 5555-4444"
            ayuda="Es con lo que después se le escribe por WhatsApp."
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Selector
            etiqueta="Cómo llegó"
            value={datos.origen}
            onChange={(e) => cambiar({ origen: e.target.value as OrigenDeLead })}
            opciones={ORIGENES_DE_LEAD.map((origen) => ({ valor: origen, texto: NOMBRE_ORIGEN_LEAD[origen] }))}
          />
          <Selector
            etiqueta="Sucursal"
            value={datos.sucursal}
            onChange={(e) => cambiar({ sucursal: e.target.value })}
            opciones={opcionesDeSucursal.map((s) => ({ valor: s, texto: s }))}
          />
        </div>

        <Campo
          etiqueta="Qué quiere asegurar"
          value={datos.interes}
          onChange={(e) => cambiar({ interes: e.target.value })}
          placeholder="El Gol de la hija, la moto del pibe, la casa de Berazategui…"
          ayuda="Escribilo como lo dijo: después se entiende mejor de qué se trataba."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Tipo de vehículo"
            value={datos.tipoVehiculo}
            onChange={(e) => cambiar({ tipoVehiculo: e.target.value })}
            placeholder="Auto, moto, camioneta…"
          />
          <Selector
            etiqueta="Estado"
            value={datos.estado}
            onChange={(e) => cambiar({ estado: e.target.value as EstadoLead })}
            opciones={ESTADOS_DE_LEAD.map((estado) => ({ valor: estado, texto: estado }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="DNI / CUIT"
            value={datos.documento}
            onChange={(e) => cambiar({ documento: e.target.value })}
            ayuda="Si lo dejó, cargalo: con eso «Convertir en cliente» no duplica a nadie."
          />
          <Campo etiqueta="Email" type="email" value={datos.email} onChange={(e) => cambiar({ email: e.target.value })} />
        </div>

        {!lead && (
          <AreaTexto
            etiqueta="Primera nota"
            rows={2}
            value={datos.nota}
            onChange={(e) => cambiar({ nota: e.target.value })}
            placeholder="Qué preguntó, qué se le dijo, cuándo vuelve a llamar…"
          />
        )}
      </div>
    </Dialogo>
  )
}
