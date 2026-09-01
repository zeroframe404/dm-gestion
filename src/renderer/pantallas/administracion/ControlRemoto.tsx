// Administración → Control remoto: la consola con la que se atienden las computadoras de las
// sucursales sin ir hasta el local.
//
// Por qué está acá y no en un papel pegado al monitor: cuando en Sarandí no anda la impresora o
// alguien no puede ingresar, hay que acordarse de la dirección, buscarla en el navegador y esperar a
// ver si contesta. Con esto el link está donde ya se está trabajando, y el estado se ve ANTES de
// abrirlo: si la consola está caída, se sabe en dos segundos y no después de tres minutos mirando una
// pestaña en blanco.
//
// La consola se abre en el navegador del sistema y pide su propia clave. Es a propósito: un control
// remoto de todas las máquinas de la agencia es exactamente el acceso que conviene que siga teniendo
// su puerta aparte, y no quedar abierto porque alguien dejó DM Gestión iniciado.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDelMesh } from '../../../shared/tipos'
import { Alerta, Boton, Cargando, Etiqueta, Tarjeta } from '../../componentes/ui'

export function ControlRemoto() {
  const [estado, setEstado] = useState<EstadoDelMesh | null>(null)
  const [midiendo, setMidiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const medir = useCallback(async () => {
    setMidiendo(true)
    setError(null)
    const resultado = await window.dm.mesh.estado()
    setMidiendo(false)
    if (resultado.ok) setEstado(resultado.datos)
    else setError(resultado.error)
  }, [])

  useEffect(() => {
    void medir()
  }, [medir])

  const abrir = async () => {
    if (!estado) return
    const resultado = await window.dm.sistema.abrirEnlace(estado.url)
    if (!resultado.ok) setError(resultado.error)
  }

  const copiar = async () => {
    if (!estado) return
    try {
      await navigator.clipboard.writeText(estado.url)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      setError('No se pudo copiar la dirección. Seleccionala y copiala a mano.')
    }
  }

  if (!estado && !error) return <Cargando texto="Probando la consola…" />

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}

      <Tarjeta
        titulo="Control remoto de las computadoras"
        descripcion="Desde la consola se ve qué máquinas de la agencia están prendidas y se puede tomar el control de cualquiera para resolver algo sin ir hasta la sucursal."
        acciones={
          <>
            <Boton icono="refrescar" onClick={() => void medir()} cargando={midiendo}>
              Probar de nuevo
            </Boton>
            <Boton variante="primario" icono="enlace" onClick={() => void abrir()} disabled={!estado}>
              Abrir la consola
            </Boton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {estado && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {midiendo ? (
                  <Etiqueta tono="neutro">Probando…</Etiqueta>
                ) : estado.enLinea ? (
                  <Etiqueta tono="exito">En línea</Etiqueta>
                ) : (
                  <Etiqueta tono="peligro">No contesta</Etiqueta>
                )}
                {estado.enLinea && !midiendo && (
                  <span className="text-xs tabular-nums text-slate-500">respondió en {estado.tardanzaMs} ms</span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-700">{estado.detalle}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-800">
                  {estado.url}
                </code>
                <button
                  type="button"
                  onClick={() => void copiar()}
                  className="text-xs font-semibold text-marino-700 hover:underline"
                >
                  {copiado ? 'Copiada' : 'Copiar la dirección'}
                </button>
              </div>
            </div>
          )}

          {estado && !estado.enLinea && (
            <Alerta tono="aviso">
              La consola no está contestando. Si hace falta entrar a una computadora ahora, se puede probar de nuevo en un
              minuto: el servicio se reinicia solo. Si sigue igual, es algo del servidor y hay que avisarle a quien lo
              administra —no se arregla desde acá.
            </Alerta>
          )}

          <Alerta tono="info">
            La consola se abre en el navegador y pide su propio usuario y clave, que no son los de DM Gestión. Es a
            propósito: desde ahí se entra a todas las computadoras de la agencia.
          </Alerta>

          <p className="text-xs leading-relaxed text-slate-500">
            Para que una computadora aparezca en la lista tiene que tener instalado el agente, que se baja de la misma
            consola una sola vez por máquina. Las que ya lo tenían siguen apareciendo: el agente vuelve solo cuando el
            servidor está en línea.
          </p>
        </div>
      </Tarjeta>
    </div>
  )
}
