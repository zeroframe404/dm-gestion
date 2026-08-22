// Formatos que comparten las pantallas de Cobranzas.

/** Importe en pesos, como lo escribe la agencia: «$ 24.420,00». */
export function pesos(valor: number): string {
  return valor.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Igual que `pesos` pero sin centavos, para los totales grandes de las tarjetas. */
export function pesosRedondos(valor: number): string {
  return valor.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
}

export function numero(valor: number): string {
  return valor.toLocaleString('es-AR')
}

/** Para comparar texto escrito a mano: sin tildes, sin puntuación, en mayúsculas. */
export function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}
