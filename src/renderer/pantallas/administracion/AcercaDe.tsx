// Acerca de: versión del programa, estado de las actualizaciones y de la base de usuarios compartida,
// y datos técnicos útiles para soporte.
import { useEffect, useState, type ReactNode } from 'react'
import type { EstadoActualizacion, EstadoDeAcceso, InfoApp } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { BotonManual } from '../../componentes/BotonManual'
import { Boton, Cargando, Tarjeta, haceCuanto } from '../../componentes/ui'
import { avisoDeVencimiento, useAcceso } from '../../contexto/Acceso'
import { useUsuarioActual } from '../../contexto/Sesion'

function textoDeSituacion(estado: EstadoActualizacion): string {
  switch (estado.situacion) {
    case 'deshabilitada':
      return 'Desactivadas: esta es una versión de desarrollo, sin instalador.'
    case 'buscando':
      return 'Buscando actualizaciones…'
    case 'al-dia':
      return 'No hay actualizaciones pendientes.'
    case 'descargando':
      return `Descargando la versión ${estado.version ?? ''}${estado.porcentaje !== null ? ` (${estado.porcentaje}%)` : ''}…`
    case 'lista':
      return `Versión ${estado.version} lista: se instala al cerrar el programa.`
    case 'error':
      return `No se pudo chequear${estado.ultimoError ? `: ${estado.ultimoError}` : '.'} Se reintenta solo.`
  }
}

/** Cómo está la base de usuarios, en una línea. El detalle técnico del error sólo lo ve un superadministrador. */
function textoDeAcceso(acceso: EstadoDeAcceso, esSuperAdmin: boolean): string {
  if (!acceso.configurada) {
    return acceso.sinTokenEnProduccion
      ? 'Sólo en esta computadora: esta versión del programa salió sin la base compartida configurada.'
      : 'Sólo en esta computadora (desarrollo, sin base compartida).'
  }
  const donde = `Compartida · ${acceso.repo ?? 'GitHub'}`
  switch (acceso.modo) {
    case 'sin-inicializar':
      return `${donde} — todavía no inicializada. Un superadministrador tiene que subir los usuarios desde la pestaña Usuarios.`
    case 'en-linea':
      return `${donde} — última comprobación ${haceCuanto(acceso.ultimaComprobacion)}${acceso.cantidad !== null ? `, ${acceso.cantidad} usuario${acceso.cantidad === 1 ? '' : 's'}` : ''}.`
    case 'sin-internet':
      return `${donde} — sin internet${acceso.ultimaLecturaBuena ? ` (la última comprobación buena fue ${haceCuanto(acceso.ultimaLecturaBuena)})` : ''}.`
    case 'error-remoto':
      return `${donde} — con error${esSuperAdmin && acceso.ultimoError ? `: ${acceso.ultimoError}` : '. Avisale al administrador.'}`
    default:
      return donde
  }
}

export function AcercaDe() {
  const usuario = useUsuarioActual()
  const [info, setInfo] = useState<InfoApp | null>(null)
  const [actualizacion, setActualizacion] = useState<EstadoActualizacion | null>(null)
  const [buscando, setBuscando] = useState(false)
  const { acceso, comprobando, comprobar } = useAcceso(false)

  useEffect(() => {
    let vigente = true
    void window.dm.app.info().then((resultado) => {
      if (vigente && resultado.ok) setInfo(resultado.datos)
    })
    void window.dm.actualizaciones.estado().then((resultado) => {
      if (vigente && resultado.ok) setActualizacion(resultado.datos)
    })
    const dejarDeEscuchar = window.dm.actualizaciones.alCambiarEstado((nuevo) => {
      if (vigente) setActualizacion(nuevo)
    })
    return () => {
      vigente = false
      dejarDeEscuchar()
    }
  }, [])

  const buscarActualizaciones = async () => {
    setBuscando(true)
    const resultado = await window.dm.actualizaciones.buscarAhora()
    if (resultado.ok) setActualizacion(resultado.datos)
    setBuscando(false)
  }

  const vencimiento = avisoDeVencimiento(acceso)

  return (
    <div className="mx-auto max-w-3xl">
      <Tarjeta>
        {info ? (
          <>
            <div className="flex items-center gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-marino-950 text-cielo-200 shadow-marca">
                <Icono nombre="escudo" tamano={30} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cielo-700">Seguros Daniel Martínez</p>
                <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-900">DM Gestión</h2>
                <p className="mt-0.5 text-sm font-medium text-slate-600">Versión {info.version}</p>
              </div>
              {/* El manual también acá: es donde se lo busca cuando ya se sabe que existe. */}
              <div className="ml-auto">
                <BotonManual />
              </div>
            </div>

            <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-4 border-t border-slate-200 pt-6 sm:grid-cols-2">
              <Dato etiqueta="Electron">{info.electron}</Dato>
              <Dato etiqueta="Chromium">{info.chrome}</Dato>
              <Dato etiqueta="Node.js">{info.node}</Dato>
              <Dato etiqueta="Plataforma">{info.plataforma}</Dato>
            </dl>

            <dl className="mt-6 grid grid-cols-1 gap-y-4 border-t border-slate-200 pt-6">
              <Dato etiqueta="Carpeta de datos" monoespaciado>
                {info.carpetaDatos}
              </Dato>
              <Dato etiqueta="Base de datos" monoespaciado>
                {info.rutaBaseDeDatos}
              </Dato>
              <Dato etiqueta="Configuración" monoespaciado>
                {info.rutaConfig}
              </Dato>
            </dl>

            <div className="mt-6 border-t border-slate-200 pt-6">
              <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Actualizaciones</dt>
              <dd className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-slate-800">
                  Canal <span className="font-semibold">{actualizacion?.canal ?? 'estable'}</span> — {actualizacion ? textoDeSituacion(actualizacion) : 'Cargando…'}
                </span>
                <Boton
                  icono="descargar"
                  tamano="sm"
                  cargando={buscando}
                  disabled={!actualizacion || actualizacion.situacion === 'deshabilitada'}
                  onClick={() => void buscarActualizaciones()}
                >
                  Buscar actualizaciones
                </Boton>
              </dd>
            </div>

            <div className="mt-6 border-t border-slate-200 pt-6">
              <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Base de usuarios</dt>
              <dd className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-slate-800">{acceso ? textoDeAcceso(acceso, usuario.rol === 'SUPER_ADMIN') : 'Cargando…'}</span>
                <Boton icono="nube" tamano="sm" cargando={comprobando} disabled={!acceso?.configurada} onClick={() => void comprobar()}>
                  Probar conexión
                </Boton>
              </dd>
              {acceso?.configurada && (
                <dd className="mt-2 text-xs text-slate-500">
                  {acceso.usuarioGuardado
                    ? `Sin internet, en esta computadora puede ingresar «${acceso.usuarioGuardado}» (el último que ingresó con conexión).`
                    : 'Todavía nadie puede ingresar sin internet en esta computadora: hace falta un ingreso con conexión.'}
                  {!acceso.puedeGuardarCredencial && ' Esta computadora no puede guardar la copia cifrada para ingresar sin internet.'}
                </dd>
              )}
              {vencimiento && <dd className="mt-2 text-xs font-semibold text-amber-700">{vencimiento}</dd>}
            </div>

            <p className="mt-8 text-xs text-slate-500">© {new Date().getFullYear()} Seguros Daniel Martínez. Software de uso interno.</p>
          </>
        ) : (
          <Cargando />
        )}
      </Tarjeta>
    </div>
  )
}

function Dato({ etiqueta, monoespaciado = false, children }: { etiqueta: string; monoespaciado?: boolean; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{etiqueta}</dt>
      <dd className={monoespaciado ? 'mt-1 font-mono text-xs break-all text-slate-800' : 'mt-1 text-sm text-slate-800'}>{children}</dd>
    </div>
  )
}
