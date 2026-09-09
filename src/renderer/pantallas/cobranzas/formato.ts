// Formatos que comparten las pantallas de Cobranzas y, de acá en más, las que muestran un cálculo del
// servidor con su cartel de frescura (Métricas, Estadísticas, el Podio de Inicio).

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

/** Cuándo pasó algo, en el formato que usan los carteles de frescura: «9/9/2026 a las 14:32». */
export function momento(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return `${fecha.toLocaleDateString('es-AR')} a las ${fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
}

/** Para comparar texto escrito a mano: sin tildes, sin puntuación, en mayúsculas. */
export function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}
