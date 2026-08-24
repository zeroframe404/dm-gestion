// Módulo Administración: Usuarios y Permisos (sólo SUPER_ADMIN), Conexión con Google (SUPER_ADMIN y
// ADMIN, y con permiso sobre el módulo) y Acerca de, que la ve todo el mundo.
import { useMemo, useState } from 'react'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'
import { usePermisos } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'
import { AcercaDe } from './AcercaDe'
import { Companias } from './Companias'
import { ConexionGoogle } from './ConexionGoogle'
import { ImportarGoogle } from './ImportarGoogle'
import { Impresora } from './Impresora'
import { Permisos } from './Permisos'
import { Sincronizacion } from './Sincronizacion'
import { Usuarios } from './Usuarios'

type IdSeccion = 'usuarios' | 'permisos' | 'companias' | 'impresora' | 'google' | 'importar' | 'sincronizacion' | 'acerca'

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
    if (usuario.rol !== 'EMPLEADO' && puedeVer('administracion')) {
      lista.push({ id: 'companias', nombre: 'Compañías', icono: 'escudo', ayuda: 'administracion.companias' })
      lista.push({ id: 'impresora', nombre: 'Impresora', icono: 'impresora', ayuda: 'administracion.impresora' })
      lista.push({ id: 'google', nombre: 'Conexión con Google', icono: 'nube', ayuda: 'administracion.google' })
      lista.push({ id: 'importar', nombre: 'Importar desde Google', icono: 'nubeBajada', ayuda: 'administracion.importar' })
      lista.push({ id: 'sincronizacion', nombre: 'Sincronización', icono: 'nube', ayuda: 'administracion.sincronizacion' })
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
        {seccion === 'google' && <ConexionGoogle />}
        {seccion === 'importar' && <ImportarGoogle />}
        {seccion === 'sincronizacion' && <Sincronizacion />}
        {seccion === 'acerca' && <AcercaDe />}
      </div>
    </div>
  )
}
