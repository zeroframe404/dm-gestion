// Impresora: la ticketeadora térmica de 80 mm (POS-80) del mostrador. Es opcional; si no está
// configurada, cobrar funciona igual y no se imprime nada.
import { useCallback, useEffect, useState } from 'react'
import type { ConfigImpresora } from '../../../shared/tipos'
import { Alerta, Boton, Campo, Cargando, Selector, Tarjeta } from '../../componentes/ui'

export function Impresora() {
  const [estado, setEstado] = useState<ConfigImpresora | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [habilitada, setHabilitada] = useState(false)
  const [impresora, setImpresora] = useState('')
  const [anchoMm, setAnchoMm] = useState('80')

  const aplicar = useCallback((config: ConfigImpresora) => {
    setEstado(config)
    setHabilitada(config.habilitada)
    setImpresora(config.impresora ?? config.predeterminada ?? '')
    setAnchoMm(String(config.anchoMm))
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await window.dm.impresora.estado()
    if (resultado.ok) aplicar(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [aplicar])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.impresora.guardar({ habilitada, impresora, anchoMm: Number(anchoMm) })
    setGuardando(false)
    if (resultado.ok) {
      aplicar(resultado.datos)
      setAviso(habilitada ? 'Listo: cada pago que registres va a imprimir su comprobante.' : 'El ticket quedó desactivado.')
    } else {
      setError(resultado.error)
    }
  }

  /**
   * La prueba usa la configuración GUARDADA, no la del formulario: por eso el botón está apagado
   * mientras haya cambios sin guardar. Al terminar sólo se refresca el estado —para traer el último
   * error—, sin volver a escribir los campos, que pisaría lo que la persona esté editando.
   */
  const probar = async () => {
    setProbando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.impresora.prueba()
    if (resultado.ok) setAviso('Se mandó un comprobante de prueba a la impresora.')
    else setError(resultado.error)
    const refrescado = await window.dm.impresora.estado()
    if (refrescado.ok) setEstado(refrescado.datos)
    setProbando(false)
  }

  if (cargando && !estado) return <Cargando />
  if (!estado) return <div>{error && <Alerta tono="error">{error}</Alerta>}</div>

  const sinImpresoras = estado.disponibles.length === 0
  const hayCambios = habilitada !== estado.habilitada || impresora !== (estado.impresora ?? '') || Number(anchoMm) !== estado.anchoMm

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}
      {estado.ultimoError && (
        <Alerta tono="aviso">
          El último ticket no se pudo imprimir: {estado.ultimoError}. El pago se guardó igual; el comprobante es lo único que falló.
        </Alerta>
      )}

      <Tarjeta
        titulo="Ticketeadora térmica"
        descripcion="Si esta PC tiene una impresora térmica de 80 mm, al registrar un pago sale el comprobante solo, sin diálogo de impresión. Es opcional: sin configurar, cobrar funciona igual."
        acciones={
          <>
            <Boton
              icono="impresora"
              onClick={() => void probar()}
              cargando={probando}
              disabled={!estado.habilitada || !estado.impresora || hayCambios}
              title={hayCambios ? 'Guardá los cambios antes de probar: la prueba usa la configuración guardada.' : undefined}
            >
              Imprimir una prueba
            </Boton>
            <Boton variante="primario" icono="ok" onClick={() => void guardar()} cargando={guardando} disabled={!hayCambios}>
              Guardar
            </Boton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <input
              type="checkbox"
              checked={habilitada}
              onChange={(evento) => setHabilitada(evento.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm">
              <span className="block font-semibold text-slate-800">Imprimir un comprobante al registrar un pago</span>
              <span className="block text-slate-600">
                Sale con «SEGUROS DANIEL MARTÍNEZ», la sucursal, la fecha y hora, el cliente, la patente, la póliza, el importe, el
                medio y quién atendió.
              </span>
            </span>
          </label>

          {sinImpresoras ? (
            <Campo
              etiqueta="Impresora"
              value={impresora}
              onChange={(evento) => setImpresora(evento.target.value)}
              placeholder="POS-80"
              ayuda="Windows no devolvió ninguna impresora instalada. Escribí el nombre exacto tal como figura en «Dispositivos e impresoras»."
            />
          ) : (
            <Selector
              etiqueta="Impresora"
              value={impresora}
              onChange={(evento) => setImpresora(evento.target.value)}
              opciones={[{ valor: '', texto: '(elegí una)' }, ...estado.disponibles.map((nombre) => ({ valor: nombre, texto: nombre }))]}
              ayuda={estado.predeterminada ? `La predeterminada de esta PC es «${estado.predeterminada}».` : 'Las que ve esta PC.'}
            />
          )}

          <Campo
            etiqueta="Ancho del papel (mm)"
            type="number"
            min={40}
            max={120}
            value={anchoMm}
            onChange={(evento) => setAnchoMm(evento.target.value)}
            ayuda="Una POS-80 usa 80 mm. Si el ticket sale cortado o muy angosto, ajustá este número."
            className="max-w-40"
          />
        </div>
      </Tarjeta>
    </div>
  )
}
