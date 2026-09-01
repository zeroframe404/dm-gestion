// El vehículo, elegido del catálogo en vez de escrito a mano.
//
// De todo el bloque, lo único que se elige libremente es AUTO o MOTO. Marca, modelo, línea y año
// salen del catálogo, encadenados: elegir la marca llena los modelos, elegir el modelo llena las
// líneas, y así. Y la categoría —pick-up, SUV, furgón, camión— no se elige: la decide el catálogo con
// lo ya elegido y se muestra como una etiqueta que no se puede tocar.
//
// Esto último es lo que pidió la agencia y además es lo correcto. De la categoría dependen la prima y
// qué coberturas se pueden emitir; quien carga no tiene por qué saber si una Amarok es camioneta o
// pick-up, y dejarlo elegir es dejarlo equivocarse en el dato del que después se cuelga el reclamo.
//
// Si no hay catálogo bajado —o si el vehículo que hay que cargar no está—, el bloque cae solo a los
// campos de texto libre de siempre. Un programa que no deja emitir una póliza porque un proveedor
// externo no contesta es peor que un programa sin catálogo.
import { useCallback, useEffect, useState } from 'react'
import {
  NOMBRE_CATEGORIA,
  NOMBRE_TIPO_VEHICULO,
  TIPOS_DE_VEHICULO,
  type CategoriaDeVehiculo,
  type LineaDeCatalogo,
  type OpcionDeCatalogo,
  type TipoDeVehiculo,
} from '../../shared/tipos'
import { Campo, Etiqueta, Selector, cx } from './ui'

/** Lo que el formulario guarda del vehículo. Es lo mismo que va a `DatosDePoliza.vehiculoNuevo`. */
export interface VehiculoElegido {
  tipo: string
  marca: string
  modelo: string
  linea: string
  anio: string
  categoria: string
  /** Vacío = se cargó a mano. Con código = salió del catálogo. */
  catalogoCodigo: string
}

export const VEHICULO_ELEGIDO_VACIO: VehiculoElegido = {
  tipo: '',
  marca: '',
  modelo: '',
  linea: '',
  anio: '',
  categoria: '',
  catalogoCodigo: '',
}

interface Props {
  valor: VehiculoElegido
  alCambiar: (parte: Partial<VehiculoElegido>) => void
  deshabilitado?: boolean
  /**
   * true cuando el tipo (auto o moto) ya se eligió afuera, en el desplegable de tipo de riesgo del
   * formulario de la póliza: acá no se vuelve a preguntar, sólo se muestra la categoría.
   */
  sinTipo?: boolean
}

/** Los ids del catálogo mientras se está eligiendo. No se guardan: lo que se guarda son los nombres. */
interface Eleccion {
  marcaId: string
  modeloId: string
  lineaId: string
}

const SIN_ELEGIR: Eleccion = { marcaId: '', modeloId: '', lineaId: '' }

export function SelectorDeVehiculo({ valor, alCambiar, deshabilitado = false, sinTipo = false }: Props) {
  const [hayCatalogo, setHayCatalogo] = useState<boolean | null>(null)
  // «a mano» es el modo de siempre. Arranca en «catálogo» si hay algo bajado.
  const [aMano, setAMano] = useState(false)
  const [eleccion, setEleccion] = useState<Eleccion>(SIN_ELEGIR)
  const [marcas, setMarcas] = useState<OpcionDeCatalogo[]>([])
  const [modelos, setModelos] = useState<OpcionDeCatalogo[]>([])
  const [lineas, setLineas] = useState<LineaDeCatalogo[]>([])
  const [anios, setAnios] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)

  const tipo = valor.tipo === 'MOTO' ? 'MOTO' : valor.tipo === 'AUTO' ? 'AUTO' : ''

  useEffect(() => {
    void window.dm.vehiculos.estado().then((resultado) => {
      const hay = resultado.ok && resultado.datos.hayCatalogo
      setHayCatalogo(hay)
      // Un vehículo que YA tiene algo cargado se edita a mano, venga del catálogo o no.
      //
      // Los tres desplegables se dibujan con `eleccion`, que son ids del catálogo y viven sólo en este
      // componente: al volver a montarse (cambiar a «uno de los del cliente» y volver, o abrir la
      // edición de una póliza) esos ids se perdieron aunque `valor` siga trayendo la marca, el modelo
      // y la línea. En modo catálogo eso se vería como un formulario vacío que sin embargo guarda un
      // vehículo cargado: la pantalla estaría mintiendo. En modo a mano se ve lo que de verdad hay, y
      // el botón de abajo deja volver al catálogo cuando se quiera.
      if (!hay || valor.marca) setAMano(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Si el tipo lo cambian desde afuera (de auto a moto en el desplegable del formulario), los ids del
  // catálogo que se venían eligiendo son de otro catálogo: se empieza de nuevo.
  useEffect(() => {
    setEleccion(SIN_ELEGIR)
  }, [tipo])

  // Marcas: cambian sólo con el tipo.
  useEffect(() => {
    if (aMano || !tipo) {
      setMarcas([])
      return
    }
    void window.dm.vehiculos.marcas(tipo as TipoDeVehiculo).then((resultado) => {
      if (resultado.ok) setMarcas(resultado.datos)
    })
  }, [aMano, tipo])

  useEffect(() => {
    if (aMano || !tipo || !eleccion.marcaId) {
      setModelos([])
      return
    }
    void window.dm.vehiculos.modelos(tipo as TipoDeVehiculo, eleccion.marcaId).then((resultado) => {
      if (resultado.ok) setModelos(resultado.datos)
    })
  }, [aMano, tipo, eleccion.marcaId])

  useEffect(() => {
    if (aMano || !tipo || !eleccion.marcaId || !eleccion.modeloId) {
      setLineas([])
      return
    }
    void window.dm.vehiculos.lineas(tipo as TipoDeVehiculo, eleccion.marcaId, eleccion.modeloId).then((resultado) => {
      if (resultado.ok) setLineas(resultado.datos)
    })
  }, [aMano, tipo, eleccion.marcaId, eleccion.modeloId])

  useEffect(() => {
    if (aMano || !tipo || !eleccion.lineaId) {
      setAnios([])
      return
    }
    void window.dm.vehiculos
      .anios(tipo as TipoDeVehiculo, eleccion.marcaId, eleccion.modeloId, eleccion.lineaId)
      .then((resultado) => {
        if (resultado.ok) setAnios(resultado.datos)
      })
  }, [aMano, tipo, eleccion.marcaId, eleccion.modeloId, eleccion.lineaId])

  /**
   * El vehículo terminado lo arma el proceso principal, no la pantalla: es el único que puede decir
   * cuál es la categoría, y así no hay ningún camino por el que la pantalla mande una distinta.
   */
  const resolver = useCallback(
    async (siguiente: Eleccion, anio: string) => {
      if (!tipo || !siguiente.marcaId || !siguiente.modeloId || !siguiente.lineaId || !anio) return
      const resultado = await window.dm.vehiculos.resolver(tipo as TipoDeVehiculo, siguiente.marcaId, siguiente.modeloId, siguiente.lineaId, anio)
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      setError(null)
      const v = resultado.datos
      alCambiar({
        marca: v.marca,
        modelo: v.modelo,
        linea: v.linea,
        anio: v.anio,
        categoria: v.categoria ?? '',
        catalogoCodigo: v.codigo,
      })
    },
    [alCambiar, tipo],
  )

  const elegirTipo = (nuevo: string) => {
    setEleccion(SIN_ELEGIR)
    alCambiar({ tipo: nuevo, marca: '', modelo: '', linea: '', anio: '', categoria: '', catalogoCodigo: '' })
  }

  const elegirMarca = (marcaId: string) => {
    setEleccion({ marcaId, modeloId: '', lineaId: '' })
    alCambiar({ marca: marcas.find((m) => m.id === marcaId)?.nombre ?? '', modelo: '', linea: '', anio: '', categoria: '', catalogoCodigo: '' })
  }

  const elegirModelo = (modeloId: string) => {
    setEleccion((previa) => ({ ...previa, modeloId, lineaId: '' }))
    alCambiar({ modelo: modelos.find((m) => m.id === modeloId)?.nombre ?? '', linea: '', anio: '', categoria: '', catalogoCodigo: '' })
  }

  const elegirLinea = (lineaId: string) => {
    const siguiente = { ...eleccion, lineaId }
    setEleccion(siguiente)
    alCambiar({ linea: lineas.find((l) => l.id === lineaId)?.nombre ?? '', anio: '', categoria: '', catalogoCodigo: '' })
  }

  const elegirAnio = (anio: string) => {
    alCambiar({ anio })
    void resolver(eleccion, anio)
  }

  const categoria = valor.categoria ? (NOMBRE_CATEGORIA[valor.categoria as CategoriaDeVehiculo] ?? valor.categoria) : ''

  return (
    <div className="flex flex-col gap-4">
      {/* El tipo va siempre, en los dos modos: es lo único que no sale del catálogo. Salvo que ya se
          haya elegido afuera, como tipo de riesgo de la póliza: entonces no se pregunta dos veces. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {!sinTipo && (
          <Selector
            etiqueta="Tipo de vehículo"
            value={tipo}
            disabled={deshabilitado}
            onChange={(evento) => elegirTipo(evento.target.value)}
            opciones={[
              { valor: '', texto: 'Elegí…' },
              ...TIPOS_DE_VEHICULO.map((candidato) => ({ valor: candidato, texto: NOMBRE_TIPO_VEHICULO[candidato] })),
            ]}
            ayuda="Es lo único que se elige a mano. El resto sale del catálogo."
          />
        )}

        {/* La categoría, de sólo lectura. Ocupa un lugar fijo aunque esté vacía: si apareciera y
            desapareciera, el formulario saltaría a cada clic. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">Categoría</span>
          <div className="flex h-10 items-center">
            {categoria ? (
              <Etiqueta tono="marca">{categoria}</Etiqueta>
            ) : (
              <span className="text-sm text-slate-400">{valor.catalogoCodigo ? 'Sin determinar' : 'Se completa sola'}</span>
            )}
          </div>
          <p className="text-xs text-slate-500">La decide el catálogo con los datos elegidos. No se puede cambiar.</p>
        </div>
      </div>

      {hayCatalogo === false && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          Todavía no hay catálogo de vehículos bajado en esta computadora, así que la marca y el modelo se cargan a mano como
          siempre. Un administrador lo baja desde Administración → Catálogo de vehículos.
        </p>
      )}

      {aMano ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Tocar la marca o el modelo a mano deja de ser lo que dijo el catálogo: se van con ellos
              el código, la línea y la categoría. Dejar la línea pegada guardaría un CHERY TIGGO con
              la versión de un Focus, y no hay pantalla donde eso se vea para corregirlo. */}
          <Campo
            etiqueta="Marca"
            value={valor.marca}
            disabled={deshabilitado}
            onChange={(e) => alCambiar({ marca: e.target.value, linea: '', categoria: '', catalogoCodigo: '' })}
          />
          <Campo
            etiqueta="Modelo"
            value={valor.modelo}
            disabled={deshabilitado}
            onChange={(e) => alCambiar({ modelo: e.target.value, linea: '', categoria: '', catalogoCodigo: '' })}
          />
          <Campo
            etiqueta="Año"
            value={valor.anio}
            disabled={deshabilitado}
            onChange={(e) => alCambiar({ anio: e.target.value })}
            className="tabular-nums"
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Selector
            etiqueta="Marca"
            value={eleccion.marcaId}
            disabled={deshabilitado || !tipo}
            onChange={(evento) => elegirMarca(evento.target.value)}
            opciones={[{ valor: '', texto: tipo ? 'Elegí la marca…' : 'Elegí primero el tipo' }, ...marcas.map((m) => ({ valor: m.id, texto: m.nombre }))]}
          />
          <Selector
            etiqueta="Modelo"
            value={eleccion.modeloId}
            disabled={deshabilitado || !eleccion.marcaId}
            onChange={(evento) => elegirModelo(evento.target.value)}
            opciones={[{ valor: '', texto: eleccion.marcaId ? 'Elegí el modelo…' : 'Elegí primero la marca' }, ...modelos.map((m) => ({ valor: m.id, texto: m.nombre }))]}
          />
          <Selector
            etiqueta="Línea"
            value={eleccion.lineaId}
            disabled={deshabilitado || !eleccion.modeloId}
            onChange={(evento) => elegirLinea(evento.target.value)}
            opciones={[{ valor: '', texto: eleccion.modeloId ? 'Elegí la versión…' : 'Elegí primero el modelo' }, ...lineas.map((l) => ({ valor: l.id, texto: l.nombre }))]}
            ayuda="La versión exacta: es la que decide la categoría."
          />
          <Selector
            etiqueta="Año"
            value={valor.anio}
            disabled={deshabilitado || !eleccion.lineaId}
            onChange={(evento) => elegirAnio(evento.target.value)}
            opciones={[{ valor: '', texto: eleccion.lineaId ? 'Elegí el año…' : 'Elegí primero la línea' }, ...anios.map((a) => ({ valor: String(a), texto: String(a) }))]}
          />
        </div>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}

      {/* La salida de emergencia, siempre a la vista: el catálogo puede no tener el vehículo (un
          importado, un modelo del año que todavía no cargaron) y eso no puede frenar una póliza. */}
      {hayCatalogo && (
        <button
          type="button"
          disabled={deshabilitado}
          onClick={() => {
            setAMano((previo) => !previo)
            setEleccion(SIN_ELEGIR)
            // Al pasar a mano se borra lo que había dicho el catálogo —el código, la línea y la
            // categoría—: de acá en adelante lo que valga es lo que se escriba.
            if (!aMano) alCambiar({ linea: '', categoria: '', catalogoCodigo: '' })
          }}
          className={cx('self-start text-xs font-semibold text-marino-700 hover:underline disabled:opacity-50')}
        >
          {aMano ? 'Buscarlo en el catálogo' : '¿No está en la lista? Cargarlo a mano'}
        </button>
      )}
    </div>
  )
}
