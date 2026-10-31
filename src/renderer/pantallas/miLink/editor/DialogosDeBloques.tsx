// Los diálogos para agregar y editar bloques de la página: un contacto, una cobertura (elegir el tipo y
// después editarla) y un link.
//
// Cada diálogo lo monta el editor sólo mientras está abierto, así que arranca siempre con el bloque que
// se va a editar y no hay que «resetear» nada al cerrar. Ninguno guarda: devuelven el bloque al editor,
// que lo pone en la página y deja que el autoguardado haga lo suyo, igual que con lo que se escribe en
// el lugar.
import { useState, type FormEvent } from 'react'
import {
  DESCRIPCION_POR_DEFECTO_DE_COBERTURA,
  LIMITES_DE_MI_LINK,
  NOMBRE_TIPO_DE_COBERTURA,
  NOMBRE_TIPO_DE_CONTACTO,
  RAMO_DE_COBERTURA,
  TIPOS_DE_COBERTURA,
  TIPOS_DE_CONTACTO,
  type BloqueDeCobertura,
  type BloqueDeContacto,
  type BloqueDeLink,
  type TipoDeCobertura,
  type TipoDeContacto,
} from '../../../../shared/miLink'
import { AreaTexto, Boton, Campo, Dialogo, Selector, cx } from '../../../componentes/ui'
import { esUrlWeb, problemaDeContacto, urlConEsquema } from './reglas'
import { IconoDeLaPagina } from './VistaPrevia'

/** Cómo se escribe cada contacto: el ejemplo del campo y para qué sirve en la página. */
const AYUDA_DE_CONTACTO: Record<TipoDeContacto, { ejemplo: string; ayuda: string }> = {
  whatsapp: { ejemplo: '+54 9 11 5555-1234', ayuda: 'Con la característica. Al tocarlo, le abre un chat con vos.' },
  telefono: { ejemplo: '11 5555-1234', ayuda: 'Al tocarlo desde el celular, te llama.' },
  email: { ejemplo: 'vos@ejemplo.com', ayuda: 'Al tocarlo, le abre un mail nuevo para vos.' },
  instagram: { ejemplo: '@tuusuario', ayuda: 'Tu usuario o el link de tu perfil.' },
  facebook: { ejemplo: 'tu.pagina', ayuda: 'Tu usuario o el link de tu página.' },
  tiktok: { ejemplo: '@tuusuario', ayuda: 'Tu usuario o el link de tu perfil.' },
  web: { ejemplo: 'tusitio.com.ar', ayuda: 'La dirección de tu sitio.' },
  direccion: { ejemplo: 'Av. Mitre 1234, Avellaneda', ayuda: 'Al tocarla, abre el mapa con esa dirección.' },
}

/** Una grilla de opciones con ícono, para elegir el tipo de un contacto o de una cobertura. */
function GrillaDeTipos<T extends string>({
  tipos,
  elegido,
  nombre,
  detalle,
  alElegir,
}: {
  tipos: readonly T[]
  elegido: T | null
  nombre: (tipo: T) => string
  detalle?: (tipo: T) => string | null
  alElegir: (tipo: T) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {tipos.map((tipo) => {
        const activo = tipo === elegido
        const extra = detalle?.(tipo)
        return (
          <button
            key={tipo}
            type="button"
            onClick={() => alElegir(tipo)}
            aria-pressed={elegido === null ? undefined : activo}
            className={cx(
              'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
              activo ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', activo ? 'bg-violet-100' : 'bg-slate-100')}>
              <IconoDeLaPagina nombre={tipo} className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold leading-tight">{nombre(tipo)}</span>
              {extra && <span className="block truncate text-xs text-slate-500">{extra}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Contacto ─────────────────────────────────────────────────────────────────────────────────────

export function DialogoContacto({
  inicial,
  alGuardar,
  alCerrar,
}: {
  /** null = uno nuevo. */
  inicial: BloqueDeContacto | null
  alGuardar: (datos: { tipo: TipoDeContacto; valor: string }) => void
  alCerrar: () => void
}) {
  const [tipo, setTipo] = useState<TipoDeContacto>(inicial?.tipo ?? 'whatsapp')
  const [valor, setValor] = useState(inicial?.valor ?? '')
  // El problema se muestra recién después del primer intento: con el campo vacío al abrir, un cartel
  // rojo de entrada sería un reto antes de haber escrito nada.
  const [intento, setIntento] = useState(false)
  const problema = problemaDeContacto(tipo, valor)

  const guardar = (evento?: FormEvent) => {
    evento?.preventDefault()
    setIntento(true)
    if (problema) return
    alGuardar({ tipo, valor: valor.trim() })
  }

  return (
    <Dialogo
      abierto
      titulo={inicial ? 'Editar contacto' : 'Agregar en Contacto'}
      descripcion="Cómo te pueden encontrar. Cada uno es un botón de tu página."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton variante="fantasma" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={() => guardar()}>
            {inicial ? 'Listo' : 'Agregar'}
          </Boton>
        </>
      }
    >
      <form onSubmit={guardar} className="flex flex-col gap-5">
        <GrillaDeTipos tipos={TIPOS_DE_CONTACTO} elegido={tipo} nombre={(t) => NOMBRE_TIPO_DE_CONTACTO[t]} alElegir={setTipo} />
        <Campo
          etiqueta={NOMBRE_TIPO_DE_CONTACTO[tipo]}
          value={valor}
          onChange={(evento) => setValor(evento.target.value)}
          placeholder={AYUDA_DE_CONTACTO[tipo].ejemplo}
          maxLength={LIMITES_DE_MI_LINK.valorDeContacto}
          ayuda={AYUDA_DE_CONTACTO[tipo].ayuda}
          error={intento ? problema : null}
          autoFocus
        />
      </form>
    </Dialogo>
  )
}

// ── Cobertura ────────────────────────────────────────────────────────────────────────────────────

/** El primer paso de «Agregar en Tus seguros»: qué cobertura. El texto se edita después, en la página. */
export function DialogoNuevaCobertura({
  usadas,
  alElegir,
  alCerrar,
}: {
  /** Los tipos que ya están en la página: se marcan, pero se pueden repetir (dos «Seguro de auto» con distinto texto). */
  usadas: ReadonlySet<TipoDeCobertura>
  alElegir: (tipo: TipoDeCobertura) => void
  alCerrar: () => void
}) {
  return (
    <Dialogo
      abierto
      titulo="Agregar en Tus seguros"
      descripcion="Auto y moto abren el cotizador (marca, modelo, versión y año); las demás, un formulario corto para pedirte presupuesto."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <Boton variante="fantasma" onClick={alCerrar}>
          Cancelar
        </Boton>
      }
    >
      <GrillaDeTipos
        tipos={TIPOS_DE_COBERTURA}
        elegido={null}
        nombre={(tipo) => NOMBRE_TIPO_DE_COBERTURA[tipo]}
        // El ramo debajo ayuda a ubicarla («Combinado familiar»), salvo cuando dice lo mismo que el nombre.
        detalle={(tipo) => (usadas.has(tipo) ? 'Ya está en tu página' : RAMO_DE_COBERTURA[tipo] === NOMBRE_TIPO_DE_COBERTURA[tipo] ? null : RAMO_DE_COBERTURA[tipo])}
        alElegir={alElegir}
      />
    </Dialogo>
  )
}

export function DialogoCobertura({
  inicial,
  alGuardar,
  alCerrar,
}: {
  inicial: BloqueDeCobertura
  alGuardar: (datos: Pick<BloqueDeCobertura, 'tipo' | 'titulo' | 'descripcion'>) => void
  alCerrar: () => void
}) {
  const [tipo, setTipo] = useState<TipoDeCobertura>(inicial.tipo)
  const [titulo, setTitulo] = useState(inicial.titulo)
  const [descripcion, setDescripcion] = useState(inicial.descripcion)
  const [intento, setIntento] = useState(false)
  const faltaTitulo = titulo.trim().length === 0

  // Cambiar el tipo trae su título y su texto de siempre, pero sólo si la persona no los había cambiado:
  // si escribió los suyos, se respetan.
  const cambiarTipo = (nuevo: TipoDeCobertura) => {
    if (titulo.trim() === NOMBRE_TIPO_DE_COBERTURA[tipo]) setTitulo(NOMBRE_TIPO_DE_COBERTURA[nuevo])
    if (descripcion.trim() === DESCRIPCION_POR_DEFECTO_DE_COBERTURA[tipo] || !descripcion.trim()) {
      setDescripcion(DESCRIPCION_POR_DEFECTO_DE_COBERTURA[nuevo])
    }
    setTipo(nuevo)
  }

  const guardar = (evento?: FormEvent) => {
    evento?.preventDefault()
    setIntento(true)
    if (faltaTitulo) return
    alGuardar({ tipo, titulo: titulo.trim(), descripcion: descripcion.trim() })
  }

  return (
    <Dialogo
      abierto
      titulo="Editar cobertura"
      alCerrar={alCerrar}
      pie={
        <>
          <Boton variante="fantasma" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={() => guardar()}>
            Listo
          </Boton>
        </>
      }
    >
      <form onSubmit={guardar} className="flex flex-col gap-4">
        <Selector
          etiqueta="Tipo"
          value={tipo}
          onChange={(evento) => cambiarTipo(evento.target.value as TipoDeCobertura)}
          opciones={TIPOS_DE_COBERTURA.map((t) => ({ valor: t, texto: NOMBRE_TIPO_DE_COBERTURA[t] }))}
          ayuda={tipo === 'auto' || tipo === 'moto' ? 'Abre el cotizador con el catálogo de vehículos.' : 'Abre un formulario para pedirte presupuesto.'}
        />
        <Campo
          etiqueta="Título"
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
          maxLength={LIMITES_DE_MI_LINK.tituloDeCobertura}
          error={intento && faltaTitulo ? 'Falta el título.' : null}
          autoFocus
        />
        <AreaTexto
          etiqueta="Descripción (opcional)"
          value={descripcion}
          onChange={(evento) => setDescripcion(evento.target.value)}
          maxLength={LIMITES_DE_MI_LINK.descripcionDeCobertura}
          rows={3}
          ayuda={`${descripcion.length}/${LIMITES_DE_MI_LINK.descripcionDeCobertura}. En el estilo «Botones» no se muestra.`}
        />
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialogo>
  )
}

// ── Link ─────────────────────────────────────────────────────────────────────────────────────────

export function DialogoLink({
  inicial,
  alGuardar,
  alCerrar,
}: {
  /** null = uno nuevo. */
  inicial: BloqueDeLink | null
  alGuardar: (datos: Pick<BloqueDeLink, 'titulo' | 'url'>) => void
  alCerrar: () => void
}) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [url, setUrl] = useState(inicial?.url ?? '')
  const [intento, setIntento] = useState(false)
  const urlCompleta = urlConEsquema(url)
  const errorTitulo = titulo.trim() ? null : 'Falta el título: es lo que se lee en el botón.'
  const errorUrl = !url.trim()
    ? 'Falta la dirección.'
    : !esUrlWeb(urlCompleta)
      ? 'La dirección tiene que empezar con http:// o https://.'
      : urlCompleta.length > LIMITES_DE_MI_LINK.urlDeLink
        ? `La dirección puede tener hasta ${LIMITES_DE_MI_LINK.urlDeLink} caracteres.`
        : null

  const guardar = (evento?: FormEvent) => {
    evento?.preventDefault()
    setIntento(true)
    if (errorTitulo || errorUrl) return
    alGuardar({ titulo: titulo.trim(), url: urlCompleta })
  }

  return (
    <Dialogo
      abierto
      titulo={inicial ? 'Editar link' : 'Agregar en Tus links'}
      alCerrar={alCerrar}
      pie={
        <>
          <Boton variante="fantasma" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={() => guardar()}>
            {inicial ? 'Listo' : 'Agregar'}
          </Boton>
        </>
      }
    >
      <form onSubmit={guardar} className="flex flex-col gap-4">
        <Campo
          etiqueta="Título"
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
          placeholder="Mi agenda de turnos"
          maxLength={LIMITES_DE_MI_LINK.tituloDeLink}
          error={intento ? errorTitulo : null}
          autoFocus
        />
        <Campo
          etiqueta="Dirección"
          value={url}
          onChange={(evento) => setUrl(evento.target.value)}
          placeholder="https://…"
          maxLength={LIMITES_DE_MI_LINK.urlDeLink}
          error={intento ? errorUrl : null}
          ayuda="Si la pegás sin «https://», se lo agrego yo."
          // Que pegue con espacios de más no es un error: se recortan al guardar.
          spellCheck={false}
        />
        {/* Enter en cualquier campo manda el formulario: con dos campos, sin un botón de envío adentro no
            pasa (los botones de verdad están en el pie del diálogo, afuera del form). */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialogo>
  )
}
