// Administración → Sincronización: qué está esperando para subir, qué pasó últimamente y los respaldos.
import { useCallback, useEffect, useState } from 'react'
import type { PanelSincronizacion } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, Etiqueta, Tarjeta, cx } from '../../componentes/ui'

function fecha(iso: string | null): string {
  if (!iso) return '—'
  const f = new Date(iso)
  return Number.isNaN(f.getTime()) ? iso : f.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' })
}

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const TONO_EVENTO: Record<string, 'marca' | 'exito' | 'aviso' | 'neutro' | 'peligro'> = {
  subida: 'exito',
  bajada: 'marca',
  respaldo: 'neutro',
  conflicto: 'aviso',
  conexion: 'aviso',
  error: 'peligro',
  motor: 'neutro',
}

const NOMBRE_OPERACION: Record<string, string> = {
  actualizar: 'Editar',
  crear: 'Agregar fila',
  borrar: 'Quitar fila',
}

export function Sincronizacion() {
  const [panel, setPanel] = useState<PanelSincronizacion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.sincronizacion.panel()
    if (resultado.ok) setPanel(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
    const reloj = setInterval(() => void cargar(), 10_000)
    return () => clearInterval(reloj)
  }, [cargar])

  const correr = async (que: string, accion: () => Promise<void>) => {
    setOcupado(que)
    setError(null)
    setAviso(null)
    await accion()
    await cargar()
    setOcupado(null)
  }

  if (cargando) return <Cargando />
  if (!panel) return <Alerta tono="error">{error ?? 'No se pudo leer el estado de la sincronización.'}</Alerta>

  const { estado } = panel
  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {!estado.configurada && (
        <Alerta tono="aviso">
          Todavía no hay hoja conectada, así que la sincronización está apagada y todo se guarda sólo acá. Cargá la cuenta de servicio en{' '}
          <strong className="font-semibold">Conexión con Google</strong>.
        </Alerta>
      )}
      {estado.ultimoError && <Alerta tono="error">Último error de sincronización: {estado.ultimoError}</Alerta>}

      <Tarjeta
        titulo="Estado"
        descripcion="La aplicación sube cada 10 segundos lo que se va tocando y baja de la hoja cada 5 minutos."
        acciones={
          <>
            <Boton
              icono="cargando"
              cargando={ocupado === 'ahora'}
              disabled={!estado.configurada}
              onClick={() =>
                void correr('ahora', async () => {
                  const r = await window.dm.sincronizacion.ahora(false)
                  if (!r.ok) setError(r.error)
                })
              }
            >
              Sincronizar ahora
            </Boton>
            <Boton
              variante="primario"
              icono="nubeBajada"
              cargando={ocupado === 'completa'}
              disabled={!estado.configurada}
              onClick={() =>
                void correr('completa', async () => {
                  const r = await window.dm.sincronizacion.ahora(true)
                  if (r.ok) setAviso('Bajada completa terminada.')
                  else setError(r.error)
                })
              }
            >
              Forzar bajada completa
            </Boton>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cifra etiqueta="Por subir" valor={estado.pendientes} tono={estado.pendientes > 0 ? 'aviso' : 'neutro'} />
          <Cifra etiqueta="Con problemas" valor={estado.fallidas} tono={estado.fallidas > 0 ? 'peligro' : 'neutro'} />
          <Dato etiqueta="Última bajada" valor={fecha(estado.ultimaBajada)} />
          <Dato etiqueta="Última subida" valor={fecha(estado.ultimaSubida)} />
        </div>
        {estado.fallidas > 0 && (
          <div className="mt-3">
            <Boton
              tamano="sm"
              cargando={ocupado === 'reintentar'}
              onClick={() =>
                void correr('reintentar', async () => {
                  const r = await window.dm.sincronizacion.reintentar()
                  if (r.ok) setAviso(`${r.datos} cambios vuelven a la cola.`)
                  else setError(r.error)
                })
              }
            >
              Volver a intentar los que fallaron
            </Boton>
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo="Cola de subida" descripcion="Lo que todavía no llegó a la hoja. Si no hay internet, espera acá sin perderse." alRas>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={encabezado}>Cuándo</th>
                <th className={encabezado}>Qué</th>
                <th className={encabezado}>Pestaña</th>
                <th className={encabezado}>Campos</th>
                <th className={encabezado}>Quién</th>
                <th className={encabezado}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {panel.cola.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    {estado.configurada
                      ? `No hay nada esperando: todo lo de esta computadora ya está en la hoja.`
                      : `No hay nada encolado todavía. Cuando conectes la hoja, lo que se vaya tocando va a aparecer acá hasta que suba.`}
                  </td>
                </tr>
              )}
              {panel.cola.map((entrada) => (
                <tr key={entrada.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fecha(entrada.creadoEn)}</td>
                  <td className="px-3 py-2 text-slate-700">{NOMBRE_OPERACION[entrada.operacion] ?? entrada.operacion}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{entrada.pestana}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{entrada.campos.join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{entrada.usuarioNombre ?? '—'}</td>
                  <td className="px-3 py-2">
                    {entrada.estado === 'fallido' ? (
                      <span title={entrada.ultimoError ?? undefined}>
                        <Etiqueta tono="peligro">No se pudo</Etiqueta>
                      </span>
                    ) : entrada.intentos > 0 ? (
                      <span title={entrada.ultimoError ?? undefined}>
                        <Etiqueta tono="aviso">Reintentando ({entrada.intentos})</Etiqueta>
                      </span>
                    ) : (
                      <Etiqueta tono="neutro">Esperando</Etiqueta>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Últimos movimientos" descripcion="Los 50 más recientes." alRas>
        <ul className="max-h-80 divide-y divide-slate-100 overflow-auto">
          {panel.eventos.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Todavía no pasó nada.</li>}
          {panel.eventos.map((evento) => (
            <li key={evento.id} className="flex items-start gap-3 px-4 py-2">
              <span className="mt-0.5 shrink-0">
                <Etiqueta tono={evento.conError ? 'peligro' : (TONO_EVENTO[evento.tipo] ?? 'neutro')}>{evento.tipo}</Etiqueta>
              </span>
              <div className="min-w-0 flex-1">
                <p className={cx('text-sm', evento.conError ? 'text-red-700' : 'text-slate-700')}>{evento.detalle}</p>
                <p className="text-xs text-slate-400">
                  {fecha(evento.fecha)}
                  {evento.duracionMs !== null ? ` · ${evento.duracionMs} ms` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Tarjeta>

      <Tarjeta
        titulo="Respaldos"
        descripcion="Todos los días después de las 20:00 se guarda una copia de la hoja entera en formato Excel y se sube a la carpeta «Respaldos DM» del Drive. Se conservan los últimos 30."
        acciones={
          <Boton
            icono="descargar"
            cargando={ocupado === 'respaldo'}
            disabled={!estado.configurada}
            onClick={() =>
              void correr('respaldo', async () => {
                const r = await window.dm.sincronizacion.respaldarAhora()
                if (r.ok) setAviso(r.datos ? 'Respaldo guardado.' : 'No se pudo hacer el respaldo: revisá los movimientos de acá abajo.')
                else setError(r.error)
              })
            }
          >
            Respaldar ahora
          </Boton>
        }
        alRas
      >
        <div className="max-h-60 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={encabezado}>Archivo</th>
                <th className={encabezado}>Fecha</th>
                <th className={cx(encabezado, 'text-right')}>Tamaño</th>
              </tr>
            </thead>
            <tbody>
              {panel.respaldos.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-slate-500">
                    Todavía no hay respaldos. El primero sale hoy después de las 20:00.
                  </td>
                </tr>
              )}
              {panel.respaldos.map((respaldo) => (
                <tr key={respaldo.archivo} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">
                    <span className="inline-flex items-center gap-1.5">
                      <Icono nombre="tabla" tamano={13} className="text-slate-400" />
                      {respaldo.archivo}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fecha(respaldo.fecha)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{tamano(respaldo.tamano)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  )
}

function Cifra({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono: 'neutro' | 'aviso' | 'peligro' }) {
  const clases = {
    neutro: 'border-slate-200 bg-white text-slate-900',
    aviso: 'border-amber-200 bg-amber-50 text-amber-800',
    peligro: 'border-red-200 bg-red-50 text-red-800',
  }[tono]
  return (
    <div className={cx('rounded-lg border px-3 py-2', clases)}>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">{etiqueta}</p>
      <p className="font-display text-xl font-extrabold tabular-nums">{valor.toLocaleString('es-AR')}</p>
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{etiqueta}</p>
      <p className="text-sm font-semibold text-slate-800">{valor}</p>
    </div>
  )
}
