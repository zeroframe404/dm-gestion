// Cartera → Flotas: las empresas con muchos autos. No se cargan a mano: una flota aparece sola cuando hay
// 6 o más pólizas vigentes con el mismo nombre. Se busca por nombre y, al desplegar, se ven todos los autos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MINIMO_DE_POLIZAS_DE_UNA_FLOTA, type Flota } from '../../../../shared/flotas'
import { Alerta, Cargando, Tarjeta } from '../../../componentes/ui'
import { useRefrescoEnVivo } from '../../../contexto/DatosEnVivo'
import { useNavegacion } from '../../../contexto/Navegacion'

const normalizar = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function verFecha(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export default function FlotasListado() {
  const { ir } = useNavegacion()
  const [flotas, setFlotas] = useState<Flota[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())

  const cargar = useCallback(async () => {
    const r = await window.dm.flotas.listar()
    if (r.ok) {
      setFlotas(r.datos)
      setError(null)
    } else setError(r.error)
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])
  useRefrescoEnVivo({ tipos: ['MENSUAL', 'BAJAS'], recargar: cargar })

  const visibles = useMemo(() => {
    const q = normalizar(busqueda)
    return (flotas ?? []).filter((f) => !q || normalizar(f.nombre).includes(q))
  }, [flotas, busqueda])

  if (!flotas) return error ? <div className="p-8"><Alerta tono="error">{error}</Alerta></div> : <Cargando />

  const alternar = (nombre: string) =>
    setAbiertas((prev) => {
      const sig = new Set(prev)
      if (!sig.delete(nombre)) sig.add(nombre)
      return sig
    })

  return (
    <div className="flex flex-col gap-4 p-6">
      <Alerta tono="aviso">
        Una flota aparece sola cuando hay {MINIMO_DE_POLIZAS_DE_UNA_FLOTA} o más pólizas vigentes de autos con el mismo nombre de titular. No hay nada que cargar.
      </Alerta>
      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar empresa…"
        aria-label="Buscar empresa"
        className="w-full max-w-md rounded-md border border-borde px-3 py-2 text-sm"
      />
      {visibles.length === 0 && <p className="text-sm text-texto-suave">No hay flotas para mostrar.</p>}
      {visibles.map((f) => {
        const abierta = abiertas.has(f.nombre)
        return (
          <Tarjeta key={f.nombre} titulo={f.nombre} descripcion={`${f.vehiculos.length} autos`}>
            <button type="button" className="text-sm font-medium text-primario" aria-expanded={abierta} onClick={() => alternar(f.nombre)}>
              {abierta ? 'Ocultar autos' : 'Ver los autos'}
            </button>
            {abierta && (
              <table className="mt-3 w-full text-left text-sm">
                <thead>
                  <tr className="text-texto-suave">
                    <th className="py-1">Patente</th>
                    <th>Vehículo</th>
                    <th>Compañía</th>
                    <th>Póliza</th>
                    <th>Cobertura</th>
                    <th>Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {f.vehiculos.map((v) => (
                    <tr key={v.polizaId} className="cursor-pointer border-t border-borde hover:bg-fondo-suave" onClick={() => ir('polizas', { polizaId: v.polizaId })}>
                      <td className="py-1 font-medium">{v.patente ?? '—'}</td>
                      <td>{[v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || '—'}</td>
                      <td>{v.compania ?? '—'}</td>
                      <td>{v.numero ?? '—'}</td>
                      <td>{v.cobertura ?? '—'}</td>
                      <td>{verFecha(v.vigenciaHasta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Tarjeta>
        )
      })}
    </div>
  )
}
