// Cómo se dibuja una persona de la agencia (14.0): su foto, y si no cargó ninguna, sus iniciales
// sobre el color que eligió en la paleta.
//
// Es uno solo para toda la aplicación a propósito. Antes de la 14.0 había un círculo de iniciales
// escrito a mano en la barra superior y un `<Icono nombre="usuario">` gris en las tres listas de
// mensajes: cuatro dibujos distintos de la misma persona. Ahora el color y la foto vienen del perfil
// —que es de la agencia y no de esta computadora— así que la misma cara aparece igual en la barra, en
// la burbuja del glow, en la lista de conversaciones y en el encabezado del hilo.
//
// SIN PERFIL cae en Grafito, el último de la paleta: es el neutro, y es lo que corresponde mostrar
// mientras el canal todavía no trajo los perfiles o cuando la persona nunca eligió color. No se
// inventa un color a partir del nombre: los doce son únicos por persona y los reparte el servidor;
// uno adivinado acá se pisaría con el de alguien más y el glow diría mentiras.
import { colorDePaleta } from '../../shared/paleta'
import { obtenerIniciales } from '../../shared/texto'
import { usePerfiles } from '../contexto/Perfiles'
import { cx } from './ui'

export type TamanoDeAvatar = 'xs' | 'sm' | 'md' | 'lg'

/** Diámetro en píxeles y tamaño de letra de las iniciales, por tamaño. */
const MEDIDAS: Record<TamanoDeAvatar, { lado: number; letra: string }> = {
  // xs es la burbuja que se cuelga del glow: entra en el borde de una celda de 34 px de alto.
  xs: { lado: 18, letra: 'text-[9px]' },
  sm: { lado: 24, letra: 'text-[10px]' },
  md: { lado: 36, letra: 'text-xs' },
  lg: { lado: 48, letra: 'text-sm' },
}

export interface PropsAvatar {
  /** La clave de usuario (login en minúscula). Sin ella no hay perfil y va el neutro con iniciales. */
  clave?: string | null
  nombre: string
  tamano: TamanoDeAvatar
  /** Anillo del color de la persona alrededor de la foto: separa la cara del fondo donde se apoya. */
  anillo?: boolean
  /** Qué se lee al pasar el mouse. Por defecto, el nombre. */
  title?: string
  className?: string
}

export function Avatar({ clave, nombre, tamano, anillo = false, title, className }: PropsAvatar) {
  const { perfilDe } = usePerfiles()
  const perfil = perfilDe(clave)
  const color = colorDePaleta(perfil?.color ?? -1)
  const { lado, letra } = MEDIDAS[tamano]

  return (
    <span
      // `aria-hidden` no: el nombre completo va en el `title` y en el texto alternativo, así el lector
      // de pantalla dice quién es. El círculo de la barra superior antes era decorativo porque el
      // nombre estaba al lado; en la lista de conversaciones y en las burbujas del glow no lo está.
      title={title ?? nombre}
      style={{
        width: lado,
        height: lado,
        backgroundColor: perfil?.foto ? undefined : color.hex,
        color: color.texto,
        // El anillo con `box-shadow` y no con `border`: un borde le come píxeles a la foto y con 18 px
        // de lado la cara se pierde. El segundo anillo blanco es el que la despega del fondo cuando la
        // burbuja se apoya encima de una celda del color de alguien más.
        boxShadow: anillo ? `0 0 0 1.5px #ffffff, 0 0 0 3px ${color.hex}` : undefined,
      }}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-bold leading-none',
        letra,
        className,
      )}
    >
      {perfil?.foto ? (
        <img src={perfil.foto} alt={nombre} width={lado} height={lado} className="h-full w-full object-cover" />
      ) : (
        obtenerIniciales(nombre)
      )}
    </span>
  )
}
