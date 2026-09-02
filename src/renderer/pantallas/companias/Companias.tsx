// Módulo Compañías: las cinco listas que se consultan mientras alguien espera del otro lado.
//
// Qué NO es: no es el catálogo de compañías de Administración, que guarda los días de cobertura
// financiera y el porcentaje de comisión —cosas de la agencia—. Esto es lo que ofrece cada compañía,
// y lo mira todo el equipo que atiende.
//
// Las cuatro primeras listas se cargan a mano y viven en la base de cada computadora; la quinta
// —Antigüedad— no se carga, se calcula sobre la matriz de reglas de cobertura de Cartera. Como no hay
// pestaña en la planilla donde escribirlas, las cuatro se comparten entre las computadoras por el
// puente del VPS, y esa barra de arriba es la que dice si están al día.
import { useCallback, useEffect, useState } from 'react'
import type { ListasDeCompanias } from '../../../shared/tipos'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'
import { Alerta, Cargando } from '../../componentes/ui'
import { Antiguedad } from './Antiguedad'
import { Clausulas } from './Clausulas'
import { Compartir } from './Compartir'
import { Gruas } from './Gruas'
import { Organizadores } from './Organizadores'
import { Precios } from './Precios'

type IdSeccion = 'organizadores' | 'precios' | 'antiguedad' | 'gruas' | 'cobertura'

const SECCIONES: ItemDePestana<IdSeccion>[] = [
  { id: 'organizadores', nombre: 'Organizadores', icono: 'mensaje', ayuda: 'companias.organizadores' },
  { id: 'precios', nombre: 'Precios', icono: 'billete', ayuda: 'companias.precios' },
  { id: 'antiguedad', nombre: 'Antigüedad', icono: 'calendario', ayuda: 'companias.antiguedad' },
  { id: 'gruas', nombre: 'Grúas', icono: 'auto', ayuda: 'companias.gruas' },
  { id: 'cobertura', nombre: 'Cobertura', icono: 'escudo', ayuda: 'companias.cobertura' },
]

export function Companias() {
  const [seccionActiva, setSeccionActiva] = useState<IdSeccion>('organizadores')
  const seccion = SECCIONES.find((s) => s.id === seccionActiva) ?? SECCIONES[0]!
  const [listas, setListas] = useState<ListasDeCompanias | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Las cuatro listas se piden una sola vez y viven acá: son cortas (decenas de filas) y se pasan de
  // una solapa a otra sin volver a consultar, que es lo que hace que este módulo se sienta instantáneo.
  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await window.dm.referencias.listas()
    if (resultado.ok) {
      setListas(resultado.datos)
      setError(null)
    } else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarraDePestanas
        etiqueta="Listas de las compañías"
        prefijo="companias"
        items={SECCIONES}
        activa={seccion.id}
        alElegir={setSeccionActiva}
      />

      <div
        id={`panel-companias-${seccion.id}`}
        role="tabpanel"
        aria-labelledby={`tab-companias-${seccion.id}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Antigüedad no se carga a mano: no participa del compartir ni necesita las listas. */}
        {seccion.id !== 'antiguedad' && listas && <Compartir listas={listas} alCambiar={setListas} />}

        {cargando && !listas && <Cargando texto="Buscando las listas de las compañías…" />}
        {error && !listas && (
          <div className="p-6">
            <Alerta tono="error">{error}</Alerta>
          </div>
        )}

        {listas && seccion.id === 'organizadores' && <Organizadores listas={listas} alCambiar={setListas} />}
        {listas && seccion.id === 'precios' && <Precios listas={listas} alCambiar={setListas} />}
        {seccion.id === 'antiguedad' && <Antiguedad anioActual={listas?.anioActual ?? new Date().getFullYear()} />}
        {listas && seccion.id === 'gruas' && <Gruas listas={listas} alCambiar={setListas} />}
        {listas && seccion.id === 'cobertura' && <Clausulas listas={listas} alCambiar={setListas} />}
      </div>
    </div>
  )
}
