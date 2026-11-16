// La pantalla de ingreso cuando la licencia de la agencia no deja ingresar (venció, no hay, no es
// válida). En lugar del formulario: el motivo, a quién pedírsela y el lugar para pegar la licencia
// nueva. Pegarla no pide contraseña: el servidor sólo acepta una licencia firmada por quien vende el
// programa, así que no le abre nada a nadie.
import { useState } from 'react'
import { fechaDeLicencia, type EstadoDeLicencia } from '../../shared/licencia'
import { Alerta, AreaTexto, Boton } from './ui'

const TITULOS: Partial<Record<EstadoDeLicencia['estado'], string>> = {
  vencida: 'La licencia venció',
  falta: 'Falta la licencia',
  invalida: 'La licencia no es válida',
}

export function BloqueoPorLicencia({ estado, alInstalar, alReintentar }: {
  estado: EstadoDeLicencia
  alInstalar: (nuevo: EstadoDeLicencia) => void
  alReintentar: () => Promise<void>
}) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [comprobando, setComprobando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function instalar() {
    setEnviando(true)
    setError(null)
    const resultado = await window.dm.licencia.instalar(texto)
    setEnviando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    setTexto('')
    alInstalar(resultado.datos)
  }

  return (
    <div className="rounded-2xl bg-white p-8 shadow-media">
      <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">{TITULOS[estado.estado] ?? 'Licencia'}</h2>
      <div className="mt-4 flex flex-col gap-4">
        <Alerta tono="error">
          {estado.mensaje} Mientras tanto nadie puede ingresar al programa en esta agencia.
          {estado.vence && <> Vencimiento: {fechaDeLicencia(estado.vence)}.</>}
        </Alerta>
        <p className="text-sm text-slate-600">
          Para renovarla, comunicate con quien te vendió DM Gestión. Te van a mandar un código que empieza con
          <span className="font-mono"> dmgl1.</span>: pegalo acá abajo.
        </p>
        <AreaTexto
          etiqueta="Licencia nueva"
          rows={4}
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder="dmgl1.…"
        />
        {error && <Alerta tono="error">{error}</Alerta>}
        <Boton variante="primario" cargando={enviando} disabled={!texto.trim()} onClick={() => void instalar()} className="w-full">
          Instalar licencia
        </Boton>
        <Boton
          cargando={comprobando}
          onClick={() => {
            setComprobando(true)
            void alReintentar().finally(() => setComprobando(false))
          }}
          className="w-full"
        >
          Volver a comprobar
        </Boton>
      </div>
    </div>
  )
}
