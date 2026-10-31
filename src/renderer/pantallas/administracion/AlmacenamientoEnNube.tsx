// Administración → Almacenamiento en nube: qué tipos de archivo ocupan el espacio de los adjuntos.
// Torta con animación al pasar el mouse; el total lo carga el superadministrador.
import { useEffect, useState } from 'react'
import type { CategoriaDeArchivo, EstadoDeAlmacenamiento } from '../../../shared/tipos'
import { formatearBytes, NOMBRE_DE_CATEGORIA } from '../../componentes/almacenamiento'
import { Alerta, Boton, Campo, Cargando, Tarjeta } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'

const COLORES: Record<CategoriaDeArchivo, string> = {
  imagenes: '#3b82f6',
  pdf: '#ef4444',
  excel: '#22c55e',
  word: '#a855f7',
  otros: '#94a3b8',
}
const R = 80
const CENTRO = 100

function arco(desde: number, hasta: number, radio: number): string {
  const punto = (fraccion: number) => {
    const angulo = fraccion * 2 * Math.PI - Math.PI / 2
    return `${CENTRO + radio * Math.cos(angulo)} ${CENTRO + radio * Math.sin(angulo)}`
  }
  if (hasta - desde >= 0.9999) return `M ${punto(0)} A ${radio} ${radio} 0 1 1 ${CENTRO} ${CENTRO + radio} A ${radio} ${radio} 0 1 1 ${punto(0)} Z`
  return `M ${CENTRO} ${CENTRO} L ${punto(desde)} A ${radio} ${radio} 0 ${hasta - desde > 0.5 ? 1 : 0} 1 ${punto(hasta)} Z`
}

export function AlmacenamientoEnNube() {
  const usuario = useUsuarioActual()
  const [estado, setEstado] = useState<EstadoDeAlmacenamiento | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activa, setActiva] = useState<CategoriaDeArchivo | null>(null)
  const [totalGb, setTotalGb] = useState('')
  const [guardando, setGuardando] = useState(false)

  const aplicar = (datos: EstadoDeAlmacenamiento) => {
    setEstado(datos)
    setTotalGb(String(Math.round((datos.totalBytes / 1024 ** 3) * 10) / 10))
  }
  useEffect(() => {
    void window.dm.almacenamiento.estado().then((r) => (r.ok ? aplicar(r.datos) : setError(r.error)))
  }, [])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    const r = await window.dm.almacenamiento.guardarTotal(Number(totalGb.replace(',', '.')))
    if (r.ok) aplicar(r.datos)
    else setError(r.error)
    setGuardando(false)
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  let acumulado = 0
  const porciones = estado.categorias
    .filter((c) => c.bytes > 0)
    .map((c) => {
      const fraccion = c.bytes / estado.usadoBytes
      const porcion = { ...c, fraccion, desde: acumulado, hasta: acumulado + fraccion }
      acumulado += fraccion
      return porcion
    })
  const libre = Math.max(0, estado.totalBytes - estado.usadoBytes)
  const detalle = porciones.find((p) => p.categoria === activa)

  return (
    <div className="space-y-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      <Tarjeta
        titulo="Almacenamiento en nube"
        descripcion={`Usado ${formatearBytes(estado.usadoBytes)} de ${formatearBytes(estado.totalBytes)} · libre ${formatearBytes(libre)}`}
      >
        {porciones.length === 0 ? (
          <p className="text-sm text-slate-600">Todavía no se subió ningún archivo.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-10">
            <svg width="260" height="260" viewBox="0 0 200 200" role="img" aria-label="Espacio usado por tipo de archivo">
              {porciones.map((p) => (
                <path
                  key={p.categoria}
                  d={arco(p.desde, p.hasta, R)}
                  fill={COLORES[p.categoria]}
                  stroke="white"
                  strokeWidth="1.5"
                  onMouseEnter={() => setActiva(p.categoria)}
                  onMouseLeave={() => setActiva(null)}
                  style={{
                    transformOrigin: `${CENTRO}px ${CENTRO}px`,
                    transform: activa === p.categoria ? 'scale(1.08)' : 'scale(1)',
                    opacity: activa && activa !== p.categoria ? 0.55 : 1,
                    transition: 'transform 200ms ease, opacity 200ms ease',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </svg>
            <ul className="min-w-[260px] space-y-2 text-sm">
              {porciones.map((p) => (
                <li
                  key={p.categoria}
                  onMouseEnter={() => setActiva(p.categoria)}
                  onMouseLeave={() => setActiva(null)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 transition ${activa === p.categoria ? 'bg-slate-100 font-semibold' : ''}`}
                >
                  <span className="h-3 w-3 rounded-full" style={{ background: COLORES[p.categoria] }} />
                  <span className="flex-1">{NOMBRE_DE_CATEGORIA[p.categoria]}</span>
                  <span>{formatearBytes(p.bytes)}</span>
                  <span className="w-12 text-right text-slate-500">{Math.round(p.fraccion * 100)} %</span>
                </li>
              ))}
              <li className="px-3 pt-2 text-slate-600">
                {detalle
                  ? `${NOMBRE_DE_CATEGORIA[detalle.categoria]}: ${detalle.archivos.toLocaleString('es-AR')} archivo${detalle.archivos === 1 ? '' : 's'}`
                  : 'Pasá el mouse por el gráfico para ver el detalle.'}
              </li>
            </ul>
          </div>
        )}
      </Tarjeta>
      {usuario.rol === 'SUPER_ADMIN' && (
        <Tarjeta titulo="Espacio total" descripcion="El servidor no informa su capacidad: cargá acá cuánto espacio tiene la agencia para archivos.">
          <div className="flex items-end gap-3">
            <Campo etiqueta="Total (GB)" value={totalGb} onChange={(e) => setTotalGb(e.target.value)} inputMode="decimal" />
            <Boton onClick={() => void guardar()} disabled={guardando}>
              Guardar
            </Boton>
          </div>
        </Tarjeta>
      )}
    </div>
  )
}
