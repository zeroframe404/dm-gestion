// La foto y el color de cada persona de la agencia (14.0), tal como los mira la pantalla.
//
// UN SOLO SUSCRIPTOR, igual que `DatosEnVivo` y `Conexion`: el proveedor se monta una vez en
// `App.tsx` y es el único que escucha `perfiles:cambiaron`. Los perfiles se dibujan en muchos lados a
// la vez —el avatar de la barra, las burbujas del glow, cada renglón de la lista de conversaciones,
// el encabezado del hilo—; con cada avatar suscribiéndose por su cuenta habría cientos de puentes IPC
// abiertos para el mismo aviso, y la lista de conversaciones abre y cierra avatares al desplazarse.
//
// POR QUÉ NO TIRA ERROR SIN PROVEEDOR (a diferencia de `usePermisos`): `Avatar` usa este hook y se
// dibuja también arriba del proveedor mientras el escritorio todavía no está montado. Sin perfiles el
// avatar cae en las iniciales sobre el color de reserva, que es exactamente lo que corresponde
// mostrar cuando todavía no llegó nada del canal.
//
// La foto llega YA COMO DATA URL desde el proceso principal (la base la guarda como bytes): el
// renderer no arma URLs de objeto ni las libera, que con avatares que se montan y desmontan al
// desplazar una tabla es una fuga difícil de ver.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PerfilDeUsuario } from '../../shared/tipos'

interface ContextoPerfiles {
  /** Todos los que esta computadora conoce, indexados por clave de usuario. */
  porClave: ReadonlyMap<string, PerfilDeUsuario>
  perfilDe: (clave: string | null | undefined) => PerfilDeUsuario | null
  /** Los colores que ya tiene tomado alguien, para apagarlos en la grilla de «Mi perfil». */
  coloresTomados: ReadonlySet<number>
  /** Vuelve a pedir la lista. La usa el diálogo de perfil después de guardar. */
  recargar: () => void
}

const SIN_PERFILES: ContextoPerfiles = {
  porClave: new Map(),
  perfilDe: () => null,
  coloresTomados: new Set(),
  recargar: () => {},
}

const Contexto = createContext<ContextoPerfiles>(SIN_PERFILES)

export function ProveedorPerfiles({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<PerfilDeUsuario[]>([])
  // Un número que sube para pedir de nuevo: `recargar` no puede depender de la lista sin volverse una
  // función nueva en cada cambio, y esta función viaja al diálogo de perfil por el contexto.
  const [pedido, setPedido] = useState(0)
  const recargar = useCallback(() => setPedido((n) => n + 1), [])

  useEffect(() => {
    let vigente = true
    const pedir = () => {
      void window.dm.perfiles.listar().then((resultado) => {
        if (vigente && resultado.ok) setLista(resultado.datos)
      })
    }
    pedir()
    // El evento del canal no trae el perfil: dice «cambió algo» y se vuelve a pedir la lista entera.
    // Son cinco personas: traerlas todas cuesta menos que llevar la cuenta de qué cambió.
    const dejarDeEscuchar = window.dm.perfiles.alCambiar(() => pedir())
    return () => {
      vigente = false
      dejarDeEscuchar()
    }
  }, [pedido])

  const valor = useMemo<ContextoPerfiles>(() => {
    const porClave = new Map(lista.map((perfil) => [perfil.clave, perfil]))
    const coloresTomados = new Set(lista.map((perfil) => perfil.color))
    return {
      porClave,
      perfilDe: (clave) => (clave ? (porClave.get(clave) ?? null) : null),
      coloresTomados,
      recargar,
    }
  }, [lista, recargar])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function usePerfiles(): ContextoPerfiles {
  return useContext(Contexto)
}

/** Atajo para el caso de siempre: «dame el perfil de esta clave». */
export function usePerfilDe(clave: string | null | undefined): PerfilDeUsuario | null {
  return usePerfiles().perfilDe(clave)
}
