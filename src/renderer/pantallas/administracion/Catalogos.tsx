// Administración → Sucursales y ramas: las listas que ofrecen todos los filtros y desplegables. Sólo del
// superadministrador. Se guardan acá y viajan al servidor para las otras computadoras.
//
// Renombrar no reescribe ningún dato: el nombre anterior de una sucursal queda como sinónimo del nuevo, y las
// filas que lo traen se siguen leyendo bien. Sacar una sucursal o una rama de la lista tampoco borra nada: lo
// cargado con ella sigue ahí, listado aparte como «fuera del catálogo».
import { useEffect, useState } from 'react'
import {
  claveDeCatalogo,
  type Catalogos as CatalogosConfigurados,
  type FamiliaDeRama,
  MAXIMO_DE_NOMBRE_DE_CATALOGO,
  MAXIMO_DE_RAMAS,
  MAXIMO_DE_SUCURSALES,
} from '../../../shared/catalogos'
import { aplicarCatalogosEnPantalla } from '../../canal'
import { Alerta, Boton, Campo, Selector, Tarjeta } from '../../componentes/ui'

interface FilaDeSucursal {
  nombre: string
  /** Cómo se llamaba al abrir la pantalla; null si la sucursal es nueva. */
  original: string | null
  sinonimos: string
}

interface FilaDeRama {
  /** El valor guardado: no cambia nunca una vez creada (null en las nuevas, que lo sacan del nombre). */
  valor: string | null
  nombre: string
  familia: FamiliaDeRama
  sinonimos: string
}

const FAMILIAS: Array<{ valor: FamiliaDeRama; texto: string }> = [
  { valor: 'auto', texto: 'Como un auto (puede afinarse a pick up o camión)' },
  { valor: 'moto', texto: 'Como una moto (puede afinarse a scooter)' },
  { valor: 'otro', texto: 'Otra cosa (trailer, etc.)' },
]

const aLista = (texto: string): string[] =>
  texto
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)

function desdeCatalogos(c: CatalogosConfigurados): { sucursales: FilaDeSucursal[]; ramas: FilaDeRama[] } {
  return {
    sucursales: c.sucursales.map((s) => ({ nombre: s.nombre, original: s.nombre, sinonimos: s.sinonimos.join(', ') })),
    ramas: c.ramas.map((r) => ({ valor: r.valor, nombre: r.nombre, familia: r.familia, sinonimos: r.sinonimos.join(', ') })),
  }
}

function mover<T>(lista: T[], desde: number, hacia: number): T[] {
  if (hacia < 0 || hacia >= lista.length) return lista
  const copia = [...lista]
  const [fila] = copia.splice(desde, 1)
  copia.splice(hacia, 0, fila)
  return copia
}

export function Catalogos() {
  const [sucursales, setSucursales] = useState<FilaDeSucursal[]>([])
  const [ramas, setRamas] = useState<FilaDeRama[]>([])
  const [cargado, setCargado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const poner = (c: CatalogosConfigurados) => {
    const filas = desdeCatalogos(c)
    setSucursales(filas.sucursales)
    setRamas(filas.ramas)
  }

  useEffect(() => {
    void window.dm.catalogos.obtener().then((resultado) => {
      if (resultado.ok) poner(resultado.datos)
      else setError(resultado.error)
      setCargado(true)
    })
  }, [])

  const guardar = async () => {
    setError(null)
    setAviso(null)
    const claves = new Set<string>()
    for (const s of sucursales) {
      const clave = claveDeCatalogo(s.nombre)
      if (!clave) continue
      if (claves.has(clave)) return setError(`La sucursal «${s.nombre.trim()}» está repetida.`)
      claves.add(clave)
    }
    const clavesDeRamas = new Set<string>()
    for (const r of ramas) {
      const clave = claveDeCatalogo(r.valor ?? r.nombre)
      if (!clave) continue
      if (clavesDeRamas.has(clave)) return setError(`La rama «${r.nombre.trim()}» está repetida.`)
      clavesDeRamas.add(clave)
    }
    const datos: CatalogosConfigurados = {
      sucursales: sucursales
        .filter((s) => s.nombre.trim())
        .map((s) => {
          const sinonimos = aLista(s.sinonimos)
          // El nombre anterior pasa a ser sinónimo del nuevo, así lo ya cargado se sigue leyendo bien.
          if (s.original && claveDeCatalogo(s.original) !== claveDeCatalogo(s.nombre) && !sinonimos.some((x) => claveDeCatalogo(x) === claveDeCatalogo(s.original))) {
            sinonimos.push(s.original)
          }
          return { nombre: s.nombre.trim(), sinonimos }
        }),
      ramas: ramas
        .filter((r) => r.nombre.trim())
        .map((r) => ({
          valor: r.valor ?? r.nombre.trim().toUpperCase(),
          nombre: r.nombre.trim(),
          familia: r.familia,
          sinonimos: aLista(r.sinonimos),
        })),
    }
    setGuardando(true)
    const resultado = await window.dm.catalogos.guardar(datos)
    setGuardando(false)
    if (!resultado.ok) return setError(resultado.error)
    aplicarCatalogosEnPantalla(resultado.datos)
    poner(resultado.datos)
    setAviso('Listo: las listas quedaron guardadas. Las otras computadoras las toman al abrir el programa.')
  }

  const restaurar = async () => {
    setError(null)
    setAviso(null)
    setGuardando(true)
    const resultado = await window.dm.catalogos.restaurar()
    setGuardando(false)
    if (!resultado.ok) return setError(resultado.error)
    aplicarCatalogosEnPantalla(resultado.datos)
    poner(resultado.datos)
    setAviso('Volvieron las listas de siempre.')
  }

  if (!cargado) return null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Tarjeta
        titulo="Sucursales"
        descripcion="Las sucursales que se ofrecen en los filtros, las altas y los reportes. Si cambiás un nombre, el anterior se sigue reconociendo: nada de lo cargado se pierde. En «También se escribe» van las otras formas con que la planilla o los usuarios viejos nombran la misma sucursal, separadas por coma."
      >
        <div className="space-y-3">
          {sucursales.map((fila, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3">
              <div className="min-w-40 flex-1">
                <Campo etiqueta="Nombre" value={fila.nombre} maxLength={MAXIMO_DE_NOMBRE_DE_CATALOGO} onChange={(e) => setSucursales(sucursales.map((f, j) => (j === i ? { ...f, nombre: e.target.value } : f)))} />
              </div>
              <div className="min-w-40 flex-1">
                <Campo etiqueta="También se escribe" value={fila.sinonimos} onChange={(e) => setSucursales(sucursales.map((f, j) => (j === i ? { ...f, sinonimos: e.target.value } : f)))} />
              </div>
              <div className="flex gap-1">
                <Boton variante="fantasma" tamano="sm" title="Subir" disabled={i === 0} onClick={() => setSucursales(mover(sucursales, i, i - 1))}>
                  ↑
                </Boton>
                <Boton variante="fantasma" tamano="sm" title="Bajar" disabled={i === sucursales.length - 1} onClick={() => setSucursales(mover(sucursales, i, i + 1))}>
                  ↓
                </Boton>
                <Boton variante="fantasma" tamano="sm" title="Sacar de la lista" disabled={sucursales.length <= 1} onClick={() => setSucursales(sucursales.filter((_, j) => j !== i))}>
                  Sacar
                </Boton>
              </div>
            </div>
          ))}
          <Boton variante="secundario" tamano="sm" disabled={sucursales.length >= MAXIMO_DE_SUCURSALES} onClick={() => setSucursales([...sucursales, { nombre: '', original: null, sinonimos: '' }])}>
            Agregar sucursal
          </Boton>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Ramas"
        descripcion="Los tipos de vehículo que vende la agencia, en el orden en que se ofrecen. Cambiar el nombre sólo cambia cómo se lee en pantalla. «Se comporta» decide con qué grupo se afina la categoría del catálogo de vehículos."
      >
        <div className="space-y-3">
          {ramas.map((fila, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3">
              <div className="min-w-40 flex-1">
                <Campo etiqueta="Nombre" value={fila.nombre} maxLength={MAXIMO_DE_NOMBRE_DE_CATALOGO} onChange={(e) => setRamas(ramas.map((f, j) => (j === i ? { ...f, nombre: e.target.value } : f)))} />
              </div>
              <div className="min-w-40 flex-1">
                <Campo etiqueta="También se escribe" value={fila.sinonimos} onChange={(e) => setRamas(ramas.map((f, j) => (j === i ? { ...f, sinonimos: e.target.value } : f)))} />
              </div>
              <div className="min-w-48">
                <Selector etiqueta="Se comporta" opciones={FAMILIAS} value={fila.familia} onChange={(e) => setRamas(ramas.map((f, j) => (j === i ? { ...f, familia: e.target.value as FamiliaDeRama } : f)))} />
              </div>
              <div className="flex gap-1">
                <Boton variante="fantasma" tamano="sm" title="Subir" disabled={i === 0} onClick={() => setRamas(mover(ramas, i, i - 1))}>
                  ↑
                </Boton>
                <Boton variante="fantasma" tamano="sm" title="Bajar" disabled={i === ramas.length - 1} onClick={() => setRamas(mover(ramas, i, i + 1))}>
                  ↓
                </Boton>
                <Boton variante="fantasma" tamano="sm" title="Sacar de la lista" disabled={ramas.length <= 1} onClick={() => setRamas(ramas.filter((_, j) => j !== i))}>
                  Sacar
                </Boton>
              </div>
            </div>
          ))}
          <Boton variante="secundario" tamano="sm" disabled={ramas.length >= MAXIMO_DE_RAMAS} onClick={() => setRamas([...ramas, { valor: null, nombre: '', familia: 'otro', sinonimos: '' }])}>
            Agregar rama
          </Boton>
        </div>
      </Tarjeta>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <div className="flex gap-2">
        <Boton variante="primario" onClick={() => void guardar()} cargando={guardando} escribe>
          Guardar
        </Boton>
        <Boton variante="secundario" onClick={() => void restaurar()} disabled={guardando}>
          Volver a las listas de siempre
        </Boton>
      </div>
      <Alerta tono="info">
        Sacar una sucursal o una rama de la lista no borra lo que ya está cargado: sigue en los listados, aparte, como «fuera del catálogo». Las computadoras con la versión normal del programa siguen con las listas de siempre hasta que se actualicen.
      </Alerta>
    </div>
  )
}
