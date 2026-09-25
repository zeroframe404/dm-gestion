// Administración → Catálogo de vehículos.
//
// El catálogo sale de las APIs de TODAS las aseguradoras cargadas en el servidor (hoy Galeno, autos y
// motos). El servidor las recorre una vez por día, las une y cada computadora baja lo que cambió. No
// hay credenciales que cargar acá: son las de cada aseguradora en API Aseguradoras.
//
// La pantalla muestra dos cosas y en este orden: qué tiene ESTA computadora, y cómo le fue al
// servidor con las últimas lecturas (versiones leídas por aseguradora, descartadas y por qué). Los
// botones son dos y están pensados para no tener que usarse: todo pasa solo.
import { useCallback, useEffect, useState } from 'react'
import {
  NOMBRE_TIPO_VEHICULO,
  type EstadoDelCatalogo,
  type ImportacionDelCatalogo,
  type ProgresoDeCatalogo,
  type RegistroDeImportaciones,
} from '../../../shared/tipos'
import { Alerta, Boton, Cargando, Etiqueta, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

/** «2026-09-04» → «04/09/2026». */
function fechaDeLectura(edicion: string | null): string {
  if (!edicion) return 'sin datos'
  const [anio, mes, dia] = edicion.split('-')
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : edicion
}

const MOTIVOS_DE_DESCARTE: Record<string, string> = {
  'sin-marca': 'sin marca',
  'sin-modelo': 'sin modelo',
  'sin-version': 'sin versión',
  'sin-anios': 'sin años',
}

const ESTADOS_DE_LECTURA: Record<string, { texto: string; tono: 'exito' | 'aviso' | 'neutro' | 'peligro' }> = {
  LEIDA: { texto: 'Leída', tono: 'exito' },
  INCOMPLETA: { texto: 'Incompleta', tono: 'aviso' },
  RECHAZADA: { texto: 'No usada', tono: 'aviso' },
  ERROR: { texto: 'Falló', tono: 'peligro' },
}

const ESTADOS: Record<string, { texto: string; tono: 'exito' | 'aviso' | 'neutro' | 'peligro' }> = {
  PUBLICADA: { texto: 'Publicada', tono: 'exito' },
  SIN_CAMBIOS: { texto: 'Sin cambios', tono: 'neutro' },
  RECHAZADA: { texto: 'No publicada', tono: 'aviso' },
  ERROR: { texto: 'Falló', tono: 'peligro' },
}

function numero(valor: number): string {
  return valor.toLocaleString('es-AR')
}

function RenglonDeImportacion({ importacion }: { importacion: ImportacionDelCatalogo }) {
  const estado = ESTADOS[importacion.estado] ?? { texto: importacion.estado, tono: 'neutro' as const }
  const motivos = Object.entries(importacion.descartesPorMotivo)
  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-slate-900">
          {importacion.fuente === 'DNRPA' ? 'Tabla de la DNRPA' : 'Lectura'} del {fechaDeLectura(importacion.edicion)}
        </p>
        <Etiqueta tono={estado.tono}>{estado.texto}</Etiqueta>
        <span className="text-[11px] text-slate-500">{cuando(importacion.iniciadaEn)}</span>
      </div>
      {importacion.fuentes.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {importacion.fuentes.map((lectura) => {
            const estadoDeLectura = ESTADOS_DE_LECTURA[lectura.estado] ?? { texto: lectura.estado, tono: 'neutro' as const }
            return (
              <li key={lectura.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <span className="font-semibold">{lectura.nombre}</span>
                <Etiqueta tono={estadoDeLectura.tono}>{estadoDeLectura.texto}</Etiqueta>
                {lectura.versiones > 0 && (
                  <span>
                    {numero(lectura.versiones)} versiones ({numero(lectura.autos)} autos y {numero(lectura.motos)} motos)
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {importacion.aceptadas > 0 && (
        <p className="mt-1 text-xs text-slate-700">
          En el catálogo: {numero(importacion.aceptadas)} versiones.
          {importacion.estado === 'PUBLICADA' &&
            ` Nuevas: ${numero(importacion.altas)} · cambiadas: ${numero(importacion.cambios)} · dadas de baja: ${numero(importacion.bajas)}.`}
        </p>
      )}
      {importacion.descartadas > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          Descartados {numero(importacion.descartadas)}:{' '}
          {motivos.map(([motivo, cantidad]) => `${cantidad} ${MOTIVOS_DE_DESCARTE[motivo] ?? motivo}`).join(', ')}.
        </p>
      )}
      {importacion.mensaje && <p className="mt-1 text-xs text-red-700">{importacion.mensaje}</p>}
    </li>
  )
}

export function CatalogoVehiculos() {
  const puedeEditar = usePuedeEditar('administracion')
  const [estado, setEstado] = useState<EstadoDelCatalogo | null>(null)
  const [registro, setRegistro] = useState<RegistroDeImportaciones | null>(null)
  const [trabajando, setTrabajando] = useState<'bajar' | 'importar' | null>(null)
  const [progreso, setProgreso] = useState<ProgresoDeCatalogo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.vehiculos.estado()
    if (resultado.ok) setEstado(resultado.datos)
    else setError(resultado.error)
  }, [])

  // El log va aparte y después: sale a la red, y la pantalla tiene que dibujarse ya.
  const cargarRegistro = useCallback(async () => {
    const resultado = await window.dm.vehiculos.importaciones()
    if (resultado.ok) setRegistro(resultado.datos)
  }, [])

  useEffect(() => {
    void cargar()
    void cargarRegistro()
    return window.dm.vehiculos.alProgresar(setProgreso)
  }, [cargar, cargarRegistro])

  const bajar = async () => {
    setTrabajando('bajar')
    setError(null)
    setAviso(null)
    setProgreso(null)
    const resultado = await window.dm.vehiculos.actualizar()
    setTrabajando(null)
    if (resultado.ok) {
      setEstado(resultado.datos)
      setAviso('El catálogo de esta computadora quedó al día.')
    } else {
      setError(resultado.error)
      await cargar()
    }
  }

  const importar = async () => {
    setTrabajando('importar')
    setError(null)
    setAviso(null)
    setProgreso(null)
    const resultado = await window.dm.vehiculos.importarAhora(true)
    setTrabajando(null)
    if (resultado.ok) {
      setEstado(resultado.datos.estado)
      const importacion = resultado.datos.importacion
      if (importacion && (importacion.estado === 'PUBLICADA' || importacion.estado === 'SIN_CAMBIOS')) {
        setAviso(
          importacion.mensaje
            ? `Listo, con avisos: ${importacion.mensaje}`
            : 'Listo: el servidor leyó las APIs de todas las aseguradoras y el catálogo quedó bajado a esta computadora.',
        )
      } else if (importacion) {
        setError(importacion.mensaje ?? 'La lectura no se publicó. Mirá el detalle abajo.')
      }
    } else {
      setError(resultado.error)
    }
    await cargarRegistro()
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo="Catálogo de vehículos (APIs de las aseguradoras)"
        descripcion="Con esto las pólizas, los presupuestos y el multicotizador ofrecen marca, modelo, versión y año en listas en vez de pedirlos escritos, y la categoría —pick-up, SUV, furgón, camión— la decide el catálogo y no quien está cargando. Sale de las APIs de todas las aseguradoras cargadas (hoy Galeno, autos y motos)."
        acciones={
          puedeEditar && (
            <Boton variante="primario" icono="refrescar" onClick={() => void bajar()} cargando={trabajando === 'bajar'} disabled={trabajando !== null}>
              Actualizar ahora
            </Boton>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {!estado.hayCatalogo && (
            <Alerta tono="aviso">
              Esta computadora todavía no bajó el catálogo. Se baja solo al abrir el programa si hay conexión con el servidor;
              mientras tanto, la marca y el modelo se escriben a mano, como siempre.
            </Alerta>
          )}
          {estado.ultimoError && (
            <Alerta tono="aviso">
              El último intento ({cuando(estado.intentadoEn)}) no pudo bajar el catálogo: {estado.ultimoError}
              {estado.hayCatalogo && ' Lo que ya estaba bajado sigue funcionando.'}
            </Alerta>
          )}

          {trabajando && (
            <div className="rounded-xl border border-marino-200 bg-marino-50 px-4 py-3">
              <p className="text-sm font-semibold text-marino-900">
                {trabajando === 'importar' ? 'El servidor está leyendo las APIs de las aseguradoras…' : 'Actualizando el catálogo…'}
              </p>
              <p className="mt-0.5 text-xs text-marino-800">{progreso?.detalle ?? 'Conectando con el servidor…'}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {estado.porTipo.map((tipo) => (
              <div key={tipo.tipo} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="font-display font-bold text-slate-900">{NOMBRE_TIPO_VEHICULO[tipo.tipo]}s</p>
                  {tipo.versiones > 0 ? <Etiqueta tono="exito">Bajado</Etiqueta> : <Etiqueta tono="neutro">Sin bajar</Etiqueta>}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-slate-500">Marcas</dt>
                    <dd className="tabular-nums font-semibold text-slate-800">{numero(tipo.marcas)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Modelos</dt>
                    <dd className="tabular-nums font-semibold text-slate-800">{numero(tipo.modelos)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Versiones</dt>
                    <dd className="tabular-nums font-semibold text-slate-800">{numero(tipo.versiones)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            Última lectura de las APIs: {fechaDeLectura(estado.edicion)}. Bajada a esta computadora: {cuando(estado.bajadoEn)}. Los
            años son los que cada aseguradora ofrece para la versión; un vehículo que no está se carga a mano. Las pólizas ya
            cargadas no se tocan.
          </p>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Lo que leyó el servidor"
        descripcion="El servidor de la agencia recorre una vez por día las APIs de todas las aseguradoras cargadas, las une en un solo catálogo y lo manda a todas las computadoras. Acá queda lo que leyó cada vez. Leer una API entera son miles de pedidos: puede tardar un buen rato."
        acciones={
          puedeEditar && (
            <Boton icono="descargar" onClick={() => void importar()} cargando={trabajando === 'importar'} disabled={trabajando !== null}>
              Leer las APIs ahora
            </Boton>
          )
        }
      >
        {registro === null ? (
          <p className="text-sm text-slate-500">Consultando el servidor…</p>
        ) : registro.error ? (
          <Alerta tono="aviso">No se pudo consultar el servidor: {registro.error}</Alerta>
        ) : registro.importaciones.length === 0 ? (
          registro.enCurso ? (
            <Alerta tono="aviso">El servidor está leyendo las APIs por primera vez{registro.progreso ? `: ${registro.progreso.detalle}` : '…'}</Alerta>
          ) : (
            <p className="text-sm text-slate-500">El servidor todavía no leyó ninguna API.</p>
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {registro.enCurso && (
              <Alerta tono="aviso">Hay una lectura en curso en el servidor{registro.progreso ? `: ${registro.progreso.detalle}` : '.'}</Alerta>
            )}
            {registro.importaciones.slice(0, 6).map((importacion) => (
              <RenglonDeImportacion key={importacion.id} importacion={importacion} />
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  )
}
