// Administración → Servidor (VPS), sólo en la versión de demostración.
//
// Es la respuesta a la pregunta que hace todo el que prueba la demo: «¿y esto cómo se conecta a lo
// mío?». Muestra con qué servidor está hablando la demo (uno simulado, adentro del programa), cómo es
// la arquitectura de verdad, los pasos para poner en marcha el servidor de una agencia y un formulario
// para cargar su dirección y su token con una prueba de conexión. La prueba es simulada: la demo no sale
// a internet (ver `main/demo/conexion.ts`).
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { EJEMPLO_URL_DEL_VPS, type EstadoDeLaDemo, type PasoDePruebaDeVps } from '../../../shared/demo'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Cargando, Etiqueta, Tarjeta, cx, haceCuanto } from '../../componentes/ui'

/** Un token al azar, del largo y la forma que conviene para el DMG_SYNC_TOKEN del servidor. */
function generarToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function ServidorVps() {
  const [estado, setEstado] = useState<EstadoDeLaDemo | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    void window.dm.demo.estado().then((resultado) => {
      if (!vigente) return
      if (resultado.ok) setEstado(resultado.datos)
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Tarjeta
        titulo="Servidor de esta demo"
        descripcion="La demo no se conecta a ningún servidor real: trae uno simulado adentro, con datos de ejemplo, que se vuelve a armar cada vez que se abre el programa."
        acciones={<Etiqueta tono="exito">Simulado · en esta computadora</Etiqueta>}
      >
        {cargando ? (
          <Cargando />
        ) : estado ? (
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <Dato termino="Dirección">{estado.urlDelServidor}</Dato>
            <Dato termino="Datos armados">{haceCuanto(estado.armadaEn)}</Dato>
            <Dato termino="Pestañas de la base">{estado.pestanas.toLocaleString('es-AR')}</Dato>
            <Dato termino="Filas">{estado.filas.toLocaleString('es-AR')}</Dato>
          </dl>
        ) : (
          <Alerta tono="aviso">El servidor de la demo no está corriendo. Cerrá y volvé a abrir el programa.</Alerta>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Cómo funciona en una agencia"
        descripcion="Cada computadora trabaja con una copia local (rápida, y que sigue mostrando todo aunque se corte internet) y se sincroniza en el momento con el servidor de la agencia, que es la única fuente de verdad."
      >
        <Arquitectura />
      </Tarjeta>

      <Tarjeta
        titulo="Conectar el servidor de su agencia"
        descripcion="Lo que hay que hacer una sola vez para que todas las sucursales trabajen sobre la misma base."
      >
        <ol className="flex flex-col gap-3 text-sm text-slate-700">
          {PASOS.map((paso, indice) => (
            <li key={paso.titulo} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marino-50 text-xs font-bold text-marino-700">
                {indice + 1}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{paso.titulo}</p>
                <p className="mt-0.5 leading-relaxed text-slate-600">{paso.detalle}</p>
              </div>
            </li>
          ))}
        </ol>
      </Tarjeta>

      <FormularioDeConexion />
    </div>
  )
}

function Dato({ termino, children }: { termino: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{termino}</dt>
      <dd className="mt-1 truncate font-medium text-slate-900">{children}</dd>
    </div>
  )
}

const PASOS: Array<{ titulo: string; detalle: string }> = [
  {
    titulo: 'Un VPS para la agencia',
    detalle: 'Cualquier proveedor sirve (Hostinger, DigitalOcean, Contabo…). Alcanza con Ubuntu 22.04 o 24.04, 2 núcleos, 4 GB de memoria y 40 GB de disco SSD para una agencia con varias sucursales.',
  },
  {
    titulo: 'Instalar el servidor de DM Gestión',
    detalle: 'Va en contenedores (Docker Compose): la base PostgreSQL, el servicio del programa y nginx adelante. Se instala y se actualiza con un solo comando, y deja respaldos diarios automáticos.',
  },
  {
    titulo: 'Un dominio con https',
    detalle: 'Por ejemplo gestion.suagencia.com.ar apuntando al VPS, con un certificado gratuito de Let’s Encrypt. Todo viaja cifrado.',
  },
  {
    titulo: 'El token del puente',
    detalle: 'Una clave larga y secreta (DMG_SYNC_TOKEN en el archivo .env del servidor) que identifica a las computadoras de la agencia. Abajo hay un botón para generar una.',
  },
  {
    titulo: 'Cargar la dirección y el token en el programa',
    detalle: 'Van en el instalador que se arma para la agencia, o en el archivo config.json de cada computadora (abajo se arma solo). Desde ahí el programa se conecta, se sincroniza y abre el canal en vivo.',
  },
  {
    titulo: 'Primera carga y usuarios',
    detalle: 'Administración → Base de datos sube la planilla actual de la agencia (clientes, pólizas, cuotas, siniestros) y Administración → Usuarios da de alta a cada persona con su rol y su sucursal.',
  },
  {
    titulo: 'Las APIs de las compañías',
    detalle: 'En «API Aseguradoras» se cargan una vez el usuario y la clave de productor que da cada compañía (Galeno, ATM, Mercantil Andina, La Equidad…). Quedan guardadas cifradas en el servidor y todas las computadoras cotizan con ellas.',
  },
]

/** El dibujo de la arquitectura: sucursales ⇄ servidor de la agencia ⇄ compañías. */
function Arquitectura() {
  return (
    <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1.3fr_auto_1fr]">
      <Caja titulo="Computadoras de las sucursales" icono="sucursal" items={['Dock Sud', 'Lanús', 'Sarandí', 'Productores']} />
      <Flecha texto="https + canal en vivo" />
      <Caja
        titulo="Servidor de la agencia (VPS)"
        icono="nube"
        destacada
        items={['Base de clientes, pólizas y cuotas', 'Usuarios y permisos', 'Chat interno, presencia y llamadas', 'Adjuntos y respaldos diarios', 'Credenciales de las compañías (cifradas)']}
      />
      <Flecha texto="APIs" />
      <Caja titulo="Compañías" icono="escudo" items={['Cotización', 'Emisión', 'Catálogo de vehículos', 'Novedades']} />
    </div>
  )
}

function Caja({ titulo, icono, items, destacada = false }: { titulo: string; icono: 'sucursal' | 'nube' | 'escudo'; items: string[]; destacada?: boolean }) {
  return (
    <div className={cx('rounded-xl border p-4', destacada ? 'border-marino-200 bg-marino-50' : 'border-slate-200 bg-slate-50')}>
      <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Icono nombre={icono} tamano={16} className="text-marino-700" />
        {titulo}
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
        {items.map((item) => (
          <li key={item}>· {item}</li>
        ))}
      </ul>
    </div>
  )
}

function Flecha({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-[11px] font-semibold text-slate-500">
      <span className="hidden md:block" aria-hidden="true">
        ⇄
      </span>
      <span className="md:hidden" aria-hidden="true">
        ⇅
      </span>
      <span>{texto}</span>
    </div>
  )
}

function FormularioDeConexion() {
  const [urlBase, setUrlBase] = useState('')
  const [token, setToken] = useState('')
  const [probando, setProbando] = useState(false)
  const [pasos, setPasos] = useState<PasoDePruebaDeVps[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const configJson = useMemo(
    () => JSON.stringify({ vps: { urlBase: urlBase.trim() || EJEMPLO_URL_DEL_VPS, token: token.trim() || '<el DMG_SYNC_TOKEN del servidor>' } }, null, 2),
    [urlBase, token],
  )

  async function probar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setProbando(true)
    setPasos(null)
    setError(null)
    const resultado = await window.dm.demo.probarVps({ urlBase, token })
    if (resultado.ok) setPasos(resultado.datos)
    else setError(resultado.error)
    setProbando(false)
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(configJson)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* sin portapapeles queda a la vista para copiarlo a mano */
    }
  }

  const todoBien = pasos !== null && pasos.every((paso) => paso.ok)

  return (
    <Tarjeta
      titulo="Probar la conexión con su servidor"
      descripcion="Escriba la dirección y el token del servidor de su agencia. En la demo la prueba es simulada: no se conecta ni guarda nada, pero recorre los mismos pasos que el programa de verdad."
    >
      <form onSubmit={probar} noValidate className="grid gap-4 md:grid-cols-2">
        <Campo
          etiqueta="Dirección del servidor"
          placeholder={EJEMPLO_URL_DEL_VPS}
          value={urlBase}
          onChange={(evento) => setUrlBase(evento.target.value)}
          spellCheck={false}
          autoCapitalize="none"
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Campo
              etiqueta="Token del puente"
              ayuda="El mismo DMG_SYNC_TOKEN del .env del servidor."
              value={token}
              onChange={(evento) => setToken(evento.target.value)}
              spellCheck={false}
              autoCapitalize="none"
            />
          </div>
          <Boton variante="fantasma" icono="llave" onClick={() => setToken(generarToken())} className={cx('mb-5')}>
            Generar
          </Boton>
        </div>
        <div className="md:col-span-2">
          <Boton type="submit" variante="primario" icono="nube" cargando={probando}>
            Probar conexión
          </Boton>
        </div>
      </form>

      {error && (
        <div className="mt-4">
          <Alerta tono="error">{error}</Alerta>
        </div>
      )}

      {pasos && (
        <ul className="mt-5 flex flex-col gap-2 text-sm" aria-live="polite">
          {pasos.map((paso) => (
            <li key={paso.paso} className="flex items-start gap-2.5">
              <Icono nombre={paso.ok ? 'ok' : 'alerta'} tamano={16} className={cx('mt-0.5 shrink-0', paso.ok ? 'text-green-600' : 'text-red-600')} />
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{paso.paso}</p>
                <p className="text-slate-600">{paso.detalle}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {todoBien && (
        <div className="mt-4">
          <Alerta tono="exito">
            Así se vería una conexión correcta. En el programa de su agencia, con esta dirección y este token, todas las computadoras quedan
            trabajando sobre la misma base.
          </Alerta>
        </div>
      )}

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-900">config.json de cada computadora</p>
          <Boton variante="fantasma" tamano="sm" icono="lista" onClick={() => void copiar()}>
            {copiado ? 'Copiado' : 'Copiar'}
          </Boton>
        </div>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{configJson}</pre>
        <p className="mt-2 text-xs text-slate-500">
          Va en la carpeta de datos del programa (%APPDATA%\dm-gestion\config.json). Si el instalador se arma con la dirección y el token de
          la agencia, no hace falta tocarlo en ninguna computadora.
        </p>
      </div>
    </Tarjeta>
  )
}
