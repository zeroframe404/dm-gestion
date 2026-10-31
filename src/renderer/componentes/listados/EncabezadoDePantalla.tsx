// Encabezado de las pantallas de listado: recuadro con el ícono, título grande, subtítulo gris y, a la
// derecha, los botones de acción.
//
// Uso:
//   <EncabezadoDePantalla
//     icono="usuario"
//     titulo="Listado de Asegurados"
//     subtitulo="Buscar y administrar los clientes asegurados de tu cartera"
//     acciones={<>
//       <Boton icono="descargar" onClick={exportar}>Exportar Excel</Boton>
//       <Boton variante="primario" icono="mas" onClick={crear}>Crear Cliente</Boton>
//       <AccionNoDisponible icono="usuario" motivo="Todavía no se pueden asignar vendedores.">Asignar Vendedores</AccionNoDisponible>
//     </>}
//   />
// Los botones son los `Boton` de siempre (secundario con borde e ícono, primario relleno).
import type { ReactNode } from 'react'
import { Boton } from '../ui'
import { Icono, type NombreIcono } from '../Icono'

interface PropsEncabezadoDePantalla {
  icono: NombreIcono
  titulo: string
  subtitulo?: string
  /** Botones de acción, alineados a la derecha. */
  acciones?: ReactNode
}

export function EncabezadoDePantalla({ icono, titulo, subtitulo, acciones }: PropsEncabezadoDePantalla) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-marino-700 shadow-suave">
        <Icono nombre={icono} tamano={24} />
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">{titulo}</h1>
        {subtitulo && <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center justify-end gap-2">{acciones}</div>}
    </header>
  )
}

interface PropsAccionNoDisponible {
  icono?: NombreIcono
  /** Por qué no se puede todavía. Se lee al pasar el mouse. */
  motivo: string
  children: ReactNode
}

/**
 * Un botón que está en el diseño pero todavía no hace nada: se muestra apagado y el globo explica por
 * qué. Nada de botones que parecen andar y no andan. El `span` es el que lleva el globo porque un
 * botón deshabilitado no siempre lo muestra.
 */
export function AccionNoDisponible({ icono, motivo, children }: PropsAccionNoDisponible) {
  return (
    <span title={motivo} className="inline-flex">
      <Boton icono={icono} disabled aria-label={`${typeof children === 'string' ? children : 'Acción'}: ${motivo}`}>
        {children}
      </Boton>
    </span>
  )
}
