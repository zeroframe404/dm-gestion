// API Aseguradoras → ATM: la cuenta del web service de ATM Seguros y las tablas de parámetros que ATM
// publica por FTP. Con las dos cosas el multicotizador cotiza en ATM; por ahora sólo cotiza, no se
// emite desde la app.
//
// Dos cosas que la hacen distinta de la pestaña de Galeno:
//
// 1. LA CUENTA SÍ VIVE EN CADA COMPUTADORA. ATM no exige que los pedidos salgan de una IP dada de
//    alta, así que cada PC le habla directo, sin pasar por el VPS. Se carga una vez acá, viaja al
//    servidor como el ajuste compartido `atmApi` y el resto la adopta al abrir el programa, igual que
//    la app de Meta: por eso están el renglón de si esta computadora está al día y «Traer del servidor».
// 2. EL CATÁLOGO DE VEHÍCULOS NO VIENE POR LA API. ATM lo deja todas las noches en un FTP, y sin esas
//    tablas no hay con qué pedirle el vehículo con su código. Cada computadora las baja sola al cotizar
//    (una vez por día); acá se ve cómo quedaron y, si el FTP está bloqueado en la red de una sucursal,
//    se importan de archivos bajados a mano. Por eso el estado de cada tabla y el último error del FTP
//    se muestran enteros: es lo primero que hay que mirar cuando ATM no cotiza.
//
// La clave nunca vuelve a esta pantalla —el proceso principal no la manda— y el campo aparece siempre
// vacío: escribir una nueva la reemplaza, dejarlo vacío conserva la que había.
import { useCallback, useEffect, useState } from 'react'
import {
  AMBIENTES_ATM,
  NOMBRE_AMBIENTE_ATM,
  type AmbienteAtm,
  type EstadoDeAtm,
  type EstadoDeTablasAtm,
  type PruebaDeAtm,
  type TablaDeAtmEnDisco,
} from '../../../shared/tipos'
import { EstadoCompartido } from '../../componentes/EstadoCompartido'
import { Alerta, Boton, Campo, CampoClave, Cargando, Etiqueta, Selector, Tarjeta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

/**
 * El FTP de cada ambiente (capítulo 1 del manual de ATM), con el mismo usuario y la misma clave que el
 * web service. Es el mismo dato que `FTP_ATM` de main/aseguradoras/atm/repositorio.ts: acá sólo se
 * muestra, para quien tenga que bajar las tablas a mano.
 */
const FTP_ATM: Record<AmbienteAtm, { host: string; puerto: number }> = {
  produccion: { host: 'wsatm.atmseguros.com.ar', puerto: 2113 },
  desarrollo: { host: 'wsatm-dev.atmseguros.com.ar', puerto: 2111 },
}

/** El ambiente dentro de una frase: «las tablas de producción». */
const AMBIENTE_EN_FRASE: Record<AmbienteAtm, string> = { produccion: 'producción', desarrollo: 'desarrollo' }

/** ATM regenera las tablas todas las noches: con más de un día, el multicotizador intenta bajarlas de nuevo. */
const UN_DIA_MS = 24 * 60 * 60_000

function cuando(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function numero(valor: number): string {
  return valor.toLocaleString('es-AR')
}

/** El vendedor sin espacios, como lo guarda el proceso principal. */
function vendedorLimpio(vendedor: string): string {
  return vendedor.replace(/\s/g, '')
}

export function Atm() {
  const usuario = useUsuarioActual()
  const puedeEditar = usePuedeEditar('administracion') && (usuario.rol === 'SUPER_ADMIN' || usuario.rol === 'ADMIN')

  const [estado, setEstado] = useState<EstadoDeAtm | null>(null)
  const [ambiente, setAmbiente] = useState<AmbienteAtm>('produccion')
  const [usuarioAtm, setUsuarioAtm] = useState('')
  const [clave, setClave] = useState('')
  const [vendedor, setVendedor] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [prueba, setPrueba] = useState<PruebaDeAtm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Lo que devuelve el proceso principal pasa a los campos: es lo que quedó guardado de verdad, ya
  // normalizado (el vendedor sin espacios, el usuario sin blancos de más).
  const mostrar = useCallback((datos: EstadoDeAtm) => {
    setEstado(datos)
    setAmbiente(datos.ambiente)
    setUsuarioAtm(datos.usuario)
    setVendedor(datos.vendedor)
  }, [])

  const cargar = useCallback(async () => {
    const resultado = await window.dm.atm.estado()
    if (resultado.ok) {
      mostrar(resultado.datos)
    } else {
      setError(resultado.error)
    }
  }, [mostrar])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.atm.guardarCredenciales({ ambiente, usuario: usuarioAtm, clave, vendedor })
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      // La clave no se deja en memoria más de lo necesario.
      setClave('')
      setAviso(
        resultado.datos.compartido?.error
          ? 'La cuenta se guardó en esta computadora. Al resto no se pudo mandar: mirá el aviso de acá abajo. Probá la conexión antes de cotizar.'
          : 'La cuenta de ATM quedó guardada y salió para el resto de las computadoras. Probá la conexión antes de cotizar.',
      )
    } else {
      setError(resultado.error)
    }
  }

  const borrar = async () => {
    // Galeno vuelve a su cuenta de fábrica; ATM no tiene ninguna: sin cuenta, deja de cotizar.
    const seguro = window.confirm(
      'Se saca la cuenta de ATM de esta computadora y del servidor, y el multicotizador deja de cotizar en ATM hasta que se cargue otra. ' +
        'Las tablas ya bajadas se conservan. ¿Seguir?',
    )
    if (!seguro) return
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.atm.borrarCredenciales()
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      setClave('')
      // Si el servidor no la pudo borrar, esta computadora la volvería a tomar al abrir el programa:
      // hay que decirlo en vez de dar por hecho que se sacó de los dos lados.
      if (resultado.datos.compartido?.enElServidor || resultado.datos.compartido?.error) {
        setError(
          `Se sacó la cuenta de ATM de esta computadora, pero el servidor todavía la tiene${resultado.datos.compartido.error ? ` (${resultado.datos.compartido.error})` : ''}. ` +
            'Volvé a tocar «Sacarla»: si no, al abrir el programa esta computadora la vuelve a tomar del servidor.',
        )
      } else {
        setAviso('Se sacó la cuenta de ATM de esta computadora y del servidor.')
      }
    } else {
      setError(resultado.error)
    }
  }

  const traer = async () => {
    if (estado?.configurada && !window.confirm('Se reemplaza la cuenta de ATM de esta computadora por la que tiene el servidor. ¿Seguir?')) return
    setGuardando(true)
    setError(null)
    setAviso(null)
    setPrueba(null)
    const resultado = await window.dm.atm.traerDelServidor()
    setGuardando(false)
    if (resultado.ok) {
      mostrar(resultado.datos)
      setClave('')
      setAviso('Esta computadora tomó la cuenta de ATM que tiene el servidor.')
    } else {
      setError(resultado.error)
    }
  }

  const probar = async () => {
    setProbando(true)
    setPrueba(null)
    setError(null)
    const resultado = await window.dm.atm.probar()
    setProbando(false)
    if (resultado.ok) {
      setPrueba(resultado.datos)
    } else {
      setError(resultado.error)
    }
  }

  if (!estado) return error ? <Alerta tono="error">{error}</Alerta> : <Cargando />

  const compartido = estado.compartido
  const vendedorInvalido = vendedorLimpio(vendedor) !== '' && !/^\d{10}$/.test(vendedorLimpio(vendedor))
  // Sólo tiene sentido traer cuando el servidor tiene una cuenta y no es la de acá.
  const puedeTraer = puedeEditar && compartido !== null && compartido.enElServidor && !compartido.alDia && !compartido.error

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Tarjeta
        titulo="Conexión con ATM Seguros"
        descripcion="Con esto, el multicotizador cotiza autos y motos en ATM junto con las demás compañías. Por ahora ATM sólo cotiza: la póliza no se emite desde la app. A diferencia de Galeno, ATM no pide una IP dada de alta: cada computadora le habla directo con esta cuenta, que se carga una vez acá y el resto adopta al abrir el programa."
        acciones={
          puedeEditar && (
            <>
              {/* También con la cuenta ya sacada de acá si el servidor la sigue teniendo: es la forma de
                  reintentar borrarla allá. */}
              {(estado.configurada || estado.compartido?.enElServidor) && (
                <Boton icono="basura" onClick={() => void borrar()} disabled={guardando}>
                  Sacarla
                </Boton>
              )}
              <Boton
                variante="primario"
                icono="ok"
                onClick={() => void guardar()}
                cargando={guardando}
                disabled={!usuarioAtm.trim() || (!clave.trim() && !estado.configurada) || vendedorInvalido}
              >
                Guardar
              </Boton>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {estado.configurada ? (
            <Alerta tono="exito">
              Cuenta cargada en esta computadora{estado.actualizadoEn ? ` el ${cuando(estado.actualizadoEn)}` : ''}: usuario {estado.usuario}, ambiente de{' '}
              {AMBIENTE_EN_FRASE[estado.ambiente]}, {estado.vendedor ? `vendedor ${estado.vendedor}` : 'con el primer vendedor de la cuenta'}.
            </Alerta>
          ) : (
            <Alerta tono="aviso">
              Todavía no hay una cuenta de ATM en esta computadora: el multicotizador no cotiza en ATM hasta cargarla
              {compartido?.enElServidor ? ' o traer la que tiene el servidor' : ''}.
            </Alerta>
          )}

          <div className="flex flex-col gap-2">
            <EstadoCompartido
              estado={compartido}
              nombre="la cuenta de ATM"
              comoSeCarga="La carga un administrador una sola vez y el resto la adopta al abrir el programa."
            />
            {puedeTraer && (
              <div className="flex flex-wrap items-center gap-3">
                <Boton icono="nubeBajada" onClick={() => void traer()} disabled={guardando}>
                  Traer del servidor
                </Boton>
                <span className="text-xs text-slate-500">Toma ya la cuenta del servidor, sin esperar a volver a abrir el programa.</span>
              </div>
            )}
          </div>

          <Selector
            etiqueta="Ambiente"
            value={ambiente}
            onChange={(evento) => setAmbiente(evento.target.value as AmbienteAtm)}
            disabled={!puedeEditar}
            opciones={AMBIENTES_ATM.map((a) => ({ valor: a, texto: NOMBRE_AMBIENTE_ATM[a] }))}
            ayuda="Producción es el de todos los días. Desarrollo es el de pruebas de ATM: anda sólo de lunes a viernes de 8 a 18 y lo que cotiza no vale para el cliente. El usuario y la clave son los mismos en los dos; las tablas, no: cada ambiente tiene las suyas."
          />
          <Campo
            etiqueta="Usuario"
            value={usuarioAtm}
            onChange={(evento) => setUsuarioAtm(evento.target.value)}
            disabled={!puedeEditar}
            autoComplete="off"
          />
          <CampoClave
            etiqueta="Clave"
            value={clave}
            onChange={(evento) => setClave(evento.target.value)}
            disabled={!puedeEditar}
            placeholder={estado.configurada ? '•••••••• (dejala vacía para conservar la guardada)' : ''}
            ayuda="Se guarda en esta computadora y, cifrada, en el servidor, para que la adopten las demás. Nunca vuelve a esta pantalla: con la cuenta ya cargada, dejala vacía para cambiar sólo el ambiente o el vendedor."
            autoComplete="off"
          />
          <Campo
            etiqueta="Vendedor (opcional)"
            value={vendedor}
            onChange={(evento) => setVendedor(evento.target.value)}
            disabled={!puedeEditar}
            inputMode="numeric"
            placeholder="Vacío = el primero de la cuenta"
            className="tabular-nums"
            error={vendedorInvalido ? 'El código de vendedor de ATM tiene 10 números (por ejemplo, 0956112663).' : null}
            ayuda="El código de 10 números con que se cotiza, el que ATM le dio a la agencia. Vacío, se usa el primero que ATM tenga para la cuenta. «Probar conexión» muestra los que lista."
            autoComplete="off"
          />

          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-3">
              <Boton icono="enlace" onClick={() => void probar()} cargando={probando} disabled={!estado.configurada}>
                Probar conexión
              </Boton>
              <span className="text-xs text-slate-500">Prueba la cuenta guardada en esta computadora, no lo que está escrito: si cambiaste algo, guardá primero.</span>
            </div>
          )}

          {prueba && (
            <div className="flex flex-col gap-2">
              <Alerta tono={prueba.ok ? 'exito' : 'error'}>{prueba.detalle}</Alerta>
              {prueba.vendedores.length > 0 && (
                <div className="rounded-xl border border-slate-200">
                  <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    Vendedores que ATM lista para esta cuenta
                  </p>
                  <ul className="divide-y divide-slate-100">
                    {prueba.vendedores.map((candidato) => (
                      <li key={candidato.codigo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="font-mono tabular-nums text-slate-800">{candidato.codigo}</span>
                          <span className="ml-2 text-slate-600">{candidato.nombre}</span>
                        </span>
                        {vendedorLimpio(vendedor) === candidato.codigo ? (
                          <Etiqueta tono="exito">En el campo</Etiqueta>
                        ) : (
                          puedeEditar && (
                            <Boton tamano="sm" variante="secundario" onClick={() => setVendedor(candidato.codigo)}>
                              Usar este
                            </Boton>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
                    «Usar este» lo pone en el campo Vendedor; después hay que tocar Guardar. La lista es una ayuda: ATM puede cotizar
                    también con un vendedor que no figura acá, como el que le dio a la agencia.
                  </p>
                </div>
              )}
            </div>
          )}

          {!puedeEditar && (
            <Alerta tono="info">
              La cuenta de ATM la carga un administrador con permiso para editar Administración: vale para todas las computadoras.
            </Alerta>
          )}
        </div>
      </Tarjeta>

      <TablasDeAtm
        tablas={estado.tablas}
        cuentaCargada={estado.configurada}
        puedeEditar={puedeEditar}
        alCambiar={(tablas) => setEstado((previo) => previo && { ...previo, tablas })}
      />
    </div>
  )
}

function EstadoDeTabla({ tabla }: { tabla: TablaDeAtmEnDisco }) {
  if (tabla.error) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Etiqueta tono="peligro">No se pudo leer</Etiqueta>
        <span className="whitespace-normal text-red-700">{tabla.error}</span>
      </div>
    )
  }
  if (tabla.filas !== null) {
    return <Etiqueta tono={tabla.filas > 0 ? 'exito' : 'aviso'}>{tabla.filas === 1 ? '1 fila' : `${numero(tabla.filas)} filas`}</Etiqueta>
  }
  return <Etiqueta tono={tabla.necesaria ? 'aviso' : 'neutro'}>Sin archivo</Etiqueta>
}

function TablasDeAtm({
  tablas,
  cuentaCargada,
  puedeEditar,
  alCambiar,
}: {
  tablas: EstadoDeTablasAtm
  cuentaCargada: boolean
  puedeEditar: boolean
  alCambiar: (tablas: EstadoDeTablasAtm) => void
}) {
  const [trabajando, setTrabajando] = useState<'ftp' | 'archivos' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const contarVehiculos = (nuevas: EstadoDeTablasAtm) =>
    nuevas.listasParaCotizar
      ? `${numero(nuevas.vehiculos)} vehículos para cotizar.`
      : 'Con lo que hay todavía no se puede cotizar: mirá el estado de cada tabla.'

  const actualizar = async () => {
    setTrabajando('ftp')
    setError(null)
    setAviso(null)
    const resultado = await window.dm.atm.actualizarTablas()
    setTrabajando(null)
    if (resultado.ok) {
      alCambiar(resultado.datos)
      setAviso(`Tablas bajadas del FTP de ATM. ${contarVehiculos(resultado.datos)}`)
    } else {
      setError(resultado.error)
    }
  }

  const importar = async () => {
    setTrabajando('archivos')
    setError(null)
    setAviso(null)
    const resultado = await window.dm.atm.importarTablas()
    setTrabajando(null)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (!resultado.datos) return // canceló el diálogo
    alCambiar(resultado.datos)
    setAviso(`Tablas importadas. ${contarVehiculos(resultado.datos)}`)
  }

  const ambiente = AMBIENTE_EN_FRASE[tablas.ambiente]
  const viejas = tablas.bajadasEn !== null && Date.now() - new Date(tablas.bajadasEn).getTime() > UN_DIA_MS
  const origen = tablas.origen === 'ftp' ? ' del FTP de ATM' : tablas.origen === 'archivos' ? ' de archivos importados a mano' : ''

  return (
    <Tarjeta
      titulo="Tablas de ATM (el catálogo de vehículos)"
      descripcion="ATM no da su catálogo de vehículos por la API: lo publica todas las noches en un FTP, en tablas de parámetros. El multicotizador las necesita para encontrar el vehículo en ATM (su código de InfoAuto y el de uso). Cada computadora las baja sola una vez por día, al cotizar; acá se ve cómo quedaron y se pueden bajar a mano."
      acciones={
        puedeEditar && (
          <>
            <Boton icono="carpeta" onClick={() => void importar()} cargando={trabajando === 'archivos'} disabled={trabajando !== null}>
              Importar desde archivos…
            </Boton>
            <Boton
              variante="primario"
              icono="refrescar"
              onClick={() => void actualizar()}
              cargando={trabajando === 'ftp'}
              disabled={trabajando !== null || !cuentaCargada}
              title={cuentaCargada ? undefined : 'Primero cargá la cuenta: el FTP usa el mismo usuario y la misma clave.'}
            >
              Actualizar tablas (FTP)
            </Boton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}

        {tablas.listasParaCotizar ? (
          <Alerta tono="exito">
            Listas para cotizar en {ambiente}: {numero(tablas.vehiculos)} vehículos, bajadas el {cuando(tablas.bajadasEn)}
            {origen}.
            {viejas &&
              ' Tienen más de un día: la próxima cotización intenta actualizarlas sola y, si no puede, cotiza con éstas y lo avisa en la tarjeta de ATM.'}
          </Alerta>
        ) : tablas.bajadasEn ? (
          <Alerta tono="error">
            Las tablas de {ambiente} que hay (bajadas el {cuando(tablas.bajadasEn)}
            {origen}) no alcanzan para cotizar: hace falta al menos una de las dos de vehículos y que se pueda leer. Mirá el estado de
            cada una acá abajo.
          </Alerta>
        ) : (
          <Alerta tono="aviso">
            Esta computadora todavía no tiene las tablas de ATM de {ambiente}, y sin ellas ATM no puede cotizar. Se bajan solas la
            primera vez que se cotiza en ATM, o a mano con «Actualizar tablas (FTP)» o «Importar desde archivos…».
          </Alerta>
        )}

        {tablas.ultimoError && !error && (
          <Alerta tono="error">
            El último intento de bajarlas del FTP falló: {tablas.ultimoError}
            {tablas.listasParaCotizar && ' Mientras tanto se cotiza con las que ya están.'}
          </Alerta>
        )}

        {trabajando === 'ftp' && (
          <p className="text-sm text-slate-600">Bajando las tablas del FTP de ATM… puede tardar un rato: son archivos grandes.</p>
        )}

        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Tabla</th>
                <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Archivo</th>
                <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Estado</th>
              </tr>
            </thead>
            <tbody>
              {tablas.tablas.map((tabla) => (
                <tr key={tabla.tabla} className="align-top odd:bg-white even:bg-slate-50">
                  <td className="border-b border-slate-100 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800">{tabla.descripcion}</span>
                      {tabla.necesaria && <Etiqueta tono="marca">Para cotizar</Etiqueta>}
                    </div>
                    <span className="font-mono text-[11px] text-slate-500">{tabla.tabla}</span>
                  </td>
                  <td className="break-all border-b border-slate-100 px-3 py-2 font-mono text-slate-700">{tabla.archivo ?? '—'}</td>
                  <td className="border-b border-slate-100 px-3 py-2">
                    <EstadoDeTabla tabla={tabla} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Las marcadas «Para cotizar» son las de vehículos: con una de las dos alcanza para encontrar el vehículo. Las demás completan
          las listas de la tarjeta de ATM en el multicotizador (usos, localidades, rastreo, IVA).
        </p>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">Si el FTP no anda desde esta red</p>
          <p className="mt-1">
            Algunas redes bloquean el FTP (el error dice que no se pudo conectar). Las tablas se pueden bajar desde otra conexión con un
            programa de FTP (FileZilla, por ejemplo) y traerlas acá con «Importar desde archivos…»:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {AMBIENTES_ATM.map((a) => (
              <li key={a}>
                {a === 'produccion' ? 'Producción' : 'Desarrollo'}: servidor{' '}
                <code className="rounded bg-white px-1 font-mono text-xs">{FTP_ATM[a].host}</code>, puerto{' '}
                <code className="rounded bg-white px-1 font-mono text-xs">{FTP_ATM[a].puerto}</code>
                {a === tablas.ambiente && ' (el de la cuenta cargada)'}.
              </li>
            ))}
            <li>Usuario y clave: los mismos de la cuenta de ATM de arriba. Si el programa pregunta, probá FTP común y, si no deja, FTP con TLS.</li>
            <li>
              Hay que bajar los archivos que tienen en el nombre el de la tabla (ws_au_marca_modelo, ws_au_infoauto…), sueltos o en un
              .zip, y elegirlos todos juntos al importar. Van a las tablas de {ambiente}; las que no vengan conservan las que ya había.
            </li>
          </ul>
        </div>
      </div>
    </Tarjeta>
  )
}
