// Mi link → Siniestros: las denuncias que dejan desde la página pública, con sus fotos y PDF. No son
// todavía siniestros de la cartera (el alta de un siniestro pide el cliente, y el que denuncia desde
// el celular no sabe su número de cliente): es la bandeja de entrada. Se leen acá, se cargan en la
// compañía y en el módulo Siniestros, y se marcan «Cargada».
import { useMemo, useState } from 'react'
import {
  ESTADOS_DE_DENUNCIA,
  NOMBRE_ESTADO_DE_DENUNCIA,
  NOMBRE_TIPO_DE_SINIESTRO,
  filtrosVaciosDeMiLink,
  type DenunciaDeMiLink,
  type FiltrosDeMiLink,
} from '../../../shared/miLink'
import { Icono } from '../../componentes/Icono'
import { CeldaDoble, TablaDeListado, type ColumnaDeListado } from '../../componentes/listados'
import { Alerta, Boton } from '../../componentes/ui'
import { exportarAExcel } from '../../exportarAExcel'
import {
  AVANCE_DE_DENUNCIA,
  BarraDeEstado,
  BotonDeWhatsapp,
  CeldaDeFecha,
  EncabezadoDeMiLink,
  FiltrosDeMiLinkPanel,
  fechaDelSiniestro,
  fechaYHoraDeIso,
  opcionesDeUsuario,
  useListadoDeMiLink,
  useUsuariosDeMiLink,
  useVeTodoMiLink,
} from './listados/comun'
import { DialogoDeDenuncia } from './listados/DialogoDeDenuncia'

const OPCIONES_DE_ESTADO = ESTADOS_DE_DENUNCIA.map((estado) => ({ valor: estado, texto: NOMBRE_ESTADO_DE_DENUNCIA[estado] }))

/** La descripción cortada para la tabla; entera se lee en el seguimiento. */
function resumen(texto: string, maximo = 60): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio
}

export function Siniestros() {
  const veTodo = useVeTodoMiLink()
  const usuarios = useUsuariosDeMiLink(veTodo)
  const [borrador, setBorrador] = useState<FiltrosDeMiLink>(filtrosVaciosDeMiLink)
  const [aplicados, setAplicados] = useState<FiltrosDeMiLink>(filtrosVaciosDeMiLink)
  const { filas, cargando, error, recargar, reemplazar } = useListadoDeMiLink(window.dm.miLink.denuncias, aplicados)
  const [abierta, setAbierta] = useState<DenunciaDeMiLink | null>(null)
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
    const resultado = await exportarAExcel({
      titulo: 'Denuncias de siniestro de Mi link',
      columnas: [
        'Denuncia',
        'Estado',
        'Usuario',
        'Tipo',
        'Cliente',
        'DNI',
        'Teléfono',
        'Email',
        'Patente',
        'Fecha del siniestro',
        'Lugar',
        'Descripción',
        'Tercero',
        'Lesionados',
        'Adjuntos',
        'Nota',
        'Fecha',
      ],
      filas: filas.map((d) => [
        d.numero,
        NOMBRE_ESTADO_DE_DENUNCIA[d.estado],
        d.usuarioNombre,
        NOMBRE_TIPO_DE_SINIESTRO[d.tipo],
        d.nombre,
        d.dni,
        d.telefono,
        d.email,
        d.patente,
        fechaDelSiniestro(d.fecha),
        d.lugar,
        d.descripcion,
        d.hayTercero ? `Sí${d.terceroDatos.trim() ? `: ${d.terceroDatos.trim()}` : ''}` : 'No',
        d.hayLesionados ? 'Sí' : 'No',
        d.archivos.length,
        d.nota,
        fechaYHoraDeIso(d.creadaEn),
      ]),
    })
    setExportando(false)
    if (!resultado.ok) setAviso({ tono: 'error', texto: resultado.error })
    else if (resultado.datos.ruta) setAviso({ tono: 'exito', texto: `Se guardó el Excel en ${resultado.datos.ruta}` })
  }

  const columnas = useMemo<ColumnaDeListado<DenunciaDeMiLink>[]>(
    () => [
      { id: 'numero', encabezado: 'Denuncia', celda: (d) => <span className="font-semibold tabular-nums text-slate-800">#{d.numero}</span> },
      {
        id: 'estado',
        encabezado: 'Estado',
        celda: (d) => <BarraDeEstado {...AVANCE_DE_DENUNCIA[d.estado]} texto={NOMBRE_ESTADO_DE_DENUNCIA[d.estado]} />,
      },
      { id: 'usuario', encabezado: 'Usuario', celda: (d) => d.usuarioNombre || d.usuarioClave },
      { id: 'ramo', encabezado: 'Ramo', celda: (d) => <CeldaDoble principal={NOMBRE_TIPO_DE_SINIESTRO[d.tipo]} secundario={d.patente.toUpperCase()} /> },
      { id: 'cliente', encabezado: 'Cliente', celda: (d) => <CeldaDoble principal={d.nombre} secundario={d.dni ? `DNI ${d.dni}` : ''} /> },
      {
        id: 'siniestro',
        encabezado: 'Siniestro',
        celda: (d) => (
          <CeldaDoble
            principal={<span title={d.descripcion}>{resumen(d.descripcion) || '—'}</span>}
            secundario={[fechaDelSiniestro(d.fecha), d.lugar.trim()].filter(Boolean).join(' · ')}
          />
        ),
      },
      {
        id: 'adjuntos',
        encabezado: 'Adjuntos',
        celda: (d) =>
          d.archivos.length === 0 ? (
            <span className="text-slate-400">—</span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium tabular-nums text-slate-700">
              <Icono nombre="clip" tamano={14} />
              {d.archivos.length}
            </span>
          ),
      },
      { id: 'telefono', encabezado: 'Tel.', celda: (d) => <BotonDeWhatsapp telefono={d.telefono} /> },
      { id: 'fecha', encabezado: 'Fecha', celda: (d) => <CeldaDeFecha iso={d.creadaEn} /> },
    ],
    [],
  )

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDeMiLink
        icono="siniestros"
        titulo="Siniestros"
        descripcion="Las denuncias de siniestro que te dejan desde tu link. Tocá una fila para ver lo que respondieron y los archivos que adjuntaron."
        ayuda="miLink.siniestros"
        acciones={
          <>
            <Boton icono="refrescar" onClick={() => void recargar()} cargando={cargando} title="Volver a pedir las denuncias ahora">
              Actualizar
            </Boton>
            <Boton icono="descargar" onClick={() => void exportar()} cargando={exportando} disabled={exportando || cargando || filas.length === 0}>
              Exportar denuncias
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
        ayudaDeTexto="Nombre, teléfono, DNI o patente"
        usuarios={veTodo ? opcionesDeUsuario(usuarios, 'Mis denuncias') : null}
        alBuscar={buscar}
        alLimpiar={limpiar}
        buscando={cargando}
      />

      <TablaDeListado
        etiqueta="Denuncias de siniestro de Mi link"
        columnas={columnas}
        filas={filas}
        clave={(d) => d.id}
        cargando={cargando && filas.length === 0}
        alHacerClic={setAbierta}
        vacio="No hay denuncias de siniestro registradas"
      />

      {abierta && (
        <DialogoDeDenuncia
          denuncia={abierta}
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
