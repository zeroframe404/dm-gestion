// El aviso de «se acaba el tiempo laboral» (Administración → Uso laboral).
//
// Llega estando en cualquier pantalla, por eso vive en el marco y no en un módulo. El proceso principal
// ya sacudió la ventana (es el único que la puede mover); acá suena el zumbido —con el interruptor de
// silencio de esta computadora— y sale la ventana con el ícono amarillo, que ofrece dos cosas: «Aceptar»
// (se entera y sigue trabajando hasta la hora) o «Pedir excepción al super-administrador».
//
// Cuando se pide, el proceso principal se queda mirando la respuesta y la manda por `horario:respuesta`:
// acá se muestra si el superadministrador aprobó (y hasta qué hora) o si no. Al llegar la hora, la sesión
// se cierra sola desde el proceso principal y esta ventana desaparece con el resto de la pantalla.
import { useEffect, useState } from 'react'
import type { AvisoDeFinDeTurno, RespuestaDeExcepcion } from '../../shared/horario'
import { reproducir } from '../sonidos'
import { Icono } from './Icono'
import { Alerta, Boton, Dialogo } from './ui'

type Fase = 'aviso' | 'pidiendo' | 'esperando'

export function AvisoDeFinDeTurno() {
  const [aviso, setAviso] = useState<AvisoDeFinDeTurno | null>(null)
  const [fase, setFase] = useState<Fase>('aviso')
  const [respuesta, setRespuesta] = useState<RespuestaDeExcepcion | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dejarDeAvisar = window.dm.horario.alAvisarFinDeTurno((datos) => {
      reproducir('zumbido')
      setAviso(datos)
      setFase((anterior) => (anterior === 'esperando' ? 'esperando' : 'aviso'))
      setError(null)
    })
    const dejarDeResponder = window.dm.horario.alResponderUnPedido((datos) => {
      reproducir('campana')
      setRespuesta(datos)
      setAviso(null)
      setFase('aviso')
    })
    return () => {
      dejarDeAvisar()
      dejarDeResponder()
    }
  }, [])

  async function pedirExcepcion() {
    setFase('pidiendo')
    setError(null)
    const resultado = await window.dm.horario.pedirEnSesion('')
    if (!resultado.ok) {
      setError(resultado.error)
      setFase('aviso')
      return
    }
    setFase('esperando')
  }

  if (respuesta) {
    const aprobada = respuesta.estado === 'APROBADA'
    return (
      <Dialogo
        abierto
        ancho="sm"
        titulo={aprobada ? 'Excepción aprobada' : 'Excepción rechazada'}
        alCerrar={() => setRespuesta(null)}
        pie={
          <Boton variante="primario" onClick={() => setRespuesta(null)}>
            Aceptar
          </Boton>
        }
      >
        {aprobada ? (
          <Alerta tono="exito">
            El superadministrador te dio {respuesta.minutosConcedidos} minutos más. Podés trabajar hasta las{' '}
            <strong className="font-semibold">{respuesta.cierraA}</strong>; ahí se cierra la sesión.
          </Alerta>
        ) : (
          <Alerta tono="aviso">
            El superadministrador no aprobó la excepción. Cuando termine tu horario la sesión se cierra sola: guardá lo que estés haciendo.
          </Alerta>
        )}
      </Dialogo>
    )
  }

  if (!aviso) return null
  const cierre = `${aviso.minutosRestantes} ${aviso.minutosRestantes === 1 ? 'minuto' : 'minutos'}`

  return (
    <Dialogo
      abierto
      ancho="sm"
      titulo="Se acaba tu tiempo laboral"
      alCerrar={() => setAviso(null)}
      pie={
        <>
          {fase === 'aviso' && (
            <Boton onClick={() => void pedirExcepcion()}>Pedir excepción al super-administrador</Boton>
          )}
          <Boton variante="primario" onClick={() => setAviso(null)}>
            Aceptar
          </Boton>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-500">
          <Icono nombre="alerta" tamano={30} />
        </span>
        <div className="min-w-0 space-y-3 text-sm leading-relaxed text-slate-700">
          <p>
            Tu horario de trabajo termina a las <strong className="font-semibold">{aviso.cierraA}</strong>: faltan {cierre}. Cuando se
            acabe, el programa cierra tu sesión y la conexión con el servidor de la agencia.
          </p>
          <p>Guardá lo que estés haciendo para no perderlo.</p>
          {fase === 'pidiendo' && <p className="text-slate-500">Enviando el pedido…</p>}
          {fase === 'esperando' && (
            <Alerta tono="info">Pedido enviado. Cuando el superadministrador conteste te avisamos acá.</Alerta>
          )}
          {error && <Alerta tono="error">{error}</Alerta>}
        </div>
      </div>
    </Dialogo>
  )
}
