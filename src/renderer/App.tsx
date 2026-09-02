// Raíz de la interfaz: decide entre carga, login, cambio de contraseña obligatorio y el escritorio.
import type { ReactNode } from 'react'
import { AvisoActualizacion } from './componentes/AvisoActualizacion'
import { AvisoDeTareaHecha } from './componentes/AvisoDeTareaHecha'
import { BarraLateral } from './componentes/BarraLateral'
import { BarraSuperior } from './componentes/BarraSuperior'
import { Icono } from './componentes/Icono'
import { PreguntaDeTicket } from './componentes/PreguntaDeTicket'
import { Proximamente } from './componentes/Proximamente'
import { Alerta } from './componentes/ui'
import { ProveedorNavegacion, useNavegacion } from './contexto/Navegacion'
import { ProveedorPermisos, usePermisos } from './contexto/Permisos'
import { useSesion } from './contexto/Sesion'
import { buscarModulo, esAreaDePermisos, type IdModulo } from './modulos'
import { Administracion } from './pantallas/administracion/Administracion'
import { Cartera } from './pantallas/cartera/Cartera'
import { Companias } from './pantallas/companias/Companias'
import { Clientes } from './pantallas/clientes/Clientes'
import { Cobranzas } from './pantallas/cobranzas/Cobranzas'
import { GeneralExcel } from './pantallas/excel/GeneralExcel'
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
    <ProveedorPermisos>
      <ProveedorNavegacion>
        <ConPermisosCargados />
      </ProveedorNavegacion>
    </ProveedorPermisos>
  )
}

/**
 * La barra lateral depende de los permisos: se esperan antes de dibujar el escritorio para no mostrar
 * módulos que enseguida van a desaparecer.
 */
function ConPermisosCargados() {
  const { cargando } = usePermisos()
  if (cargando) return <PantallaDeCarga />
  return <Escritorio />
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
  const { puedeVer } = usePermisos()
  const modulo = buscarModulo(moduloActivo)

  // Sin permiso no se abre el módulo, aunque se haya llegado por un atajo (Inicio, la campana de
  // tareas o el módulo que quedó abierto cuando le sacaron el permiso mientras trabajaba).
  //
  // Administración es la excepción: se abre siempre porque «Acerca de» la ve todo el mundo (ahí está
  // la versión y el estado del acceso, que es lo primero que se pregunta cuando algo falla). Adentro,
  // la pantalla muestra sólo las secciones que correspondan.
  const area = esAreaDePermisos(modulo.id) && modulo.id !== 'administracion' ? modulo.id : null
  if (area && !puedeVer(area)) {
    return (
      <Marco moduloActivo={moduloActivo} titulo={modulo.nombre} alElegir={ir}>
        <SinPermiso nombre={modulo.nombre} />
      </Marco>
    )
  }

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
  } else if (modulo.id === 'companias') {
    contenido = <Companias />
  } else if (modulo.id === 'excel') {
    contenido = <GeneralExcel />
  } else if (modulo.id === 'administracion') {
    contenido = <Administracion />
  } else {
    contenido = <Proximamente modulo={modulo} />
  }

  return (
    <Marco moduloActivo={moduloActivo} titulo={modulo.nombre} alElegir={ir}>
      {contenido}
    </Marco>
  )
}

/** El marco de siempre: barra lateral, barra superior y el contenido en el medio. */
function Marco({
  moduloActivo,
  titulo,
  alElegir,
  children,
}: {
  moduloActivo: IdModulo
  titulo: string
  alElegir: (destino: IdModulo) => void
  children: ReactNode
}) {
  return (
    <div className="flex h-full">
      <BarraLateral moduloActivo={moduloActivo} alElegir={alElegir} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AvisoActualizacion />
        <BarraSuperior titulo={titulo} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
      {/* Fuera del módulo activo: se cobra desde Cartera, desde la ficha del cliente y desde la caja. */}
      <PreguntaDeTicket />
      {/* Ídem: una tarea se cierra desde tres pantallas distintas y hasta desde otra computadora. */}
      <AvisoDeTareaHecha />
    </div>
  )
}

function SinPermiso({ nombre }: { nombre: string }) {
  return (
    <div className="p-8">
      <Alerta tono="aviso">
        No tenés permiso para entrar a <strong className="font-semibold">{nombre}</strong>. Si lo necesitás para trabajar,
        pedíselo a un administrador: se configura en Administración → Permisos.
      </Alerta>
    </div>
  )
}
