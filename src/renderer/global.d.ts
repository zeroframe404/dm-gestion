// La precarga expone `window.dm`; acá se declara su tipo para todo el renderer.
import type { ApiDm } from '../shared/api'

declare global {
  interface Window {
    dm: ApiDm
  }
}

export {}
