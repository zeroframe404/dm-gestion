// El vehículo del multicotizador, en el orden en que lo piden las compañías en su web: marca, año, si
// es 0 km, modelo y versión. Sale del catálogo de la agencia, encadenado: la marca da sus años, y
// marca y año dan los modelos y las versiones que se ofrecen ese año.
//
// A diferencia del selector de la póliza (SelectorDeVehiculo.tsx), acá el año va antes que el modelo.
// Si se cambia el año con el modelo ya elegido, el modelo y la versión se conservan mientras se sigan
// ofreciendo ese año; si no, se vacían y se vuelven a elegir.
//
// Sin catálogo bajado —o si el vehículo no está—, los cuatro datos se escriben a mano.
import { useEffect, useState } from 'react'
import { NOMBRE_CATEGORIA, type CategoriaDeVehiculo, type LineaDeCatalogo, type OpcionDeCatalogo, type TipoDeVehiculo } from '../../../shared/tipos'
import type { VehiculoElegido } from '../../componentes/SelectorDeVehiculo'
import { Campo, Etiqueta, Selector, cx } from '../../componentes/ui'

/** Los ids del catálogo mientras se está eligiendo. No se guardan: lo que se guarda son los nombres. */
interface Eleccion {
  marcaId: string
  modeloId: string
  lineaId: string
}

const SIN_ELEGIR: Eleccion = { marcaId: '', modeloId: '', lineaId: '' }

export type CampoDelVehiculo = 'marca' | 'anio' | 'modelo' | 'linea'

interface Props {
  valor: VehiculoElegido
  alCambiar: (parte: Partial<VehiculoElegido>) => void
  ceroKm: boolean
  alCambiarCeroKm: (ceroKm: boolean) => void
  errores: Partial<Record<CampoDelVehiculo, string>>
}

export function VehiculoDelCotizador({ valor, alCambiar, ceroKm, alCambiarCeroKm, errores }: Props) {
  const tipo: TipoDeVehiculo = valor.tipo === 'MOTO' ? 'MOTO' : 'AUTO'
  const [hayCatalogo, setHayCatalogo] = useState<boolean | null>(null)
  const [aMano, setAMano] = useState(false)
  const [eleccion, setEleccion] = useState<Eleccion>(SIN_ELEGIR)
  const [marcas, setMarcas] = useState<OpcionDeCatalogo[]>([])
  const [anios, setAnios] = useState<number[]>([])
  const [modelos, setModelos] = useState<OpcionDeCatalogo[]>([])
  const [lineas, setLineas] = useState<LineaDeCatalogo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.dm.vehiculos.estado().then((resultado) => {
      const hay = resultado.ok && resultado.datos.hayCatalogo
      setHayCatalogo(hay)
      if (!hay) setAMano(true)
    })
  }, [])

  // «Empezar de nuevo» vacía el vehículo desde afuera: los ids que se venían eligiendo ya no valen.
  useEffect(() => {
    if (!valor.marca) setEleccion(SIN_ELEGIR)
  }, [valor.marca])

  useEffect(() => {
    if (aMano) return
    void window.dm.vehiculos.marcas(tipo).then((resultado) => {
      if (resultado.ok) setMarcas(resultado.datos)
    })
  }, [aMano, tipo])

  useEffect(() => {
    if (aMano || !eleccion.marcaId) {
      setAnios([])
      return
    }
    let vigente = true
    void window.dm.vehiculos.aniosDeMarca(tipo, eleccion.marcaId).then((resultado) => {
      if (vigente && resultado.ok) setAnios(resultado.datos)
    })
    return () => {
      vigente = false
    }
  }, [aMano, tipo, eleccion.marcaId])

  // Los modelos de la marca en ese año. Si el elegido ya no se ofrece ese año, se suelta.
  useEffect(() => {
    // Sin vaciar la lista mientras llega la nueva: el modelo elegido seguiría a la vista.
    if (aMano || !eleccion.marcaId) {
      setModelos([])
      return
    }
    let vigente = true
    void window.dm.vehiculos.modelos(tipo, eleccion.marcaId, valor.anio || undefined).then((resultado) => {
      if (!vigente || !resultado.ok) return
      setModelos(resultado.datos)
      if (eleccion.modeloId && !resultado.datos.some((modelo) => modelo.id === eleccion.modeloId)) {
        setEleccion((previa) => ({ ...previa, modeloId: '', lineaId: '' }))
        alCambiar({ modelo: '', linea: '', categoria: '', catalogoCodigo: '' })
      }
    })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `alCambiar` y el modelo elegido no tienen que volver a pedir la lista.
  }, [aMano, tipo, eleccion.marcaId, valor.anio])

  // Las versiones del modelo en ese año. Lo mismo: si la elegida ya no se ofrece, se suelta.
  useEffect(() => {
    if (aMano || !eleccion.marcaId || !eleccion.modeloId) {
      setLineas([])
      return
    }
    let vigente = true
    void window.dm.vehiculos.lineas(tipo, eleccion.marcaId, eleccion.modeloId, valor.anio || undefined).then((resultado) => {
      if (!vigente || !resultado.ok) return
      setLineas(resultado.datos)
      if (eleccion.lineaId && !resultado.datos.some((linea) => linea.id === eleccion.lineaId)) {
        setEleccion((previa) => ({ ...previa, lineaId: '' }))
        alCambiar({ linea: '', categoria: '', catalogoCodigo: '' })
      }
    })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ídem.
  }, [aMano, tipo, eleccion.marcaId, eleccion.modeloId, valor.anio])

  // Con versión y año, el vehículo terminado lo arma el proceso principal: es el único que dice la
  // categoría y el código del catálogo.
  useEffect(() => {
    if (aMano || !eleccion.lineaId || !valor.anio) return
    let vigente = true
    void window.dm.vehiculos.resolver(tipo, eleccion.marcaId, eleccion.modeloId, eleccion.lineaId, valor.anio).then((resultado) => {
      if (!vigente) return
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      setError(null)
      const v = resultado.datos
      alCambiar({ marca: v.marca, modelo: v.modelo, linea: v.linea, anio: v.anio, categoria: v.categoria ?? '', catalogoCodigo: v.codigo })
    })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ídem.
  }, [aMano, tipo, eleccion.lineaId, valor.anio])

  const elegirMarca = (marcaId: string) => {
    setEleccion({ marcaId, modeloId: '', lineaId: '' })
    setError(null)
    alCambiar({ marca: marcas.find((m) => m.id === marcaId)?.nombre ?? '', anio: '', modelo: '', linea: '', categoria: '', catalogoCodigo: '' })
  }

  const elegirModelo = (modeloId: string) => {
    setEleccion((previa) => ({ ...previa, modeloId, lineaId: '' }))
    alCambiar({ modelo: modelos.find((m) => m.id === modeloId)?.nombre ?? '', linea: '', categoria: '', catalogoCodigo: '' })
  }

  const elegirLinea = (lineaId: string) => {
    setEleccion((previa) => ({ ...previa, lineaId }))
    const linea = lineas.find((l) => l.id === lineaId)
    alCambiar({ linea: linea?.nombre ?? '', categoria: linea?.categoria ?? '', catalogoCodigo: '' })
  }

  const pasarAMano = () => {
    setAMano((previo) => !previo)
    setEleccion(SIN_ELEGIR)
    setError(null)
    // De un modo al otro se empieza de nuevo: lo que dijo el catálogo no vale escrito a mano, y al
    // revés los nombres escritos no son ids del catálogo.
    alCambiar({ marca: '', modelo: '', linea: '', anio: '', categoria: '', catalogoCodigo: '' })
  }

  const categoria = valor.categoria ? (NOMBRE_CATEGORIA[valor.categoria as CategoriaDeVehiculo] ?? valor.categoria) : ''

  return (
    <div className="flex flex-col gap-4">
      {hayCatalogo === false && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          No hay catálogo de vehículos bajado en esta computadora: el vehículo se escribe a mano. Un administrador lo baja desde
          Administración → Catálogo de vehículos.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {aMano ? (
          <>
            <Campo etiqueta="Marca *" value={valor.marca} error={errores.marca} onChange={(e) => alCambiar({ marca: e.target.value, catalogoCodigo: '' })} />
            <Campo
              etiqueta="Año *"
              value={valor.anio}
              inputMode="numeric"
              maxLength={4}
              error={errores.anio}
              onChange={(e) => alCambiar({ anio: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              className="tabular-nums"
            />
          </>
        ) : (
          <>
            <Selector
              etiqueta="Marca *"
              value={eleccion.marcaId}
              error={errores.marca}
              onChange={(e) => elegirMarca(e.target.value)}
              opciones={[{ valor: '', texto: 'Elegí la marca…' }, ...marcas.map((m) => ({ valor: m.id, texto: m.nombre }))]}
            />
            <Selector
              etiqueta="Año *"
              value={valor.anio}
              disabled={!eleccion.marcaId}
              error={errores.anio}
              onChange={(e) => alCambiar({ anio: e.target.value })}
              opciones={[
                { valor: '', texto: eleccion.marcaId ? 'Elegí el año…' : 'Elegí primero la marca' },
                ...anios.map((anio) => ({ valor: String(anio), texto: String(anio) })),
              ]}
            />
          </>
        )}

        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={ceroKm} onChange={(e) => alCambiarCeroKm(e.target.checked)} />
          Es 0 km
        </label>

        {aMano ? (
          <>
            <Campo
              etiqueta="Modelo *"
              value={valor.modelo}
              disabled={!valor.marca.trim()}
              placeholder={valor.marca.trim() ? '' : 'Escribí primero la marca'}
              error={errores.modelo}
              onChange={(e) => alCambiar({ modelo: e.target.value, catalogoCodigo: '' })}
            />
            <Campo
              etiqueta="Versión *"
              value={valor.linea}
              disabled={!valor.modelo.trim()}
              placeholder={valor.modelo.trim() ? 'Ej.: 1.6 XEI CVT' : 'Escribí primero el modelo'}
              error={errores.linea}
              onChange={(e) => alCambiar({ linea: e.target.value, catalogoCodigo: '' })}
            />
          </>
        ) : (
          <>
            <Selector
              etiqueta="Modelo *"
              value={eleccion.modeloId}
              disabled={!eleccion.marcaId}
              error={errores.modelo}
              onChange={(e) => elegirModelo(e.target.value)}
              opciones={[
                { valor: '', texto: eleccion.marcaId ? 'Elegí el modelo…' : 'Elegí primero la marca' },
                ...modelos.map((m) => ({ valor: m.id, texto: m.nombre })),
              ]}
              ayuda={eleccion.marcaId && valor.anio ? `Los que se ofrecen en ${valor.anio}.` : undefined}
            />
            <Selector
              etiqueta="Versión *"
              value={eleccion.lineaId}
              disabled={!eleccion.modeloId}
              error={errores.linea ?? error}
              onChange={(e) => elegirLinea(e.target.value)}
              opciones={[
                { valor: '', texto: eleccion.modeloId ? 'Elegí la versión…' : 'Elegí primero el modelo' },
                ...lineas.map((l) => ({ valor: l.id, texto: l.nombre })),
              ]}
              ayuda={categoria ? undefined : 'La versión exacta: de ella dependen la categoría y la suma asegurada.'}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {categoria && (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            Categoría <Etiqueta tono="marca">{categoria}</Etiqueta>
          </span>
        )}
        {/* La salida de emergencia, siempre a la vista: el catálogo puede no tener el vehículo. */}
        {hayCatalogo && (
          <button type="button" onClick={pasarAMano} className={cx('ml-auto text-xs font-semibold text-marino-700 hover:underline')}>
            {aMano ? 'Buscarlo en el catálogo' : '¿No está en la lista? Cargarlo a mano'}
          </button>
        )}
      </div>
    </div>
  )
}
