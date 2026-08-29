// Administración → Catálogo de vehículos: las credenciales del proveedor y la bajada del catálogo.
//
// Es lo que hace que el formulario de póliza pueda ofrecer marca, modelo, línea y año en desplegables
// en vez de pedirlos escritos, y que la categoría —pick-up, SUV, furgón— la decida el catálogo y no
// quien está cargando.
//
// La bajada trae decenas de miles de filas y tarda: por eso hay barra de progreso. Se hace una vez y
// después el mostrador trabaja siempre contra la copia local, incluso sin internet.
import { useCallback, useEffect, useState } from 'react'
import {
  NOMBRE_TIPO_VEHICULO,
  type EstadoDelCatalogo,
  type ProgresoDeCatalogo,
  type PruebaDelProveedor,
  type TipoDeVehiculo,
} from '../../../shared/tipos'
import { Alerta, Boton, Campo, CampoClave, Cargando, Etiqueta, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'

/** Pasados estos días el catálogo se marca viejo: los modelos nuevos salen todo el año. */
const DIAS_ANTES_DE_ENVEJECER = 30

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

function estaViejo(iso: string | null): boolean {
  if (!iso) return false
  const fecha = new Date(iso).getTime()
  if (Number.isNaN(fecha)) return false
  return Date.now() - fecha > DIAS_ANTES_DE_ENVEJECER * 24 * 60 * 60 * 1000
}

export function CatalogoVehiculos() {
  const puedeEditar = usePuedeEditar('administracion')
  const [estado, setEstado] = useState<EstadoDelCatalogo | null>(null)
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [refrescando, setRefrescando] = useState(false)
  const [progreso, setProgreso] = useState<ProgresoDeCatalogo | null>(null)
  const [prueba, setPrueba] = useState<PruebaDelProveedor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.vehiculos.estado()
    if (resultado.ok) {
      setEstado(resultado.datos)
      setUsuario(resultado.datos.usuario)
    } else {
      setError(resultado.error)
    }
  }, [])

  useEffect(() => {
    void cargar()
    // El avance llega del proceso principal: son decenas de miles de filas y no puede parecer colgado.
    return window.dm.vehiculos.alProgresar(setProgreso)
  }, [cargar])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.vehiculos.guardarCredenciales({ usuario, clave })
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setClave('')
      setAviso('Listo. Probá la conexión y después bajá el catálogo.')
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async () => {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.vehiculos.borrarCredenciales()
    setGuardando(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setUsuario('')
      setClave('')
      setAviso('Se sacaron las credenciales del catálogo de esta computadora. Lo ya bajado sigue estando.')
    } else {
      setError(resultado.error)
    }
  }

  const probar = async () => {
    setPrueba(null)
    setError(null)
    const resultado = await window.dm.vehiculos.probar()
    if (resultado.ok) setPrueba(resultado.datos)
    else setError(resultado.error)
  }

  const refrescar = async (tipo: TipoDeVehiculo | null) => {
    setRefrescando(true)
    setError(null)
    setAviso(null)
    setProgreso(null)
    const resultado = await window.dm.vehiculos.refrescar(tipo)
    setRefrescando(false)
    setProgreso(null)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setAviso('Catálogo actualizado.')
    } else {
      setError(resultado.error)
    }
    await cargar()
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo={`Catálogo de vehículos (${estado.proveedor})`}
        descripcion="Con esto el alta de una póliza ofrece marca, modelo, línea y año en listas en vez de pedirlos escritos, y la categoría —pick-up, SUV, furgón, camión— la decide el catálogo y no quien está cargando."
        acciones={
          puedeEditar && (
            <>
              {estado.configurado && (
                <Boton icono="basura" onClick={() => void borrar()} disabled={guardando || refrescando}>
                  Sacarlas
                </Boton>
              )}
              <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!usuario.trim()}>
                Guardar
              </Boton>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {!estado.configurado && (
            <Alerta tono="aviso">
              Todavía no están cargadas las credenciales. Sin ellas el catálogo no se puede bajar, y el alta de pólizas sigue
              pidiendo la marca y el modelo escritos a mano, como siempre.
            </Alerta>
          )}

          <Campo
            etiqueta="Usuario"
            value={usuario}
            onChange={(evento) => setUsuario(evento.target.value)}
            disabled={!puedeEditar}
            ayuda="El usuario de la cuenta que la agencia tiene con el proveedor del catálogo."
            autoComplete="off"
          />
          <CampoClave
            etiqueta="Clave"
            value={clave}
            onChange={(evento) => setClave(evento.target.value)}
            disabled={!puedeEditar}
            placeholder={estado.configurado ? '•••••••• (dejala vacía para no cambiarla)' : ''}
            autoComplete="off"
          />

          <Alerta tono="info">
            Se guardan sólo en esta computadora, en <code className="font-mono text-xs">{estado.rutaDeConfig}</code>. Cada
            computadora que vaya a cargar pólizas necesita las suyas.
          </Alerta>

          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-3">
              <Boton icono="enlace" onClick={() => void probar()} disabled={!estado.configurado || refrescando}>
                Probar la conexión
              </Boton>
              {prueba && (
                <span className={prueba.ok ? 'text-sm text-green-700' : 'text-sm text-red-700'}>
                  {prueba.detalle}
                  {prueba.ok && prueba.marcasEncontradas > 0 ? ` (${prueba.marcasEncontradas} marcas en la primera página)` : ''}
                </span>
              )}
            </div>
          )}
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="La copia local"
        descripcion="Los desplegables del formulario salen siempre de acá y nunca de internet: elegir un vehículo tiene que ser instantáneo y tiene que andar aunque se corte la conexión. Se baja una vez y se refresca de vez en cuando."
        acciones={
          puedeEditar && (
            <Boton
              variante="primario"
              icono="refrescar"
              onClick={() => void refrescar(null)}
              cargando={refrescando}
              disabled={!estado.configurado}
            >
              Refrescar todo
            </Boton>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {refrescando && (
            <div className="rounded-xl border border-marino-200 bg-marino-50 px-4 py-3">
              <p className="text-sm font-semibold text-marino-900">
                Bajando el catálogo de {progreso ? NOMBRE_TIPO_VEHICULO[progreso.tipo] : 'vehículos'}…
              </p>
              <p className="mt-0.5 text-xs text-marino-800">{progreso?.detalle ?? 'Conectando…'}</p>
              {progreso && progreso.totales > 0 && (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-marino-200">
                    <div
                      className="h-full rounded-full bg-marino-600 transition-all"
                      style={{ width: `${Math.min(100, Math.round((progreso.hechas / progreso.totales) * 100))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] tabular-nums text-marino-700">
                    {progreso.hechas} de {progreso.totales}
                  </p>
                </>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-marino-700">
                Son decenas de miles de versiones: puede tardar varios minutos. Se puede seguir usando el programa mientras tanto.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {estado.porTipo.map((tipo) => (
              <div key={tipo.tipo} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="font-display font-bold text-slate-900">{NOMBRE_TIPO_VEHICULO[tipo.tipo]}</p>
                  {tipo.lineas > 0 ? (
                    estaViejo(tipo.refrescadoEn) ? (
                      <Etiqueta tono="aviso">Conviene refrescarlo</Etiqueta>
                    ) : (
                      <Etiqueta tono="exito">Al día</Etiqueta>
                    )
                  ) : (
                    <Etiqueta tono="neutro">Sin bajar</Etiqueta>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-slate-500">Marcas</dt>
                    <dd className="tabular-nums font-semibold text-slate-800">{tipo.marcas.toLocaleString('es-AR')}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Modelos</dt>
                    <dd className="tabular-nums font-semibold text-slate-800">{tipo.modelos.toLocaleString('es-AR')}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Versiones</dt>
                    <dd className="tabular-nums font-semibold text-slate-800">{tipo.lineas.toLocaleString('es-AR')}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] text-slate-500">Se bajó: {cuando(tipo.refrescadoEn)}</p>
                {tipo.ultimoError && <p className="mt-1 text-[11px] text-red-700">{tipo.ultimoError}</p>}
                {puedeEditar && estado.configurado && (
                  <button
                    type="button"
                    onClick={() => void refrescar(tipo.tipo)}
                    disabled={refrescando}
                    className="mt-2 text-xs font-semibold text-marino-700 hover:underline disabled:opacity-50"
                  >
                    Refrescar sólo {NOMBRE_TIPO_VEHICULO[tipo.tipo].toLowerCase()}s
                  </button>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            La agencia puede tener contratada una sola mitad del catálogo. Si una de las dos falla, la otra se baja igual y acá
            queda escrito el motivo. Las pólizas que ya están cargadas no se tocan: siguen con su marca y su modelo tal como se
            escribieron, y sólo se completan si alguien vuelve a elegir ese vehículo del catálogo.
          </p>
        </div>
      </Tarjeta>
    </div>
  )
}
