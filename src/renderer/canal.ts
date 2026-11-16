// Qué canal es este programa (estable, beta o demo), visto desde la pantalla. Se pregunta una sola vez
// por ejecución: el canal sale del instalador y no cambia mientras el programa está abierto.
import { useEffect, useState } from 'react'
import type { Canal } from '../shared/canal'
import { type Catalogos } from '../shared/catalogos'
import { aplicarCatalogos } from '../shared/catalogosVigentes'
import { variablesDeColor, type Marca } from '../shared/marca'
import { alCambiarMarca, anotarCanal, anotarMarca, canalSinEsperar, marcaActual, marcaVisible, nombreDeLaAgencia } from './agencia'

export { canalSinEsperar, marcaVisible, nombreDeLaAgencia }

/**
 * Anota la marca y la pinta: el color se escribe en el `<html>` (el CSS lee `--color-marino-*`) y cambia el
 * título de la ventana. Sin color elegido se quitan las variables y vuelve el azul de `estilos.css`.
 */
export function aplicarMarca(marca: Marca): void {
  anotarMarca(marca)
  const raiz = document.documentElement
  const variables = marca.color ? variablesDeColor(marca.color) : {}
  for (const paso of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
    const nombre = `--color-marino-${paso}`
    if (variables[nombre]) raiz.style.setProperty(nombre, variables[nombre])
    else raiz.style.removeProperty(nombre)
  }
  if (canalSinEsperar() !== 'demo') document.title = marca.nombre
}

/** Le pregunta la marca al proceso principal y la aplica. Si no contesta, queda la de fábrica. */
export async function cargarMarca(): Promise<void> {
  try {
    const resultado = await window.dm.marca.obtener()
    if (resultado.ok) aplicarMarca(resultado.datos)
  } catch {
    /* queda la de fábrica */
  }
}

/** Deja las sucursales y las ramas de esta ventana como dice el proceso principal (las listas de `shared` son por ventana). */
export function aplicarCatalogosEnPantalla(catalogos: Catalogos): void {
  aplicarCatalogos(catalogos)
}

/** Le pregunta las sucursales y ramas al proceso principal y las aplica. Si no contesta, quedan las de fábrica. */
export async function cargarCatalogos(): Promise<void> {
  try {
    const resultado = await window.dm.catalogos.obtener()
    if (resultado.ok) aplicarCatalogosEnPantalla(resultado.datos)
  } catch {
    /* quedan las de fábrica */
  }
}

/** La marca configurada; se actualiza sola cuando se guarda otra. */
export function useMarca(): Marca {
  const [marca, setMarca] = useState<Marca>(marcaActual())
  useEffect(() => {
    setMarca(marcaActual())
    return alCambiarMarca(() => setMarca(marcaActual()))
  }, [])
  return marca
}

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
  useMarca()
  return nombreDeLaAgencia(useCanal())
}
