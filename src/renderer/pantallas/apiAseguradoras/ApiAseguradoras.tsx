// Módulo API Aseguradoras: las credenciales con las que DM Gestión habla con la API de cada
// aseguradora. Hoy, Galeno —la cuenta de su API REST (cotizar, emitir, consultas) y la del portal de
// productores (novedades)—, ATM —la cuenta de su web service y las tablas que publica por FTP, para
// cotizar en el multicotizador—, Mercantil Andina —la cuenta de su API REST, también para el
// multicotizador— y La Equidad —la cuenta de su API GLM, ídem—. Es donde va a ir cualquier otra que
// se sume más adelante.
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
import { Atm } from './Atm'
import { Galeno } from './Galeno'
import { GalenoNovedades } from './GalenoNovedades'
import { Equidad } from './Equidad'
import { Mercantil } from './Mercantil'

type IdSeccion = 'galeno' | 'galenonovedades' | 'atm' | 'mercantil' | 'equidad'

const SECCIONES: ItemDePestana<IdSeccion>[] = [
  { id: 'galeno', nombre: 'Galeno', icono: 'escudo', ayuda: 'apiAseguradoras.galeno' },
  // La credencial del PORTAL de Galeno (15.4): la usa el servidor, que consulta las novedades cada
  // quince minutos y las deja en la bandeja de Cartera. No tiene nada que ver con la de arriba —esa es
  // la API REST que usa Presupuestos para cotizar y emitir— por eso es una pestaña aparte.
  { id: 'galenonovedades', nombre: 'Galeno (novedades)', icono: 'nube', ayuda: 'apiAseguradoras.galenonovedades' },
  // ATM no pide una IP dada de alta: cada computadora le habla directo con la cuenta que se carga acá
  // (y viaja a las demás como ajuste compartido). La pestaña también muestra sus tablas por FTP.
  { id: 'atm', nombre: 'ATM', icono: 'auto', ayuda: 'apiAseguradoras.atm' },
  // Mercantil tampoco pide una IP dada de alta: misma mecánica que ATM (la cuenta viaja como ajuste
  // compartido), sin tablas por FTP porque su catálogo de vehículos sí viene por la API.
  { id: 'mercantil', nombre: 'Mercantil', icono: 'escudo', ayuda: 'apiAseguradoras.mercantil' },
  // Equidad tampoco: su API GLM se habla directo desde cada computadora con la cuenta que viaja como
  // ajuste compartido; el catálogo de vehículos también viene por la API.
  { id: 'equidad', nombre: 'Equidad', icono: 'escudo', ayuda: 'apiAseguradoras.equidad' },
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
        {seccion === 'atm' && <Atm />}
        {seccion === 'mercantil' && <Mercantil />}
        {seccion === 'equidad' && <Equidad />}
      </div>
    </div>
  )
}
