// Mi link → Solicitudes: lo que piden desde la página pública. Las de auto y moto entran por el
// cotizador de la página (con marca, modelo, versión y año); las de las demás coberturas, por el
// formulario corto. Todas viven en el VPS: acá se listan, se les sigue el rastro (estado y nota) y se
// mandan a donde se trabajan de verdad —el Multicotizador o Leads—.
import { useMemo, useState } from 'react'
import {
  ESTADOS_DE_SOLICITUD,
  NOMBRE_CANAL_DE_SOLICITUD,
  NOMBRE_ESTADO_DE_SOLICITUD,
  RAMO_DE_COBERTURA,
  filtrosVaciosDeMiLink,
  type FiltrosDeMiLink,
  type SolicitudDeMiLink,
} from '../../../shared/miLink'
import { CeldaDoble, TablaDeListado, type ColumnaDeListado } from '../../componentes/listados'
import { Alerta, Boton, Etiqueta } from '../../componentes/ui'
import { exportarAExcel } from '../../exportarAExcel'
import {
  AVANCE_DE_SOLICITUD,
  BarraDeEstado,
  BotonDeWhatsapp,
  CeldaDeFecha,
  EncabezadoDeMiLink,
  FiltrosDeMiLinkPanel,
  fechaYHoraDeIso,
  opcionesDeUsuario,
  riesgoDeSolicitud,
  useListadoDeMiLink,
  useUsuariosDeMiLink,
  useVeTodoMiLink,
} from './listados/comun'
import { DialogoDeSolicitud } from './listados/DialogoDeSolicitud'

const OPCIONES_DE_ESTADO = ESTADOS_DE_SOLICITUD.map((estado) => ({ valor: estado, texto: NOMBRE_ESTADO_DE_SOLICITUD[estado] }))

export function Solicitudes() {
  const veTodo = useVeTodoMiLink()
  const usuarios = useUsuariosDeMiLink(veTodo)
  const [borrador, setBorrador] = useState<FiltrosDeMiLink>(filtrosVaciosDeMiLink)
  const [aplicados, setAplicados] = useState<FiltrosDeMiLink>(filtrosVaciosDeMiLink)
  const { filas, cargando, error, recargar, reemplazar } = useListadoDeMiLink(window.dm.miLink.solicitudes, aplicados)
  const [abierta, setAbierta] = useState<SolicitudDeMiLink | null>(null)
  const [aviso, setAviso] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null)
  const [exportando, setExportando] = useState(false)

  const buscar = () => setAplicados({ ...borrador, texto: borrador.texto.trim() })
  const limpiar = () => {
    setBorrador(filtrosVaciosDeMiLink())
    setAplicados(filtrosVaciosDeMiLink())
  }

  const exportar = async () => {
    setExportando(true)
    setAviso(null)
    // Lo que se ve, con los filtros aplicados y en el orden de la tabla (no sólo la página actual).
    const resultado = await exportarAExcel({
      titulo: 'Solicitudes de Mi link',
      columnas: ['Cotización', 'Estado', 'Canal', 'Usuario', 'Ramo', 'Cobertura', 'Cliente', 'Teléfono', 'Email', 'Código postal', 'Riesgo', 'Mensaje', 'Nota', 'Fecha'],
      filas: filas.map((s) => [
        s.numero,
        NOMBRE_ESTADO_DE_SOLICITUD[s.estado],
        NOMBRE_CANAL_DE_SOLICITUD[s.canal],
        s.usuarioNombre,
        RAMO_DE_COBERTURA[s.cobertura],
        s.coberturaTitulo,
        s.nombre,
        s.telefono,
        s.email,
        s.codigoPostal,
        riesgoDeSolicitud(s),
        s.mensaje,
        s.nota,
        fechaYHoraDeIso(s.creadaEn),
      ]),
    })
    setExportando(false)
    if (!resultado.ok) setAviso({ tono: 'error', texto: resultado.error })
    else if (resultado.datos.ruta) setAviso({ tono: 'exito', texto: `Se guardó el Excel en ${resultado.datos.ruta}` })
  }

  const columnas = useMemo<ColumnaDeListado<SolicitudDeMiLink>[]>(
    () => [
      { id: 'numero', encabezado: 'Cotización', celda: (s) => <span className="font-semibold tabular-nums text-slate-800">#{s.numero}</span> },
      {
        id: 'estado',
        encabezado: 'Estado',
        celda: (s) => <BarraDeEstado {...AVANCE_DE_SOLICITUD[s.estado]} texto={NOMBRE_ESTADO_DE_SOLICITUD[s.estado]} />,
      },
      {
        id: 'canal',
        encabezado: 'Canal',
        celda: (s) => <Etiqueta tono={s.canal === 'COTIZADOR' ? 'marca' : 'neutro'}>{NOMBRE_CANAL_DE_SOLICITUD[s.canal]}</Etiqueta>,
      },
      { id: 'usuario', encabezado: 'Usuario', celda: (s) => s.usuarioNombre || s.usuarioClave },
      { id: 'ramo', encabezado: 'Ramo', celda: (s) => <CeldaDoble principal={RAMO_DE_COBERTURA[s.cobertura]} secundario={s.coberturaTitulo} /> },
      { id: 'cliente', encabezado: 'Cliente', celda: (s) => <CeldaDoble principal={s.nombre} secundario={s.email} /> },
      { id: 'riesgo', encabezado: 'Riesgo', celda: (s) => riesgoDeSolicitud(s) || '—' },
      { id: 'telefono', encabezado: 'Tel.', celda: (s) => <BotonDeWhatsapp telefono={s.telefono} /> },
      { id: 'fecha', encabezado: 'Fecha', celda: (s) => <CeldaDeFecha iso={s.creadaEn} /> },
    ],
    [],
  )

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDeMiLink
        icono="bandeja"
        titulo="Solicitudes"
        descripcion="Lo que te piden desde tu link: las cotizaciones de auto y moto y los formularios de las demás coberturas. Tocá una fila para ver su seguimiento."
        ayuda="miLink.solicitudes"
        acciones={
          <>
            <Boton icono="refrescar" onClick={() => void recargar()} cargando={cargando} title="Volver a pedir las solicitudes ahora">
              Actualizar
            </Boton>
            <Boton icono="descargar" onClick={() => void exportar()} cargando={exportando} disabled={exportando || cargando || filas.length === 0}>
              Exportar solicitudes
            </Boton>
          </>
        }
      />

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono={aviso.tono}>{aviso.texto}</Alerta>}

      <FiltrosDeMiLinkPanel
        borrador={borrador}
        alCambiar={(cambios) => setBorrador((previo) => ({ ...previo, ...cambios }))}
        estados={OPCIONES_DE_ESTADO}
        ayudaDeTexto="Nombre, teléfono, mail, marca o modelo"
        usuarios={veTodo ? opcionesDeUsuario(usuarios, 'Mis solicitudes') : null}
        alBuscar={buscar}
        alLimpiar={limpiar}
        buscando={cargando}
      />

      <TablaDeListado
        etiqueta="Solicitudes de Mi link"
        columnas={columnas}
        filas={filas}
        clave={(s) => s.id}
        cargando={cargando && filas.length === 0}
        alHacerClic={setAbierta}
        vacio="No hay solicitudes registradas"
      />

      {abierta && (
        <DialogoDeSolicitud
          solicitud={abierta}
          alCerrar={() => setAbierta(null)}
          alGuardar={(actualizada) => {
            reemplazar(actualizada)
            setAbierta(actualizada)
          }}
        />
      )}
    </div>
  )
}
