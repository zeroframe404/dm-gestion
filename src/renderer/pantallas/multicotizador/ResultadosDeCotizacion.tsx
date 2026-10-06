// Lo que contestó cada compañía y la comparación entre todas.
//
// Arriba, una tarjeta por compañía: si cotizó, cuánto tardó, qué entendió del vehículo, y sus ajustes
// propios (plan comercial, forma de pago, la versión en su catálogo…) para cambiarlos sin volver a
// cargar nada. Abajo, todas las coberturas juntas, agrupadas por categoría —responsabilidad civil,
// terceros, todo riesgo— porque es la única forma de comparar compañías que nombran distinto lo mismo,
// con la más barata de cada categoría marcada.
import { useMemo, useState } from 'react'
import {
  CATEGORIAS_DE_COBERTURA,
  DETALLE_CATEGORIA_DE_COBERTURA,
  NOMBRE_CATEGORIA_DE_COBERTURA,
  claveDeCobertura,
  coberturasOrdenadas,
  enPesos,
  enPorcentaje,
  mejoresPorCategoria,
  type AjusteDeAseguradora,
  type AseguradoraDelMulticotizador,
  type CategoriaDeCobertura,
  type CoberturaCotizada,
  type IdAseguradora,
  type ResultadoDeAseguradora,
} from '../../../shared/multicotizador'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Etiqueta, Selector, Tarjeta, cx } from '../../componentes/ui'

export interface EstadoDeTarjeta {
  cotizando: boolean
  resultado: ResultadoDeAseguradora | null
  /** Lo que la persona eligió a mano en los ajustes de esta compañía. */
  elegidos: Record<string, string>
}

function segundos(ms: number): string {
  return `${(ms / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} s`
}

// ---------------------------------------------------------------------------
// La tarjeta de cada compañía
// ---------------------------------------------------------------------------

function EstadoDeLaCompania({ tarjeta }: { tarjeta: EstadoDeTarjeta }) {
  if (tarjeta.cotizando) {
    return (
      <Etiqueta tono="marca">
        <Icono nombre="cargando" tamano={12} className="mr-1 animate-spin" />
        Cotizando…
      </Etiqueta>
    )
  }
  const resultado = tarjeta.resultado
  if (!resultado) return <Etiqueta>Sin cotizar</Etiqueta>
  switch (resultado.estado) {
    case 'OK':
      return (
        <Etiqueta tono="exito">
          {resultado.coberturas.length} cobertura{resultado.coberturas.length === 1 ? '' : 's'} · {segundos(resultado.duracionMs)}
        </Etiqueta>
      )
    case 'FALTAN_DATOS':
      return <Etiqueta tono="aviso">Falta elegir algo</Etiqueta>
    case 'ERROR':
      return <Etiqueta tono="peligro">No se pudo cotizar</Etiqueta>
    default:
      return <Etiqueta>No aplica</Etiqueta>
  }
}

function Ajustes({ ajustes, alCambiar, deshabilitado }: { ajustes: AjusteDeAseguradora[]; alCambiar: (campo: string, valor: string) => void; deshabilitado: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {ajustes.map((ajuste) => {
        const falta = ajuste.obligatorio && !ajuste.valor
        return (
          <Selector
            key={ajuste.campo}
            etiqueta={ajuste.titulo}
            value={ajuste.valor}
            disabled={deshabilitado || ajuste.opciones.length === 0}
            onChange={(e) => alCambiar(ajuste.campo, e.target.value)}
            opciones={[
              { valor: '', texto: ajuste.opciones.length === 0 ? '—' : ajuste.obligatorio ? 'Elegí…' : 'Que decida la compañía' },
              ...ajuste.opciones,
            ]}
            error={falta ? (ajuste.ayuda ?? 'Hay que elegirlo para poder cotizar.') : null}
            ayuda={falta ? undefined : ajuste.ayuda}
          />
        )
      })}
    </div>
  )
}

function TarjetaDeCompania({
  aseguradora,
  tarjeta,
  alCambiarAjuste,
  alRecotizar,
}: {
  aseguradora: AseguradoraDelMulticotizador
  tarjeta: EstadoDeTarjeta
  alCambiarAjuste: (campo: string, valor: string) => void
  alRecotizar: () => void
}) {
  const resultado = tarjeta.resultado
  const faltan = resultado?.estado === 'FALTAN_DATOS'
  const [abierta, setAbierta] = useState(false)
  // Los ajustes comerciales —modo de facturación, cuotas, bonificación, cláusula de ajuste— van
  // siempre a la vista: son lo que define el precio y lo que se compara contra la web de la
  // compañía. Los técnicos (la versión en su catálogo, su código de localidad…) quedan detrás de
  // «Más ajustes», salvo que falte elegir uno.
  const comerciales = resultado?.ajustes.filter((ajuste) => ajuste.destacado) ?? []
  const tecnicos = resultado?.ajustes.filter((ajuste) => !ajuste.destacado) ?? []
  const faltaUnTecnico = tecnicos.some((ajuste) => ajuste.obligatorio && !ajuste.valor)
  const verTecnicos = (abierta || faltaUnTecnico) && tecnicos.length > 0
  const tecnicosAMano = Object.keys(tarjeta.elegidos).filter((campo) => tecnicos.some((ajuste) => ajuste.campo === campo)).length
  const [copiado, setCopiado] = useState(false)

  // El pedido exacto que recibió la API de la compañía y su respuesta: lo que hay que pasarle cuando
  // un precio no coincide con el de su web.
  const copiarDetalle = async () => {
    if (resultado?.detalleTecnico === undefined) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(resultado.detalleTecnico, null, 2))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2_000)
    } catch {
      /* sin portapapeles no hay nada más que hacer: el botón queda igual */
    }
  }

  return (
    <div className={cx('rounded-xl border bg-white px-4 py-3', faltan ? 'border-amber-300' : resultado?.estado === 'ERROR' ? 'border-red-200' : 'border-slate-200')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-base font-bold text-slate-900">{aseguradora.nombre}</span>
        <EstadoDeLaCompania tarjeta={tarjeta} />
        <div className="ml-auto flex items-center gap-2">
          {tecnicos.length > 0 && !faltaUnTecnico && (
            <Boton tamano="sm" variante="fantasma" icono={abierta ? 'flechaIzquierda' : 'desplegar'} onClick={() => setAbierta((previa) => !previa)}>
              {comerciales.length > 0 ? 'Más ajustes' : 'Ajustes'} de {aseguradora.nombre}
              {tecnicosAMano > 0 ? ` (${tecnicosAMano} a mano)` : ''}
            </Boton>
          )}
          {resultado?.estado === 'OK' && resultado.detalleTecnico !== undefined && (
            <Boton
              tamano="sm"
              variante="fantasma"
              onClick={() => void copiarDetalle()}
              title={`Copia el pedido exacto que recibió la API de ${aseguradora.nombre} y su respuesta, para mandárselo a la compañía`}
            >
              {copiado ? 'Copiado' : `Copiar datos para ${aseguradora.nombre}`}
            </Boton>
          )}
          {resultado && (
            <Boton tamano="sm" icono="refrescar" onClick={alRecotizar} disabled={tarjeta.cotizando}>
              Volver a cotizar
            </Boton>
          )}
        </div>
      </div>

      {resultado?.mensaje && (
        <p className={cx('mt-2 text-sm', resultado.estado === 'ERROR' ? 'text-red-700' : resultado.estado === 'FALTAN_DATOS' ? 'text-amber-800' : 'text-slate-600')}>
          {resultado.mensaje}
        </p>
      )}
      {resultado?.descripcionVehiculo && (
        <p className="mt-1 text-xs text-slate-500">
          {aseguradora.nombre} lo cotizó como: <span className="font-medium text-slate-700">{resultado.descripcionVehiculo}</span>
        </p>
      )}
      {resultado && resultado.avisos.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
          {resultado.avisos.map((aviso, indice) => (
            // eslint-disable-next-line react/no-array-index-key -- son avisos sueltos, sin id propio.
            <li key={indice}>{aviso}</li>
          ))}
        </ul>
      )}

      {resultado && comerciales.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-3 text-xs text-slate-500">
            Cómo se factura y qué descuentos se aplican. Para que el precio dé igual que en la web de {aseguradora.nombre}, usá lo mismo que ahí;
            cambiar cualquiera vuelve a cotizar sólo en {aseguradora.nombre} y se recuerda en esta computadora.
          </p>
          <Ajustes ajustes={comerciales} alCambiar={alCambiarAjuste} deshabilitado={tarjeta.cotizando} />
        </div>
      )}
      {verTecnicos && resultado && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-3 text-xs text-slate-500">
            {faltaUnTecnico
              ? `${aseguradora.nombre} no pudo decidir sola lo marcado en rojo. Al elegirlo se vuelve a cotizar.`
              : `Lo que ${aseguradora.nombre} eligió sola para cotizar. Cambiar cualquiera vuelve a cotizar sólo en ${aseguradora.nombre}.`}
          </p>
          <Ajustes ajustes={tecnicos} alCambiar={alCambiarAjuste} deshabilitado={tarjeta.cotizando} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// El comparativo
// ---------------------------------------------------------------------------

function Comparativo({
  resultados,
  seleccionadas,
  alAlternar,
  veComision,
  puedeEmitir,
  alEmitir,
}: {
  resultados: ResultadoDeAseguradora[]
  seleccionadas: Set<string>
  alAlternar: (clave: string) => void
  veComision: boolean
  puedeEmitir: boolean
  alEmitir: (cobertura: CoberturaCotizada) => void
}) {
  const [filtro, setFiltro] = useState<CategoriaDeCobertura | 'TODAS'>('TODAS')
  const ordenadas = useMemo(() => coberturasOrdenadas(resultados), [resultados])
  const mejores = useMemo(() => mejoresPorCategoria(resultados), [resultados])
  const companias = new Set(resultados.filter((r) => r.coberturas.length > 0).map((r) => r.aseguradora)).size

  if (ordenadas.length === 0) return null

  const presentes = CATEGORIAS_DE_COBERTURA.filter((categoria) => ordenadas.some((c) => c.categoria === categoria))
  const visibles = filtro === 'TODAS' ? presentes : presentes.filter((categoria) => categoria === filtro)
  const columnas = veComision ? 8 : 7

  return (
    <Tarjeta
      titulo="Comparativo"
      descripcion={
        companias > 1
          ? `${ordenadas.length} coberturas de ${companias} compañías, agrupadas por lo que cubren y de la más barata a la más cara.`
          : `${ordenadas.length} coberturas, agrupadas por lo que cubren y de la más barata a la más cara. Con más compañías cargadas, acá se comparan todas juntas.`
      }
      alRas
    >
      {/* Lo más barato de cada categoría, de un vistazo: es lo primero que pregunta el cliente. */}
      <div className="grid gap-3 px-6 pb-4 sm:grid-cols-2 xl:grid-cols-5">
        {presentes
          .filter((categoria) => mejores.has(categoria))
          .map((categoria) => {
            const mejor = mejores.get(categoria)!
            return (
              <button
                key={categoria}
                type="button"
                onClick={() => setFiltro((previo) => (previo === categoria ? 'TODAS' : categoria))}
                className={cx(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  filtro === categoria ? 'border-marino-500 bg-marino-50' : 'border-slate-200 hover:border-marino-300 hover:bg-marino-50',
                )}
                title={DETALLE_CATEGORIA_DE_COBERTURA[categoria]}
              >
                <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">{NOMBRE_CATEGORIA_DE_COBERTURA[categoria]}</span>
                <span className="block font-display text-lg font-extrabold tabular-nums text-slate-900">{enPesos(mejor.premio)}</span>
                <span className="block truncate text-xs text-slate-600">
                  {mejor.nombreAseguradora} · {mejor.nombre}
                </span>
              </button>
            )
          })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-6 py-3">
        {(['TODAS', ...presentes] as const).map((opcion) => {
          const cuantas = opcion === 'TODAS' ? ordenadas.length : ordenadas.filter((c) => c.categoria === opcion).length
          return (
            <button
              key={opcion}
              type="button"
              aria-pressed={filtro === opcion}
              onClick={() => setFiltro(opcion)}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                filtro === opcion ? 'border-marino-600 bg-marino-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-marino-300',
              )}
            >
              {opcion === 'TODAS' ? 'Todas' : NOMBRE_CATEGORIA_DE_COBERTURA[opcion]} ({cuantas})
            </button>
          )
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="w-10 px-4 py-2" aria-label="Elegir" />
              <th className="px-3 py-2 font-semibold">Compañía</th>
              <th className="px-3 py-2 font-semibold">Cobertura</th>
              <th className="px-3 py-2 font-semibold">Franquicia y adicionales</th>
              <th className="px-3 py-2 text-right font-semibold">Cuota</th>
              <th className="px-3 py-2 text-right font-semibold">Premio total</th>
              {veComision && <th className="px-3 py-2 text-right font-semibold">Comisión</th>}
              <th className="px-4 py-2" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((categoria) => {
              const deLaCategoria = ordenadas.filter((c) => c.categoria === categoria)
              const mejor = mejores.get(categoria)
              return [
                <tr key={`titulo-${categoria}`} className="border-t border-slate-200 bg-slate-50/60">
                  <td colSpan={columnas} className="px-4 py-2">
                    <span className="font-semibold text-slate-800">{NOMBRE_CATEGORIA_DE_COBERTURA[categoria]}</span>
                    <span className="ml-2 text-xs text-slate-500">{DETALLE_CATEGORIA_DE_COBERTURA[categoria]}</span>
                  </td>
                </tr>,
                ...deLaCategoria.map((cobertura) => {
                  const clave = claveDeCobertura(cobertura)
                  const elegida = seleccionadas.has(clave)
                  const esLaMejor = mejor !== undefined && claveDeCobertura(mejor) === clave
                  return (
                    <tr key={clave} className={cx('border-t border-slate-100', elegida && 'bg-marino-50/40')}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={elegida} onChange={() => alAlternar(clave)} aria-label={`Elegir ${cobertura.nombre} de ${cobertura.nombreAseguradora}`} />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-800">{cobertura.nombreAseguradora}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">{cobertura.nombre}</span>
                          {esLaMejor && <Etiqueta tono="exito">Más barata</Etiqueta>}
                        </div>
                        <span className="text-xs text-slate-400">
                          {cobertura.codigo}
                          {/* Las dos columnas que la web de Galeno muestra al lado de cada precio: con eso se compara fila por fila. */}
                          {typeof cobertura.bonificacionPorcentaje === 'number' && ` · Bonif. ${enPorcentaje(cobertura.bonificacionPorcentaje)}`}
                          {typeof cobertura.recargoAdministrativoPorcentaje === 'number' && ` · RA ${enPorcentaje(cobertura.recargoAdministrativoPorcentaje)}`}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        {cobertura.franquicia && <div>Franquicia: {cobertura.franquicia}</div>}
                        {cobertura.adicionales.length > 0 && <div>{cobertura.adicionales.join(' · ')}</div>}
                        {!cobertura.franquicia && cobertura.adicionales.length === 0 && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {cobertura.cuota !== null ? enPesos(cobertura.cuota) : '—'}
                        {cobertura.primeraCuota !== null && cobertura.primeraCuota !== cobertura.cuota && (
                          <div className="text-xs text-slate-400">1ª: {enPesos(cobertura.primeraCuota)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                        {cobertura.premio > 0 ? enPesos(cobertura.premio) : <span className="font-normal text-slate-400">Sin precio</span>}
                      </td>
                      {veComision && (
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{cobertura.comision !== null ? enPesos(cobertura.comision) : '—'}</td>
                      )}
                      <td className="px-4 py-2.5 text-right">
                        {puedeEmitir && cobertura.emision && (
                          <Boton tamano="sm" onClick={() => alEmitir(cobertura)}>
                            Emitir…
                          </Boton>
                        )}
                      </td>
                    </tr>
                  )
                }),
              ]
            })}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  )
}

// ---------------------------------------------------------------------------
// Todo junto
// ---------------------------------------------------------------------------

interface Props {
  aseguradoras: AseguradoraDelMulticotizador[]
  tarjetas: Record<IdAseguradora, EstadoDeTarjeta>
  alCambiarAjuste: (aseguradora: IdAseguradora, campo: string, valor: string) => void
  alRecotizar: (aseguradora: IdAseguradora) => void
  seleccionadas: Set<string>
  alAlternar: (clave: string) => void
  veComision: boolean
  puedeEmitir: boolean
  alEmitir: (cobertura: CoberturaCotizada) => void
  desactualizada: boolean
}

export function ResultadosDeCotizacion({
  aseguradoras,
  tarjetas,
  alCambiarAjuste,
  alRecotizar,
  seleccionadas,
  alAlternar,
  veComision,
  puedeEmitir,
  alEmitir,
  desactualizada,
}: Props) {
  const conTarjeta = aseguradoras.filter((aseguradora) => tarjetas[aseguradora.id])
  const resultados = conTarjeta
    .map((aseguradora) => tarjetas[aseguradora.id]!.resultado)
    .filter((resultado): resultado is ResultadoDeAseguradora => resultado !== null)
  if (conTarjeta.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {desactualizada && (
        <Alerta tono="aviso">Cambiaste datos desde la última cotización: los precios de abajo son de antes. Volvé a cotizar para actualizarlos.</Alerta>
      )}
      <div className="flex flex-col gap-3">
        {conTarjeta.map((aseguradora) => (
          <TarjetaDeCompania
            key={aseguradora.id}
            aseguradora={aseguradora}
            tarjeta={tarjetas[aseguradora.id]!}
            alCambiarAjuste={(campo, valor) => alCambiarAjuste(aseguradora.id, campo, valor)}
            alRecotizar={() => alRecotizar(aseguradora.id)}
          />
        ))}
      </div>
      <Comparativo
        resultados={resultados}
        seleccionadas={seleccionadas}
        alAlternar={alAlternar}
        veComision={veComision}
        puedeEmitir={puedeEmitir}
        alEmitir={alEmitir}
      />
    </div>
  )
}
