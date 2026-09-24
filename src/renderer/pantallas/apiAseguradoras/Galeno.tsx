// API Aseguradoras → Galeno: la cuenta de Galeno Seguros y los reportes de sólo lectura que trae su API
// (Consultas, Cuenta Corriente y Contratos ART). Cotizar y Emitir viven en Presupuestos —son parte de
// armar y cerrar un presupuesto, no de "mirar la cuenta"—; acá está la conexión y todo lo que es
// consultar en vez de cargar.
import { useCallback, useEffect, useState } from 'react'
import {
  NOMBRE_IMPRESION_GALENO,
  NOMBRE_REPORTE_GALENO,
  REPORTES_DE_GALENO,
  TIPOS_DE_IMPRESION_GALENO,
  type EstadoDeGaleno,
  type FiltrosDeReporteGaleno,
  type PruebaDeGaleno,
  type ReporteDeGaleno,
  type ReporteGaleno,
  type TipoDeImpresionGaleno,
} from '../../../shared/tipos'
import { Alerta, Boton, Campo, CampoClave, Cargando, Selector, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function Galeno() {
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('administracion') && (usuario.rol === 'SUPER_ADMIN' || usuario.rol === 'ADMIN')

  const [estado, setEstado] = useState<EstadoDeGaleno | null>(null)
  const [usuarioGaleno, setUsuarioGaleno] = useState('')
  const [clave, setClave] = useState('')
  const [ambiente, setAmbiente] = useState<'desa' | 'produccion'>('produccion')
  const [urlBase, setUrlBase] = useState('')
  const [authorizationBasic, setAuthorizationBasic] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [prueba, setPrueba] = useState<PruebaDeGaleno | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.galeno.estado()
    if (resultado.ok) {
      setEstado(resultado.datos)
    } else {
      setError(resultado.error)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.galeno.guardarCredenciales({
      usuario: usuarioGaleno,
      clave,
      ambiente,
      urlBase: ambiente === 'produccion' ? urlBase : '',
      authorizationBasic: ambiente === 'produccion' ? authorizationBasic : '',
    })
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      // La clave no se deja en memoria más de lo necesario: no se guarda en esta computadora, va
      // derecho al servidor, igual que la credencial del portal de novedades.
      setClave('')
      setAviso('Credenciales guardadas en el servidor. Probá la conexión antes de cotizar o emitir.')
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.galeno.borrarCredenciales()
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setUsuarioGaleno('')
      setClave('')
      setAviso('Se sacó la cuenta de Galeno del servidor: queda la de producción de fábrica.')
    } else {
      setError(resultado.error)
    }
  }

  const probar = async () => {
    setPrueba(null)
    setError(null)
    const resultado = await window.dm.galeno.probar()
    if (resultado.ok) {
      setPrueba(resultado.datos)
      void cargar() // el legajo del productor puede haberse completado solo
    } else {
      setError(resultado.error)
    }
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo="Conexión con Galeno Seguros"
        descripcion="Con esto, Presupuestos puede cotizar y emitir pólizas de Galeno sin salir de la app, y acá abajo se pueden consultar sus pólizas, cuotas y cuenta corriente. Galeno sólo acepta pedidos desde la IP del VPS de la agencia: es el servidor el que le habla, no esta computadora."
        acciones={
          puedeEditar && (
            <>
              {estado.enElServidor && (
                <Boton icono="basura" onClick={() => void borrar()} disabled={guardando}>
                  Sacarlas
                </Boton>
              )}
              <Boton
                variante="primario"
                icono="ok"
                onClick={() => void guardar()}
                cargando={guardando}
                disabled={!usuarioGaleno.trim() || !clave}
              >
                Guardar
              </Boton>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {estado.enElServidor ? (
            <Alerta tono="exito">
              Cargadas en el servidor el {cuando(estado.actualizadoEn)}
              {estado.actualizadoPor ? ` por ${estado.actualizadoPor}` : ''}.
            </Alerta>
          ) : (
            <Alerta tono="info">
              Todavía no se cargó una cuenta propia: se está usando la cuenta de producción de fábrica.
            </Alerta>
          )}
          {estado.error && <Alerta tono="error">{estado.error}</Alerta>}
          <Campo etiqueta="Usuario" value={usuarioGaleno} onChange={(evento) => setUsuarioGaleno(evento.target.value)} disabled={!puedeEditar} autoComplete="off" />
          <CampoClave
            etiqueta="Clave"
            value={clave}
            onChange={(evento) => setClave(evento.target.value)}
            disabled={!puedeEditar}
            placeholder="Se guarda en el servidor, no en esta computadora"
            autoComplete="off"
          />
          <Selector
            etiqueta="Ambiente"
            value={ambiente}
            onChange={(evento) => setAmbiente(evento.target.value as 'desa' | 'produccion')}
            disabled={!puedeEditar}
            opciones={[
              { valor: 'desa', texto: 'Pruebas (el que trae el manual de Galeno)' },
              { valor: 'produccion', texto: 'Producción' },
            ]}
            ayuda="El manual de Galeno sólo documenta el ambiente de pruebas. Para producción, Galeno da aparte una URL y un «Authorization» distintos: sin cargarlos acá no se puede pasar a producción."
          />
          {ambiente === 'produccion' && (
            <>
              <Campo
                etiqueta="URL base de producción"
                value={urlBase}
                onChange={(evento) => setUrlBase(evento.target.value)}
                disabled={!puedeEditar}
                placeholder="https://..."
                autoComplete="off"
              />
              <CampoClave
                etiqueta='"Authorization" de producción'
                value={authorizationBasic}
                onChange={(evento) => setAuthorizationBasic(evento.target.value)}
                disabled={!puedeEditar}
                placeholder="Basic ..."
                ayuda="El que Galeno haya dado para el endpoint de token en producción (no el del manual, que es sólo para pruebas)."
                autoComplete="off"
              />
            </>
          )}
          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-3">
              <Boton icono="enlace" onClick={() => void probar()}>
                Probar la conexión
              </Boton>
              {prueba && (
                <span className={prueba.ok ? 'text-sm text-green-700' : 'text-sm text-red-700'}>
                  {prueba.detalle}
                  {prueba.ok && prueba.ramasEncontradas > 0 ? ` (${prueba.ramasEncontradas} ramas)` : ''}
                </span>
              )}
            </div>
          )}
          {estado.productorCodigo && <p className="text-xs text-slate-500">Legajo del productor identificado: {estado.productorCodigo}</p>}
        </div>
      </Tarjeta>

      <ImpresionGaleno legajoSugerido={estado.productorCodigo ?? ''} />
      <ReportesGaleno />
    </div>
  )
}

function ImpresionGaleno({ legajoSugerido }: { legajoSugerido: string }) {
  const [tipoImpresion, setTipoImpresion] = useState<TipoDeImpresionGaleno>('P')
  const [poliza, setPoliza] = useState('')
  const [rama, setRama] = useState('4')
  const [legajo, setLegajo] = useState(legajoSugerido)
  const [idRiesgo, setIdRiesgo] = useState('')
  const [imprimiendo, setImprimiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const imprimir = async () => {
    setImprimiendo(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.galeno.imprimir({
      tipoImpresion,
      poliza,
      rama: Number(rama),
      legajo,
      idRiesgo: idRiesgo || undefined,
    })
    setImprimiendo(false)
    if (resultado.ok) setAviso(`Se abrió «${resultado.datos.nombre}».`)
    else setError(resultado.error)
  }

  return (
    <Tarjeta titulo="Imprimir un documento" descripcion="Póliza, certificado de cobertura o certificado Mercosur. Se abre solo al terminar de bajarlo.">
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}
        <div className="flex flex-wrap items-end gap-3">
          <Selector
            etiqueta="Documento"
            value={tipoImpresion}
            onChange={(evento) => setTipoImpresion(evento.target.value as TipoDeImpresionGaleno)}
            opciones={TIPOS_DE_IMPRESION_GALENO.map((t) => ({ valor: t, texto: NOMBRE_IMPRESION_GALENO[t] }))}
            className="w-56"
          />
          <Campo etiqueta="Póliza" value={poliza} onChange={(evento) => setPoliza(evento.target.value)} className="w-28" />
          <Selector
            etiqueta="Rama"
            value={rama}
            onChange={(evento) => setRama(evento.target.value)}
            opciones={[
              { valor: '4', texto: 'Autos' },
              { valor: '28', texto: 'Motos' },
            ]}
            className="w-32"
          />
          <Campo etiqueta="Legajo" value={legajo} onChange={(evento) => setLegajo(evento.target.value)} className="w-28" />
          <Campo etiqueta="Riesgo (opcional)" value={idRiesgo} onChange={(evento) => setIdRiesgo(evento.target.value)} className="w-28" />
          <Boton variante="primario" icono="impresora" onClick={() => void imprimir()} cargando={imprimiendo} disabled={!poliza.trim() || !legajo.trim()}>
            Imprimir
          </Boton>
        </div>
      </div>
    </Tarjeta>
  )
}

const REPORTES_VISIBLES = REPORTES_DE_GALENO.filter((reporte) => reporte !== 'DETALLE_DE_POLIZA')

function FiltrosDelReporte({
  tipo,
  filtros,
  onChange,
}: {
  tipo: ReporteDeGaleno
  filtros: FiltrosDeReporteGaleno
  onChange: (filtros: FiltrosDeReporteGaleno) => void
}) {
  const set = (parche: Partial<FiltrosDeReporteGaleno>) => onChange({ ...filtros, ...parche })

  const campoPoliza = (
    <Campo etiqueta="Póliza (opcional)" value={filtros.poliza ?? ''} onChange={(e) => set({ poliza: e.target.value || undefined })} className="w-32" />
  )
  const campoRama = (
    <Selector
      etiqueta="Rama"
      value={filtros.rama ? String(filtros.rama) : ''}
      onChange={(e) => set({ rama: e.target.value ? Number(e.target.value) : undefined })}
      opciones={[
        { valor: '', texto: 'Todas' },
        { valor: '4', texto: 'Autos' },
        { valor: '28', texto: 'Motos' },
      ]}
      className="w-36"
    />
  )
  const rangoDeFechas = (etiquetaDesde: string, etiquetaHasta: string, claveDesde: keyof FiltrosDeReporteGaleno, claveHasta: keyof FiltrosDeReporteGaleno) => (
    <>
      <Campo
        etiqueta={etiquetaDesde}
        placeholder="DD/MM/AAAA"
        value={(filtros[claveDesde] as string | undefined) ?? ''}
        onChange={(e) => set({ [claveDesde]: e.target.value || undefined } as Partial<FiltrosDeReporteGaleno>)}
        className="w-32"
      />
      <Campo
        etiqueta={etiquetaHasta}
        placeholder="DD/MM/AAAA"
        value={(filtros[claveHasta] as string | undefined) ?? ''}
        onChange={(e) => set({ [claveHasta]: e.target.value || undefined } as Partial<FiltrosDeReporteGaleno>)}
        className="w-32"
      />
    </>
  )

  switch (tipo) {
    case 'POLIZAS_POR_LEGAJO':
      return (
        <>
          {campoRama}
          {campoPoliza}
          {rangoDeFechas('Emitidas desde', 'hasta', 'fechaEmisionDesde', 'fechaEmisionHasta')}
        </>
      )
    case 'RIESGOS_DE_POLIZA':
      return (
        <>
          {campoRama}
          {campoPoliza}
        </>
      )
    case 'PRODUCCION_DE_AUTOMOTORES':
      return (
        <>
          {campoPoliza}
          {rangoDeFechas('Vigencia desde', 'hasta', 'inicioVigencia', 'finVigencia')}
        </>
      )
    case 'CUOTAS_IMPAGAS':
    case 'CUOTAS_COBRADAS':
      return (
        <>
          {campoRama}
          {campoPoliza}
        </>
      )
    case 'POLIZAS_VIGENTES':
      return (
        <>
          {campoRama}
          {campoPoliza}
        </>
      )
    case 'ENDOSOS':
      return (
        <>
          {campoRama}
          {campoPoliza}
          {rangoDeFechas('Emitidos desde', 'hasta (máx. 31 días)', 'fechaEmisionDesde', 'fechaEmisionHasta')}
        </>
      )
    case 'CUENTA_CORRIENTE':
      return (
        <>
          <Selector
            etiqueta="Negocio"
            value={String(filtros.idNegocio ?? 20)}
            onChange={(e) => set({ idNegocio: Number(e.target.value) as 27 | 20 })}
            opciones={[
              { valor: '20', texto: 'Seguros y Autos' },
              { valor: '27', texto: 'ART' },
            ]}
            className="w-40"
          />
          <Campo etiqueta="Desde (AAAAMM)" placeholder="202401" value={filtros.mesDesde ?? ''} onChange={(e) => set({ mesDesde: e.target.value || undefined })} className="w-28" />
          <Campo etiqueta="Hasta (AAAAMM)" placeholder="202412" value={filtros.mesHasta ?? ''} onChange={(e) => set({ mesHasta: e.target.value || undefined })} className="w-28" />
        </>
      )
    case 'CONTRATOS_ART':
      return (
        <>
          <Campo etiqueta="Mes (MM)" placeholder="02" value={filtros.mes ?? ''} onChange={(e) => set({ mes: e.target.value || undefined })} className="w-20" />
          <Campo etiqueta="Año (AAAA)" placeholder="2024" value={filtros.anio ?? ''} onChange={(e) => set({ anio: e.target.value || undefined })} className="w-24" />
        </>
      )
    default:
      return null
  }
}

function TablaDeReporte({ reporte }: { reporte: ReporteGaleno }) {
  if (reporte.filas.length === 0) return <p className="text-sm text-slate-500">No hay datos para estos filtros.</p>
  return (
    <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-max text-left text-xs">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {reporte.columnas.map((columna) => (
              <th key={columna.clave} className="whitespace-nowrap border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">
                {columna.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reporte.filas.map((fila, indice) => (
            // eslint-disable-next-line react/no-array-index-key -- las filas no tienen un id propio de Galeno.
            <tr key={indice} className="odd:bg-white even:bg-slate-50">
              {reporte.columnas.map((columna) => (
                <td key={columna.clave} className="whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-slate-700">
                  {fila[columna.clave] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportesGaleno() {
  const [tipo, setTipo] = useState<ReporteDeGaleno>('POLIZAS_POR_LEGAJO')
  const [filtros, setFiltros] = useState<FiltrosDeReporteGaleno>({})
  const [reporte, setReporte] = useState<ReporteGaleno | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const elegirTipo = (nuevo: ReporteDeGaleno) => {
    setTipo(nuevo)
    setFiltros({})
    setReporte(null)
    setError(null)
  }

  const buscar = async () => {
    setBuscando(true)
    setError(null)
    const resultado = await window.dm.galeno.reporte(tipo, filtros)
    setBuscando(false)
    if (resultado.ok) setReporte(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Tarjeta
      titulo="Consultas, Cuenta Corriente y ART"
      descripcion="Todo lo que la API de Galeno permite consultar: pólizas, riesgos, producción, cuotas, endosos, la cuenta corriente y los contratos de ART. Se pide con el legajo del productor ya identificado."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Selector
            etiqueta="Reporte"
            value={tipo}
            onChange={(evento) => elegirTipo(evento.target.value as ReporteDeGaleno)}
            opciones={REPORTES_VISIBLES.map((r) => ({ valor: r, texto: NOMBRE_REPORTE_GALENO[r] }))}
            className="w-56"
          />
          <FiltrosDelReporte tipo={tipo} filtros={filtros} onChange={setFiltros} />
          <Boton variante="primario" onClick={() => void buscar()} cargando={buscando}>
            Buscar
          </Boton>
        </div>
        {error && <Alerta tono="error">{error}</Alerta>}
        {reporte && <TablaDeReporte reporte={reporte} />}
      </div>
    </Tarjeta>
  )
}
