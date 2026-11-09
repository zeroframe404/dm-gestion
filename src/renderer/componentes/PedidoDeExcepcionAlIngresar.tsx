// El bloque que aparece en el Login cuando alguien intenta ingresar fuera de su horario de trabajo (Uso
// laboral): «Pedir excepción al super-administrador». El pedido se manda sin sesión (el proceso principal
// se acuerda de quién acaba de ser rechazado con la contraseña bien) y acá se espera la respuesta.
//
// Si el superadministrador aprueba, la persona vuelve a tocar «Ingresar»: la excepción ya está vigente en el
// servidor y la deja pasar por el tiempo que le dieron. Si rechaza, queda dicho y no se puede insistir.
import { useEffect, useState } from 'react'
import type { SolicitudDeHorario } from '../../shared/horario'
import { Alerta, Boton } from './ui'

/** Cada cuánto se vuelve a preguntar si el superadministrador ya contestó. */
const CADA_MS = 5_000

export function PedidoDeExcepcionAlIngresar() {
  const [pedido, setPedido] = useState<SolicitudDeHorario | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pedir() {
    setEnviando(true)
    setError(null)
    const resultado = await window.dm.horario.pedirAlIngresar('')
    setEnviando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    setPedido(resultado.datos)
  }

  useEffect(() => {
    if (!pedido || pedido.estado !== 'PENDIENTE') return
    let vigente = true
    const reloj = setInterval(() => {
      void window.dm.horario.estadoDelPedidoAlIngresar().then((resultado) => {
        if (vigente && resultado.ok && resultado.datos) setPedido(resultado.datos)
      })
    }, CADA_MS)
    return () => {
      vigente = false
      clearInterval(reloj)
    }
  }, [pedido])

  if (pedido?.estado === 'APROBADA') {
    return (
      <Alerta tono="exito">
        El superadministrador aprobó tu pedido por {pedido.minutosConcedidos} minutos. Tocá «Ingresar» de nuevo para entrar.
      </Alerta>
    )
  }
  if (pedido?.estado === 'RECHAZADA') {
    return <Alerta tono="aviso">El superadministrador no aprobó tu pedido. Tenés que esperar a tu horario de trabajo.</Alerta>
  }
  if (pedido) {
    return <Alerta tono="info">Pedido enviado. Esperando que el superadministrador conteste: esta pantalla se actualiza sola.</Alerta>
  }
  return (
    <div className="flex flex-col gap-2">
      {error && <Alerta tono="error">{error}</Alerta>}
      <Boton cargando={enviando} onClick={() => void pedir()}>
        Pedir excepción al super-administrador
      </Boton>
    </div>
  )
}
