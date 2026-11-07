// Los gráficos de UNA sucursal, que se abren desde su tarjeta del podio de Inicio. Son los de Métricas
// (evolución, altas y bajas, activos por compañía, bajas por motivo, siniestros) filtrados por esa
// sucursal, más la morosidad del mes. Los ve cualquiera que vea el podio, así que sólo hay cantidades:
// el canal que los trae (`metricas:panelDeSucursal`) no manda nada más.
import { useEffect, useState } from 'react'
import { campoDeRama } from '../../../shared/riesgos'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { NOMBRE_RAMA_DE_METRICA, RAMAS_DE_METRICA, type PanelDeSucursal, type RamaDeMetrica } from '../../../shared/tipos'
import { Boton, Cargando, Dialogo, Tarjeta } from '../../componentes/ui'
import { GraficoDeBarras, GraficoDeLinea, mesCorto, numero, Ranking, TarjetaGrande } from './graficos'

const COLOR_DE_RAMA: Record<RamaDeMetrica, string> = {
  AUTOS_MOTOS: '#0f766e',
  RIESGOS_VARIOS: '#d97706',
}

/** El porcentaje de cuotas del mes que siguen sin pagar. Null si el mes no tiene cuotas: no hay nada que medir. */
function porcentajeDeMora(panel: PanelDeSucursal): number | null {
  const total = panel.cuotasCobradas + panel.cuotasPendientes
  if (total === 0) return null
  return Math.round((panel.cuotasPendientes / total) * 1000) / 10
}

export function GraficosDeSucursal({ periodo, sucursal, alCerrar }: { periodo: string; sucursal: string; alCerrar: () => void }) {
  const [panel, setPanel] = useState<PanelDeSucursal | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    setPanel(null)
    setError(null)
    void window.dm.metricas.panelDeSucursal(periodo, sucursal).then((resultado) => {
      if (!vigente) return
      if (resultado.ok) setPanel(resultado.datos)
      else setError(resultado.error)
    })
    return () => {
      vigente = false
    }
  }, [periodo, sucursal])

  return (
    <Dialogo
      abierto
      alCerrar={alCerrar}
      ancho="xl"
      titulo={`${sucursal} · ${mesCorto(periodo)}`}
      descripcion={`Cómo viene ${sucursal} en ${nombreDePeriodo(periodo).toLowerCase()}: pólizas, altas, bajas, cuotas y siniestros.`}
      pie={<Boton onClick={alCerrar}>Cerrar</Boton>}
    >
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && panel === null && <Cargando texto="Armando los gráficos…" />}
      {!error && panel !== null && <Contenido panel={panel} />}
    </Dialogo>
  )
}

function Contenido({ panel }: { panel: PanelDeSucursal }) {
  const mora = porcentajeDeMora(panel)
  const totalDeCuotas = panel.cuotasCobradas + panel.cuotasPendientes
  // La separación por rama sólo si la traen TODOS los meses (mismo criterio que el tablero de Métricas).
  const mesesConRama = panel.evolucion.flatMap((mes) => (mes.porRama ? [mes.porRama] : []))
  const evolucionPorRama = mesesConRama.length > 0 && mesesConRama.length === panel.evolucion.length ? mesesConRama : null

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaGrande
          etiqueta="Seguros activos"
          valor={numero(panel.activos)}
          tono="marca"
          desglose={panel.porRama && { autosMotos: panel.porRama.autosMotos.activos, riesgosVarios: panel.porRama.riesgosVarios.activos }}
        />
        <TarjetaGrande
          etiqueta="Altas del mes"
          valor={panel.altas === null ? '—' : numero(panel.altas)}
          detalle={panel.altas === null ? 'Sin mes anterior cargado no se pueden deducir' : undefined}
          tono="exito"
          desglose={panel.porRama && { autosMotos: panel.porRama.autosMotos.altas, riesgosVarios: panel.porRama.riesgosVarios.altas }}
        />
        <TarjetaGrande
          etiqueta="Bajas del mes"
          valor={numero(panel.bajas)}
          tono="peligro"
          desglose={panel.porRama && { autosMotos: panel.porRama.autosMotos.bajas, riesgosVarios: panel.porRama.riesgosVarios.bajas }}
        />
        <TarjetaGrande
          etiqueta="Morosidad"
          valor={mora === null ? '—' : `${mora.toLocaleString('es-AR')} %`}
          detalle={
            totalDeCuotas === 0
              ? 'Este mes no tiene cuotas cargadas'
              : `${numero(panel.cuotasPendientes)} cuota(s) impaga(s) de ${numero(totalDeCuotas)} del mes`
          }
          tono={mora !== null && mora > 0 ? 'peligro' : 'neutro'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Tarjeta titulo="Evolución de la cartera" descripcion="Seguros activos mes a mes, hasta doce meses hacia atrás.">
          <GraficoDeLinea
            titulo={`Seguros activos por mes de ${panel.sucursal}`}
            puntos={panel.evolucion.map((mes) => ({ periodo: mes.periodo, valor: mes.activos }))}
            series={
              evolucionPorRama
                ? RAMAS_DE_METRICA.map((rama) => ({
                    nombre: NOMBRE_RAMA_DE_METRICA[rama],
                    color: COLOR_DE_RAMA[rama],
                    valores: evolucionPorRama.map((porRama) => porRama[campoDeRama(rama)].activos),
                  }))
                : undefined
            }
          />
        </Tarjeta>

        <Tarjeta titulo="Altas y bajas por mes" descripcion="Lo que entró y lo que se fue, mes a mes.">
          <GraficoDeBarras
            titulo={`Altas y bajas por mes de ${panel.sucursal}`}
            nombrePrimera="Altas"
            nombreSegunda="Bajas"
            meses={panel.evolucion.map((mes) => ({
              periodo: mes.periodo,
              primera: mes.altas ?? 0,
              segunda: mes.bajas,
              ...(evolucionPorRama && mes.porRama
                ? { riesgosVarios: { primera: mes.altas === null ? 0 : (mes.porRama.riesgosVarios.altas ?? 0), segunda: mes.porRama.riesgosVarios.bajas } }
                : {}),
            }))}
          />
        </Tarjeta>

        <Tarjeta titulo="Seguros activos por compañía" descripcion={`Cantidad y porcentaje sobre ${numero(panel.activos)} pólizas.`}>
          <Ranking filas={panel.activosPorCompania} vacio="No hay pólizas en la planilla de este mes." />
        </Tarjeta>

        <Tarjeta titulo="Bajas del mes por motivo" descripcion="Por qué se fueron, en sus propias palabras.">
          <Ranking
            filas={panel.bajasPorMotivo.map((fila) => ({ etiqueta: fila.motivo, cantidad: fila.cantidad }))}
            conPorcentaje={false}
            vacio={`No hubo bajas en ${nombreDePeriodo(panel.periodo)}.`}
          />
        </Tarjeta>

        <Tarjeta titulo="Cuotas del mes" descripcion="Cuántas se cobraron y cuántas siguen impagas.">
          <Ranking
            filas={
              totalDeCuotas === 0
                ? []
                : [
                    { etiqueta: 'Cobradas', cantidad: panel.cuotasCobradas },
                    { etiqueta: 'Impagas', cantidad: panel.cuotasPendientes },
                  ]
            }
            conPorcentaje={false}
            vacio="Este mes no tiene cuotas cargadas."
          />
        </Tarjeta>

        <Tarjeta
          titulo="Siniestros abiertos por compañía"
          descripcion={`${numero(panel.siniestrosAbiertos)} trámite(s) sin cerrar, sin importar de qué mes son.`}
        >
          <Ranking filas={panel.siniestrosPorCompania} vacio="No hay siniestros abiertos." />
        </Tarjeta>
      </div>
    </div>
  )
}
