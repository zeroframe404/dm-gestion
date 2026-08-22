// Acerca de: versión del programa y datos técnicos útiles para soporte.
import { useEffect, useState, type ReactNode } from 'react'
import type { EstadoActualizacion, InfoApp } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Boton, Cargando, Tarjeta } from '../../componentes/ui'

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

export function AcercaDe() {
  const [info, setInfo] = useState<InfoApp | null>(null)
  const [actualizacion, setActualizacion] = useState<EstadoActualizacion | null>(null)
  const [buscando, setBuscando] = useState(false)

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
