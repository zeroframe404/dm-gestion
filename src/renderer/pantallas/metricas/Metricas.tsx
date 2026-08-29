// Módulo Métricas: el tablero de la agencia. Es el equivalente de las pestañas SEGUROS ACT y CONTADOR
// de la hoja, pero calculado solo y sin fórmulas que se rompan al arrastrar una fila.
//
// Arriba, las tarjetas grandes con los números del mes; abajo, cuatro gráficos y las tres listas que
// no son un gráfico sino una lista (bajas por motivo, cobranza por medio, siniestros por compañía).
import { useCallback, useEffect, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import type { TableroMetricas } from '../../../shared/tipos'
import { Alerta, Cargando, Tarjeta } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { pesos, pesosRedondos } from '../cobranzas/formato'
import { GraficoDeBarras, GraficoDeLinea, numero, Ranking, TarjetaGrande } from './graficos'

export function Metricas() {
  const [datos, setDatos] = useState<TableroMetricas | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async (periodo: string | null, sucursal: string) => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.metricas.tablero({ periodo, sucursal })
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(null, '')
  }, [cargar])

  if (cargando && !datos) return <Cargando texto="Calculando las métricas…" />
  if (!datos) {
    return (
      <div className="p-8">
        <Alerta tono="error">{error ?? 'No se pudieron calcular las métricas.'}</Alerta>
      </div>
    )
  }

  const alcance = datos.sucursal ? `${nombreDePeriodo(datos.periodo)} · ${datos.sucursal}` : nombreDePeriodo(datos.periodo)
  const seleccion = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select
            value={datos.periodo}
            onChange={(evento) => void cargar(evento.target.value, datos.sucursal)}
            className={`ml-2 ${seleccion}`}
          >
            {datos.periodos.length === 0 && <option value={datos.periodo}>{nombreDePeriodo(datos.periodo)}</option>}
            {datos.periodos.map((periodo) => (
              <option key={periodo} value={periodo}>
                {nombreDePeriodo(periodo)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Sucursal
          <select
            value={datos.sucursal}
            onChange={(evento) => void cargar(datos.periodo, evento.target.value)}
            className={`ml-2 ${seleccion}`}
          >
            <option value="">Todas</option>
            {datos.sucursales.map((sucursal) => (
              <option key={sucursal} value={sucursal}>
                {sucursal}
              </option>
            ))}
          </select>
        </label>
        {cargando && <span className="text-xs text-slate-500">Actualizando…</span>}
        <BotonAyuda clave="metricas" className="ml-auto" />
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {!datos.hayMesAnterior && (
        <Alerta tono="info">
          Las altas se cuentan comparando contra el mes anterior, y de {nombreDePeriodo(datos.periodo)} no hay mes anterior cargado:
          por eso van en cero. En cuanto se importe el mes previo aparecen solas.
        </Alerta>
      )}

      <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <TarjetaGrande
          etiqueta="Seguros activos"
          valor={numero(datos.activos)}
          detalle={`Filas de la planilla de ${alcance}`}
          tono="marca"
        />
        <TarjetaGrande etiqueta="Altas del mes" valor={numero(datos.altas)} detalle="Están este mes y no estaban el anterior" tono="exito" />
        <TarjetaGrande etiqueta="Bajas del mes" valor={numero(datos.bajas)} detalle={resumenDeMotivos(datos)} tono="peligro" />
        {/* Las dos de plata sólo para quien ve los números de la agencia. Cuando no, en su lugar va la
            CANTIDAD de cuotas, que es lo mismo en términos de trabajo hecho y por hacer, y es lo que
            de verdad necesita el mostrador. Una tarjeta con un guion invitaría a preguntar por qué. */}
        {datos.cobranza.cobrado !== null ? (
          <TarjetaGrande
            etiqueta="Cobrado en el mes"
            valor={pesosRedondos(datos.cobranza.cobrado)}
            detalle={`${numero(datos.cobranza.cuotasCobradas)} cuota(s) cobrada(s)`}
          />
        ) : (
          <TarjetaGrande
            etiqueta="Cuotas cobradas"
            valor={numero(datos.cobranza.cuotasCobradas)}
            detalle={`De ${numero(datos.cobranza.cuotasCobradas + datos.cobranza.cuotasPendientes)} del mes`}
            tono="exito"
          />
        )}
        {datos.cobranza.pendiente !== null ? (
          <TarjetaGrande
            etiqueta="Pendiente de cobro"
            valor={pesosRedondos(datos.cobranza.pendiente)}
            detalle={
              datos.cobranza.sinImporte > 0
                ? `${numero(datos.cobranza.cuotasPendientes)} impaga(s) · ${numero(datos.cobranza.sinImporte)} sin importe numérico`
                : `${numero(datos.cobranza.cuotasPendientes)} cuota(s) impaga(s)`
            }
          />
        ) : (
          <TarjetaGrande
            etiqueta="Cuotas impagas"
            valor={numero(datos.cobranza.cuotasPendientes)}
            detalle="Las que todavía hay que salir a cobrar"
            tono="peligro"
          />
        )}
        <TarjetaGrande
          etiqueta="Siniestros abiertos"
          valor={numero(datos.siniestrosAbiertos)}
          detalle="Todos los que no están cerrados, de cualquier mes"
        />
      </div>

      <div className="grid shrink-0 gap-4 xl:grid-cols-2">
        <Tarjeta titulo="Seguros activos por compañía" descripcion={`Cantidad y porcentaje sobre ${numero(datos.activos)} pólizas de ${alcance}.`}>
          <Ranking filas={datos.activosPorCompania} vacio="No hay pólizas en la planilla de este mes." />
        </Tarjeta>

        <Tarjeta titulo="Seguros activos por sucursal" descripcion="La misma cartera, repartida por local.">
          <Ranking filas={datos.activosPorSucursal} vacio="No hay pólizas en la planilla de este mes." />
        </Tarjeta>

        <Tarjeta titulo="Evolución de la cartera" descripcion="Seguros activos mes a mes, hasta doce meses hacia atrás.">
          <GraficoDeLinea
            titulo="Seguros activos por mes"
            puntos={datos.evolucion.map((mes) => ({ periodo: mes.periodo, valor: mes.activos }))}
          />
        </Tarjeta>

        <Tarjeta titulo="Altas y bajas por mes" descripcion="Lo que entró y lo que se fue, mes a mes.">
          <GraficoDeBarras
            titulo="Altas y bajas por mes"
            nombrePrimera="Altas"
            nombreSegunda="Bajas"
            meses={datos.evolucion.map((mes) => ({ periodo: mes.periodo, primera: mes.altas, segunda: mes.bajas }))}
          />
        </Tarjeta>

        <Tarjeta titulo="Bajas del mes por motivo" descripcion="Por qué se fueron, en sus propias palabras.">
          <Ranking
            filas={datos.bajasPorMotivo.map((fila) => ({ etiqueta: fila.motivo, cantidad: fila.cantidad }))}
            conPorcentaje={false}
            vacio={`No hubo bajas en ${nombreDePeriodo(datos.periodo)}.`}
          />
        </Tarjeta>

        {/* El reparto de lo recaudado es el número de la agencia: sin permiso, la tarjeta no existe. */}
        {datos.cobranza.porMedio !== null && (
        <Tarjeta titulo="Cobranza del mes por medio de pago" descripcion="Cómo entró la plata que se cobró en el mes.">
          {datos.cobranza.porMedio.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Todavía no hay cobranza registrada en este mes.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {datos.cobranza.porMedio.map((medio) => (
                <li key={medio.medio} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                  <span className="truncate text-sm font-medium text-slate-800">{medio.medio}</span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    <strong className="font-semibold text-slate-900">{pesos(medio.total)}</strong>
                    <span className="ml-2 text-xs text-slate-500">{numero(medio.pagos)} pago(s)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
        )}

        <Tarjeta titulo="Siniestros abiertos por compañía" descripcion="Los trámites que siguen sin cerrarse, sin importar de qué mes son.">
          <Ranking filas={datos.siniestrosPorCompania} vacio="No hay siniestros abiertos." />
        </Tarjeta>
      </div>

      <p className="shrink-0 text-xs leading-relaxed text-slate-500">
        Los seguros activos son las filas de la planilla del mes elegido, que es lo mismo que cuentan los COUNTIF de la pestaña SEGUROS
        ACT de la hoja. Las altas se deducen comparando contra el mes anterior, igual que lo hace el contador; las bajas salen de la
        pestaña de BAJAS de ese mes.
      </p>
    </div>
  )
}

function resumenDeMotivos(datos: TableroMetricas): string {
  if (datos.bajasPorMotivo.length === 0) return 'Sin bajas en el mes'
  const principal = datos.bajasPorMotivo[0]!
  return `Sobre todo ${principal.motivo.toLowerCase()} (${numero(principal.cantidad)})`
}
