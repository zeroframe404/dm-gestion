// La dirección del cliente, en partes.
//
// Antes eran dos campos sueltos en el formulario —«Dirección» de texto libre y «Localidad»— y con eso
// entraba cualquier cosa: «Mitre 1234 Lanús», «mitre1234», «al lado de la plaza». Se sacaron del
// formulario y se pusieron detrás de un botón que abre esto: ocupa un renglón en vez de dos, se carga
// una sola vez y queda igual la cargue quien la cargue.
//
// «Altura» tiene su propio «no tiene» porque en el conurbano hay direcciones que de verdad no tienen
// número. Dejar el campo vacío no distingue entre «no tiene» y «me falta preguntarlo», y esa
// diferencia importa cuando después hay que mandar una carta documento o el perito tiene que llegar.
import { useEffect, useState } from 'react'
import {
  DIRECCION_VACIA,
  PROVINCIAS,
  direccionCompleta,
  direccionEstaVacia,
  faltantesDeDireccion,
  sanearDireccion,
  type DireccionEstructurada,
} from '../../../shared/direccion'
import { Alerta, Boton, Campo, Dialogo, Selector } from '../../componentes/ui'

const LISTA_LOCALIDADES = 'lista-localidades-direccion'

interface Props {
  abierto: boolean
  direccion: DireccionEstructurada
  /** Localidades ya cargadas en la agencia, para sugerir sin obligar. */
  localidadesConocidas?: string[]
  alCerrar: () => void
  alGuardar: (direccion: DireccionEstructurada) => void
}

export function DialogoDireccion({ abierto, direccion, localidadesConocidas = [], alCerrar, alGuardar }: Props) {
  const [borrador, setBorrador] = useState<DireccionEstructurada>(direccion)

  // Se recarga cada vez que se abre: si alguien cerró con la cruz y vuelve a entrar, tiene que ver lo
  // que estaba guardado y no lo que había tipeado y descartó.
  useEffect(() => {
    if (abierto) setBorrador(sanearDireccion(direccion))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  if (!abierto) return null

  const cambiar = (campo: keyof DireccionEstructurada) => (evento: { target: { value: string } }) =>
    setBorrador((previa) => ({ ...previa, [campo]: evento.target.value }))

  const marcarSinAltura = (sinAltura: boolean) =>
    // Marcar «no tiene» borra el número: guardar las dos cosas sería guardar una contradicción.
    setBorrador((previa) => ({ ...previa, sinAltura, altura: sinAltura ? '' : previa.altura }))

  const faltantes = faltantesDeDireccion(borrador)
  const vista = direccionCompleta(borrador)

  return (
    <Dialogo
      abierto
      titulo="Dirección"
      descripcion="Con la dirección cargada así, después se puede buscar por localidad y sale bien impresa en el comprobante."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton onClick={() => setBorrador(DIRECCION_VACIA)} disabled={direccionEstaVacia(borrador)}>
            Vaciar
          </Boton>
          <Boton onClick={alCerrar}>Cancelar</Boton>
          <Boton variante="primario" icono="ok" onClick={() => alGuardar(sanearDireccion(borrador))}>
            Usar esta dirección
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Calle" value={borrador.calle} onChange={cambiar('calle')} autoFocus autoComplete="off" />
          <Campo
            etiqueta="Calle 2 (opcional)"
            value={borrador.calle2}
            onChange={cambiar('calle2')}
            ayuda="La esquina o entre qué calles está. Sirve para encontrarla."
            autoComplete="off"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Altura"
            value={borrador.altura}
            onChange={cambiar('altura')}
            disabled={borrador.sinAltura}
            className="tabular-nums"
            autoComplete="off"
          />
          <label className="flex cursor-pointer items-start gap-3 self-end rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <input
              type="checkbox"
              checked={borrador.sinAltura}
              onChange={(evento) => marcarSinAltura(evento.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm">
              <span className="block font-semibold text-slate-800">No tiene</span>
              <span className="block text-xs text-slate-600">La dirección no tiene número de puerta.</span>
            </span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Selector
            etiqueta="Provincia"
            value={borrador.provincia}
            onChange={cambiar('provincia')}
            opciones={[{ valor: '', texto: 'Elegí una…' }, ...PROVINCIAS.map((provincia) => ({ valor: provincia, texto: provincia }))]}
          />
          <Campo
            etiqueta="Localidad"
            value={borrador.localidad}
            onChange={cambiar('localidad')}
            list={LISTA_LOCALIDADES}
            autoComplete="off"
          />
          <Campo
            etiqueta="Código postal"
            value={borrador.codigoPostal}
            onChange={cambiar('codigoPostal')}
            ayuda="1824 o B1824, como venga."
            autoComplete="off"
          />
        </div>

        <datalist id={LISTA_LOCALIDADES}>
          {localidadesConocidas.map((localidad) => (
            <option key={localidad} value={localidad} />
          ))}
        </datalist>

        {/* Cómo va a quedar escrita. Es la línea que después sale en el ticket. */}
        {vista && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Va a quedar así</p>
            <p className="mt-1 text-sm text-slate-800">{vista}</p>
          </div>
        )}

        {faltantes.length > 0 && (
          <Alerta tono="aviso">
            Se puede guardar igual, pero todavía falta {faltantes.join(', ')}. Una dirección incompleta no sirve para mandar
            nada por correo.
          </Alerta>
        )}
      </div>
    </Dialogo>
  )
}
