// Administración → Marca: cómo se llama el programa, con qué nombre firma la agencia, el color principal y
// el logo. Sólo del superadministrador. Se guarda acá y viaja al servidor para las otras computadoras.
import { useEffect, useRef, useState } from 'react'
import { MAXIMO_DE_LOGO_EN_BYTES, MAXIMO_DE_NOMBRE, esColorHex, normalizarMarca, type Marca as MarcaConfigurada } from '../../../shared/marca'
import { marcaActual } from '../../agencia'
import { aplicarMarca } from '../../canal'
import { LogoPropio } from '../../componentes/LogoPropio'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Tarjeta } from '../../componentes/ui'

const COLOR_DE_FABRICA = '#235ba8'

function leerComoDataUrl(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () => resolver(String(lector.result))
    lector.onerror = () => rechazar(new Error('No se pudo leer la imagen.'))
    lector.readAsDataURL(archivo)
  })
}

export function Marca() {
  const inicial = marcaActual()
  const [nombre, setNombre] = useState(inicial.nombre)
  const [agencia, setAgencia] = useState(inicial.agencia)
  const [color, setColor] = useState<string | null>(inicial.color)
  const [logo, setLogo] = useState<string | null>(inicial.logo)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const selector = useRef<HTMLInputElement>(null)

  // Lo que quedó guardado puede haber cambiado desde otra computadora mientras la pantalla se abría.
  useEffect(() => {
    void window.dm.marca.obtener().then((resultado) => {
      if (!resultado.ok) return
      setNombre(resultado.datos.nombre)
      setAgencia(resultado.datos.agencia)
      setColor(resultado.datos.color)
      setLogo(resultado.datos.logo)
    })
  }, [])

  const aplicar = (marca: MarcaConfigurada) => {
    setNombre(marca.nombre)
    setAgencia(marca.agencia)
    setColor(marca.color)
    setLogo(marca.logo)
    aplicarMarca(marca)
  }

  const elegirLogo = async (archivo: File | undefined) => {
    if (!archivo) return
    setError(null)
    if (archivo.size > MAXIMO_DE_LOGO_EN_BYTES) {
      setError(`El logo pesa demasiado: el máximo es ${Math.round(MAXIMO_DE_LOGO_EN_BYTES / 1024)} KB.`)
      return
    }
    try {
      const url = await leerComoDataUrl(archivo)
      if (normalizarMarca({ logo: url }).logo === null) {
        setError('El logo tiene que ser una imagen PNG, JPG, WebP o SVG.')
        return
      }
      setLogo(url)
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo leer la imagen.')
    }
  }

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.marca.guardar({ nombre, agencia, color, logo })
    setGuardando(false)
    if (resultado.ok) {
      aplicar(resultado.datos)
      setAviso('Listo: la marca quedó guardada. Las otras computadoras la toman al abrir el programa.')
    } else setError(resultado.error)
  }

  const restaurar = async () => {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.marca.restaurar()
    setGuardando(false)
    if (resultado.ok) {
      aplicar(resultado.datos)
      setAviso('Volvió la marca de siempre.')
    } else setError(resultado.error)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Tarjeta titulo="Marca" descripcion="Cómo se presenta el programa: el nombre, el color y el logo. El nombre de la agencia es el que firma los mensajes de WhatsApp, los presupuestos y los reportes.">
        <div className="space-y-4">
          <Campo etiqueta="Nombre del programa" value={nombre} maxLength={MAXIMO_DE_NOMBRE} onChange={(e) => setNombre(e.target.value)} />
          <Campo etiqueta="Nombre de la agencia" value={agencia} maxLength={MAXIMO_DE_NOMBRE} onChange={(e) => setAgencia(e.target.value)} ayuda="Lo que firma los mensajes. Si ya tenías plantillas con la firma anterior, pasan a la nueva." />

          <div>
            <p className="mb-1 text-sm font-semibold text-slate-700">Color principal</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                aria-label="Color principal"
                value={esColorHex(color) ? color : COLOR_DE_FABRICA}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
              />
              <span className="text-sm text-slate-600">{color ?? 'El azul de siempre'}</span>
              {color && (
                <Boton variante="fantasma" tamano="sm" onClick={() => setColor(null)}>
                  Volver al azul
                </Boton>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-semibold text-slate-700">Logo</p>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-marino-950 p-2">
                <LogoPropio
                  logo={logo}
                  tamano={44}
                  className="rounded-lg"
                  hijos={
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 text-cielo-200">
                      <Icono nombre="escudo" tamano={22} />
                    </div>
                  }
                />
              </div>
              <input ref={selector} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => void elegirLogo(e.target.files?.[0])} />
              <Boton variante="secundario" tamano="sm" onClick={() => selector.current?.click()}>
                Elegir imagen…
              </Boton>
              {logo && (
                <Boton variante="fantasma" tamano="sm" onClick={() => setLogo(null)}>
                  Quitar
                </Boton>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">PNG, JPG, WebP o SVG de hasta {Math.round(MAXIMO_DE_LOGO_EN_BYTES / 1024)} KB. Mejor cuadrado y con fondo transparente.</p>
          </div>

          {error && <Alerta tono="error">{error}</Alerta>}
          {aviso && <Alerta tono="exito">{aviso}</Alerta>}

          <div className="flex gap-2">
            <Boton onClick={() => void guardar()} cargando={guardando}>
              Guardar
            </Boton>
            <Boton variante="secundario" onClick={() => void restaurar()} disabled={guardando}>
              Volver a la marca de siempre
            </Boton>
          </div>
        </div>
      </Tarjeta>
      <Alerta tono="info">El nombre del instalador y del acceso directo de Windows no cambian desde acá: salen de cómo se arma el programa.</Alerta>
    </div>
  )
}
