// Módulo API Aseguradoras: las credenciales con las que DM Gestión habla con la API de cada
// aseguradora. Por ahora sólo Galeno —la cuenta de su API REST (cotizar, emitir, consultas) y la del
// portal de productores (novedades)—, pero es donde va a ir cualquier otra que se sume más adelante.
//
// No es un área de permisos configurable desde Administración → Permisos, mismo criterio que el
// catálogo de vehículos o la conexión con Google: son credenciales de un tercero y una integración, no
// algo que necesite el mostrador. Por eso el módulo entero —barra lateral incluida, ver
// `BarraLateral`— sólo lo ven ADMIN y SUPER_ADMIN con permiso sobre Administración.
import { useState } from 'react'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'
import { Alerta } from '../../componentes/ui'
import { usePermisos } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'
import { Galeno } from './Galeno'
import { GalenoNovedades } from './GalenoNovedades'

type IdSeccion = 'galeno' | 'galenonovedades'

const SECCIONES: ItemDePestana<IdSeccion>[] = [
  { id: 'galeno', nombre: 'Galeno', icono: 'escudo', ayuda: 'apiAseguradoras.galeno' },
  // La credencial del PORTAL de Galeno (15.4): la usa el servidor, que consulta las novedades cada
  // quince minutos y las deja en la bandeja de Cartera. No tiene nada que ver con la de arriba —esa es
  // la API REST que usa Presupuestos para cotizar y emitir— por eso es una pestaña aparte.
  { id: 'galenonovedades', nombre: 'Galeno (novedades)', icono: 'nube', ayuda: 'apiAseguradoras.galenonovedades' },
]

export function ApiAseguradoras() {
  const usuario = useUsuarioActual()
  const { puedeVer } = usePermisos()
  const [seccion, setSeccion] = useState<IdSeccion>('galeno')

  if (usuario.rol === 'EMPLEADO' || !puedeVer('administracion')) {
    return (
      <div className="p-8">
        <Alerta tono="aviso">
          No tenés permiso para entrar a API Aseguradoras. Si lo necesitás para trabajar, pedíselo a un
          administrador: se configura en Administración → Permisos.
        </Alerta>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarraDePestanas
        etiqueta="Secciones de API Aseguradoras"
        prefijo="apiAseguradoras"
        items={SECCIONES}
        activa={seccion}
        alElegir={setSeccion}
      />
      <div
        id={`panel-apiAseguradoras-${seccion}`}
        role="tabpanel"
        aria-labelledby={`tab-apiAseguradoras-${seccion}`}
        className="min-w-0 flex-1 overflow-y-auto p-8"
      >
        {seccion === 'galeno' && <Galeno />}
        {seccion === 'galenonovedades' && <GalenoNovedades />}
      </div>
    </div>
  )
}
