// El seguimiento de una denuncia de siniestro de Mi link: todo lo que respondió el cliente, los
// archivos que adjuntó (se abren con el programa de la computadora) y el estado y la nota de la agencia.
import { useState } from 'react'
import {
  ESTADOS_DE_DENUNCIA,
  NOMBRE_ESTADO_DE_DENUNCIA,
  NOMBRE_TIPO_DE_SINIESTRO,
  type ArchivoDeDenuncia,
  type DenunciaDeMiLink,
  type EstadoDeDenuncia,
} from '../../../../shared/miLink'
import { Icono } from '../../../componentes/Icono'
import { Alerta, AreaTexto, Boton, Dialogo, Selector } from '../../../componentes/ui'
import { usePermisos } from '../../../contexto/Permisos'
import { Dato, abrirWhatsapp, enlaceDeWhatsapp, fechaDeIso, fechaDelSiniestro, horaDeIso } from './comun'

interface Props {
  denuncia: DenunciaDeMiLink
  alCerrar: () => void
  alGuardar: (denuncia: DenunciaDeMiLink) => void
}

/** «2,4 MB», «380 KB»: lo justo para saber si conviene abrirlo con datos del celular compartidos. */
function tamanoLegible(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('es-AR')} KB`
}

export function DialogoDeDenuncia({ denuncia, alCerrar, alGuardar }: Props) {
  const { puedeEditar } = usePermisos()
  const editable = puedeEditar('miLink')
  const [estado, setEstado] = useState<EstadoDeDenuncia>(denuncia.estado)
  const [nota, setNota] = useState(denuncia.nota)
  const [guardando, setGuardando] = useState(false)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null)

  const cambiado = estado !== denuncia.estado || nota.trim() !== denuncia.nota.trim()

  const guardar = async () => {
    setGuardando(true)
    setMensaje(null)
    const cambios: { estado?: EstadoDeDenuncia; nota?: string } = {}
    if (estado !== denuncia.estado) cambios.estado = estado
    if (nota.trim() !== denuncia.nota.trim()) cambios.nota = nota.trim()
    const resultado = await window.dm.miLink.actualizarDenuncia(denuncia.id, cambios)
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

  // El archivo se baja del VPS a una carpeta temporal y se abre ahí: puede tardar con una foto grande,
  // así que el botón muestra que está trabajando.
  const abrir = async (archivo: ArchivoDeDenuncia) => {
    setAbriendo(archivo.id)
    setMensaje(null)
    const resultado = await window.dm.miLink.abrirArchivo(archivo)
    setAbriendo(null)
    if (!resultado.ok) setMensaje({ tono: 'error', texto: resultado.error })
  }

  return (
    <Dialogo
      abierto
      ancho="lg"
      titulo={`Denuncia #${denuncia.numero} · ${NOMBRE_TIPO_DE_SINIESTRO[denuncia.tipo]}`}
      descripcion={`Entró el ${fechaDeIso(denuncia.creadaEn)} a las ${horaDeIso(denuncia.creadaEn)} por la página de ${denuncia.usuarioNombre || denuncia.usuarioClave}.`}
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
          <Dato etiqueta="Cliente">{denuncia.nombre}</Dato>
          <Dato etiqueta="DNI">{denuncia.dni}</Dato>
          <Dato etiqueta="Teléfono">{denuncia.telefono}</Dato>
          <Dato etiqueta="Email">{denuncia.email}</Dato>
          <Dato etiqueta="Patente">{denuncia.patente.toUpperCase()}</Dato>
          <Dato etiqueta="Fecha del siniestro">{fechaDelSiniestro(denuncia.fecha)}</Dato>
          <Dato etiqueta="Lugar" ancho>
            {denuncia.lugar}
          </Dato>
          <Dato etiqueta="Qué pasó" ancho>
            {denuncia.descripcion}
          </Dato>
          <Dato etiqueta="¿Hubo un tercero?">{denuncia.hayTercero ? 'Sí' : 'No'}</Dato>
          <Dato etiqueta="¿Hubo lesionados?">{denuncia.hayLesionados ? 'Sí' : 'No'}</Dato>
          {denuncia.hayTercero && (
            <Dato etiqueta="Datos del tercero" ancho>
              {denuncia.terceroDatos}
            </Dato>
          )}
        </dl>

        <section>
          <h3 className="text-[11px] font-bold tracking-[0.1em] text-slate-500 uppercase">Archivos adjuntos</h3>
          {denuncia.archivos.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No adjuntó fotos ni PDF.</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
              {denuncia.archivos.map((archivo) => (
                <li key={archivo.id} className="flex items-center gap-3 px-3 py-2">
                  <Icono nombre={archivo.tipo === 'application/pdf' ? 'reportes' : 'clip'} tamano={16} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800" title={archivo.nombre}>
                    {archivo.nombre}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{tamanoLegible(archivo.tamano)}</span>
                  <Boton tamano="sm" icono="ojo" cargando={abriendo === archivo.id} disabled={abriendo !== null} onClick={() => void abrir(archivo)}>
                    Abrir
                  </Boton>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          <Boton icono="whatsapp" onClick={() => abrirWhatsapp(denuncia.telefono)} disabled={!enlaceDeWhatsapp(denuncia.telefono)}>
            WhatsApp
          </Boton>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-5 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <Selector
            etiqueta="Estado"
            value={estado}
            disabled={!editable}
            onChange={(e) => setEstado(e.target.value as EstadoDeDenuncia)}
            opciones={ESTADOS_DE_DENUNCIA.map((valor) => ({ valor, texto: NOMBRE_ESTADO_DE_DENUNCIA[valor] }))}
            ayuda="«Cargada» cuando ya está en la compañía y en el módulo Siniestros."
          />
          <AreaTexto
            etiqueta="Nota"
            value={nota}
            disabled={!editable}
            rows={3}
            maxLength={2000}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Número de siniestro de la compañía, qué documentación falta, a quién se le pasó…"
            ayuda="La ve cualquiera de la agencia que pueda ver esta denuncia."
          />
        </div>
      </div>
    </Dialogo>
  )
}
