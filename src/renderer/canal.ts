// Qué canal es este programa (estable, beta o demo), visto desde la pantalla. Se pregunta una sola vez
// por ejecución: el canal sale del instalador y no cambia mientras el programa está abierto.
import { useEffect, useState } from 'react'
import type { Canal } from '../shared/canal'
import { anotarCanal, canalSinEsperar, nombreDeLaAgencia } from './agencia'

export { canalSinEsperar, nombreDeLaAgencia }

let consultaDeCanal: Promise<Canal> | null = null

export function canalDelPrograma(): Promise<Canal> {
  consultaDeCanal ??= window.dm.app
    .info()
    .then((resultado) => (resultado.ok ? resultado.datos.canal : 'estable'))
    .catch(() => 'estable' as const)
    // Anotado, las pantallas que se abren después lo tienen de entrada (ver `agencia.ts`).
    .then(anotarCanal)
  return consultaDeCanal
}

/** `estable` hasta que contesta el proceso principal; con `main.tsx` esperándolo, ya contestó. */
export function useCanal(): Canal {
  const [canal, setCanal] = useState<Canal>(canalSinEsperar())
  useEffect(() => {
    let vigente = true
    void canalDelPrograma().then((valor) => {
      if (vigente) setCanal(valor)
    })
    return () => {
      vigente = false
    }
  }, [])
  return canal
}

export function useEsDemo(): boolean {
  return useCanal() === 'demo'
}

/** El nombre de la agencia que se muestra arriba del de DM Gestión: la demo no es de ninguna. */
export function useNombreDeLaAgencia(): string {
  return nombreDeLaAgencia(useCanal())
}
