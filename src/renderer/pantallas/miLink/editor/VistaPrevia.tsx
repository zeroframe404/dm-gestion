// La página tal como la va a ver la gente, y a la vez el lugar donde se edita.
//
// Se dibuja con la hoja de la página pública (ver aspecto.ts) y con la misma estructura de bloques que
// arma el servidor, así el estilo, el color y lo de detrás del avatar se ven acá como allá. Con
// `edicion` cada texto se puede tocar en el lugar y cada bloque muestra al pasar el mouse su barrita
// (editar, subir, bajar, borrar); sin `edicion` es un dibujo quieto: así la usan las miniaturas del
// panel «Diseño» y quien no tiene permiso para editar.
//
// Los textos de la persona se muestran SIEMPRE como texto de React (escapado); el único HTML crudo que
// entra es el de los trazos de los íconos, que son constantes de aspecto.ts.
import { useLayoutEffect, type KeyboardEvent } from 'react'
import {
  LIMITES_DE_MI_LINK,
  NOMBRE_TIPO_DE_CONTACTO,
  coberturaCotizaVehiculo,
  type ContenidoDeMiLink,
} from '../../../../shared/miLink'
import { obtenerIniciales } from '../../../../shared/texto'
import { Icono } from '../../../componentes/Icono'
import { cx } from '../../../componentes/ui'
import { CSS_DE_LA_VISTA, TRAZOS_DE_LA_PAGINA, variablesDelColor } from './aspecto'
import { mover, problemaDeContacto } from './reglas'

/** Lo que el editor le presta a la vista para que se pueda tocar. Sin esto, la vista es de solo lectura. */
export interface EdicionDeLaVista {
  cambiar: (cambio: (previo: ContenidoDeMiLink) => ContenidoDeMiLink) => void
  /** null = uno nuevo. */
  editarContacto: (indice: number | null) => void
  agregarCobertura: () => void
  editarCobertura: (indice: number) => void
  /** null = uno nuevo. */
  editarLink: (indice: number | null) => void
}

interface PropsVistaPrevia {
  contenido: ContenidoDeMiLink
  /** La foto del perfil (data URL) si la página la usa y la persona tiene una; si no, van las iniciales. */
  foto: string | null
  edicion?: EdicionDeLaVista
  className?: string
}

// La hoja se pone UNA vez en el documento y no una por vista: el panel dibuja ocho miniaturas y cada
// una con su `<style>` serían ocho copias de lo mismo que el navegador tiene que volver a mirar. Va en
// un efecto de layout para que esté puesta antes del primer dibujo y la página no aparezca un instante
// sin estilos.
const ID_DE_LA_HOJA = 'mi-link-vista-previa'

function useHojaDeLaVista(): void {
  useLayoutEffect(() => {
    if (document.getElementById(ID_DE_LA_HOJA)) return
    const hoja = document.createElement('style')
    hoja.id = ID_DE_LA_HOJA
    hoja.textContent = CSS_DE_LA_VISTA
    document.head.appendChild(hoja)
    // No se saca al desmontar: la usan varias vistas a la vez, y volver a la pantalla la necesita igual.
  }, [])
}

/** Un ícono de la página pública. Afuera de `.mlv` (los diálogos) el tamaño lo pone `className`. */
export function IconoDeLaPagina({ nombre, chico = false, className }: { nombre: string; chico?: boolean; className?: string }) {
  return (
    <svg
      className={cx('mlv-icono', chico && 'mlv-icono-chico', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: TRAZOS_DE_LA_PAGINA[nombre] ?? TRAZOS_DE_LA_PAGINA.otro! }}
    />
  )
}

/**
 * Un texto de la página que se escribe en el lugar. Es un `textarea` de un renglón que crece con el
 * texto (field-sizing en aspecto.ts) en vez de un `input`: el nombre largo o la línea sobre vos se
 * cortan en dos renglones en la página, y acá tienen que cortarse igual.
 */
function TextoEnLugar({
  valor,
  alCambiar,
  maximo,
  placeholder,
  etiqueta,
  multilinea = false,
}: {
  valor: string
  alCambiar: (valor: string) => void
  maximo: number
  placeholder: string
  etiqueta: string
  multilinea?: boolean
}) {
  const alTeclear = (evento: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter termina (como en un título); sólo la descripción admite saltos, y la página igual los junta.
    if (evento.key === 'Enter' && !multilinea) {
      evento.preventDefault()
      evento.currentTarget.blur()
    }
    if (evento.key === 'Escape') evento.currentTarget.blur()
  }
  return (
    <textarea
      rows={1}
      className="mlv-editable"
      value={valor}
      maxLength={maximo}
      placeholder={placeholder}
      aria-label={etiqueta}
      spellCheck
      onChange={(evento) => alCambiar(multilinea ? evento.target.value : evento.target.value.replace(/\r?\n/g, ' '))}
      onKeyDown={alTeclear}
    />
  )
}

/** La barrita de cada bloque. Aparece al pasar el mouse o al llegar con el teclado (`focus-within`). */
function Acciones({
  que,
  alEditar,
  alMover,
  alBorrar,
  indice,
  total,
  textoBorrar = 'Borrar',
}: {
  que: string
  alEditar?: () => void
  alMover?: (delta: -1 | 1) => void
  alBorrar: () => void
  indice?: number
  total?: number
  textoBorrar?: string
}) {
  return (
    <div className="mlv-acciones" role="toolbar" aria-label={`Acciones de ${que}`}>
      {alEditar && (
        <button type="button" className="mlv-accion" title="Editar" aria-label={`Editar ${que}`} onClick={alEditar}>
          <Icono nombre="lapiz" tamano={14} />
        </button>
      )}
      {alMover && indice !== undefined && total !== undefined && (
        <>
          <button
            type="button"
            className="mlv-accion"
            title="Subir"
            aria-label={`Subir ${que}`}
            disabled={indice === 0}
            onClick={() => alMover(-1)}
          >
            <Icono nombre="flechaAbajo" tamano={14} className="rotate-180" />
          </button>
          <button
            type="button"
            className="mlv-accion"
            title="Bajar"
            aria-label={`Bajar ${que}`}
            disabled={indice === total - 1}
            onClick={() => alMover(1)}
          >
            <Icono nombre="flechaAbajo" tamano={14} />
          </button>
        </>
      )}
      <button type="button" className="mlv-accion mlv-accion-borrar" title={textoBorrar} aria-label={`${textoBorrar} ${que}`} onClick={alBorrar}>
        <Icono nombre="basura" tamano={14} />
      </button>
    </div>
  )
}

function BotonAgregar({ texto, alTocar, lleno, maximo }: { texto: string; alTocar: () => void; lleno: boolean; maximo: number }) {
  return (
    <button type="button" className="mlv-agregar" onClick={alTocar} disabled={lleno} title={lleno ? `Puede haber hasta ${maximo}.` : undefined}>
      <Icono nombre="mas" tamano={16} />
      {lleno ? `Llegaste al máximo (${maximo})` : texto}
    </button>
  )
}

export function VistaPrevia({ contenido, foto, edicion, className }: PropsVistaPrevia) {
  useHojaDeLaVista()
  const { diseno } = contenido
  const nombreVisible = contenido.nombre.trim() || 'Tu nombre'
  const iniciales = obtenerIniciales(nombreVisible)
  const editable = Boolean(edicion)
  const cambiar = edicion?.cambiar ?? (() => {})

  const decorado =
    diseno.fondo === 'iniciales' ? (
      <div className="mlv-decorado" aria-hidden="true">
        <span className="mlv-marca-de-agua">{iniciales}</span>
      </div>
    ) : diseno.fondo === 'franja' || diseno.fondo === 'degradado' ? (
      <div className="mlv-decorado" aria-hidden="true" />
    ) : null

  const hayContacto = contenido.contacto.length > 0
  const hayCoberturas = contenido.coberturas.length > 0
  const hayLinks = contenido.links.length > 0

  return (
    <div className={cx('mlv', `mlv-estilo-${diseno.estilo}`, `mlv-fondo-${diseno.fondo}`, className)} style={variablesDelColor(diseno.color)}>
      <div className="mlv-pagina">
        <header className="mlv-cabecera">
          {decorado}
          <div className="mlv-avatar">{foto ? <img src={foto} alt="" /> : <span aria-hidden="true">{iniciales}</span>}</div>
          <h1 className="mlv-nombre">
            {edicion ? (
              <TextoEnLugar
                valor={contenido.nombre}
                alCambiar={(nombre) => cambiar((previo) => ({ ...previo, nombre }))}
                maximo={LIMITES_DE_MI_LINK.nombre}
                placeholder="Tu nombre"
                etiqueta="Tu nombre"
              />
            ) : (
              nombreVisible
            )}
          </h1>
          {edicion ? (
            <p className="mlv-bio">
              <TextoEnLugar
                valor={contenido.bio}
                alCambiar={(bio) => cambiar((previo) => ({ ...previo, bio }))}
                maximo={LIMITES_DE_MI_LINK.bio}
                placeholder="Escribí una línea sobre vos"
                etiqueta="Una línea sobre vos"
              />
            </p>
          ) : (
            contenido.bio.trim() && <p className="mlv-bio">{contenido.bio}</p>
          )}
        </header>

        {(hayContacto || editable) && (
          <section className="mlv-seccion" aria-label="Contacto">
            {hayContacto && (
              <ul className="mlv-contactos">
                {contenido.contacto.map((bloque, indice) => {
                  const nombre = NOMBRE_TIPO_DE_CONTACTO[bloque.tipo]
                  // El servidor guarda un contacto que no sirve para armar un link pero no lo muestra:
                  // se avisa acá, donde se ve y se puede corregir.
                  const problema = editable ? problemaDeContacto(bloque.tipo, bloque.valor) : null
                  return (
                    <li key={bloque.id} className="mlv-bloque">
                      <div className="mlv-contacto">
                        <span className="mlv-contacto-icono">
                          <IconoDeLaPagina nombre={bloque.tipo} />
                        </span>
                        <span className="mlv-contacto-texto">
                          <span className="mlv-contacto-tipo">{nombre}</span>
                          <span className="mlv-contacto-valor">{bloque.valor}</span>
                          {problema && (
                            <span className="mlv-aviso" title={problema}>
                              No se va a ver
                            </span>
                          )}
                        </span>
                      </div>
                      {edicion && (
                        <Acciones
                          que={`el contacto ${nombre}`}
                          alEditar={() => edicion.editarContacto(indice)}
                          alMover={(delta) => cambiar((previo) => ({ ...previo, contacto: mover(previo.contacto, indice, delta) }))}
                          alBorrar={() => cambiar((previo) => ({ ...previo, contacto: previo.contacto.filter((_, i) => i !== indice) }))}
                          indice={indice}
                          total={contenido.contacto.length}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {edicion && (
              <BotonAgregar
                texto="Agregar en Contacto"
                alTocar={() => edicion.editarContacto(null)}
                lleno={contenido.contacto.length >= LIMITES_DE_MI_LINK.contactos}
                maximo={LIMITES_DE_MI_LINK.contactos}
              />
            )}
          </section>
        )}

        {(hayCoberturas || editable) && (
          <section className="mlv-seccion" aria-label="Coberturas">
            <h2 className="mlv-titulo-seccion">¿Qué necesitás asegurar?</h2>
            {hayCoberturas ? (
              <ul className="mlv-coberturas">
                {contenido.coberturas.map((bloque, indice) => {
                  const accion = coberturaCotizaVehiculo(bloque.tipo) ? 'Cotizar' : 'Pedir presupuesto'
                  const cambiarBloque = (cambios: Partial<typeof bloque>) =>
                    cambiar((previo) => ({
                      ...previo,
                      coberturas: previo.coberturas.map((otro, i) => (i === indice ? { ...otro, ...cambios } : otro)),
                    }))
                  return (
                    <li key={bloque.id} className="mlv-bloque">
                      <div className="mlv-cobertura">
                        <span className="mlv-cobertura-icono">
                          <IconoDeLaPagina nombre={bloque.tipo} />
                        </span>
                        <span className="mlv-cobertura-texto">
                          <span className="mlv-cobertura-titulo">
                            {edicion ? (
                              <TextoEnLugar
                                valor={bloque.titulo}
                                alCambiar={(titulo) => cambiarBloque({ titulo })}
                                maximo={LIMITES_DE_MI_LINK.tituloDeCobertura}
                                placeholder="Título"
                                etiqueta={`Título de la cobertura ${indice + 1}`}
                              />
                            ) : (
                              bloque.titulo
                            )}
                          </span>
                          {edicion ? (
                            <span className="mlv-cobertura-descripcion">
                              <TextoEnLugar
                                valor={bloque.descripcion}
                                alCambiar={(descripcion) => cambiarBloque({ descripcion })}
                                maximo={LIMITES_DE_MI_LINK.descripcionDeCobertura}
                                placeholder="Una descripción corta (opcional)"
                                etiqueta={`Descripción de la cobertura ${indice + 1}`}
                                multilinea
                              />
                            </span>
                          ) : (
                            bloque.descripcion.trim() && <span className="mlv-cobertura-descripcion">{bloque.descripcion}</span>
                          )}
                        </span>
                        <span className="mlv-cobertura-accion">
                          <span className="mlv-cobertura-accion-texto">{accion}</span>
                          <IconoDeLaPagina nombre="flecha" chico />
                        </span>
                      </div>
                      {edicion && (
                        <Acciones
                          que={`la cobertura ${bloque.titulo || indice + 1}`}
                          alEditar={() => edicion.editarCobertura(indice)}
                          alMover={(delta) => cambiar((previo) => ({ ...previo, coberturas: mover(previo.coberturas, indice, delta) }))}
                          alBorrar={() => cambiar((previo) => ({ ...previo, coberturas: previo.coberturas.filter((_, i) => i !== indice) }))}
                          indice={indice}
                          total={contenido.coberturas.length}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mlv-vacio">Sin coberturas, la página no muestra esta parte.</p>
            )}
            {edicion && (
              <BotonAgregar
                texto="Agregar en Tus seguros"
                alTocar={edicion.agregarCobertura}
                lleno={contenido.coberturas.length >= LIMITES_DE_MI_LINK.coberturas}
                maximo={LIMITES_DE_MI_LINK.coberturas}
              />
            )}
          </section>
        )}

        {(hayLinks || editable) && (
          <section className="mlv-seccion" aria-label="Mis links">
            <h2 className="mlv-titulo-seccion">Mis links</h2>
            {hayLinks ? (
              <ul className="mlv-links">
                {contenido.links.map((bloque, indice) => (
                  <li key={bloque.id} className="mlv-bloque">
                    <div className="mlv-link" title={bloque.url}>
                      <IconoDeLaPagina nombre="link" className="mlv-link-icono" />
                      <span className="mlv-link-titulo">{bloque.titulo}</span>
                      <IconoDeLaPagina nombre="flecha" chico className="mlv-link-flecha" />
                    </div>
                    {edicion && (
                      <Acciones
                        que={`el link ${bloque.titulo}`}
                        alEditar={() => edicion.editarLink(indice)}
                        alMover={(delta) => cambiar((previo) => ({ ...previo, links: mover(previo.links, indice, delta) }))}
                        alBorrar={() => cambiar((previo) => ({ ...previo, links: previo.links.filter((_, i) => i !== indice) }))}
                        indice={indice}
                        total={contenido.links.length}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mlv-vacio">Tu web, tu agenda, una nota tuya: lo que quieras que tengan a mano.</p>
            )}
            {edicion && (
              <BotonAgregar
                texto="Agregar en Tus links"
                alTocar={() => edicion.editarLink(null)}
                lleno={contenido.links.length >= LIMITES_DE_MI_LINK.links}
                maximo={LIMITES_DE_MI_LINK.links}
              />
            )}
          </section>
        )}

        {contenido.siniestros && (
          <section className="mlv-seccion" aria-label="Siniestros">
            <div className="mlv-bloque">
              <div className="mlv-siniestro">
                <span className="mlv-siniestro-icono">
                  <IconoDeLaPagina nombre="siniestro" />
                </span>
                <span className="mlv-siniestro-texto">
                  <span className="mlv-siniestro-titulo">Denunciar un siniestro</span>
                  <span className="mlv-siniestro-descripcion">Contame qué pasó y mandame las fotos.</span>
                </span>
                <IconoDeLaPagina nombre="flecha" chico />
              </div>
              {edicion && (
                <Acciones
                  que="el botón de siniestros"
                  textoBorrar="Sacar"
                  alBorrar={() => cambiar((previo) => ({ ...previo, siniestros: false }))}
                />
              )}
            </div>
          </section>
        )}

        <footer className="mlv-pie">
          <strong>Seguros Daniel Martínez</strong> · Productor asesor
        </footer>
      </div>
    </div>
  )
}
