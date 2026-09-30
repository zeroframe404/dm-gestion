// Vite convierte las importaciones con `?inline` en una URL `data:` dentro del propio paquete.
declare module '*.png?inline' {
  const url: string
  export default url
}
