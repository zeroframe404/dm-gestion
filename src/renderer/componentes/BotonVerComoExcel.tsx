// «Ver como Excel»: el botón que lleva de una pantalla del programa a la misma información en planilla.
//
// Está en cada módulo por lo mismo que existe «General Excel»: buena parte del equipo trabajó veinte
// años sobre una hoja de cálculo y esa es la forma en la que sabe buscar. Un botón acá es la diferencia
// entre «no encuentro nada en este programa» y «ah, era esto, en la columna de siempre».
//
// Va al mismo lugar que la barra lateral, no a una pantalla aparte: hay UNA vista de planilla y no una
// por módulo, así se comporta igual en todos lados y no hay doce copias que mantener.
import { useNavegacion } from '../contexto/Navegacion'
import { Boton } from './ui'

/**
 * @param area El id del listado en «General Excel» («cartera», «clientes», «mora»…). Es el mismo id
 *             que usa Reportes, porque los datos salen de ahí.
 */
export function BotonVerComoExcel({ area }: { area: string }) {
  const { ir } = useNavegacion()
  return (
    <Boton
      icono="cuadricula"
      onClick={() => ir('excel', { area })}
      title="Ver esta misma información en formato planilla, como en Excel."
    >
      Ver como Excel
    </Boton>
  )
}
