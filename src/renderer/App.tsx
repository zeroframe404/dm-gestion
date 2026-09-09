// Raíz de la interfaz: decide entre carga, login, cambio de contraseña obligatorio y el escritorio.
import { lazy, Suspense, type ReactNode } from 'react'
import { AvisoActualizacion } from './componentes/AvisoActualizacion'
import { CartelActualizacionDisponible } from './componentes/CartelActualizacionDisponible'
import { AvisoDeTareaHecha } from './componentes/AvisoDeTareaHecha'
import { AvisoDeZumbido } from './componentes/AvisoDeZumbido'
import { BarraLateral } from './componentes/BarraLateral'
import { BarraSuperior } from './componentes/BarraSuperior'
import { Icono } from './componentes/Icono'
import { PreguntaDeTicket } from './componentes/PreguntaDeTicket'
import { Proximamente } from './componentes/Proximamente'
import { Alerta } from './componentes/ui'
import { ProveedorNavegacion, useNavegacion } from './contexto/Navegacion'
import { ProveedorPermisos, usePermisos } from './contexto/Permisos'
import { useSesion } from './contexto/Sesion'
import { ProveedorDatosEnVivo } from './contexto/DatosEnVivo'
import { ProveedorTareas } from './contexto/Tareas'
import { buscarModulo, esAreaDePermisos, type IdModulo } from './modulos'
import { CambiarClave } from './pantallas/CambiarClave'
import { Inicio } from './pantallas/Inicio'
import { Login } from './pantallas/Login'

// Cada módulo se carga la primera vez que se abre (12.6). Antes los dieciséis venían en el mismo
// paquete que el ingreso: la ventana no dibujaba nada hasta que el navegador terminaba de leer
// Marketing y Reportes para mostrar el Login. Inicio y Login siguen viniendo de entrada, que es lo
// que se ve primero.
const Administracion = lazy(() => import('./pantallas/administracion/Administracion').then((m) => ({ default: m.Administracion })))
const Cartera = lazy(() => import('./pantallas/cartera/Cartera').then((m) => ({ default: m.Cartera })))
const Companias = lazy(() => import('./pantallas/companias/Companias').then((m) => ({ default: m.Companias })))
const Clientes = lazy(() => import('./pantallas/clientes/Clientes').then((m) => ({ default: m.Clientes })))
const Cobranzas = lazy(() => import('./pantallas/cobranzas/Cobranzas').then((m) => ({ default: m.Cobranzas })))
const GeneralExcel = lazy(() => import('./pantallas/excel/GeneralExcel').then((m) => ({ default: m.GeneralExcel })))
const Leads = lazy(() => import('./pantallas/leads/Leads').then((m) => ({ default: m.Leads })))
const Marketing = lazy(() => import('./pantallas/marketing/Marketing').then((m) => ({ default: m.Marketing })))
const Metricas = lazy(() => import('./pantallas/metricas/Metricas').then((m) => ({ default: m.Metricas })))
const Presupuestos = lazy(() => import('./pantallas/presupuestos/Presupuestos').then((m) => ({ default: m.Presupuestos })))
const Reportes = lazy(() => import('./pantallas/reportes/Reportes').then((m) => ({ default: m.Reportes })))
const Mensajes = lazy(() => import('./pantallas/mensajes/Mensajes').then((m) => ({ default: m.Mensajes })))
const Tareas = lazy(() => import('./pantallas/tareas/Tareas').then((m) => ({ default: m.Tareas })))
const Polizas = lazy(() => import('./pantallas/polizas/Polizas').then((m) => ({ default: m.Polizas })))
const Renovaciones = lazy(() => import('./pantallas/renovaciones/Renovaciones').then((m) => ({ default: m.Renovaciones })))
const Siniestros = lazy(() => import('./pantallas/siniestros/Siniestros').then((m) => ({ default: m.Siniestros })))

export function App() {
  const { usuario, cargando } = useSesion()

  if (cargando) return <PantallaDeCarga />
  if (!usuario) return <Login />
  if (usuario.debeCambiarClave) return <CambiarClave />
  return (
    <ProveedorPermisos>
      <ProveedorNavegacion>
        {/* Adentro de los permisos: lo que se pregunta depende de a qué módulos entra esta persona. */}
        <ProveedorTareas>
          {/* El aviso de que bajaron datos de otra computadora, para que la pantalla abierta se
              recargue sola. Un solo suscriptor para toda la aplicación. */}
          <ProveedorDatosEnVivo>
            <ConPermisosCargados />
          </ProveedorDatosEnVivo>
        </ProveedorTareas>
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
  } else if (modulo.id === 'mensajes') {
    contenido = <Mensajes />
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
      <Suspense fallback={<CargandoModulo />}>{contenido}</Suspense>
    </Marco>
  )
}

/** Lo que se ve el instante en que un módulo se abre por primera vez y su código todavía está llegando. */
function CargandoModulo() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-slate-400" role="status" aria-label="Cargando">
      <Icono nombre="cargando" tamano={24} className="animate-spin" />
    </div>
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
      {/* Un zumbido llega estando en cualquier pantalla: por eso el sonido y el cartel viven acá. */}
      <AvisoDeZumbido />
      {/* Igual que el resto de estos avisos: vive acá para saltar sin importar en qué pantalla se esté. */}
      <CartelActualizacionDisponible />
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
