// Compañías → Antigüedad: se escribe el año del vehículo y sale qué le ofrece cada compañía.
//
// Es la misma matriz que Cartera → Reglas de cobertura, leída al revés. Allá la pregunta es «¿esta
// compañía me toma este auto?», con la compañía ya elegida, porque se está por emitir una póliza.
// Acá la pregunta es «¿quién me toma este auto?», con el auto adelante y la compañía todavía sin
// elegir: es lo que se pregunta el que está cotizando, con el cliente esperando.
//
// Por eso esta pantalla no carga nada y no tiene formulario: si falta una compañía, lo que falta es
// una regla, y las reglas se cargan en Cartera. Duplicar la carga acá habría dado dos matrices que
// dicen cosas distintas sobre lo mismo, y la que avisa al emitir es aquélla.
import { useCallback, useEffect, useState } from 'react'
import type { CompaniaSegunAntiguedad, ConsultaDeAntiguedad } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { useNavegacion } from '../../contexto/Navegacion'
import { Alerta, Cargando, Etiqueta } from '../../componentes/ui'

export function Antiguedad({ anioActual }: { anioActual: number }) {
  const { ir } = useNavegacion()
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState<ConsultaDeAntiguedad | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const consultar = useCallback(async (anio: string) => {
    setCargando(true)
    const resultado = await window.dm.referencias.antiguedad(anio)
    if (resultado.ok) {
      setConsulta(resultado.datos)
      setError(null)
    } else setError(resultado.error)
    setCargando(false)
  }, [])

  // Se consulta mientras se escribe: con el año todavía a medias («20») el proceso principal
  // devuelve la matriz sin año consultado, que es justo lo que hay que mostrar mientras tanto.
  useEffect(() => {
    void consultar(texto)
  }, [consultar, texto])

  const anio = consulta?.anio ?? null
  const companias = consulta?.companias ?? []
  const sinReglas = consulta?.sinReglas ?? []
  const hayMatriz = companias.length > 0

  if (cargando && !consulta) return <Cargando texto="Buscando las reglas de cobertura…" />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      {/* --- El año que se consulta ------------------------------------------ */}
      <section className="shrink-0 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-suave">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="antiguedad-anio" className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Año del vehículo a cotizar
            </label>
            <input
              id="antiguedad-anio"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              inputMode="numeric"
              maxLength={4}
              autoFocus
              placeholder={String(anioActual - 15)}
              className="mt-1.5 h-12 w-40 rounded-lg border border-slate-300 bg-white px-3 text-center font-display text-2xl font-extrabold tabular-nums tracking-tight text-slate-900 placeholder:font-normal placeholder:text-slate-300"
            />
          </div>
          {anio !== null && consulta && (
            <div className="pb-1.5">
              <p className="text-sm text-slate-600">
                Modelo <strong className="font-semibold text-slate-900">{anio}</strong>:{' '}
                <strong className="font-semibold text-slate-900">
                  {consulta.antiguedad} {consulta.antiguedad === 1 ? 'año' : 'años'}
                </strong>{' '}
                de antigüedad en {consulta.anioActual}.
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {companias.filter((compania) => compania.acepta.length > 0).length} de {companias.length} compañías con reglas cargadas le
                ofrecen alguna cobertura.
              </p>
            </div>
          )}
          {texto.trim() !== '' && anio === null && (
            <p className="pb-2.5 text-sm text-amber-700">
              Escribí el año con cuatro cifras («{anioActual - 15}») o con dos («{String(anioActual - 15).slice(2)}»).
            </p>
          )}
          {texto.trim() === '' && (
            <p className="pb-2.5 text-sm text-slate-500">Poné el año y abajo aparece, compañía por compañía, qué le pueden vender.</p>
          )}
        </div>
      </section>

      {error && <Alerta tono="error">{error}</Alerta>}

      {!hayMatriz && (
        <Alerta tono="aviso">
          Todavía no hay ninguna regla de cobertura cargada, así que esta pantalla no puede responder nada. Las reglas —qué antigüedad
          acepta cada compañía en cada cobertura— se cargan en Cartera → Reglas de cobertura.
        </Alerta>
      )}

      {sinReglas.length > 0 && (
        <Alerta tono="aviso">
          {sinReglas.length === 1 ? 'Esta compañía trabaja' : 'Estas compañías trabajan'} en la cartera y no{' '}
          {sinReglas.length === 1 ? 'tiene' : 'tienen'} ninguna regla cargada, así que no aparecen abajo: {sinReglas.join(', ')}. Que no
          estén no quiere decir que no tomen el vehículo, quiere decir que nadie cargó todavía hasta qué modelo toman.
        </Alerta>
      )}

      {/* --- Compañía por compañía -------------------------------------------- */}
      {hayMatriz && (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {companias.map((compania) => (
              <TarjetaDeCompania key={compania.compania} compania={compania} hayAnio={anio !== null} />
            ))}
          </div>
        </div>
      )}

      <p className="shrink-0 text-xs text-slate-500">
        Los límites salen de la matriz de reglas de cobertura.{' '}
        <button
          type="button"
          onClick={() => ir('cartera', { seccion: 'reglas' })}
          className="font-semibold text-marino-700 underline underline-offset-2 hover:text-marino-800"
        >
          Abrir Cartera → Reglas de cobertura
        </button>{' '}
        para corregir o completar alguna.
      </p>
    </div>
  )
}

function TarjetaDeCompania({ compania, hayAnio }: { compania: CompaniaSegunAntiguedad; hayAnio: boolean }) {
  // Sin año consultado no hay «acepta» ni «rechaza»: se muestra la oferta entera de la compañía, que
  // por sí sola ya sirve para saber qué vende cada una.
  const acepta = compania.acepta
  const rechaza = hayAnio ? compania.rechaza : []
  const todas = hayAnio ? acepta : [...acepta, ...compania.rechaza]

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-suave">
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="font-display text-base font-extrabold tracking-tight text-slate-900">{compania.compania}</h3>
        {hayAnio && (
          <span className="ml-auto">
            {acepta.length > 0 ? (
              <Etiqueta tono="exito">
                {acepta.length} {acepta.length === 1 ? 'cobertura' : 'coberturas'}
              </Etiqueta>
            ) : (
              <Etiqueta tono="peligro">no lo toma</Etiqueta>
            )}
          </span>
        )}
      </header>

      <ul className="flex flex-col">
        {todas.map((cobertura) => (
          <li key={cobertura.cobertura} className="flex items-start gap-2.5 border-b border-slate-50 px-4 py-2 last:border-b-0">
            {hayAnio && <Icono nombre="ok" tamano={15} className="mt-0.5 shrink-0 text-green-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{cobertura.cobertura}</p>
              <p className="text-xs text-slate-500">
                {cobertura.limite}
                {cobertura.franquicia ? ` · franquicia ${cobertura.franquicia}` : ''}
              </p>
              {cobertura.observaciones && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{cobertura.observaciones}</p>}
            </div>
          </li>
        ))}

        {rechaza.map((cobertura) => (
          <li key={cobertura.cobertura} className="flex items-start gap-2.5 border-b border-slate-50 bg-slate-50/70 px-4 py-2 last:border-b-0">
            <Icono nombre="cerrar" tamano={15} className="mt-0.5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-500 line-through">{cobertura.cobertura}</p>
              <p className="text-xs text-slate-500">{cobertura.limite}</p>
            </div>
          </li>
        ))}

        {todas.length === 0 && rechaza.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-500">Sin coberturas cargadas.</li>
        )}
      </ul>
    </section>
  )
}
