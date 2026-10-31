// El seguimiento de una solicitud de Mi link: todo lo que dejó el visitante, el estado y la nota de la
// agencia, y los tres caminos de salida —escribirle por WhatsApp, cotizarla en el Multicotizador (auto y
// moto) o pasarla a Leads, donde sigue el embudo de siempre (presupuesto, cliente)—.
import { useState } from 'react'
import {
  ESTADOS_DE_SOLICITUD,
  NOMBRE_CANAL_DE_SOLICITUD,
  NOMBRE_ESTADO_DE_SOLICITUD,
  RAMO_DE_COBERTURA,
  type EstadoDeSolicitud,
  type SolicitudDeMiLink,
} from '../../../../shared/miLink'
import { Alerta, AreaTexto, Boton, Dialogo, Selector } from '../../../componentes/ui'
import { useNavegacion } from '../../../contexto/Navegacion'
import { usePermisos } from '../../../contexto/Permisos'
import { useUsuarioActual } from '../../../contexto/Sesion'
import { tipoDeLaSolicitud } from '../../multicotizador/desdeMiLink'
import { Dato, abrirWhatsapp, enlaceDeWhatsapp, fechaDeIso, horaDeIso, riesgoDeSolicitud } from './comun'

interface Props {
  solicitud: SolicitudDeMiLink
  alCerrar: () => void
  /** La solicitud como quedó en el VPS después de guardar el estado o la nota. */
  alGuardar: (solicitud: SolicitudDeMiLink) => void
}

/** La nota de la primera charla del lead: de dónde salió, para que nadie lo cargue de nuevo a mano. */
function notaParaElLead(solicitud: SolicitudDeMiLink): string {
  const encabezado = `Desde Mi link #${solicitud.numero} — ${solicitud.coberturaTitulo}`
  return solicitud.mensaje.trim() ? `${encabezado}\n${solicitud.mensaje.trim()}` : encabezado
}

export function DialogoDeSolicitud({ solicitud, alCerrar, alGuardar }: Props) {
  const { ir } = useNavegacion()
  const { puedeEditar, puedeVer } = usePermisos()
  const usuario = useUsuarioActual()
  const editable = puedeEditar('miLink')
  const [estado, setEstado] = useState<EstadoDeSolicitud>(solicitud.estado)
  const [nota, setNota] = useState(solicitud.nota)
  const [guardando, setGuardando] = useState(false)
  const [pasando, setPasando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null)
  const [leadCreado, setLeadCreado] = useState<number | null>(null)

  const cambiado = estado !== solicitud.estado || nota.trim() !== solicitud.nota.trim()
  const tipo = tipoDeLaSolicitud(solicitud)
  const v = solicitud.vehiculo

  const guardar = async () => {
    setGuardando(true)
    setMensaje(null)
    // Sólo lo que cambió: si otra computadora tocó el estado mientras acá se escribía la nota, no se pisa.
    const cambios: { estado?: EstadoDeSolicitud; nota?: string } = {}
    if (estado !== solicitud.estado) cambios.estado = estado
    if (nota.trim() !== solicitud.nota.trim()) cambios.nota = nota.trim()
    const resultado = await window.dm.miLink.actualizarSolicitud(solicitud.id, cambios)
    setGuardando(false)
    if (!resultado.ok) {
      setMensaje({ tono: 'error', texto: resultado.error })
      return
    }
    setEstado(resultado.datos.estado)
    setNota(resultado.datos.nota)
    setMensaje({ tono: 'exito', texto: 'Se guardó el seguimiento.' })
    alGuardar(resultado.datos)
  }

  const cotizar = () => {
    if (!tipo) return
    ir('multicotizador', { seccion: tipo === 'MOTO' ? 'moto' : 'auto', solicitudDeMiLink: solicitud })
  }

  const pasarALeads = async () => {
    setPasando(true)
    setMensaje(null)
    const resultado = await window.dm.leads.crear({
      nombre: solicitud.nombre,
      telefono: solicitud.telefono,
      // Como en «Nueva consulta»: la sucursal de quien la atiende, que es donde se va a trabajar.
      sucursal: usuario.sucursal.nombre,
      interes: riesgoDeSolicitud(solicitud) || solicitud.coberturaTitulo,
      tipoVehiculo: tipo === 'MOTO' ? 'Moto' : tipo === 'AUTO' ? 'Auto' : '',
      // OTRO y no un origen nuevo: los orígenes viajan a la pestaña de leads de la base, que la versión
      // normal también lee, y un valor que no conoce lo mostraría mal. La nota dice de dónde vino.
      origen: 'OTRO',
      estado: 'NUEVO',
      documento: '',
      email: solicitud.email,
      nota: notaParaElLead(solicitud),
    })
    setPasando(false)
    if (!resultado.ok) {
      setMensaje({ tono: 'error', texto: resultado.error })
      return
    }
    setLeadCreado(resultado.datos.lead.id)
    setMensaje({ tono: 'exito', texto: `Se cargó como lead. Si ya le escribiste, pasá esta solicitud a «${NOMBRE_ESTADO_DE_SOLICITUD.CONTACTADA}».` })
  }

  return (
    <Dialogo
      abierto
      ancho="lg"
      titulo={`Solicitud #${solicitud.numero}`}
      descripcion={`${solicitud.coberturaTitulo} · ${NOMBRE_CANAL_DE_SOLICITUD[solicitud.canal]} · entró el ${fechaDeIso(solicitud.creadaEn)} a las ${horaDeIso(solicitud.creadaEn)} por la página de ${solicitud.usuarioNombre || solicitud.usuarioClave}.`}
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cerrar
          </Boton>
          {editable && (
            <Boton variante="primario" icono="ok" escribe cargando={guardando} disabled={!cambiado} onClick={() => void guardar()}>
              Guardar
            </Boton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {mensaje && <Alerta tono={mensaje.tono}>{mensaje.texto}</Alerta>}

        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Dato etiqueta="Cliente">{solicitud.nombre}</Dato>
          <Dato etiqueta="Teléfono">{solicitud.telefono}</Dato>
          <Dato etiqueta="Email">{solicitud.email}</Dato>
          <Dato etiqueta="Código postal">{solicitud.codigoPostal}</Dato>
          <Dato etiqueta="Ramo">{RAMO_DE_COBERTURA[solicitud.cobertura]}</Dato>
          <Dato etiqueta="Cobertura">{solicitud.coberturaTitulo}</Dato>
          {v && (
            <>
              <Dato etiqueta="Vehículo">{[v.marca, v.modelo, v.version].map((parte) => parte.trim()).filter(Boolean).join(' ')}</Dato>
              <Dato etiqueta="Año">{v.anio ? String(v.anio) : ''}</Dato>
            </>
          )}
          <Dato etiqueta="Mensaje" ancho>
            {solicitud.mensaje}
          </Dato>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Boton icono="whatsapp" onClick={() => abrirWhatsapp(solicitud.telefono)} disabled={!enlaceDeWhatsapp(solicitud.telefono)}>
            WhatsApp
          </Boton>
          {tipo && puedeVer('multicotizador') && (
            <Boton icono={tipo === 'MOTO' ? 'moto' : 'auto'} onClick={cotizar}>
              Cotizar en el Multicotizador
            </Boton>
          )}
          {puedeEditar('leads') &&
            (leadCreado === null ? (
              <Boton icono="mas" escribe cargando={pasando} onClick={() => void pasarALeads()}>
                Pasar a Leads
              </Boton>
            ) : (
              <Boton icono="flechaDerecha" onClick={() => ir('leads', { leadId: leadCreado })}>
                Ver el lead
              </Boton>
            ))}
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-5 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <Selector
            etiqueta="Estado"
            value={estado}
            disabled={!editable}
            onChange={(e) => setEstado(e.target.value as EstadoDeSolicitud)}
            opciones={ESTADOS_DE_SOLICITUD.map((valor) => ({ valor, texto: NOMBRE_ESTADO_DE_SOLICITUD[valor] }))}
          />
          <AreaTexto
            etiqueta="Nota"
            value={nota}
            disabled={!editable}
            rows={3}
            maxLength={2000}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Lo que hablaste, qué le cotizaste, cuándo volver a llamarlo…"
            ayuda="La ve cualquiera de la agencia que pueda ver esta solicitud."
          />
        </div>
      </div>
    </Dialogo>
  )
}
