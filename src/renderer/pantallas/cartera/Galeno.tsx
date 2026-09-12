// Cartera → Galeno: lo que pasó en el portal de Galeno y todavía no está en la cartera.
//
// Qué se ve y por qué. El servidor consulta Galeno cada quince minutos y deja acá lo que cambió. Lo
// que emparejó por documento con un único cliente se aplica solo y no llega a esta pantalla; lo que
// queda es exactamente lo que necesita a una persona:
//
//   · Nuevas    — hay que decir con qué cliente va (o crearlo).
//   · Cambios   — Galeno modificó algo de una póliza que no está en la cartera.
//   · Anuladas  — Galeno la anuló. NUNCA se da de baja sola: se avisa y la baja la hace una persona
//                 desde la póliza, que es donde están el motivo y la fecha.
//
// La comparación «Galeno dice / la cartera dice» está a la vista en las modificaciones: sin eso, quien
// mira no tiene forma de saber qué cambió y termina abriendo las dos pantallas en paralelo.
import { useCallback, useEffect, useState } from 'react'
import type {
  EstadoDeGaleno,
  FilaDeBandejaDeGaleno,
  PolizaDeGaleno,
  ResolucionDeNovedadDeGaleno,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx, Etiqueta } from '../../componentes/ui'
import { usePermisos } from '../../contexto/Permisos'

type Solapa = 'nuevas' | 'cambios' | 'anuladas'

const SOLAPA_DE_RESOLUCION: Record<ResolucionDeNovedadDeGaleno, Solapa> = {
  'falta-cliente': 'nuevas',
  'cliente-ambiguo': 'nuevas',
  automatica: 'cambios',
  error: 'cambios',
  'anulada-en-galeno': 'anuladas',
}

const TITULO_DE_SOLAPA: Record<Solapa, string> = {
  nuevas: 'Nuevas',
  cambios: 'Cambios',
  anuladas: 'Anuladas',
}

function fecha(iso: string | null): string {
  if (!iso) return 'nunca'
  const valor = new Date(iso)
  if (Number.isNaN(valor.getTime())) return iso
  return valor.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function Galeno() {
  const permisos = usePermisos()
  const puedeAplicar = permisos.puedeEditar('cartera')

  const [estado, setEstado] = useState<EstadoDeGaleno | null>(null)
  const [bandeja, setBandeja] = useState<FilaDeBandejaDeGaleno[]>([])
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [solapa, setSolapa] = useState<Solapa>('nuevas')
  const [trabajando, setTrabajando] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const [respuestaEstado, respuestaBandeja] = await Promise.all([
      window.dm.galeno.estado(),
      window.dm.galeno.bandeja(),
    ])
    if (respuestaEstado.ok) setEstado(respuestaEstado.datos)
    if (respuestaBandeja.ok) {
      setBandeja(respuestaBandeja.datos)
      setError(null)
    } else {
      setError(respuestaBandeja.error)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const sincronizar = async () => {
    setSincronizando(true)
    setAviso(null)
    const resultado = await window.dm.galeno.sincronizar()
    if (resultado.ok) {
      const resumen = resultado.datos
      setAviso(
        `${resumen.altas} nueva(s), ${resumen.modificaciones} cambio(s) y ${resumen.anulaciones} anulación(es) ` +
          `sobre ${resumen.polizasVistas} pólizas.` +
          // Un legajo que falló queda INTACTO y se reintenta: decirlo evita que alguien lea «0 cambios»
          // como «Galeno no tiene nada nuevo» cuando en realidad no se pudo preguntar.
          (resumen.errores.length > 0
            ? ` ${resumen.errores.length} legajo(s) no se pudieron consultar y quedaron sin tocar.`
            : ''),
      )
      await cargar()
    } else {
      setError(resultado.error)
    }
    setSincronizando(false)
  }

  const aplicar = async (fila: FilaDeBandejaDeGaleno, clienteId: number | null, crearElCliente: boolean) => {
    setTrabajando(fila.novedad.id)
    setAviso(null)
    const resultado = await window.dm.galeno.aplicar(fila.novedad.id, clienteId, crearElCliente)
    if (resultado.ok) {
      setAviso(`Póliza ${fila.novedad.datos.numeroPoliza} cargada en la cartera.`)
      await cargar()
    } else {
      setError(resultado.error)
    }
    setTrabajando(null)
  }

  const descartar = async (fila: FilaDeBandejaDeGaleno) => {
    setTrabajando(fila.novedad.id)
    const resultado = await window.dm.galeno.descartar(fila.novedad.id, 'Descartada desde la bandeja.')
    if (resultado.ok) {
      setAviso(`Novedad de la póliza ${fila.novedad.datos.numeroPoliza} descartada.`)
      await cargar()
    } else {
      setError(resultado.error)
    }
    setTrabajando(null)
  }

  const deLaSolapa = bandeja.filter((fila) => SOLAPA_DE_RESOLUCION[fila.resolucion] === solapa)
  const cuenta = (cual: Solapa) => bandeja.filter((fila) => SOLAPA_DE_RESOLUCION[fila.resolucion] === cual).length

  if (cargando && !estado) return <Cargando texto="Consultando las novedades de Galeno…" />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <Cabecera
        estado={estado}
        sincronizando={sincronizando}
        puedeAplicar={puedeAplicar}
        alSincronizar={() => void sincronizar()}
        alActualizar={() => void cargar()}
      />

      {estado && !estado.configurado && (
        <Alerta tono="aviso">
          Galeno todavía no está configurado. Un superadministrador tiene que cargar el usuario y la clave del portal
          en Administración → Ajustes compartidos.
        </Alerta>
      )}
      {estado?.ultimoError && <Alerta tono="error">La última pasada falló: {estado.ultimoError}</Alerta>}
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="info">{aviso}</Alerta>}

      <div className="flex flex-wrap items-center gap-2">
        {(['nuevas', 'cambios', 'anuladas'] as const).map((cual) => (
          <button
            key={cual}
            type="button"
            onClick={() => setSolapa(cual)}
            className={cx(
              'rounded-full px-3.5 py-1.5 text-sm font-semibold transition',
              solapa === cual ? 'bg-marino-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {TITULO_DE_SOLAPA[cual]}
            <span className="ml-1.5 tabular-nums opacity-75">{cuenta(cual)}</span>
          </button>
        ))}
      </div>

      {deLaSolapa.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Icono nombre="ok" tamano={28} className="text-slate-300" />
          No hay nada pendiente en «{TITULO_DE_SOLAPA[solapa]}».
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {deLaSolapa.map((fila) => (
            <TarjetaDeNovedad
              key={fila.novedad.id}
              fila={fila}
              puedeAplicar={puedeAplicar}
              trabajando={trabajando === fila.novedad.id}
              alAplicar={(clienteId, crear) => void aplicar(fila, clienteId, crear)}
              alDescartar={() => void descartar(fila)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Cabecera({
  estado,
  sincronizando,
  puedeAplicar,
  alSincronizar,
  alActualizar,
}: {
  estado: EstadoDeGaleno | null
  sincronizando: boolean
  puedeAplicar: boolean
  alSincronizar: () => void
  alActualizar: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-base font-bold text-slate-800">Galeno</h2>
      {estado && (
        <span className="text-sm text-slate-500">
          Última sincronización: {fecha(estado.ultimoExitoEn)} · {estado.pendientes.toLocaleString('es-AR')} pendiente(s)
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Boton tamano="sm" variante="fantasma" icono="cargando" onClick={alActualizar}>
          Actualizar
        </Boton>
        {puedeAplicar && (
          <Boton tamano="sm" icono="cargando" onClick={alSincronizar} disabled={sincronizando} cargando={sincronizando}>
            Sincronizar ahora
          </Boton>
        )}
      </div>
    </div>
  )
}

function TarjetaDeNovedad({
  fila,
  puedeAplicar,
  trabajando,
  alAplicar,
  alDescartar,
}: {
  fila: FilaDeBandejaDeGaleno
  puedeAplicar: boolean
  trabajando: boolean
  alAplicar: (clienteId: number | null, crearElCliente: boolean) => void
  alDescartar: () => void
}) {
  const poliza = fila.novedad.datos
  const anulada = fila.resolucion === 'anulada-en-galeno'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-800 tabular-nums">Póliza {poliza.numeroPoliza}</span>
        <Etiqueta tono={anulada ? 'peligro' : fila.novedad.tipo === 'ALTA' ? 'marca' : 'aviso'}>
          {fila.novedad.tipo === 'ALTA' ? 'Nueva' : fila.novedad.tipo === 'ANULACION' ? 'Anulada' : 'Modificada'}
        </Etiqueta>
        {poliza.patente && <span className="text-sm text-slate-500">{poliza.patente}</span>}
        <span className="ml-auto text-xs text-slate-400">{fecha(fila.novedad.creadoEn)}</span>
      </div>

      <div className="mt-1.5 text-sm text-slate-600">
        {poliza.nombre || 'Sin tomador'} · {poliza.documento || 'sin documento'}
        {poliza.localidad ? ` · ${poliza.localidad}` : ''}
      </div>
      <div className="mt-0.5 text-sm text-slate-500">
        Vigencia {poliza.vigenciaDesde || '?'} a {poliza.vigenciaHasta || '?'}
        {poliza.cobertura ? ` · ${poliza.cobertura}` : ''}
        {poliza.formaPago ? ` · ${poliza.formaPago}` : ''}
      </div>

      {fila.novedad.anterior && <Comparacion antes={fila.novedad.anterior} ahora={poliza} />}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">{fila.detalle}</span>

        {puedeAplicar && !anulada && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {fila.candidatos.map((candidato) => (
              <Boton
                key={candidato.clienteId}
                tamano="sm"
                variante="secundario"
                disabled={trabajando}
                onClick={() => alAplicar(candidato.clienteId, false)}
              >
                Usar a {candidato.nombre}
              </Boton>
            ))}
            {fila.resolucion === 'falta-cliente' && (
              <Boton tamano="sm" disabled={trabajando} cargando={trabajando} onClick={() => alAplicar(null, true)}>
                Crear cliente y cargar
              </Boton>
            )}
            {fila.resolucion === 'automatica' && (
              <Boton tamano="sm" disabled={trabajando} cargando={trabajando} onClick={() => alAplicar(null, false)}>
                Aplicar
              </Boton>
            )}
            <Boton tamano="sm" variante="fantasma" disabled={trabajando} onClick={alDescartar}>
              Descartar
            </Boton>
          </div>
        )}

        {puedeAplicar && anulada && (
          <div className="ml-auto flex items-center gap-2">
            {/* No hay botón de «dar de baja». Es a propósito: la baja lleva motivo y fecha, y ésos se
                cargan en la póliza. Un botón acá invitaría a darla de baja sin mirar nada. */}
            <Boton tamano="sm" variante="fantasma" disabled={trabajando} onClick={alDescartar}>
              Ya la di de baja
            </Boton>
          </div>
        )}
      </div>
    </div>
  )
}

/** Qué cambió entre lo que teníamos y lo que dice Galeno ahora. Sólo los campos distintos. */
function Comparacion({ antes, ahora }: { antes: PolizaDeGaleno; ahora: PolizaDeGaleno }) {
  const campos: Array<[string, keyof PolizaDeGaleno]> = [
    ['Tomador', 'nombre'],
    ['Documento', 'documento'],
    ['Domicilio', 'direccion'],
    ['Localidad', 'localidad'],
    ['Desde', 'vigenciaDesde'],
    ['Hasta', 'vigenciaHasta'],
    ['Forma de pago', 'formaPago'],
    ['Suplemento', 'suplemento'],
  ]
  const distintos = campos.filter(([, campo]) => String(antes[campo] ?? '') !== String(ahora[campo] ?? ''))
  if (distintos.length === 0) return null

  return (
    <div className="mt-2 rounded-md bg-slate-50 p-2.5 text-sm">
      {distintos.map(([etiqueta, campo]) => (
        <div key={campo} className="flex flex-wrap gap-x-2">
          <span className="font-medium text-slate-600">{etiqueta}:</span>
          <span className="text-slate-400 line-through">{String(antes[campo] ?? '') || '(vacío)'}</span>
          <Icono nombre="flechaDerecha" tamano={14} className="mt-0.5 text-slate-400" />
          <span className="font-medium text-slate-800">{String(ahora[campo] ?? '') || '(vacío)'}</span>
        </div>
      ))}
    </div>
  )
}
