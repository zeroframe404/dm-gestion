// El glow (14.0): el anillo de color y la burbuja con la cara de quien está trabajando en ese lugar.
//
// Es lo que reemplaza a preguntar «¿estás en la fila de Pérez?» por teléfono. Tres piezas para tres
// lugares distintos, todas colgadas de la misma clave de foco (`src/shared/presencia.ts`):
//
//   MarcaDePresencia   la calcomanía: se apoya ENCIMA de algo que ya existe (una celda de la planilla,
//                      un renglón de Mora) sin cambiarle el tamaño ni el contenido. Es lo que
//                      devuelven `decorarCelda` y `decorarFila` de `TablaVirtual`.
//   Glow               lo mismo pero envolviendo: para lo que no es una tabla.
//   InsigniaDePresencia el cartelito del encabezado de una ficha: la cara y «Ana está editando».
//
// POR QUÉ EL ANILLO VA CON `box-shadow` Y NO CON `border`: un borde ocupa lugar y correría el texto de
// la celda dos píxeles cada vez que alguien entra o sale, y con cinco personas trabajando la planilla
// temblaría. La sombra se dibuja encima y no mueve nada. Con `inset` queda por dentro del borde de la
// celda, que es donde se espera ver el marco.
//
// VARIAS PERSONAS EN EL MISMO LUGAR: los anillos se APILAN (dos píxeles cada uno, de adentro hacia
// afuera) y las burbujas se ponen una al lado de la otra. Pasa poco pero pasa, y mostrar sólo al
// primero haría que la segunda persona crea que está sola.
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import type { Presente } from '../../main/vivo/protocolo'
import { colorDePaleta } from '../../shared/paleta'
import type { ClaveDeFoco } from '../../shared/presencia'
import { claveDeFicha, useBloqueoDe, useFocoDeObjeto, usePresenciaDe, type ObjetoConFicha } from '../contexto/Presencia'
import { Avatar } from './Avatar'
import { estaEditando, motivoDelBloqueo, textoDePresencia } from './presencia-reglas'
import { cx } from './ui'

// Las frases viven en `presencia-reglas.ts`, sin una línea de React, para que el banco de pruebas pueda
// afirmarlas sin montar nada (ver `colaboracion-en-vivo.prueba.ts`). Se reexportan desde acá porque es
// donde las buscan las siete fichas y la planilla.
export { motivoDelBloqueo, textoDePresencia }

/** Hasta cuántas caras se dibujan al lado del anillo. Más que esto no entra en una celda. */
const CUANTAS_BURBUJAS = 3

/** Cuántos píxeles crece cada anillo apilado. */
const GRUESO_DEL_ANILLO = 2

/** Las sombras apiladas, de la persona más «adentro» a la de más afuera. */
function anillosDe(presentes: readonly Presente[]): string {
  return presentes
    .slice(0, CUANTAS_BURBUJAS)
    .map((presente, posicion) => `inset 0 0 0 ${(posicion + 1) * GRUESO_DEL_ANILLO}px ${colorDePaleta(presente.color).hex}`)
    .join(', ')
}

/**
 * La calcomanía que se apoya encima de algo que ya está dibujado.
 *
 * Va con `pointer-events-none` completo: la celda de abajo tiene que seguir recibiendo el doble clic
 * y el clic que selecciona la fila. El globito con los nombres se pone en el elemento de abajo (la
 * celda lo pone en su `title`), no acá.
 *
 * Devuelve `null` si no hay nadie: `decorarCelda` se llama por cada celda visible de la planilla
 * —unas cuatrocientas— y en el noventa y nueve por ciento de los casos no hay nadie, así que no puede
 * dejar un elemento vacío por celda.
 */
export function MarcaDePresencia({
  claveDeFoco,
  soloAnillo = false,
  redondeo = 'rounded-[3px]',
  burbujas = 'derecha',
}: {
  claveDeFoco: ClaveDeFoco
  /** Sin burbujas: para el renglón entero, donde la cara ya la dibuja alguna celda. */
  soloAnillo?: boolean
  redondeo?: string
  /**
   * De qué lado se cuelgan las caras.
   *
   * A la izquierda en las tablas anchas: el renglón mide lo que suman las veintidós columnas, así que
   * su borde derecho casi siempre está fuera de la pantalla y las burbujas quedarían escondidas atrás
   * de la barra horizontal. La primera columna, en cambio, es la fija y siempre se ve.
   */
  burbujas?: 'izquierda' | 'derecha'
}) {
  const presentes = usePresenciaDe(claveDeFoco)
  if (presentes.length === 0) return null

  return (
    <>
      <span
        aria-hidden="true"
        style={{ boxShadow: anillosDe(presentes) }}
        className={cx('pointer-events-none absolute inset-0 z-10', redondeo)}
      />
      {!soloAnillo && (
        <span
          className={cx(
            'pointer-events-none absolute -top-1 z-20 flex items-center',
            burbujas === 'izquierda' ? '-left-0.5' : '-right-0.5',
          )}
        >
          {presentes.slice(0, CUANTAS_BURBUJAS).map((presente, posicion) => (
            <Avatar
              key={presente.conexionId}
              clave={presente.clave}
              nombre={presente.nombre}
              tamano="xs"
              anillo
              title={`${presente.nombre} está ${estaEditando(presente) ? 'editando' : 'mirando'}`}
              // Se solapan un poco cuando son varias: tres burbujas separadas no entran en una celda.
              className={posicion > 0 ? '-ml-1.5' : undefined}
            />
          ))}
        </span>
      )}
    </>
  )
}

/**
 * Lo mismo que `MarcaDePresencia` pero envolviendo: para lo que no es una tabla y no tiene dónde
 * colgar una calcomanía (una tarjeta, un renglón de una lista común).
 */
export function Glow({
  claveDeFoco,
  children,
  className,
  redondeo = 'rounded-lg',
}: {
  claveDeFoco: ClaveDeFoco
  children: ReactNode
  className?: string
  redondeo?: string
}) {
  const presentes = usePresenciaDe(claveDeFoco)
  return (
    <span className={cx('relative block', className)} title={textoDePresencia(presentes) || undefined}>
      {children}
      <MarcaDePresencia claveDeFoco={claveDeFoco} redondeo={redondeo} />
    </span>
  )
}

/**
 * El cartelito del encabezado de una ficha: las caras y «Ana está editando».
 *
 * Acá sí se escribe el texto completo y no sólo el anillo: en una ficha la persona está por escribir,
 * y enterarse de que hay alguien más adentro tiene que costar cero (en una celda, con doscientas a la
 * vista, el texto sería ruido y alcanza el color).
 */
export function InsigniaDePresencia({ claveDeFoco }: { claveDeFoco: ClaveDeFoco }) {
  const presentes = usePresenciaDe(claveDeFoco)
  if (presentes.length === 0) return null
  const editando = presentes.some(estaEditando)

  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold',
        editando ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-600',
      )}
      title={textoDePresencia(presentes)}
    >
      <span className="flex items-center">
        {presentes.slice(0, CUANTAS_BURBUJAS).map((presente, posicion) => (
          <Avatar
            key={presente.conexionId}
            clave={presente.clave}
            nombre={presente.nombre}
            tamano="xs"
            anillo
            className={posicion > 0 ? '-ml-1.5' : undefined}
          />
        ))}
      </span>
      <span className="truncate">{textoDePresencia(presentes)}</span>
    </span>
  )
}

/**
 * Todo lo que una ficha abierta necesita de la presencia, en una línea (14.0).
 *
 * Las siete fichas —cliente, póliza, siniestro, tarea, consulta, presupuesto y el panel de la
 * planilla— hacen las mismas tres cosas: reportar que están abiertas, saber con qué clave dibujar la
 * insignia del encabezado, y preguntar si otra persona las está editando para apagar el Guardar.
 * Escrito siete veces, la sexta se olvidaría de limpiar el foco al cerrar.
 *
 * `filaId` puede venir null mientras la ficha carga o cuando el objeto todavía no subió a la hoja: ahí
 * no se reporta nada y nunca hay bloqueo, porque sin `_ID` las otras computadoras no lo pueden nombrar.
 */
export function useFichaEnVivo(
  objeto: ObjetoConFicha,
  filaId: string | null | undefined,
  conCambiosSinGuardar: boolean,
): { claveDeFoco: ClaveDeFoco; bloqueadaPor: Presente | null; motivo: string | undefined } {
  const claveDeFoco = claveDeFicha(objeto, filaId)
  useFocoDeObjeto(objeto, filaId, conCambiosSinGuardar)
  const bloqueadaPor = useBloqueoDe(claveDeFoco)
  return { claveDeFoco, bloqueadaPor, motivo: bloqueadaPor ? motivoDelBloqueo(bloqueadaPor) : undefined }
}

/** Lo que se le pone al contenedor de la ficha para que `useCursorAdentro` sepa qué mirar. */
export interface PropsDelCursor {
  ref: (nodo: HTMLElement | null) => void
  onFocusCapture: (evento: FocusEvent<HTMLElement>) => void
  onBlurCapture: (evento: FocusEvent<HTMLElement>) => void
}

/**
 * «¿Hay un cursor puesto en algún campo de esta ficha?» (14.0), para las fichas que no tienen botón de
 * Guardar y escriben campo por campo al perder el foco.
 *
 * En ésas no existe «cambios sin guardar»: lo que se guarda, se guarda solo al salir del campo. El
 * momento en que dos personas se pisarían es justamente mientras una tiene el cursor adentro, y eso es
 * lo que se reporta como `editando`.
 *
 * NO ES UN CONTADOR de eventos, y ahí está todo el asunto. Con un contador (+1 en cada `focusin`, -1 en
 * cada `focusout`) hay un caso que nunca vuelve a cero: Chromium NO dispara `focusout` cuando el
 * elemento enfocado se SACA del DOM. Pasa todos los días —el Escape de un campo de la ficha del
 * siniestro desmonta el `<input>` estando enfocado— y el resultado es que esta computadora se queda
 * reportando `editando: true` para siempre, con la ficha trabada en las otras cuatro y sin nadie
 * escribiendo nada. Por eso se lee el ESTADO REAL: si el foco del documento está o no adentro del
 * contenedor. Un estado no se puede desbalancear.
 *
 * Las tres piezas que hacen falta para leerlo bien:
 *   - el `ref`, para saber cuál es el contenedor (los eventos de foco no burbujean, pero sus versiones
 *     de captura sí llegan al padre, así que alcanza un solo lugar por ficha);
 *   - el respiro del `focusout`: `focusout` se dispara ANTES del `focusin` del campo siguiente, y en el
 *     medio `document.activeElement` es el `<body>`. Sin el respiro, cada Tab apagaría y volvería a
 *     encender el foco;
 *   - el vigía del DOM, que es el que tapa el agujero de arriba: cuando algo cambia adentro de la ficha
 *     se vuelve a mirar dónde está el cursor, y el campo que desapareció enfocado queda contado.
 */
export function useCursorAdentro(): [boolean, PropsDelCursor] {
  const [conCursor, setConCursor] = useState(false)
  const contenedor = useRef<HTMLElement | null>(null)
  const respiro = useRef<ReturnType<typeof setTimeout> | null>(null)

  const revisar = useCallback(() => {
    if (respiro.current) {
      clearTimeout(respiro.current)
      respiro.current = null
    }
    const marco = contenedor.current
    setConCursor(marco !== null && marco.contains(document.activeElement))
  }, [])

  const revisarDespues = useCallback(() => {
    if (respiro.current) clearTimeout(respiro.current)
    respiro.current = setTimeout(revisar, 0)
  }, [revisar])

  const guardarElContenedor = useCallback((nodo: HTMLElement | null) => {
    contenedor.current = nodo
  }, [])

  useEffect(() => {
    const marco = contenedor.current
    if (!marco || typeof MutationObserver !== 'function') return
    const vigia = new MutationObserver(revisarDespues)
    vigia.observe(marco, { childList: true, subtree: true })
    return () => {
      vigia.disconnect()
      if (respiro.current) clearTimeout(respiro.current)
    }
  }, [revisarDespues])

  const props = useMemo<PropsDelCursor>(
    () => ({ ref: guardarElContenedor, onFocusCapture: revisar, onBlurCapture: revisarDespues }),
    [guardarElContenedor, revisar, revisarDespues],
  )
  return [conCursor, props]
}
