// El botón de emergencia: «sincronizar todo ahora».
//
// La sincronización con la hoja y la bajada de datos corren solas cada tanto, y el 99 % de los días
// nadie se entera de que existen. El 1 % restante es un jueves a la mañana, con gente en el mostrador,
// alguien pregunta por una cuota que se cargó ayer en otra sucursal y no está. Hasta ahora la única
// salida era llamar a un administrador.
//
// Esta tarjeta la ve todo el equipo, con el rol que sea. No hace nada que la aplicación no haga sola:
// fuerza una vuelta completa —subir lo que está en la cola y bajar todo de nuevo— y cuenta cómo fue.
// Por eso no pide permisos de Administración: no configura nada, sólo apura lo que ya iba a pasar.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoSincronizacion } from '../../../shared/tipos'
import { Alerta, Boton, Etiqueta, Tarjeta } from '../../componentes/ui'

function cuando(iso: string | null): string {
  if (!iso) return 'todavía nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function SincronizarTodo() {
  const [estado, setEstado] = useState<EstadoSincronizacion | null>(null)
  const [corriendo, setCorriendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const mirar = useCallback(async () => {
    const resultado = await window.dm.sincronizacion.estado()
    if (resultado.ok) setEstado(resultado.datos)
  }, [])

  useEffect(() => {
    void mirar()
    // El estado también cambia solo mientras la tarjeta está abierta: el motor sube cada tanto.
    const dejarDeEscuchar = window.dm.sincronizacion.alCambiarEstado(setEstado)
    return dejarDeEscuchar
  }, [mirar])

  const sincronizar = async () => {
    setCorriendo(true)
    setError(null)
    setAviso(null)
    // `true` es la vuelta COMPLETA: no alcanza con subir lo pendiente, porque lo que falta suele ser
    // algo que cargó otra sucursal y que esta computadora todavía no bajó.
    const resultado = await window.dm.sincronizacion.ahora(true)
    setCorriendo(false)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setAviso(
        resultado.datos.pendientes > 0
          ? `Se sincronizó, pero quedaron ${resultado.datos.pendientes} cambio(s) esperando. Probá de nuevo en un rato; si sigue igual, avisale a un administrador.`
          : 'Listo: se subió todo lo que estaba esperando y se bajó lo último de la hoja.',
      )
    } else {
      setError(resultado.error)
    }
    await mirar()
  }

  const pendientes = estado?.pendientes ?? 0
  const sinConfigurar = estado !== null && !estado.configurada

  return (
    <Tarjeta
      titulo="Sincronizar todo ahora"
      descripcion="La aplicación sincroniza sola cada tanto. Este botón es para cuando algo que cargó otra sucursal no aparece, o cuando un cambio tuyo quedó esperando: fuerza una vuelta completa, sube lo pendiente y vuelve a bajar los datos."
      acciones={
        <Boton variante="primario" icono="nube" onClick={() => void sincronizar()} cargando={corriendo} disabled={sinConfigurar}>
          Sincronizar todo
        </Boton>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono={pendientes > 0 ? 'aviso' : 'exito'}>{aviso}</Alerta>}

        {sinConfigurar ? (
          <Alerta tono="aviso">
            En esta computadora la sincronización está apagada: todo lo que cargues se guarda acá y no viaja. Avisale a un
            administrador.
          </Alerta>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-3">
            <Dato etiqueta="Esperando para subir">
              {pendientes === 0 ? (
                <Etiqueta tono="exito">Nada pendiente</Etiqueta>
              ) : (
                <Etiqueta tono="aviso">{pendientes} cambio(s)</Etiqueta>
              )}
            </Dato>
            <Dato etiqueta="Última subida">{cuando(estado?.ultimaSubida ?? null)}</Dato>
            <Dato etiqueta="Última bajada">{cuando(estado?.ultimaBajada ?? null)}</Dato>
          </dl>
        )}

        <p className="text-xs leading-relaxed text-slate-500">
          Sincronizar de más no rompe nada: si no hay novedades, no pasa nada y listo. Puede tardar unos segundos con la hoja
          entera.
        </p>
      </div>
    </Tarjeta>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  )
}
