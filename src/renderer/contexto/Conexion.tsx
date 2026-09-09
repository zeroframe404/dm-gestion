// Si hay con quién hablar (14.0). Es la mitad visible de «ver sí, tocar no».
//
// Desde la 14.0 la aplicación no guarda nada sin canal: el proceso principal lo corta en
// `permisos.ts exigir('editar')` y devuelve `codigo:'sin-conexion'`. Esto de acá NO es esa barrera
// —una barrera en la pantalla no protege nada, cualquiera llega igual por IPC— sino la cortesía de
// avisarlo antes: el banner de arriba y los botones apagados, para que nadie escriba media ficha y
// se entere al tocar Guardar.
//
// UN SOLO SUSCRIPTOR, igual que `DatosEnVivo`: el proveedor se monta una vez en `App.tsx` y todo lo
// demás se cuelga de acá. El estado lo mira el banner, el indicador de la barra y cada botón que
// escribe; con cada uno suscribiéndose por su cuenta habría decenas de puentes IPC para el mismo aviso.
//
// POR QUÉ NO TIRA ERROR SIN PROVEEDOR (a diferencia de `usePermisos`): `Boton` usa este hook y el
// Login también usa `Boton`, y ahí arriba todavía no hay proveedor porque el canal arranca recién
// cuando se abre la sesión. El valor por defecto es `sin-puente`, que es exactamente lo que pasa:
// no hay canal, y no hay nada que apagar (ingresar y cambiar la clave no pasan por el candado).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EstadoDeConexion, SituacionDeConexion } from '../../shared/tipos'

interface ContextoConexion {
  situacion: SituacionDeConexion
  /**
   * Si tiene sentido ofrecer los botones que guardan. `sin-puente` cuenta como que sí: es la máquina
   * de desarrollo (y el banco de pruebas) sin servidor configurado, donde el proceso principal
   * tampoco exige nada. Mismo criterio que `canal().exigirConexion()`, para que la pantalla y la
   * barrera de verdad no digan cosas distintas.
   */
  puedeEscribir: boolean
}

/** Cuánto se sabe antes de que conteste el proceso principal, y lo que ve el Login. Ver arriba. */
const SIN_CANAL: ContextoConexion = { situacion: 'sin-puente', puedeEscribir: true }

const Contexto = createContext<ContextoConexion>(SIN_CANAL)

export function ProveedorConexion({ children }: { children: ReactNode }) {
  const [situacion, setSituacion] = useState<SituacionDeConexion>('sin-puente')

  useEffect(() => {
    let vigente = true
    // El estado inicial se pregunta igual que se escucha el evento: el canal puede haberse conectado
    // (o caído) antes de que esta pantalla se montara, y sin la consulta el banner esperaría al
    // próximo cambio, que con la red caída no llega nunca.
    void window.dm.conexion.estado().then((resultado) => {
      if (vigente && resultado.ok) setSituacion(resultado.datos.situacion)
    })
    const dejarDeEscuchar = window.dm.conexion.alCambiar((nuevo: EstadoDeConexion) => {
      if (vigente) setSituacion(nuevo.situacion)
    })
    return () => {
      vigente = false
      dejarDeEscuchar()
    }
  }, [])

  const valor = useMemo<ContextoConexion>(
    () => ({ situacion, puedeEscribir: situacion === 'conectado' || situacion === 'sin-puente' }),
    [situacion],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useConexion(): ContextoConexion {
  return useContext(Contexto)
}
