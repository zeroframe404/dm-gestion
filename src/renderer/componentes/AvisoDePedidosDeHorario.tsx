// Los pedidos de excepción de horario, del lado del superadministrador: salta en cualquier pantalla cuando
// llega uno nuevo y muestra quién es, desde qué dirección IP y localidad lo pide, con «Aprobar» (por 30
// minutos, 1, 2 o 4 horas) o «Rechazar». Se decida lo que se decida queda grabado en el registro del servidor.
//
// Cerrar la ventana sin contestar no pierde nada: los pedidos siguen pendientes y se ven en
// Administración → Ciberseguridad → Control de horarios. Sólo se monta para el superadministrador (los demás roles no tienen nada
// que decidir, y el proceso principal tampoco les manda el evento).
import { useCallback, useEffect, useState } from 'react'
import { MINUTOS_DE_EXCEPCION, type SolicitudDeHorario } from '../../shared/horario'
import { useUsuarioActual } from '../contexto/Sesion'
import { reproducir } from '../sonidos'
import { DatosDelPedidoDeHorario } from './DatosDelPedidoDeHorario'
import { Alerta, Boton, Dialogo, Selector } from './ui'

export function textoDeMinutos(minutos: number): string {
  if (minutos < 60) return `${minutos} minutos`
  const horas = minutos / 60
  return `${horas} ${horas === 1 ? 'hora' : 'horas'}`
}

export function PedidoParaResolver({ pedido, alResolver }: { pedido: SolicitudDeHorario; alResolver: () => void }) {
  const [minutos, setMinutos] = useState<number>(60)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resolver(aprobada: boolean) {
    setEnviando(true)
    setError(null)
    const resultado = await window.dm.horario.resolver(pedido.id, aprobada, aprobada ? minutos : null)
    setEnviando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    alResolver()
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <DatosDelPedidoDeHorario pedido={pedido} />
      <div className="flex flex-wrap items-end gap-2">
        <Selector
          etiqueta="Si aprobás, por cuánto tiempo"
          value={minutos}
          onChange={(evento) => setMinutos(Number(evento.target.value))}
          opciones={MINUTOS_DE_EXCEPCION.map((m) => ({ valor: m, texto: textoDeMinutos(m) }))}
          disabled={enviando}
        />
        <Boton variante="primario" cargando={enviando} onClick={() => void resolver(true)}>
          Aprobar
        </Boton>
        <Boton variante="peligro" disabled={enviando} onClick={() => void resolver(false)}>
          Rechazar
        </Boton>
      </div>
      {error && <Alerta tono="error">{error}</Alerta>}
    </div>
  )
}

export function AvisoDePedidosDeHorario() {
  const esSuper = useUsuarioActual().rol === 'SUPER_ADMIN'
  const [pendientes, setPendientes] = useState<SolicitudDeHorario[]>([])
  const [abierto, setAbierto] = useState(false)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.horario.pendientes()
    if (resultado.ok) setPendientes(resultado.datos)
  }, [])

  useEffect(() => {
    if (!esSuper) return
    return window.dm.horario.alLlegarPedidos(({ pendientes: nuevos }) => {
      reproducir('campana')
      setPendientes(nuevos)
      setAbierto(true)
    })
  }, [esSuper])

  const alResolver = (id: string) => {
    setPendientes((actuales) => {
      const quedan = actuales.filter((pedido) => pedido.id !== id)
      if (quedan.length === 0) setAbierto(false)
      return quedan
    })
    void cargar()
  }

  if (!esSuper || !abierto || pendientes.length === 0) return null

  return (
    <Dialogo
      abierto
      ancho="lg"
      titulo={pendientes.length === 1 ? 'Pedido de excepción de horario' : `${pendientes.length} pedidos de excepción de horario`}
      descripcion="Alguien pide trabajar fuera de su horario. Se apruebe o no, el pedido queda grabado con su IP y su localidad."
      alCerrar={() => setAbierto(false)}
      pie={<Boton onClick={() => setAbierto(false)}>Decidir después</Boton>}
    >
      <div className="space-y-3">
        {pendientes.map((pedido) => (
          <PedidoParaResolver key={pedido.id} pedido={pedido} alResolver={() => alResolver(pedido.id)} />
        ))}
      </div>
    </Dialogo>
  )
}
