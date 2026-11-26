// El croquis del siniestro: un dibujo armado en pantalla para entender cómo fue el choque.
//
// Pasa seguido que el cliente cuenta el choque en un audio y no se entiende cuál venía por dónde.
// Con esto se arma el cruce, se acomodan los vehículos mientras el cliente va contando y se le
// muestra (o se le manda la imagen) para que confirme «sí, así fue». Al confirmar queda como un
// documento más de la ficha: una imagen PNG en «Otras documentaciones», que ya viaja por el
// circuito normal de adjuntos (no toca el servidor ni la versión normal del programa).
//
// Todo es SVG con atributos en línea —nada de clases CSS— porque al confirmar se serializa a imagen y
// la imagen no ve las hojas de estilo de la ventana.
import { useCallback, useMemo, useRef, useState, type PointerEvent as EventoDePuntero, type ReactElement } from 'react'
import type { ArchivoParaAdjuntar } from '../../../shared/tipos'
import { Alerta, Boton, Dialogo, cx } from '../../componentes/ui'

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

export const ANCHO_CROQUIS = 800
export const ALTO_CROQUIS = 560

export type TipoDeCalle = 'cruz' | 'te' | 'rotonda' | 'recta' | 'blanco'
export type TipoDeElemento = 'auto' | 'moto' | 'bici' | 'camion' | 'colectivo' | 'peaton' | 'rotulo'

export interface ElementoDeCroquis {
  id: number
  tipo: TipoDeElemento
  x: number
  y: number
  /** Grados, en sentido horario; 0 = el frente apunta hacia arriba. */
  giro: number
  color: string
  /** La letra del vehículo (A, B, C…) o el nombre de la calle si es un rótulo. */
  texto: string
}

export const TIPOS_DE_CALLE: Array<{ valor: TipoDeCalle; texto: string }> = [
  { valor: 'cruz', texto: 'Cruce en cruz (+)' },
  { valor: 'te', texto: 'Cruce en T' },
  { valor: 'rotonda', texto: 'Rotonda' },
  { valor: 'recta', texto: 'Calle recta' },
  { valor: 'blanco', texto: 'En blanco' },
]

/** Lo que se ofrece para agregar. El color de cada uno va rotando para distinguir a los vehículos. */
export const PALETA: Array<{ tipo: Exclude<TipoDeElemento, 'rotulo'>; texto: string }> = [
  { tipo: 'auto', texto: 'Auto' },
  { tipo: 'moto', texto: 'Moto' },
  { tipo: 'bici', texto: 'Bici' },
  { tipo: 'camion', texto: 'Camión' },
  { tipo: 'colectivo', texto: 'Colectivo' },
  { tipo: 'peaton', texto: 'Peatón' },
]

export const COLORES_DE_VEHICULO = ['#16a34a', '#2563eb', '#dc2626', '#ea580c', '#7c3aed', '#0d9488', '#ca8a04', '#db2777']

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** La primera letra que no usa ningún vehículo del dibujo. */
export function proximaLetra(elementos: ElementoDeCroquis[]): string {
  const usadas = new Set(elementos.filter((e) => e.tipo !== 'rotulo').map((e) => e.texto))
  return LETRAS.split('').find((letra) => !usadas.has(letra)) ?? '?'
}

/** El color que sigue al del último vehículo agregado, para que dos vehículos seguidos no se parezcan. */
export function proximoColor(elementos: ElementoDeCroquis[]): string {
  const cantidad = elementos.filter((e) => e.tipo !== 'rotulo').length
  return COLORES_DE_VEHICULO[cantidad % COLORES_DE_VEHICULO.length]
}

/** Deja el valor dentro del dibujo (con un margen) para que nada se pierda fuera del mapa. */
export function dentroDelMapa(valor: number, maximo: number, margen = 12): number {
  return Math.min(maximo - margen, Math.max(margen, valor))
}

/** Los rótulos de calle con los que arranca cada tipo de calle. */
function rotulosIniciales(calle: TipoDeCalle): Array<{ x: number; y: number; texto: string }> {
  if (calle === 'cruz') {
    return [
      { x: 400, y: 36, texto: 'CALLE 1' },
      { x: 400, y: 524, texto: 'CALLE 1' },
      { x: 110, y: 330, texto: 'CALLE 2' },
      { x: 690, y: 330, texto: 'CALLE 2' },
    ]
  }
  if (calle === 'te') {
    return [
      { x: 400, y: 36, texto: 'CALLE 1' },
      { x: 110, y: 330, texto: 'CALLE 2' },
      { x: 690, y: 330, texto: 'CALLE 2' },
    ]
  }
  if (calle === 'rotonda') {
    return [
      { x: 400, y: 36, texto: 'CALLE 1' },
      { x: 400, y: 524, texto: 'CALLE 1' },
      { x: 110, y: 330, texto: 'CALLE 2' },
      { x: 690, y: 330, texto: 'CALLE 2' },
    ]
  }
  if (calle === 'recta') return [{ x: 400, y: 330, texto: 'CALLE' }]
  return []
}

/** Un dibujo nuevo: la calle elegida con sus rótulos y nada más. */
export function croquisInicial(calle: TipoDeCalle): ElementoDeCroquis[] {
  return rotulosIniciales(calle).map((rotulo, indice) => ({
    id: indice + 1,
    tipo: 'rotulo',
    x: rotulo.x,
    y: rotulo.y,
    giro: 0,
    color: '#ffffff',
    texto: rotulo.texto,
  }))
}

function proximoId(elementos: ElementoDeCroquis[]): number {
  return elementos.reduce((mayor, e) => Math.max(mayor, e.id), 0) + 1
}

/** Normaliza un ángulo a 0–359. */
export function normalizarGiro(grados: number): number {
  return ((Math.round(grados) % 360) + 360) % 360
}

// ---------------------------------------------------------------------------
// Dibujo de la calle
// ---------------------------------------------------------------------------

const CENTRO_X = ANCHO_CROQUIS / 2
const CENTRO_Y = 280
const ANCHO_CALLE = 150
const BORDE = 3

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Los tramos de calle de cada tipo, en el mismo sistema de coordenadas del dibujo. */
function tramosDeCalle(calle: TipoDeCalle): Rect[] {
  const horizontal: Rect = { x: 0, y: CENTRO_Y - ANCHO_CALLE / 2, w: ANCHO_CROQUIS, h: ANCHO_CALLE }
  const vertical: Rect = { x: CENTRO_X - ANCHO_CALLE / 2, y: 0, w: ANCHO_CALLE, h: ALTO_CROQUIS }
  if (calle === 'cruz' || calle === 'rotonda') return [horizontal, vertical]
  if (calle === 'te') return [horizontal, { ...vertical, h: CENTRO_Y }]
  if (calle === 'recta') return [horizontal]
  return []
}

function Calle({ calle }: { calle: TipoDeCalle }) {
  const tramos = tramosDeCalle(calle)
  const rotonda = calle === 'rotonda'
  const rayas: ReactElement[] = []

  // Línea de eje discontinua: se corta antes del cruce para no atravesarlo.
  if (calle !== 'blanco') {
    const tieneVertical = calle === 'cruz' || calle === 'te' || calle === 'rotonda'
    const mitad = ANCHO_CALLE / 2
    const trazo = { stroke: '#374151', strokeWidth: 3, strokeDasharray: '22 18' }
    if (calle === 'recta') {
      rayas.push(<line key="h" x1={0} y1={CENTRO_Y} x2={ANCHO_CROQUIS} y2={CENTRO_Y} {...trazo} />)
    } else {
      rayas.push(<line key="h1" x1={0} y1={CENTRO_Y} x2={CENTRO_X - mitad - 8} y2={CENTRO_Y} {...trazo} />)
      rayas.push(<line key="h2" x1={CENTRO_X + mitad + 8} y1={CENTRO_Y} x2={ANCHO_CROQUIS} y2={CENTRO_Y} {...trazo} />)
    }
    if (tieneVertical) {
      rayas.push(<line key="v1" x1={CENTRO_X} y1={0} x2={CENTRO_X} y2={CENTRO_Y - mitad - 8} {...trazo} />)
      if (calle !== 'te') {
        rayas.push(<line key="v2" x1={CENTRO_X} y1={CENTRO_Y + mitad + 8} x2={CENTRO_X} y2={ALTO_CROQUIS} {...trazo} />)
      }
    }
  }

  return (
    <g>
      {/* Manzanas */}
      <rect x={0} y={0} width={ANCHO_CROQUIS} height={ALTO_CROQUIS} fill={calle === 'blanco' ? '#ffffff' : '#e5e7eb'} />
      {/* Cordones: se dibujan los tramos más anchos en negro y encima los blancos, y queda el borde. */}
      {tramos.map((t, i) => (
        <rect key={`b${i}`} x={t.x - BORDE} y={t.y - BORDE} width={t.w + BORDE * 2} height={t.h + BORDE * 2} fill="#111827" />
      ))}
      {rotonda && <circle cx={CENTRO_X} cy={CENTRO_Y} r={ANCHO_CALLE / 2 + 60 + BORDE} fill="#111827" />}
      {tramos.map((t, i) => (
        <rect key={`c${i}`} x={t.x} y={t.y} width={t.w} height={t.h} fill="#ffffff" />
      ))}
      {rotonda && <circle cx={CENTRO_X} cy={CENTRO_Y} r={ANCHO_CALLE / 2 + 60} fill="#ffffff" />}
      {rotonda && <circle cx={CENTRO_X} cy={CENTRO_Y} r={50 + BORDE} fill="#111827" />}
      {rotonda && <circle cx={CENTRO_X} cy={CENTRO_Y} r={50} fill="#bbf7d0" />}
      {!rotonda && rayas}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Dibujo de cada elemento (mirando hacia arriba, centrado en 0,0)
// ---------------------------------------------------------------------------

function CuerpoDelVehiculo({ tipo, color }: { tipo: Exclude<TipoDeElemento, 'rotulo'>; color: string }) {
  const borde = '#111827'
  const vidrio = '#1f2937'
  if (tipo === 'auto') {
    return (
      <g>
        <rect x={-20} y={-40} width={40} height={80} rx={12} fill={color} stroke={borde} strokeWidth={2} />
        <rect x={-15} y={-26} width={30} height={13} rx={4} fill={vidrio} />
        <rect x={-15} y={13} width={30} height={11} rx={4} fill={vidrio} />
        <rect x={-14} y={-10} width={28} height={20} rx={5} fill="#ffffff" fillOpacity={0.28} />
      </g>
    )
  }
  if (tipo === 'moto') {
    return (
      <g>
        <rect x={-6} y={-30} width={12} height={60} rx={6} fill={color} stroke={borde} strokeWidth={2} />
        <rect x={-14} y={-20} width={28} height={5} rx={2.5} fill={borde} />
        <circle cx={0} cy={2} r={6} fill="#ffffff" stroke={borde} strokeWidth={1.5} />
      </g>
    )
  }
  if (tipo === 'bici') {
    return (
      <g>
        <ellipse cx={0} cy={-20} rx={4} ry={10} fill="#ffffff" stroke={borde} strokeWidth={1.5} />
        <ellipse cx={0} cy={20} rx={4} ry={10} fill="#ffffff" stroke={borde} strokeWidth={1.5} />
        <line x1={0} y1={-18} x2={0} y2={18} stroke={color} strokeWidth={4} strokeLinecap="round" />
        <line x1={-12} y1={-12} x2={12} y2={-12} stroke={borde} strokeWidth={3} strokeLinecap="round" />
        <circle cx={0} cy={0} r={5} fill={color} stroke={borde} strokeWidth={1.5} />
      </g>
    )
  }
  if (tipo === 'camion') {
    return (
      <g>
        <rect x={-24} y={-66} width={48} height={132} rx={6} fill="#d1d5db" stroke={borde} strokeWidth={2} />
        <rect x={-24} y={-66} width={48} height={34} rx={6} fill={color} stroke={borde} strokeWidth={2} />
        <rect x={-18} y={-60} width={36} height={12} rx={3} fill={vidrio} />
        <line x1={-24} y1={-28} x2={24} y2={-28} stroke={borde} strokeWidth={2} />
      </g>
    )
  }
  if (tipo === 'colectivo') {
    return (
      <g>
        <rect x={-23} y={-60} width={46} height={120} rx={8} fill={color} stroke={borde} strokeWidth={2} />
        <rect x={-17} y={-54} width={34} height={11} rx={3} fill={vidrio} />
        <rect x={-17} y={-34} width={34} height={86} rx={3} fill="#ffffff" fillOpacity={0.28} />
        <rect x={-17} y={46} width={34} height={8} rx={3} fill={vidrio} />
      </g>
    )
  }
  // peatón: visto desde arriba, hombros y cabeza
  return (
    <g>
      <ellipse cx={0} cy={0} rx={16} ry={9} fill={color} stroke={borde} strokeWidth={2} />
      <circle cx={0} cy={0} r={7} fill="#fcd9b6" stroke={borde} strokeWidth={1.5} />
    </g>
  )
}

/** La flechita blanca del frente: así se ve para dónde mira cada vehículo. */
function FlechaDeFrente({ tipo }: { tipo: Exclude<TipoDeElemento, 'rotulo'> }) {
  const arriba = { auto: -44, moto: -34, bici: -34, camion: -70, colectivo: -64, peaton: -12 }[tipo]
  return <polygon points={`0,${arriba - 8} 6,${arriba} -6,${arriba}`} fill="#111827" />
}

function Elemento({ e, seleccionado }: { e: ElementoDeCroquis; seleccionado: boolean }) {
  if (e.tipo === 'rotulo') {
    const ancho = Math.max(60, e.texto.length * 9.5 + 20)
    return (
      <g transform={`translate(${e.x} ${e.y}) rotate(${e.giro})`}>
        <rect x={-ancho / 2} y={-13} width={ancho} height={26} rx={5} fill="#ffffff" fillOpacity={0.95} stroke={seleccionado ? '#2563eb' : '#6b7280'} strokeWidth={seleccionado ? 2.5 : 1.2} />
        <text x={0} y={5} textAnchor="middle" fontSize={14} fontWeight={700} fontFamily="Arial, Helvetica, sans-serif" fill="#111827">
          {e.texto}
        </text>
      </g>
    )
  }
  const tipo = e.tipo
  return (
    <g transform={`translate(${e.x} ${e.y}) rotate(${e.giro})`}>
      <CuerpoDelVehiculo tipo={tipo} color={e.color} />
      <FlechaDeFrente tipo={tipo} />
      {/* La letra va contra-rotada para que siempre se lea derecha. */}
      <g transform={`rotate(${-e.giro})`}>
        <circle cx={0} cy={0} r={11} fill="#ffffff" stroke="#111827" strokeWidth={1.5} />
        <text x={0} y={5} textAnchor="middle" fontSize={14} fontWeight={800} fontFamily="Arial, Helvetica, sans-serif" fill="#111827">
          {e.texto}
        </text>
      </g>
    </g>
  )
}

// ---------------------------------------------------------------------------
// Pasar el dibujo a imagen
// ---------------------------------------------------------------------------

/** El SVG tal cual se ve, convertido en PNG (al doble de tamaño para que se lea al zoom). */
async function svgAPng(svg: SVGSVGElement): Promise<{ bytes: Uint8Array; ancho: number; alto: number }> {
  const copia = svg.cloneNode(true) as SVGSVGElement
  // Lo que es sólo de la pantalla (el resalte de la selección) no va en la imagen.
  copia.querySelectorAll('[data-ui]').forEach((nodo) => nodo.remove())
  copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copia.setAttribute('width', String(ANCHO_CROQUIS))
  copia.setAttribute('height', String(ALTO_CROQUIS))
  const texto = new XMLSerializer().serializeToString(copia)
  // Va como data: y no como blob: porque la política de seguridad de la app sólo deja cargar imágenes
  // propias y data: (ver vite.config.mts).
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(texto)}`
  {
    const imagen = await new Promise<HTMLImageElement>((resolver, rechazar) => {
      const nueva = new Image()
      nueva.onload = () => resolver(nueva)
      nueva.onerror = () => rechazar(new Error('No se pudo armar la imagen del croquis.'))
      nueva.src = url
    })
    const escala = 2
    const lienzo = document.createElement('canvas')
    lienzo.width = ANCHO_CROQUIS * escala
    lienzo.height = ALTO_CROQUIS * escala
    const contexto = lienzo.getContext('2d')
    if (!contexto) throw new Error('No se pudo armar la imagen del croquis.')
    contexto.fillStyle = '#ffffff'
    contexto.fillRect(0, 0, lienzo.width, lienzo.height)
    contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
    const blob = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, 'image/png'))
    if (!blob) throw new Error('No se pudo armar la imagen del croquis.')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ancho: lienzo.width, alto: lienzo.height }
  }
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

interface Props {
  alCerrar: () => void
  /** Recibe el croquis ya confirmado como archivo. Devuelve si se guardó (si no, el diálogo sigue abierto). */
  alConfirmar: (archivo: ArchivoParaAdjuntar) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function CroquisDelSiniestro({ alCerrar, alConfirmar }: Props) {
  const [calle, setCalle] = useState<TipoDeCalle>('cruz')
  const [elementos, setElementos] = useState<ElementoDeCroquis[]>(() => croquisInicial('cruz'))
  const [seleccionadoId, setSeleccionadoId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const arrastre = useRef<{ id: number; dx: number; dy: number } | null>(null)

  const seleccionado = useMemo(() => elementos.find((e) => e.id === seleccionadoId) ?? null, [elementos, seleccionadoId])
  const hayVehiculos = elementos.some((e) => e.tipo !== 'rotulo')

  const cambiarCalle = (nueva: TipoDeCalle) => {
    if (nueva === calle) return
    if (hayVehiculos && !window.confirm('Al cambiar el tipo de calle se acomodan de nuevo los nombres de las calles. Los vehículos se mantienen. ¿Seguir?')) return
    setCalle(nueva)
    // Los vehículos se quedan donde estaban; los rótulos se rearman para la calle nueva.
    setElementos((actuales) => {
      const vehiculos = actuales.filter((e) => e.tipo !== 'rotulo')
      const base = vehiculos.reduce((mayor, e) => Math.max(mayor, e.id), 0)
      const rotulos = croquisInicial(nueva).map((r, i) => ({ ...r, id: base + i + 1 }))
      return [...rotulos, ...vehiculos]
    })
    setSeleccionadoId(null)
  }

  const agregar = (tipo: Exclude<TipoDeElemento, 'rotulo'>) => {
    setElementos((actuales) => {
      const id = proximoId(actuales)
      // Aparece en una grilla sobre las manzanas, fuera de la calle, para que los que se agregan seguidos no
      // se tapen entre sí; se arrastra desde ahí al lugar que corresponda.
      const cantidad = actuales.filter((e) => e.tipo !== 'rotulo').length
      const columna = cantidad % 6
      const fila = Math.floor(cantidad / 6) % 2
      const nuevo: ElementoDeCroquis = {
        id,
        tipo,
        x: 80 + columna * 128,
        y: fila === 0 ? 470 : 90,
        giro: 0,
        color: proximoColor(actuales),
        texto: proximaLetra(actuales),
      }
      setSeleccionadoId(id)
      return [...actuales, nuevo]
    })
  }

  const agregarRotulo = () => {
    setElementos((actuales) => {
      const id = proximoId(actuales)
      setSeleccionadoId(id)
      return [...actuales, { id, tipo: 'rotulo', x: CENTRO_X, y: 90, giro: 0, color: '#ffffff', texto: 'CALLE' }]
    })
  }

  const cambiar = useCallback((id: number, cambios: Partial<ElementoDeCroquis>) => {
    setElementos((actuales) => actuales.map((e) => (e.id === id ? { ...e, ...cambios } : e)))
  }, [])

  const girar = (grados: number) => {
    if (seleccionado) cambiar(seleccionado.id, { giro: normalizarGiro(seleccionado.giro + grados) })
  }

  const eliminar = () => {
    if (!seleccionado) return
    setElementos((actuales) => actuales.filter((e) => e.id !== seleccionado.id))
    setSeleccionadoId(null)
  }

  const reiniciar = () => {
    if (elementos.some((e) => e.tipo !== 'rotulo') && !window.confirm('Se borran todos los vehículos del dibujo. ¿Seguir?')) return
    setElementos(croquisInicial(calle))
    setSeleccionadoId(null)
  }

  // --- Arrastrar -----------------------------------------------------------
  const puntoDelMapa = (evento: EventoDePuntero): { x: number; y: number } | null => {
    const svg = svgRef.current
    const matriz = svg?.getScreenCTM()
    if (!svg || !matriz) return null
    const punto = svg.createSVGPoint()
    punto.x = evento.clientX
    punto.y = evento.clientY
    const dentro = punto.matrixTransform(matriz.inverse())
    return { x: dentro.x, y: dentro.y }
  }

  const alApretar = (evento: EventoDePuntero, e: ElementoDeCroquis) => {
    const punto = puntoDelMapa(evento)
    if (!punto) return
    evento.preventDefault()
    svgRef.current?.setPointerCapture(evento.pointerId)
    arrastre.current = { id: e.id, dx: punto.x - e.x, dy: punto.y - e.y }
    setSeleccionadoId(e.id)
  }

  const alMover = (evento: EventoDePuntero) => {
    const actual = arrastre.current
    if (!actual) return
    const punto = puntoDelMapa(evento)
    if (!punto) return
    cambiar(actual.id, { x: dentroDelMapa(punto.x - actual.dx, ANCHO_CROQUIS), y: dentroDelMapa(punto.y - actual.dy, ALTO_CROQUIS) })
  }

  const alSoltar = (evento: EventoDePuntero) => {
    arrastre.current = null
    if (svgRef.current?.hasPointerCapture(evento.pointerId)) svgRef.current.releasePointerCapture(evento.pointerId)
  }

  // --- Salida ----------------------------------------------------------------
  const generar = async (): Promise<ArchivoParaAdjuntar> => {
    const svg = svgRef.current
    if (!svg) throw new Error('No se pudo armar la imagen del croquis.')
    const { bytes, ancho, alto } = await svgAPng(svg)
    const fecha = new Date().toISOString().slice(0, 10)
    return { nombre: `croquis-del-siniestro-${fecha}.png`, tipo: 'image/png', contenido: bytes, ancho, alto }
  }

  const descargar = async () => {
    setError(null)
    try {
      const archivo = await generar()
      const url = URL.createObjectURL(new Blob([archivo.contenido as BlobPart], { type: 'image/png' }))
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = archivo.nombre
      enlace.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No se pudo descargar el croquis.')
    }
  }

  const confirmar = async () => {
    setGuardando(true)
    setError(null)
    try {
      const resultado = await alConfirmar(await generar())
      if (!resultado.ok) setError(resultado.error)
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No se pudo guardar el croquis.')
    } finally {
      setGuardando(false)
    }
  }

  const seleccionadoEsRotulo = seleccionado?.tipo === 'rotulo'

  return (
    <Dialogo
      abierto
      ancho="xl"
      titulo="Croquis del siniestro"
      descripcion="Armá cómo fue el choque mientras el cliente lo cuenta: elegí la calle, sumá los vehículos y acomodalos. Cuando el cliente confirme que está bien, se guarda en la ficha."
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton icono="descargar" onClick={() => void descargar()} disabled={guardando}>
            Descargar imagen
          </Boton>
          <Boton escribe variante="primario" icono="ok" onClick={() => void confirmar()} cargando={guardando} disabled={!hayVehiculos}>
            Confirmar y guardar en la ficha
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}

        <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de calle">
          {TIPOS_DE_CALLE.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              onClick={() => cambiarCalle(opcion.valor)}
              aria-pressed={calle === opcion.valor}
              className={cx(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                calle === opcion.valor ? 'border-marino-600 bg-marino-50 text-marino-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {opcion.texto}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${ANCHO_CROQUIS} ${ALTO_CROQUIS}`}
              className="mx-auto max-h-[62vh] w-full touch-none select-none rounded-xl border border-slate-200 bg-white"
              onPointerMove={alMover}
              onPointerUp={alSoltar}
              onPointerCancel={alSoltar}
              onPointerDown={(evento) => {
                // Un toque en el fondo deselecciona.
                if (evento.target === evento.currentTarget || (evento.target as Element).closest('[data-fondo]')) setSeleccionadoId(null)
              }}
              role="img"
              aria-label="Croquis del siniestro"
            >
              <g data-fondo="1">
                <Calle calle={calle} />
              </g>
              {elementos.map((e) => (
                <g
                  key={e.id}
                  onPointerDown={(evento) => alApretar(evento, e)}
                  style={{ cursor: arrastre.current?.id === e.id ? 'grabbing' : 'grab' }}
                >
                  <Elemento e={e} seleccionado={e.id === seleccionadoId} />
                  {e.id === seleccionadoId && e.tipo !== 'rotulo' && (
                    <g data-ui="seleccion" transform={`translate(${e.x} ${e.y}) rotate(${e.giro})`} pointerEvents="none">
                      <rect x={-34} y={-76} width={68} height={152} rx={12} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeDasharray="6 5" />
                    </g>
                  )}
                </g>
              ))}
            </svg>
            <p className="mt-2 text-xs text-slate-500">
              Arrastrá los vehículos sobre el mapa. La flechita negra marca para dónde mira cada uno. Tocá uno para girarlo, cambiarle el color o borrarlo.
            </p>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-3 lg:w-60">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Agregar al dibujo</p>
              <div className="grid grid-cols-2 gap-2">
                {PALETA.map((opcion) => (
                  <Boton key={opcion.tipo} tamano="sm" onClick={() => agregar(opcion.tipo)}>
                    + {opcion.texto}
                  </Boton>
                ))}
                <Boton tamano="sm" className="col-span-2" onClick={agregarRotulo}>
                  + Nombre de calle
                </Boton>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {seleccionado ? (seleccionadoEsRotulo ? 'Nombre de calle elegido' : `Vehículo ${seleccionado.texto} elegido`) : 'Elegido'}
              </p>
              {!seleccionado ? (
                <p className="text-sm text-slate-500">Tocá un vehículo o un nombre de calle del dibujo para editarlo.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {seleccionadoEsRotulo && (
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      Nombre
                      <input
                        type="text"
                        value={seleccionado.texto}
                        maxLength={28}
                        onChange={(evento) => cambiar(seleccionado.id, { texto: evento.target.value.toUpperCase() })}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/30"
                      />
                    </label>
                  )}
                  {!seleccionadoEsRotulo && (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Color">
                      {COLORES_DE_VEHICULO.map((color) => (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Color ${color}`}
                          aria-pressed={seleccionado.color === color}
                          onClick={() => cambiar(seleccionado.id, { color })}
                          className={cx('h-6 w-6 rounded-full border-2', seleccionado.color === color ? 'border-slate-900' : 'border-white shadow')}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Boton tamano="sm" onClick={() => girar(-45)}>
                      ↺ 45°
                    </Boton>
                    <Boton tamano="sm" onClick={() => girar(45)}>
                      ↻ 45°
                    </Boton>
                  </div>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    Giro: {seleccionado.giro}°
                    <input
                      type="range"
                      min={0}
                      max={359}
                      value={seleccionado.giro}
                      onChange={(evento) => cambiar(seleccionado.id, { giro: normalizarGiro(Number(evento.target.value)) })}
                    />
                  </label>
                  <Boton tamano="sm" variante="peligro" icono="basura" onClick={eliminar}>
                    Borrar
                  </Boton>
                </div>
              )}
            </div>

            <Boton tamano="sm" onClick={reiniciar}>
              Empezar de nuevo
            </Boton>
          </div>
        </div>
      </div>
    </Dialogo>
  )
}
