// Mi link → Métricas: cómo le va a la página. Visitas, visitantes y clicks de los últimos 7, 30 o 90
// días, la línea por día y tres rankings (qué tocan, de dónde llegan, con qué entran). Lo cuenta el VPS
// con los eventos que manda la página pública; acá sólo se dibuja, con los mismos gráficos a mano de
// Métricas (pantallas/metricas/graficos.tsx).
import { useCallback, useEffect, useRef, useState } from 'react'
import { RANGOS_DE_METRICAS, type FilaDeMetricas, type MetricasDeMiLink, type MiLink, type RangoDeMetricas } from '../../../shared/miLink'
import { BotonPildora } from '../../componentes/listados'
import { Alerta, Boton, Cargando, Tarjeta } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { GraficoDeLinea, numero, Ranking, TarjetaGrande, type FilaDeRanking } from '../metricas/graficos'
import { EncabezadoDeMiLink, opcionesDeUsuario, useUsuariosDeMiLink, useVeTodoMiLink } from './listados/comun'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Los colores de las dos líneas: violeta, el de Mi link, para las visitas; azul para los clicks. */
const COLOR_VISITAS = '#7c3aed'
const COLOR_CLICKS = '#2563eb'

/** '2026-09-30' → '30 de septiembre' (con el año sólo si se pide). */
function diaLegible(dia: string, conAnio: boolean): string {
  const [anio, mes, numeroDeDia] = dia.split('-')
  const texto = `${Number(numeroDeDia)} de ${MESES[Number(mes) - 1] ?? mes}`
  return conAnio ? `${texto} de ${anio}` : texto
}

/** «Del 30 de septiembre al 29 de octubre.» El año aparece sólo cuando el rango cruza de un año a otro. */
function rangoLegible(desde: string, hasta: string): string {
  const cruzaElAnio = desde.slice(0, 4) !== hasta.slice(0, 4)
  return `Del ${diaLegible(desde, cruzaElAnio)} al ${diaLegible(hasta, cruzaElAnio)}.`
}

/** '2026-10-29' → '29/10': el rótulo del eje por día. */
function diaCorto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

/** Las filas del VPS con el porcentaje sobre el total, que es como las lee el ranking. */
function filasDeRanking(filas: FilaDeMetricas[]): FilaDeRanking[] {
  const total = filas.reduce((suma, fila) => suma + fila.valor, 0)
  return filas.map((fila) => ({
    etiqueta: fila.etiqueta,
    cantidad: fila.valor,
    porcentaje: total > 0 ? Math.round((fila.valor / total) * 100) : 0,
  }))
}

function porcentaje(valor: number): string {
  return `${Math.round(valor * 100).toLocaleString('es-AR')} %`
}

export function Metricas() {
  const { ir } = useNavegacion()
  const veTodo = useVeTodoMiLink()
  const usuarios = useUsuariosDeMiLink(veTodo)
  const [dias, setDias] = useState<RangoDeMetricas>(30)
  const [usuario, setUsuario] = useState('')
  const [metricas, setMetricas] = useState<MetricasDeMiLink | null>(null)
  const [link, setLink] = useState<MiLink | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    const mia = ++peticion.current
    setCargando(true)
    // La página propia viaja aparte: de ahí sale la dirección de «Ver mi página», y no depende del rango.
    const [resultado, propia] = await Promise.all([window.dm.miLink.metricas(dias, usuario), window.dm.miLink.mia()])
    if (mia !== peticion.current) return
    if (resultado.ok) {
      setMetricas(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    if (propia.ok) setLink(propia.datos)
    setCargando(false)
  }, [dias, usuario])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const verMiPagina = () => {
    if (link) void window.dm.miLink.abrirPagina(link.url)
  }
  const motivoSinPagina = !link ? 'Todavía no creaste tu página.' : !link.publicada ? 'Tu página todavía no está publicada.' : undefined

  return (
    <div className="flex flex-col gap-6 p-8">
      <EncabezadoDeMiLink
        icono="metricas"
        titulo="Cómo le va a tu página"
        descripcion={
          metricas ? `${rangoLegible(metricas.desde, metricas.hasta)} El día de hoy se cuenta en vivo.` : 'Las visitas y los clicks de tu página pública, día por día.'
        }
        ayuda="miLink.metricas"
        acciones={
          <>
            <Boton icono="lapiz" onClick={() => ir('miLink', { seccion: 'pagina' })}>
              Editar mi página
            </Boton>
            <Boton icono="enlace" onClick={verMiPagina} disabled={Boolean(motivoSinPagina)} title={motivoSinPagina}>
              Ver mi página
            </Boton>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {RANGOS_DE_METRICAS.map((rango) => (
          <BotonPildora key={rango} activo={dias === rango} alAlternar={() => setDias(rango)}>
            Últimos {rango} días
          </BotonPildora>
        ))}
        {veTodo && (
          <label className="ml-2 text-sm font-semibold text-slate-700">
            De quién
            <select
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800 focus:border-marino-500 focus:outline-none"
            >
              {opcionesDeUsuario(usuarios, 'Mi página').map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.texto}
                </option>
              ))}
            </select>
          </label>
        )}
        <Boton icono="refrescar" className="ml-auto" onClick={() => void cargar()} cargando={cargando} title="Volver a pedir las métricas ahora">
          Actualizar
        </Boton>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}

      {!metricas ? (
        cargando ? (
          <Cargando />
        ) : null
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <TarjetaGrande
              etiqueta="Visitas"
              valor={numero(metricas.visitas)}
              tono="marca"
              detalle={`${numero(metricas.solicitudes)} ${metricas.solicitudes === 1 ? 'solicitud' : 'solicitudes'} y ${numero(metricas.denuncias)} ${metricas.denuncias === 1 ? 'denuncia' : 'denuncias'} en el período`}
            />
            <TarjetaGrande etiqueta="Visitantes" valor={numero(metricas.visitantes)} detalle="El que vuelve el mismo día cuenta una vez" />
            <TarjetaGrande etiqueta="Clicks" valor={numero(metricas.clicks)} detalle="En contactos, coberturas y links" />
            <TarjetaGrande
              etiqueta="Clicks por visita"
              valor={porcentaje(metricas.clicksPorVisita)}
              detalle="Más de 100 % es que tocan más de una cosa por visita"
            />
          </div>

          <Tarjeta titulo="Visitas y clicks por día" descripcion="Pasá el mouse por un punto para ver el número del día.">
            <GraficoDeLinea
              titulo="Visitas y clicks por día"
              puntos={metricas.porDia.map((punto) => ({ periodo: punto.dia, valor: punto.visitas }))}
              nombre="Visitas"
              color={COLOR_VISITAS}
              conArea
              series={[{ nombre: 'Clicks', color: COLOR_CLICKS, valores: metricas.porDia.map((punto) => punto.clicks), continua: true }]}
              etiquetaDe={diaCorto}
              vacio="Todavía no hay días para mostrar."
            />
          </Tarjeta>

          <div className="grid gap-4 xl:grid-cols-3">
            <Tarjeta titulo="Qué tocan" descripcion="Clicks por bloque">
              <Ranking filas={filasDeRanking(metricas.bloques)} vacio="Todavía nadie tocó nada en este período." />
            </Tarjeta>
            <Tarjeta titulo="De dónde vienen" descripcion="Origen de las visitas">
              <Ranking filas={filasDeRanking(metricas.origenes)} vacio="Todavía no hay visitas en este período." />
            </Tarjeta>
            <Tarjeta titulo="Con qué entran" descripcion="Dispositivo">
              <Ranking filas={filasDeRanking(metricas.dispositivos)} vacio="Todavía no hay visitas en este período." />
            </Tarjeta>
          </div>
        </>
      )}
    </div>
  )
}
