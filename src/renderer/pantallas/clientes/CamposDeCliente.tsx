// Los tres campos del cliente que ahora saben algo: el documento, el nacimiento y la dirección.
//
// Están acá y no repetidos en cada pantalla porque el alta y la ficha tienen que comportarse igual.
// Que el alta detecte el CUIT y la ficha no sería peor que si ninguna de las dos lo hiciera: quien
// carga aprende una regla en una pantalla y descubre que en la otra no vale.
import { useMemo, useState } from 'react'
import {
  direccionCompleta,
  direccionEstaVacia,
  direccionTienePartes,
  textoDeDireccion,
  textoDeLocalidad,
  type DireccionEstructurada,
} from '../../../shared/direccion'
import { detectarDocumento } from '../../../shared/documento'
import { calcularEdad } from '../../../shared/edad'
import type { DatosDeCliente } from '../../../shared/tipos'
import { Boton, Campo, cx } from '../../componentes/ui'
import { DialogoDireccion } from './DialogoDireccion'

/** Los campos del cliente que son texto: los que se editan con un input común. */
export type CampoDeTexto = Exclude<keyof DatosDeCliente, 'direccionDetalle'>

const CAMPOS_DE_TEXTO: CampoDeTexto[] = [
  'nombre',
  'documento',
  'telefono',
  'email',
  'direccion',
  'localidad',
  'sucursal',
  'fechaNacimiento',
  'profesion',
]

/**
 * Los datos del cliente con la dirección cambiada.
 *
 * Cambia TRES campos y no uno: además de las partes, el renglón de siempre y la localidad, que se
 * arman con ellas. Si no, vaciar la dirección con el botón «Vaciar» dejaría las partes en blanco y el
 * renglón viejo intacto, y al guardar el proceso principal —que sin partes conserva lo que había—
 * lo resucitaría. Es lo mismo que hace el proceso principal al guardar; acá se hace para que la
 * pantalla muestre desde ya lo que va a quedar.
 */
export function conDireccion(datos: DatosDeCliente, direccionDetalle: DireccionEstructurada): DatosDeCliente {
  const vacia = direccionEstaVacia(direccionDetalle)
  return {
    ...datos,
    direccionDetalle,
    direccion: vacia ? '' : textoDeDireccion(direccionDetalle),
    localidad: vacia ? '' : direccionDetalle.localidad,
  }
}

/**
 * Le saca los espacios de los costados a lo que se escribió. Antes esto era un `Object.fromEntries`
 * sobre todas las claves; ahora una de ellas es la dirección en partes, que no tiene `.trim()`.
 */
export function recortar(datos: DatosDeCliente): DatosDeCliente {
  const recortado = { ...datos }
  for (const campo of CAMPOS_DE_TEXTO) recortado[campo] = datos[campo].trim()
  return recortado
}

/**
 * «DNI / CUIT», con el cartelito que dice qué entendió.
 *
 * No corrige ni completa nada: sólo muestra lo que leyó. Quien carga copia lo que dice el papel que
 * tiene delante y no le corresponde a él decidir la etiqueta; que el sistema muestre la suya es lo que
 * permite darse cuenta en el momento de que se fue un dígito, en vez de tres días después.
 */
export function CampoDeDocumento({
  valor,
  alCambiar,
  ayudaExtra,
}: {
  valor: string
  alCambiar: (valor: string) => void
  ayudaExtra?: string
}) {
  const detectado = useMemo(() => detectarDocumento(valor), [valor])
  const hayProblema = detectado.digitos.length > 0 && !detectado.valido

  return (
    <div>
      <Campo
        etiqueta="DNI / CUIT"
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        className="tabular-nums"
        autoComplete="off"
        ayuda={ayudaExtra}
      />
      {detectado.leyenda && (
        <p
          className={cx(
            'mt-1 flex items-center gap-1.5 text-xs font-medium',
            hayProblema ? 'text-amber-700' : 'text-green-700',
          )}
          role={hayProblema ? 'alert' : undefined}
        >
          <span
            className={cx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', hayProblema ? 'bg-amber-500' : 'bg-green-500')}
            aria-hidden="true"
          />
          {detectado.leyenda}
        </p>
      )}
    </div>
  )
}

/**
 * «Fecha de nacimiento», con la leyenda de menor de edad.
 *
 * Una póliza a nombre de un menor no se puede emitir sin más, y enterarse en el momento del alta evita
 * la llamada de la compañía tres días después. No bloquea nada: hay clientes menores con la póliza a
 * nombre de un mayor, y el sistema no es quién para decidir eso.
 */
export function CampoDeNacimiento({ valor, alCambiar }: { valor: string; alCambiar: (valor: string) => void }) {
  const edad = useMemo(() => calcularEdad(valor), [valor])

  return (
    <div>
      <Campo
        etiqueta="Fecha de nacimiento"
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        ayuda="Como se escribe en la hoja (por ejemplo 12/05/1980)."
        autoComplete="off"
      />
      {edad.esMenor && (
        <p className="mt-1 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800" role="alert">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          {edad.leyenda}
          <span className="font-medium text-amber-700">· {edad.anios} años</span>
        </p>
      )}
      {!edad.esMenor && edad.anios !== null && <p className="mt-1 text-xs text-slate-500">{edad.anios} años.</p>}
      {edad.problema && (
        <p className="mt-1 text-xs text-amber-700" role="alert">
          {edad.problema}
        </p>
      )}
    </div>
  )
}

/**
 * El botón «Dirección», que reemplazó a los dos campos sueltos de antes. Muestra lo que hay cargado en
 * un renglón; el detalle se edita en la ventanita.
 *
 * `renglon` es la dirección guardada como texto (la columna que viaja). Cuando no hay partes —otra
 * computadora, una ficha que vino de la hoja— es lo único que dice dónde vive el cliente, y hay que
 * mostrarlo: armar el texto sólo con las partes dejaba un «Lanús» a secas y parecía que lo cargado
 * no se había guardado.
 */
export function BotonDeDireccion({
  direccion,
  renglon = '',
  alCambiar,
  localidadesConocidas,
}: {
  direccion: DireccionEstructurada
  renglon?: string
  alCambiar: (direccion: DireccionEstructurada) => void
  localidadesConocidas?: string[]
}) {
  const [abierto, setAbierto] = useState(false)
  const soloRenglon = !direccionTienePartes(direccion) && renglon.trim() !== ''
  const vacia = direccionEstaVacia(direccion) && !soloRenglon
  const texto = soloRenglon
    ? [renglon.trim(), textoDeLocalidad(direccion)].filter(Boolean).join(' · ')
    : direccionCompleta(direccion)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">Dirección</span>
      <Boton icono="sucursal" onClick={() => setAbierto(true)} className="justify-start">
        {vacia ? 'Cargar la dirección' : 'Cambiar la dirección'}
      </Boton>
      <p className={cx('text-xs', vacia ? 'text-slate-500' : 'text-slate-700')}>{vacia ? 'Todavía no se cargó.' : texto}</p>

      <DialogoDireccion
        abierto={abierto}
        direccion={direccion}
        renglon={renglon}
        localidadesConocidas={localidadesConocidas}
        alCerrar={() => setAbierto(false)}
        alGuardar={(nueva) => {
          alCambiar(nueva)
          setAbierto(false)
        }}
      />
    </div>
  )
}
