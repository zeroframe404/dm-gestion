// Importar desde Google: analiza la hoja configurada, corre la importación con progreso por pestaña
// y muestra el informe final (descargable como archivo de texto).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  NOMBRE_TIPO_PESTANA,
  type EstadoImportacion,
  type EstadoImportador,
  type EstadoPestanaImportada,
  type InformeImportacion,
  type ProgresoImportacion,
  type ProgresoPestana,
  type EstadoConexionGoogle,
  type VistaPreviaHoja,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, Dialogo, Etiqueta, Tarjeta, cx } from '../../componentes/ui'

const NOMBRE_ESTADO: Record<EstadoImportacion, string> = {
  EN_CURSO: 'En curso',
  COMPLETA: 'Completa',
  CON_ERRORES: 'Completa con errores',
  CANCELADA: 'Cancelada',
  FALLIDA: 'Fallida',
}

const TONO_ESTADO: Record<EstadoImportacion, 'marca' | 'exito' | 'aviso' | 'neutro' | 'peligro'> = {
  EN_CURSO: 'marca',
  COMPLETA: 'exito',
  CON_ERRORES: 'aviso',
  CANCELADA: 'neutro',
  FALLIDA: 'peligro',
}

const NOMBRE_ESTADO_PESTANA: Record<EstadoPestanaImportada, string> = {
  pendiente: 'Pendiente',
  leyendo: 'Leyendo…',
  escribiendo_ids: 'Escribiendo _ID…',
  guardando: 'Guardando…',
  lista: 'Lista',
  error: 'Error',
  omitida: 'Omitida',
}

const NOMBRE_REGISTRO: Record<string, string> = {
  filas_crudas: 'crudas',
  clientes: 'clientes',
  clientes_unificados: 'unificados',
  vehiculos: 'vehículos',
  polizas: 'pólizas',
  cuotas_mes: 'cuotas',
  cuotas_con_texto: 'cuotas con texto',
  cuotas_sin_poliza_vigente: 'sin póliza vigente',
  bajas: 'bajas',
  bajas_sin_poliza_conocida: 'sin póliza conocida',
  riesgos_varios: 'riesgos',
  riesgos_sin_cliente_en_cartera: 'sin cliente',
  siniestros: 'siniestros',
  pagos: 'pagos',
  reglas_cobertura: 'reglas',
  clientes_con_documento_nuevo: 'con documento nuevo',
  clientes_con_clave_corregida: 'clientes corregidos',
  vehiculos_con_clave_corregida: 'vehículos corregidos',
  polizas_con_clave_corregida: 'pólizas corregidas',
  filas_que_ya_no_estan: 'ya no están en la hoja',
  filas_de_encabezado_repetidas: 'encabezados repetidos',
  filas_sin_id_no_guardadas: 'sin _ID: no guardadas',
}

function formatearFecha(iso: string | null): string {
  if (!iso) return '-'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function ImportarGoogle() {
  const [estado, setEstado] = useState<EstadoImportador | null>(null)
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<VistaPreviaHoja | null>(null)
  const [analizando, setAnalizando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [iniciando, setIniciando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [conexion, setConexion] = useState<EstadoConexionGoogle | null>(null)

  useEffect(() => {
    let vigente = true
    void window.dm.importacion.estado().then((resultado) => {
      if (!vigente) return
      if (resultado.ok) setEstado(resultado.datos)
      else setError(resultado.error)
      setCargando(false)
    })
    void window.dm.config.estadoGoogle().then((resultado) => {
      if (vigente && resultado.ok) setConexion(resultado.datos)
    })
    // El progreso mantiene la importación "en curso" hasta que llega el evento de terminada con el informe
    // nuevo; si no, por un instante se mostraría el informe anterior como si fuera el actual.
    const dejarDeEscucharProgreso = window.dm.importacion.alProgresar((progreso) => {
      setEstado((previo) => ({ enCurso: true, progreso, ultima: previo?.ultima ?? null }))
    })
    const dejarDeEscucharFin = window.dm.importacion.alTerminar((informe) => {
      setEstado({ enCurso: false, progreso: null, ultima: informe })
      setCancelando(false)
    })
    return () => {
      vigente = false
      dejarDeEscucharProgreso()
      dejarDeEscucharFin()
    }
  }, [])

  const analizar = useCallback(async () => {
    setAnalizando(true)
    setError(null)
    const resultado = await window.dm.importacion.vistaPrevia()
    if (resultado.ok) setVista(resultado.datos)
    else setError(resultado.error)
    setAnalizando(false)
  }, [])

  const iniciar = useCallback(async () => {
    setIniciando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.importacion.iniciar()
    if (!resultado.ok) setError(resultado.error)
    setIniciando(false)
    setConfirmando(false)
  }, [])

  const cancelar = useCallback(async () => {
    setCancelando(true)
    const resultado = await window.dm.importacion.cancelar()
    if (!resultado.ok) {
      setError(resultado.error)
      setCancelando(false)
    }
  }, [])

  const descargar = useCallback(async (importacionId: number) => {
    setGuardando(true)
    setAviso(null)
    const resultado = await window.dm.importacion.guardarInforme(importacionId)
    if (resultado.ok) {
      if (resultado.datos.ruta) setAviso(`Informe guardado en ${resultado.datos.ruta}`)
    } else {
      setError(resultado.error)
    }
    setGuardando(false)
  }, [])

  const abrirCarpeta = useCallback(() => {
    void window.dm.importacion.abrirCarpetaInformes()
  }, [])

  const enCurso = estado?.enCurso ?? false
  const sinConexion = conexion !== null && !conexion.configurado

  // Al arrancar una importación, el panel de progreso se trae a la vista (la vista previa puede ser larga).
  const refProgreso = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (enCurso) refProgreso.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [enCurso])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Tarjeta
        titulo="Importar desde Google"
        descripcion="Lee completa la hoja configurada en «Conexión con Google», escribe una columna _ID oculta en cada pestaña y carga la base local. Se puede volver a correr: las filas se reconocen por su _ID y no se duplican."
        acciones={
          <>
            <Boton icono="lupa" onClick={() => void analizar()} cargando={analizando} disabled={enCurso || sinConexion}>
              Analizar hoja
            </Boton>
            <Boton variante="primario" icono="nubeBajada" onClick={() => setConfirmando(true)} disabled={enCurso || cargando || sinConexion}>
              Importar
            </Boton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {error && <Alerta tono="error">{error}</Alerta>}
          {aviso && <Alerta tono="exito">{aviso}</Alerta>}
          {sinConexion && (
            <Alerta tono="aviso">
              Todavía no hay ninguna hoja conectada. Entrá a <strong className="font-semibold">Administración → Conexión con Google</strong>, pegá el JSON de la
              cuenta de servicio y la dirección de la hoja, y volvé acá.
            </Alerta>
          )}
          {!vista && !error && !estado?.ultima && !enCurso && (
            <p className="text-sm text-slate-500">
              Analizá la hoja para ver qué pestañas se detectan, qué tipo de datos tiene cada una y cuál es la planilla mensual más nueva.
            </p>
          )}
          {vista && (
            <p className="text-sm text-slate-700">
              Hoja <strong className="font-semibold text-slate-900">«{vista.titulo}»</strong> · {vista.pestanas.length} pestañas detectadas
              {vista.pestanas.some((p) => p.esLaMasNueva) && (
                <>
                  {' '}
                  · planilla más nueva:{' '}
                  <strong className="font-semibold text-slate-900">{vista.pestanas.find((p) => p.esLaMasNueva)?.titulo}</strong>
                </>
              )}
              . El detalle está al pie de la pantalla. La planilla más nueva es tentativa: al importar se confirma que tenga filas cargadas.
            </p>
          )}
        </div>
      </Tarjeta>

      {cargando && <Cargando />}

      <div ref={refProgreso}>
        {enCurso && estado?.progreso && (
          <Tarjeta
            titulo="Importación en curso"
            descripcion="No cierres la aplicación hasta que termine. Podés cancelar: lo ya guardado queda en la base."
            acciones={
              <Boton variante="peligro" icono="detener" onClick={() => void cancelar()} cargando={cancelando} disabled={cancelando}>
                {cancelando ? 'Cancelando al terminar la pestaña actual…' : 'Cancelar'}
              </Boton>
            }
          >
            <Progreso progreso={estado.progreso} />
          </Tarjeta>
        )}
      </div>

      {!enCurso && estado?.ultima && (
        <ResultadoImportacion informe={estado.ultima} guardando={guardando} alDescargar={descargar} alAbrirCarpeta={abrirCarpeta} />
      )}

      {vista && (
        <Tarjeta titulo="Pestañas de la hoja" descripcion="Cómo se clasificó cada pestaña y qué período se le asignó.">
          <VistaPrevia vista={vista} />
        </Tarjeta>
      )}

      <Dialogo
        abierto={confirmando}
        titulo="¿Importar desde Google?"
        alCerrar={() => setConfirmando(false)}
        pie={
          <>
            <Boton onClick={() => setConfirmando(false)} disabled={iniciando}>
              Cancelar
            </Boton>
            <Boton variante="primario" icono="nubeBajada" onClick={() => void iniciar()} cargando={iniciando}>
              Importar ahora
            </Boton>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-600">
          <p>
            Se va a leer completa la hoja {vista ? <strong className="font-semibold text-slate-900">«{vista.titulo}»</strong> : 'configurada'} y a cargar
            la base local con clientes, vehículos, pólizas, cuotas por mes, bajas, riesgos varios, siniestros, reglas de cobertura y pagos.
          </p>
          <p>
            En cada pestaña se escribe una columna <code className="rounded bg-slate-100 px-1 font-mono text-xs">_ID</code> (después se oculta) con un
            identificador por fila. Es la clave para sincronizar más adelante y para que volver a importar no duplique nada.
          </p>
          <p>Los datos raros (fechas imposibles, cuotas no numéricas, DNI repetidos, sucursales desconocidas) se anotan en el informe y no frenan la importación.</p>
        </div>
      </Dialogo>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vista previa de pestañas
// ---------------------------------------------------------------------------
function VistaPrevia({ vista }: { vista: VistaPreviaHoja }) {
  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className={encabezado}>Pestaña</th>
              <th className={encabezado}>Tipo</th>
              <th className={encabezado}>Período</th>
              <th className={cx(encabezado, 'text-right')}>Filas</th>
              <th className={cx(encabezado, 'text-right')}>Columnas</th>
            </tr>
          </thead>
          <tbody>
            {vista.pestanas.map((p) => (
              <tr key={p.sheetId} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 font-medium text-slate-900">
                  <span className="font-mono">{p.titulo.replace(/ $/, '␣')}</span>
                  {p.esLaMasNueva && (
                    <span className="ml-2">
                      <Etiqueta tono="marca">Más nueva</Etiqueta>
                    </span>
                  )}
                  {p.oculta && (
                    <span className="ml-2">
                      <Etiqueta tono="neutro">Oculta</Etiqueta>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-600">{NOMBRE_TIPO_PESTANA[p.tipo]}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.periodo ?? '-'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{p.filas}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{p.columnas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Progreso
// ---------------------------------------------------------------------------
function IconoDeEstado({ estado }: { estado: EstadoPestanaImportada }) {
  if (estado === 'lista') return <Icono nombre="ok" tamano={16} className="text-green-600" />
  if (estado === 'error') return <Icono nombre="alerta" tamano={16} className="text-red-600" />
  if (estado === 'omitida') return <Icono nombre="cerrar" tamano={16} className="text-slate-400" />
  if (estado === 'pendiente') return <span className="inline-block h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
  return <Icono nombre="cargando" tamano={16} className="animate-spin text-marino-600" />
}

function Progreso({ progreso }: { progreso: ProgresoImportacion }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-slate-800">{progreso.mensaje}</span>
          <span className="tabular-nums text-slate-500">{progreso.porcentaje}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={progreso.porcentaje} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 rounded-full bg-marino-600 transition-all duration-300" style={{ width: `${progreso.porcentaje}%` }} />
        </div>
      </div>
      {progreso.pestanas.length > 0 && (
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {progreso.pestanas.map((p: ProgresoPestana) => (
            <li key={p.titulo} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
              <span className="flex w-4 shrink-0 justify-center">
                <IconoDeEstado estado={p.estado} />
              </span>
              <span className="truncate font-mono text-slate-800">{p.titulo.replace(/ $/, '␣')}</span>
              <span className="ml-auto shrink-0 text-xs text-slate-500">
                {NOMBRE_ESTADO_PESTANA[p.estado]}
                {p.filas !== null ? ` · ${p.filas} filas` : ''}
                {p.detalle ? ` · ${p.detalle}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------
interface PropsResultado {
  informe: InformeImportacion
  guardando: boolean
  alDescargar: (importacionId: number) => void
  alAbrirCarpeta: () => void
}

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: number; detalle?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{etiqueta}</p>
      <p className="font-display text-xl font-extrabold tracking-tight text-slate-900 tabular-nums">{valor.toLocaleString('es-AR')}</p>
      {detalle && <p className="text-xs text-slate-500">{detalle}</p>}
    </div>
  )
}

function ResultadoImportacion({ informe, guardando, alDescargar, alAbrirCarpeta }: PropsResultado) {
  const t = informe.totales
  const tipos = Object.entries(informe.problemasPorTipo).sort((a, b) => b[1] - a[1])
  const sucursales = Object.entries(informe.sucursalesDesconocidas).sort((a, b) => b[1] - a[1])
  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <Tarjeta
      titulo="Informe de importación"
      descripcion={
        <>
          Importación Nº {informe.id} · hoja «{informe.hojaTitulo || '-'}» · {formatearFecha(informe.iniciadaEn)} → {formatearFecha(informe.terminadaEn)}
          {informe.pestanaMasNueva && (
            <>
              {' '}
              · planilla más nueva: <strong className="font-semibold text-slate-800">{informe.pestanaMasNueva}</strong>
            </>
          )}
        </>
      }
      acciones={
        <>
          <Etiqueta tono={TONO_ESTADO[informe.estado]}>{NOMBRE_ESTADO[informe.estado]}</Etiqueta>
          <Boton icono="carpeta" onClick={alAbrirCarpeta}>
            Abrir carpeta
          </Boton>
          <Boton variante="primario" icono="descargar" onClick={() => alDescargar(informe.id)} cargando={guardando}>
            Descargar informe
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {informe.error && <Alerta tono="error">{informe.error}</Alerta>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Cifra etiqueta="Clientes" valor={t.clientes} />
          <Cifra etiqueta="Vehículos" valor={t.vehiculos} />
          <Cifra etiqueta="Pólizas activas" valor={t.polizas} detalle={t.polizasInactivadas ? `${t.polizasInactivadas} inactivadas` : undefined} />
          <Cifra etiqueta="Cuotas por mes" valor={t.cuotasMes} />
          <Cifra etiqueta="Bajas" valor={t.bajas} />
          <Cifra etiqueta="Riesgos varios" valor={t.riesgosVarios} />
          <Cifra etiqueta="Siniestros" valor={t.siniestros} />
          <Cifra etiqueta="Reglas cobertura" valor={t.reglasCobertura} />
          <Cifra etiqueta="Pagos" valor={t.pagos} />
          <Cifra
            etiqueta="Datos raros"
            valor={t.problemas}
            detalle={`${t.filasCrudas.toLocaleString('es-AR')} filas crudas${t.filasQueYaNoEstan ? ` · ${t.filasQueYaNoEstan} ya no están en la hoja` : ''}`}
          />
        </div>

        {informe.avisos.length > 0 && (
          <Alerta tono="aviso">
            <ul className="list-disc space-y-1 pl-4">
              {informe.avisos.map((aviso, i) => (
                <li key={i}>{aviso}</li>
              ))}
            </ul>
          </Alerta>
        )}

        {(tipos.length > 0 || sucursales.length > 0) && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {tipos.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Datos raros por tipo</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {tipos.map(([tipo, cantidad]) => (
                    <li key={tipo} className="flex items-center justify-between gap-3 rounded px-2 py-1 odd:bg-slate-50">
                      <span className="text-slate-700">{tipo}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{cantidad}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sucursales.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Sucursales fuera de catálogo</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {sucursales.map(([valor, cantidad]) => (
                    <li key={valor} className="flex items-center justify-between gap-3 rounded px-2 py-1 odd:bg-slate-50">
                      <span className="font-mono text-slate-700">{valor}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{cantidad} filas</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Pestañas</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className={encabezado}>Pestaña</th>
                  <th className={encabezado}>Tipo</th>
                  <th className={encabezado}>Período</th>
                  <th className={encabezado}>Estado</th>
                  <th className={cx(encabezado, 'text-right')}>Con datos</th>
                  <th className={cx(encabezado, 'text-right')}>_ID nuevos</th>
                  <th className={encabezado}>Registros</th>
                  <th className={cx(encabezado, 'text-right')}>Raros</th>
                </tr>
              </thead>
              <tbody>
                {informe.pestanas.map((p) => (
                  <tr key={p.titulo} className="border-b border-slate-100 last:border-b-0 align-top">
                    <td className="px-3 py-2 font-mono text-slate-900">{p.titulo.replace(/ $/, '␣')}</td>
                    <td className="px-3 py-2 text-slate-600">{NOMBRE_TIPO_PESTANA[p.tipo]}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.periodo ?? '-'}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <IconoDeEstado estado={p.estado} />
                        <span className="text-slate-700">{NOMBRE_ESTADO_PESTANA[p.estado]}</span>
                      </span>
                      {p.error && <p className="mt-1 text-xs text-red-600">{p.error}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{p.filasConDatos}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {p.idsNuevos}
                      <span className="text-xs text-slate-400"> / {p.idsExistentes} ya tenían</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {Object.entries(p.registros)
                        .map(([clave, cantidad]) => `${cantidad} ${NOMBRE_REGISTRO[clave] ?? clave}`)
                        .join(' · ') || '-'}
                    </td>
                    <td className={cx('px-3 py-2 text-right tabular-nums', p.problemas ? 'font-semibold text-amber-700' : 'text-slate-400')}>{p.problemas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {informe.problemas.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {informe.problemas.length <= 200 && informe.problemasOmitidos === 0
                ? `Detalle de las ${informe.problemas.length} filas con datos raros`
                : `Detalle: se muestran ${Math.min(informe.problemas.length, 200)} de ${(informe.problemas.length + informe.problemasOmitidos).toLocaleString('es-AR')} · el informe descargable lista ${informe.problemas.length.toLocaleString('es-AR')}; el resto se cuenta por tipo`}
            </p>
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className={encabezado}>Pestaña</th>
                    <th className={encabezado}>Fila</th>
                    <th className={encabezado}>Tipo</th>
                    <th className={encabezado}>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {informe.problemas.slice(0, 200).map((problema, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-b-0 align-top">
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap text-slate-700">{problema.pestana}</td>
                      <td className="px-3 py-1.5 tabular-nums text-slate-600">{problema.fila ?? '-'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">{problema.tipo}</td>
                      <td className="px-3 py-1.5 text-slate-600">{problema.detalle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {informe.rutaInforme && (
          <p className="text-xs text-slate-500">
            Informe guardado automáticamente en <code className="rounded bg-slate-100 px-1 font-mono">{informe.rutaInforme}</code>
          </p>
        )}
      </div>
    </Tarjeta>
  )
}
