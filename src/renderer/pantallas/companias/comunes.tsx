// Lo que comparten las cinco pantallas del módulo Compañías: el buscador, los contadores, el aviso de
// «esto lo carga el superadministrador» y el diálogo de borrado. Están acá y no copiados cinco veces
// para que las cinco solapas se vean y se comporten igual: es un módulo de consulta, y lo que se
// consulta rápido es lo que siempre está en el mismo lugar.
import type { ReactNode } from 'react'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Dialogo } from '../../componentes/ui'

/** Clase de los encabezados de tabla, la misma que usa la matriz de coberturas. */
export const ENCABEZADO = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

/** Igual que en el proceso principal: se compara sin acentos ni signos, porque todo se escribe a mano. */
export function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

/** Ordena respetando acentos y ñ, que es como se leen los nombres de las compañías. */
export const comparar = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '', 'es-AR')

/** Un precio como se escribe en el mostrador: «$ 18.500» o «$ 18.500,50» si tiene centavos. */
export function pesos(valor: number): string {
  const conCentavos = Math.round(valor * 100) % 100 !== 0
  return `$ ${valor.toLocaleString('es-AR', {
    minimumFractionDigits: conCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** Una fecha 'AAAA-MM-DD' como se lee: «14/03/2026». Vacía se muestra como raya. */
export function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  const [anio, mes, dia] = iso.split('-')
  return dia && mes && anio ? `${dia}/${mes}/${anio}` : iso
}

export function Buscador({ valor, alCambiar, etiqueta }: { valor: string; alCambiar: (valor: string) => void; etiqueta: string }) {
  return (
    <div className="relative">
      <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        placeholder={`${etiqueta}…`}
        aria-label={etiqueta}
        className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
      />
    </div>
  )
}

/** Un número a la vista, con su rótulo. Es el contador de arriba de cada lista. */
export function Contador({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{rotulo}</span>
      <span className="ml-2 font-display text-lg font-extrabold tabular-nums text-slate-900">{valor.toLocaleString('es-AR')}</span>
    </div>
  )
}

/**
 * El aviso de sólo lectura. Se muestra a todo el que no sea el superadministrador, que es casi todo
 * el equipo: sin él, la pantalla parece rota («no hay ningún botón para agregar»).
 */
export function SoloConsulta({ que, pedirle }: { que: string; pedirle: string }) {
  return (
    <Alerta tono="info">
      {que} lo carga y lo edita el superadministrador. Acá lo podés consultar mientras atendés: si falta {pedirle}, pedísela para que la
      cargue.
    </Alerta>
  )
}

/** Fila vacía de una tabla, con el mensaje que corresponda: lista vacía o búsqueda sin resultados. */
export function SinFilas({
  columnas,
  vacia,
  busqueda,
  children,
}: {
  columnas: number
  vacia: boolean
  busqueda: string
  children: ReactNode
}) {
  return (
    <tr>
      <td colSpan={columnas} className="px-3 py-10 text-center">
        {vacia ? <div className="mx-auto max-w-lg">{children}</div> : <span className="text-slate-500">Nada coincide con «{busqueda}».</span>}
      </td>
    </tr>
  )
}

/** El diálogo de «¿seguro?». Lo mismo para las cuatro listas: lo que cambia es qué se está borrando. */
export function DialogoDeBorrado({
  abierto,
  titulo,
  descripcion,
  alCerrar,
  alConfirmar,
  children,
}: {
  abierto: boolean
  titulo: string
  descripcion?: string
  alCerrar: () => void
  alConfirmar: () => void
  children: ReactNode
}) {
  return (
    <Dialogo
      abierto={abierto}
      titulo={titulo}
      descripcion={descripcion}
      alCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton onClick={alCerrar}>Cancelar</Boton>
          <Boton variante="peligro" icono="basura" onClick={alConfirmar}>
            Borrar
          </Boton>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{children}</p>
    </Dialogo>
  )
}

/** Los botones de editar y borrar de una fila. Sólo aparecen con permiso de carga. */
export function AccionesDeFila({ alEditar, alBorrar }: { alEditar: () => void; alBorrar: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Boton tamano="sm" variante="fantasma" icono="lapiz" onClick={alEditar}>
        Editar
      </Boton>
      <Boton tamano="sm" variante="fantasma" icono="basura" onClick={alBorrar}>
        Borrar
      </Boton>
    </div>
  )
}

/** Un `<datalist>` con nombres ya usados: elegir de la lista es lo que evita «RUS» y «R.U.S.». */
export function Sugerencias({ id, valores }: { id: string; valores: string[] }) {
  return (
    <datalist id={id}>
      {valores.map((valor) => (
        <option key={valor} value={valor} />
      ))}
    </datalist>
  )
}
