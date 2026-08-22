// Raíz de la interfaz: decide entre carga, login, cambio de contraseña obligatorio y el escritorio.
import { AvisoActualizacion } from './componentes/AvisoActualizacion'
import { BarraLateral } from './componentes/BarraLateral'
import { BarraSuperior } from './componentes/BarraSuperior'
import { Icono } from './componentes/Icono'
import { Proximamente } from './componentes/Proximamente'
import { ProveedorNavegacion, useNavegacion } from './contexto/Navegacion'
import { useSesion } from './contexto/Sesion'
import { buscarModulo } from './modulos'
import { Administracion } from './pantallas/administracion/Administracion'
import { Cartera } from './pantallas/cartera/Cartera'
import { Clientes } from './pantallas/clientes/Clientes'
import { Cobranzas } from './pantallas/cobranzas/Cobranzas'
import { Leads } from './pantallas/leads/Leads'
import { Marketing } from './pantallas/marketing/Marketing'
import { Metricas } from './pantallas/metricas/Metricas'
import { Presupuestos } from './pantallas/presupuestos/Presupuestos'
import { Reportes } from './pantallas/reportes/Reportes'
import { Tareas } from './pantallas/tareas/Tareas'
import { Polizas } from './pantallas/polizas/Polizas'
import { Renovaciones } from './pantallas/renovaciones/Renovaciones'
import { Siniestros } from './pantallas/siniestros/Siniestros'
import { CambiarClave } from './pantallas/CambiarClave'
import { Inicio } from './pantallas/Inicio'
import { Login } from './pantallas/Login'

export function App() {
  const { usuario, cargando } = useSesion()

  if (cargando) return <PantallaDeCarga />
  if (!usuario) return <Login />
  if (usuario.debeCambiarClave) return <CambiarClave />
  return (
    <ProveedorNavegacion>
      <Escritorio />
    </ProveedorNavegacion>
  )
}

function PantallaDeCarga() {
  return (
    <div className="flex h-full items-center justify-center bg-marino-950 text-cielo-200" role="status" aria-label="Cargando">
      <Icono nombre="cargando" tamano={28} className="animate-spin" />
    </div>
  )
}

/** Ventana principal: barra lateral, barra superior y el módulo activo. */
function Escritorio() {
  const { modulo: moduloActivo, ir } = useNavegacion()
  const modulo = buscarModulo(moduloActivo)

  let contenido
  if (modulo.id === 'inicio') {
    contenido = <Inicio alNavegar={(destino) => ir(destino)} />
  } else if (modulo.id === 'cartera') {
    contenido = <Cartera />
  } else if (modulo.id === 'clientes') {
    contenido = <Clientes />
  } else if (modulo.id === 'leads') {
    contenido = <Leads />
  } else if (modulo.id === 'presupuestos') {
    contenido = <Presupuestos />
  } else if (modulo.id === 'tareas') {
    contenido = <Tareas />
  } else if (modulo.id === 'polizas') {
    contenido = <Polizas />
  } else if (modulo.id === 'renovaciones') {
    contenido = <Renovaciones />
  } else if (modulo.id === 'siniestros') {
    contenido = <Siniestros />
  } else if (modulo.id === 'cobranzas') {
    contenido = <Cobranzas />
  } else if (modulo.id === 'metricas') {
    contenido = <Metricas />
  } else if (modulo.id === 'reportes') {
    contenido = <Reportes />
  } else if (modulo.id === 'marketing') {
    contenido = <Marketing />
  } else if (modulo.id === 'administracion') {
    contenido = <Administracion />
  } else {
    contenido = <Proximamente modulo={modulo} />
  }

  return (
    <div className="flex h-full">
      <BarraLateral moduloActivo={moduloActivo} alElegir={(destino) => ir(destino)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AvisoActualizacion />
        <BarraSuperior titulo={modulo.nombre} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{contenido}</main>
      </div>
    </div>
  )
}
