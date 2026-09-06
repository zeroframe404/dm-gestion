// Administración → Registro de mensajes: todo lo que se dijo por el chat interno de la agencia.
//
// Es del superadministrador y de nadie más. La frontera está en tres lugares y en los tres a propósito:
// esta pestaña sólo se arma para SUPER_ADMIN, el manejador de IPC pide el rol antes de llamar a nada, y
// el servidor —que es el que tiene los mensajes— lo vuelve a pedir. Un dato que llega a la pantalla ya
// está afuera: no ofrecer el botón no es lo mismo que no dar el dato.
//
// Sale del servidor y no de la base de esta computadora porque esta computadora sólo tiene las
// conversaciones de quien la está usando, y el registro es justamente el de las otras.
//
// Muestra los mensajes borrados con su texto original y la marca de quién los borró. Es la razón de
// ser de esto: si borrar borrara de verdad, el registro no serviría para lo único que sirve.
import { useCallback, useEffect, useState } from 'react'
import type { LogDeMensajes } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Cargando, Etiqueta, Tarjeta, cx } from '../../componentes/ui'

function fechaLegible(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function RegistroDeMensajes() {
  const [usuario, setUsuario] = useState('')
  const [texto, setTexto] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [pagina, setPagina] = useState(1)

  const [log, setLog] = useState<LogDeMensajes | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buscar = useCallback(
    async (quePagina: number) => {
      setCargando(true)
      setError(null)
      const respuesta = await window.dm.mensajes.registro({
        usuario: usuario.trim() || null,
        texto: texto.trim(),
        // Las fechas del campo son días sueltos; al servidor van como momentos, con el día entero
        // adentro: si «hasta» fuera la medianoche, el último día del rango quedaría afuera.
        desde: desde ? new Date(`${desde}T00:00:00`).toISOString() : null,
        hasta: hasta ? new Date(`${hasta}T23:59:59.999`).toISOString() : null,
        pagina: quePagina,
      })
      setCargando(false)
      if (!respuesta.ok) {
        setError(respuesta.error)
        return
      }
      setLog(respuesta.datos)
      setPagina(respuesta.datos.pagina)
    },
    [usuario, texto, desde, hasta],
  )

  useEffect(() => {
    void buscar(1)
    // Sólo al abrir: después se busca con el botón. Buscar en cada tecla contra el servidor sería un
    // pedido por letra sobre una tabla que puede tener años de conversaciones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const paginas = log ? Math.max(1, Math.ceil(log.total / log.porPagina)) : 1

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Alerta tono="info">
        Acá está todo lo que se habló por el chat interno, incluidas las conversaciones en las que no
        estás y los mensajes que alguien borró. Es información del personal de la agencia: úsala para lo
        que hace falta y nada más.
      </Alerta>

      <Tarjeta titulo="Buscar">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52">
            <Campo
              etiqueta="Persona"
              value={usuario}
              onChange={(evento) => setUsuario(evento.target.value)}
              placeholder="Usuario de ingreso"
              ayuda="De o para esa persona"
            />
          </div>
          <div className="w-64">
            <Campo etiqueta="Texto" value={texto} onChange={(evento) => setTexto(evento.target.value)} placeholder="Qué decía" />
          </div>
          <div className="w-40">
            <Campo etiqueta="Desde" type="date" value={desde} onChange={(evento) => setDesde(evento.target.value)} />
          </div>
          <div className="w-40">
            <Campo etiqueta="Hasta" type="date" value={hasta} onChange={(evento) => setHasta(evento.target.value)} />
          </div>
          <Boton variante="primario" icono="lupa" cargando={cargando} onClick={() => void buscar(1)}>
            Buscar
          </Boton>
          <Boton
            variante="secundario"
            onClick={() => {
              setUsuario('')
              setTexto('')
              setDesde('')
              setHasta('')
              void buscar(1)
            }}
          >
            Limpiar
          </Boton>
        </div>
      </Tarjeta>

      {error && <Alerta tono="error">{error}</Alerta>}

      <Tarjeta
        alRas
        titulo={log ? `${log.total} mensaje${log.total === 1 ? '' : 's'}` : 'Mensajes'}
        descripcion={log && log.total > log.porPagina ? `Página ${pagina} de ${paginas}` : undefined}
        acciones={
          log && paginas > 1 ? (
            <div className="flex items-center gap-2">
              <Boton tamano="sm" variante="secundario" disabled={pagina <= 1 || cargando} onClick={() => void buscar(pagina - 1)}>
                Anteriores
              </Boton>
              <Boton tamano="sm" variante="secundario" disabled={pagina >= paginas || cargando} onClick={() => void buscar(pagina + 1)}>
                Siguientes
              </Boton>
            </div>
          ) : undefined
        }
      >
        {cargando && !log ? (
          <Cargando texto="Pidiéndole el registro al servidor…" />
        ) : !log || log.renglones.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">No hay mensajes que respondan a esa búsqueda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Cuándo</th>
                  <th className="px-3 py-2 font-semibold">Quién</th>
                  <th className="px-3 py-2 font-semibold">Conversación</th>
                  <th className="px-3 py-2 font-semibold">Qué dijo</th>
                  <th className="px-3 py-2 font-semibold">Archivos</th>
                  <th className="px-3 py-2 font-semibold">Llegada y lectura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {log.renglones.map((renglon) => (
                  <tr key={renglon.remotoId} className={cx('align-top', renglon.eliminadoEn && 'bg-red-50')}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500 tabular-nums">
                      {fechaLegible(renglon.creadoEn)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="block font-medium text-slate-800">{renglon.autorNombre}</span>
                      <span className="block text-xs text-slate-500">{renglon.autorClave}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-400">
                          <Icono nombre={renglon.tipo === 'GRUPO' ? 'clientes' : 'usuario'} tamano={14} />
                        </span>
                        <span className="text-slate-800">{renglon.conversacion}</span>
                      </span>
                      {renglon.tipo === 'GRUPO' && <span className="block text-xs text-slate-500">{renglon.participantes}</span>}
                    </td>
                    <td className="max-w-md px-3 py-2">
                      <span className="whitespace-pre-wrap break-words text-slate-800">{renglon.cuerpo || '—'}</span>
                      {renglon.eliminadoEn && (
                        <span className="mt-1 block">
                          <Etiqueta tono="peligro">
                            Lo borró {renglon.eliminadoPor ?? 'alguien'} el {fechaLegible(renglon.eliminadoEn)}
                          </Etiqueta>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{renglon.adjuntos || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{renglon.acuse}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  )
}
