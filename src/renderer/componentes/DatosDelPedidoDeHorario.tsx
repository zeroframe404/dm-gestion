// Los datos de un pedido de excepción de horario, tal como los ve el superadministrador: quién es, qué
// hora era en la agencia y desde qué IP y localidad lo pidió. La IP y la localidad las vio el SERVIDOR (lo
// que diga la computadora de la persona no vale), y quedan grabadas se apruebe o no.
import type { SolicitudDeHorario } from '../../shared/horario'
import { NOMBRE_ROL, type Rol } from '../../shared/tipos'

const MOMENTO: Record<SolicitudDeHorario['momento'], string> = {
  INGRESO: 'Quiso ingresar fuera de horario',
  EN_SESION: 'Se le acababa el turno trabajando',
}

export function nombreDelRol(rol: string): string {
  return NOMBRE_ROL[rol as Rol] ?? rol
}

export function DatosDelPedidoDeHorario({ pedido }: { pedido: SolicitudDeHorario }) {
  const filas: Array<[string, string]> = [
    ['Persona', `${pedido.nombre} (${pedido.usuario}) · ${nombreDelRol(pedido.rol)}${pedido.sucursal ? ` · ${pedido.sucursal}` : ''}`],
    ['Qué pasó', MOMENTO[pedido.momento]],
    ['Hora en la agencia', pedido.horaLocal || '—'],
    ['Dirección IP', pedido.ip || '—'],
    ['Localidad', pedido.localidad || 'Desconocida'],
  ]
  if (pedido.motivo) filas.push(['Motivo', pedido.motivo])
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="contents">
          <dt className="text-slate-500">{etiqueta}</dt>
          <dd className="min-w-0 break-words font-medium text-slate-900">{valor}</dd>
        </div>
      ))}
    </dl>
  )
}
