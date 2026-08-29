// Módulo Administración: Usuarios y Permisos (sólo SUPER_ADMIN), la base y Google Drive (SUPER_ADMIN y
// ADMIN, y con permiso sobre el módulo), y Compañías, Impresora, Sincronizar y Acerca de, que las ve
// todo el mundo.
//
// Las cuatro que ve todo el mundo son las que se necesitan con gente en el mostrador y sin tiempo de
// llamar a nadie: cuánto cubre una compañía después del vencimiento, la ticketeadora que tiene esta PC
// delante, forzar una sincronización cuando falta algo que cargó otra sucursal, y la versión del
// programa. Ninguna configura nada que afecte a las demás computadoras.
import { useMemo, useState } from 'react'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'
import { usePermisos } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'
import { AcercaDe } from './AcercaDe'
import { BaseDeDatos } from './BaseDeDatos'
import { Companias } from './Companias'
import { ConexionGoogle } from './ConexionGoogle'
import { ImportarGoogle } from './ImportarGoogle'
import { Impresora } from './Impresora'
import { Permisos } from './Permisos'
import { Sincronizacion } from './Sincronizacion'
import { SincronizarTodo } from './SincronizarTodo'
import { Usuarios } from './Usuarios'

type IdSeccion =
  | 'usuarios'
  | 'permisos'
  | 'companias'
  | 'impresora'
  | 'sincronizar'
  | 'basededatos'
  | 'google'
  | 'importar'
  | 'sincronizacion'
  | 'acerca'

export function Administracion() {
  const usuario = useUsuarioActual()
  const { puedeVer } = usePermisos()

  // Las secciones visibles dependen del rol y del permiso sobre Administración. El proceso principal
  // vuelve a controlarlo en cada llamado. «Acerca de» está siempre: es donde se ve la versión, la
  // carpeta de datos y el estado del acceso, y eso lo necesita cualquiera para pedir ayuda.
  const secciones = useMemo<ItemDePestana<IdSeccion>[]>(() => {
    const lista: ItemDePestana<IdSeccion>[] = []
    if (usuario.rol === 'SUPER_ADMIN') {
      lista.push({ id: 'usuarios', nombre: 'Usuarios', icono: 'clientes', ayuda: 'administracion.usuarios' })
      lista.push({ id: 'permisos', nombre: 'Permisos', icono: 'candado', ayuda: 'administracion.permisos' })
    }
    // Compañías la ve todo el equipo: los días de cobertura financiera de cada compañía son los que
    // decidieron el color de la fila que el mostrador tiene delante, y saber si una renueva sola o a
    // mano es la mitad de una llamada. Tocarla sigue siendo de administradores, y el porcentaje de
    // comisión no le llega a un empleado.
    lista.push({ id: 'companias', nombre: 'Compañías', icono: 'escudo', ayuda: 'administracion.companias' })
    // La impresora la ve y la configura cualquiera, con el rol que sea: es la ticketeadora que tiene
    // la PC del mostrador delante, y quien cobra es quien necesita apagarla, cambiarla o dejar de
    // gastar papel sin esperar a un administrador.
    lista.push({ id: 'impresora', nombre: 'Impresora', icono: 'impresora', ayuda: 'administracion.impresora' })
    // Y forzar una sincronización, por si la automática falla: es el jueves a la mañana con gente en
    // el mostrador y una cuota que se cargó ayer en otra sucursal y no aparece.
    lista.push({ id: 'sincronizar', nombre: 'Sincronizar', icono: 'nube', ayuda: 'administracion.sincronizar' })
    if (usuario.rol !== 'EMPLEADO' && puedeVer('administracion')) {
      // Desde la v12 la base vive en el VPS: primero lo que se usa (base y sincronización), y Google
      // queda al final, reencuadrado como lo que es ahora: la cuenta para Drive (respaldos y adjuntos).
      lista.push({ id: 'basededatos', nombre: 'Base de datos', icono: 'nube', ayuda: 'administracion.basededatos' })
      lista.push({ id: 'sincronizacion', nombre: 'Sincronización', icono: 'nube', ayuda: 'administracion.sincronizacion' })
      lista.push({ id: 'importar', nombre: 'Reimportar la base', icono: 'nubeBajada', ayuda: 'administracion.importar' })
      lista.push({ id: 'google', nombre: 'Google Drive', icono: 'nube', ayuda: 'administracion.google' })
    }
    lista.push({ id: 'acerca', nombre: 'Acerca de', icono: 'info', ayuda: 'administracion.acerca' })
    return lista
  }, [puedeVer, usuario.rol])

  const [seccionActiva, setSeccionActiva] = useState<IdSeccion>(() => secciones[0]?.id ?? 'acerca')
  const seccion = secciones.some((candidata) => candidata.id === seccionActiva) ? seccionActiva : 'acerca'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarraDePestanas
        etiqueta="Secciones de administración"
        prefijo="administracion"
        items={secciones}
        activa={seccion}
        alElegir={setSeccionActiva}
      />

      <div
        id={`panel-administracion-${seccion}`}
        role="tabpanel"
        aria-labelledby={`tab-administracion-${seccion}`}
        className="min-w-0 flex-1 overflow-y-auto p-8"
      >
        {seccion === 'usuarios' && <Usuarios />}
        {seccion === 'permisos' && <Permisos />}
        {seccion === 'companias' && <Companias />}
        {seccion === 'impresora' && <Impresora />}
        {seccion === 'sincronizar' && <SincronizarTodo />}
        {seccion === 'basededatos' && <BaseDeDatos />}
        {seccion === 'google' && <ConexionGoogle />}
        {seccion === 'importar' && <ImportarGoogle />}
        {seccion === 'sincronizacion' && <Sincronizacion />}
        {seccion === 'acerca' && <AcercaDe />}
      </div>
    </div>
  )
}
