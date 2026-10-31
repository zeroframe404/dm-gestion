// Cómo se ve la página pública, copiado para la vista previa del editor.
//
// LA PÁGINA LA ARMA EL SERVIDOR (`server/src/modules/milink/milink.pagina.ts` en Seguros_Daniel_Martinez):
// HTML con su propia hoja de estilos, sin Tailwind. Para que lo que se ve acá sea lo que va a ver la
// gente, la vista previa usa ESA hoja —las mismas medidas, radios, sombras y variantes de cada estilo—
// con las clases prefijadas `mlv-` y todo colgado de `.mlv`, para que nada se escape al resto del
// programa (la página tiene reglas sueltas para `ul`, `a` y `button` que acá romperían la barra).
// Si se toca el CSS de allá, se toca este; las variables de color salen de la misma cuenta.
//
// LA PÁGINA ES CLARA SIEMPRE (no tiene modo oscuro), así que la vista previa también: en el tema
// oscuro del programa se ve como una hoja clara apoyada sobre el fondo oscuro, que es justamente lo que
// va a ver quien la abra en el celular. Por eso estas clases no usan las de Tailwind que el tema
// oscuro da vuelta (`bg-white`, `text-slate-*`, ver estilos.css).
import type { CSSProperties } from 'react'
import { COLORES_DE_PAGINA } from '../../../../shared/miLink'

// ── Color ────────────────────────────────────────────────────────────────────────────────────────

type Rgb = [number, number, number]

function hexARgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbAHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((canal) => Math.round(canal).toString(16).padStart(2, '0')).join('')}`
}

function mezclar(a: Rgb, b: Rgb, peso: number): Rgb {
  return [0, 1, 2].map((i) => a[i]! * peso + b[i]! * (1 - peso)) as Rgb
}

function luminancia(rgb: Rgb): number {
  const [r, g, b] = rgb.map((canal) => {
    const c = canal / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Las variantes del color, con la misma cuenta que `coloresDelDiseno` del servidor: el «fuerte» (el que
 * lleva texto blanco encima) se oscurece hasta el 4,5:1 si eligieron un color claro con «Elegir otro
 * color». Si acá se calculara distinto, el amarillo de la vista previa no sería el de la página.
 */
export function coloresDelDiseno(color: string) {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : COLORES_DE_PAGINA[0]!.hex
  const base = hexARgb(hex)
  let fuerte = base
  for (let paso = 0; paso < 12 && 1.05 / (luminancia(fuerte) + 0.05) < 4.5; paso++) fuerte = mezclar(fuerte, [0, 0, 0], 0.9)
  const blanco: Rgb = [255, 255, 255]
  return {
    acento: hex,
    fuerte: rgbAHex(fuerte),
    suave: rgbAHex(mezclar(base, blanco, 0.1)),
    borde: rgbAHex(mezclar(base, blanco, 0.28)),
    profundo: rgbAHex(mezclar(fuerte, [0, 0, 0], 0.72)),
  }
}

/** Las variables CSS de la página para un color, listas para el `style` de `.mlv`. */
export function variablesDelColor(color: string): CSSProperties {
  const colores = coloresDelDiseno(color)
  return {
    '--acento': colores.acento,
    '--fuerte': colores.fuerte,
    '--suave': colores.suave,
    '--borde-acento': colores.borde,
    '--profundo': colores.profundo,
  } as CSSProperties
}

// ── Íconos ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Los trazos de la página pública, tal cual (24×24, línea de 2). No son los de `Icono.tsx`: la página
 * tiene los suyos (no hay ícono de bici ni de caución en el programa) y la vista previa tiene que
 * mostrar los mismos. Son constantes de este archivo; ningún texto de la persona pasa por acá.
 */
export const TRAZOS_DE_LA_PAGINA: Record<string, string> = {
  whatsapp: '<path d="M3 21l1.65-4.8A8.5 8.5 0 1 1 7.8 19.4z"/><path d="M9 10c0 3 2 5 5 5l1.2-1.2-2-1-.8.6c-.9-.4-1.5-1-1.8-1.8l.6-.8-1-2L9 10"/>',
  telefono: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  email: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  tiktok: '<path d="M15 3c.4 2.7 2.3 4.6 5 5"/><path d="M15 3v12.5a4.5 4.5 0 1 1-4.5-4.5"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  direccion: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  auto: '<path d="M19 17h2a1 1 0 0 0 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4a1 1 0 0 0 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  moto: '<circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M8 17h5l3-6h-5l-2-3H6M16 11l3 6M14 6h3l1 3"/>',
  hogar: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  vida: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  accidentes: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M9 12h6M12 9v6"/>',
  comercio: '<path d="M3 9h18l-1.5-5h-15z"/><path d="M5 9v11h14V9M9 20v-6h6v6"/>',
  bicicleta: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  celular: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  art: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  caucion: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>',
  otro: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
  siniestro: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  flecha: '<path d="M5 12h14M13 6l6 6-6 6"/>',
}

// ── La hoja de estilos ───────────────────────────────────────────────────────────────────────────

/**
 * La hoja de `milink.pagina.ts` (CSS_BASE y `hojaDeEstilos`) colgada de `.mlv`. Las reglas de
 * `@media (min-width:600px)` de allá van con `@container`: la vista previa no ocupa la ventana, ocupa
 * una columna, y lo que tiene que mirar es el ancho de esa columna (las miniaturas del panel, con 420
 * px, se ven como en el celular; la grande, como en la compu). Al final, lo que es sólo del editor.
 * Arriba de todo, `--mlv-panel`: el color del fondo del panel en cada tema (el de `bg-white` en
 * estilos.css), para el hueco del anillo del color elegido.
 */
export const CSS_DE_LA_VISTA = `
:root{--mlv-panel:#fff}
html[data-theme='dark']{--mlv-panel:#101a2e}
.mlv{--fondo:#f7f7fb;--superficie:#fff;--texto:#16162b;--texto-2:#5d5d75;--linea:#e8e8f0;--linea-2:#d4d4e0;--sombra:0 1px 2px rgba(22,22,43,.04),0 6px 20px rgba(22,22,43,.06);--sombra-alta:0 2px 4px rgba(22,22,43,.05),0 14px 32px rgba(22,22,43,.10);--radio:18px;container-type:inline-size;background:var(--fondo);color:var(--texto);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;text-align:left}
.mlv.mlv-estilo-sello{--fondo:#fff}
.mlv *,.mlv *::before,.mlv *::after{box-sizing:border-box}
.mlv button,.mlv input,.mlv textarea{font:inherit;color:inherit}
.mlv ul{list-style:none;margin:0;padding:0}
.mlv h1,.mlv h2,.mlv p{margin:0}
.mlv :focus-visible{outline:3px solid var(--acento);outline-offset:2px}
.mlv .mlv-icono{width:22px;height:22px;flex:none}
.mlv .mlv-icono-chico{width:18px;height:18px}
.mlv .mlv-pagina{max-width:560px;margin:0 auto;padding:0 16px 32px}

.mlv .mlv-cabecera{position:relative;text-align:center;padding:48px 8px 8px;isolation:isolate}
.mlv .mlv-decorado{position:absolute;z-index:-1;pointer-events:none;overflow:hidden}
.mlv .mlv-avatar{position:relative;width:112px;height:112px;margin:0 auto;border-radius:50%;display:grid;place-items:center;background:var(--fuerte);color:#fff;font-size:40px;font-weight:700;letter-spacing:-.02em;border:4px solid var(--superficie);box-shadow:var(--sombra-alta);overflow:hidden}
.mlv .mlv-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.mlv .mlv-nombre{margin:18px 0 6px;font-size:28px;line-height:1.15;letter-spacing:-.025em;font-weight:750;overflow-wrap:anywhere}
.mlv .mlv-bio{margin:0 auto;max-width:42ch;color:var(--texto-2);font-size:16px;overflow-wrap:anywhere}

.mlv.mlv-fondo-franja .mlv-decorado{inset:0 -16px auto;height:136px;background:var(--fuerte)}
.mlv.mlv-fondo-degradado .mlv-decorado{inset:0 -16px auto;height:260px;background:linear-gradient(180deg,var(--borde-acento) 0%,var(--suave) 55%,transparent 100%)}
.mlv.mlv-fondo-iniciales .mlv-decorado{inset:0 -16px auto;height:240px;display:grid;place-items:center}
.mlv .mlv-marca-de-agua{font-size:220px;line-height:1;font-weight:800;letter-spacing:-.06em;color:var(--acento);opacity:.09;user-select:none;transform:translateY(-6px)}
.mlv.mlv-fondo-tarjeta .mlv-cabecera{margin-top:16px;padding:36px 20px 28px;background:var(--suave);border-radius:24px}
.mlv.mlv-fondo-franja .mlv-cabecera{padding-top:72px}

.mlv .mlv-seccion{margin-top:28px}
.mlv .mlv-titulo-seccion{margin:0 4px 12px;font-size:19px;line-height:1.3;font-weight:700;letter-spacing:-.015em}

.mlv .mlv-contactos{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mlv .mlv-contacto{display:flex;align-items:center;gap:12px;min-height:64px;padding:12px 14px;background:var(--superficie);border:1px solid var(--linea);border-radius:var(--radio);box-shadow:var(--sombra)}
.mlv .mlv-contacto-icono{display:grid;place-items:center;width:40px;height:40px;flex:none;border-radius:12px;background:var(--suave);color:var(--fuerte)}
.mlv .mlv-contacto-texto{display:grid;min-width:0}
.mlv .mlv-contacto-tipo{font-weight:650;font-size:15px;line-height:1.25}
.mlv .mlv-contacto-valor{font-size:13px;color:var(--texto-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.mlv .mlv-coberturas{display:grid;gap:12px}
.mlv .mlv-cobertura{width:100%;height:100%;display:flex;align-items:center;gap:14px;padding:16px;text-align:left;background:var(--superficie);border:1px solid var(--linea);border-radius:var(--radio);box-shadow:var(--sombra)}
.mlv .mlv-cobertura-icono{display:grid;place-items:center;width:48px;height:48px;flex:none;border-radius:14px;background:var(--suave);color:var(--fuerte)}
.mlv .mlv-cobertura-icono .mlv-icono{width:26px;height:26px}
.mlv .mlv-cobertura-texto{display:grid;gap:2px;flex:1;min-width:0;width:100%}
.mlv .mlv-cobertura-titulo{font-weight:700;font-size:16px;line-height:1.3;overflow-wrap:anywhere}
.mlv .mlv-cobertura-descripcion{font-size:14px;color:var(--texto-2);line-height:1.4;overflow-wrap:anywhere}
.mlv .mlv-cobertura-accion{display:inline-flex;align-items:center;gap:4px;flex:none;font-size:14px;font-weight:650;color:var(--fuerte)}

.mlv .mlv-links{display:grid;gap:10px}
.mlv .mlv-link{display:flex;align-items:center;gap:12px;min-height:56px;padding:14px 18px;background:var(--superficie);border:1px solid var(--linea);border-radius:var(--radio);box-shadow:var(--sombra);font-weight:650}
.mlv .mlv-link-icono{color:var(--fuerte)}
.mlv .mlv-link-titulo{flex:1;min-width:0;overflow-wrap:anywhere}
.mlv .mlv-link-flecha{color:var(--texto-2)}

.mlv .mlv-siniestro{width:100%;display:flex;align-items:center;gap:14px;padding:16px;text-align:left;background:#fff6f5;border:1px solid #f6d5d2;border-radius:var(--radio);color:#7a1d16}
.mlv .mlv-siniestro-icono{display:grid;place-items:center;width:44px;height:44px;flex:none;border-radius:14px;background:#fde4e1;color:#b42318}
.mlv .mlv-siniestro-texto{display:grid;flex:1}
.mlv .mlv-siniestro-titulo{font-weight:700}
.mlv .mlv-siniestro-descripcion{font-size:14px;color:#8f3a33}

.mlv .mlv-pie{margin-top:40px;text-align:center;font-size:13px;color:var(--texto-2)}
.mlv .mlv-pie strong{color:var(--texto);font-weight:650}

.mlv.mlv-estilo-sello .mlv-nombre{font-size:34px}
.mlv.mlv-estilo-sello .mlv-contactos{display:flex;flex-wrap:wrap;justify-content:center;gap:16px 10px}
.mlv.mlv-estilo-sello .mlv-contactos>li{width:76px}
.mlv.mlv-estilo-sello .mlv-contacto{flex-direction:column;gap:6px;min-height:0;padding:0;background:none;border:0;box-shadow:none;text-align:center}
.mlv.mlv-estilo-sello .mlv-contacto-icono{width:56px;height:56px;border-radius:50%}
.mlv.mlv-estilo-sello .mlv-contacto-tipo{font-size:12px;font-weight:600;color:var(--texto-2)}
.mlv.mlv-estilo-sello .mlv-contacto-valor{display:none}
.mlv.mlv-estilo-sello .mlv-coberturas{grid-template-columns:1fr 1fr}
.mlv.mlv-estilo-sello .mlv-cobertura{flex-direction:column;align-items:flex-start;gap:10px;padding:16px 14px;background:#fafafd}
.mlv.mlv-estilo-sello .mlv-cobertura-descripcion{font-size:13px}
.mlv.mlv-estilo-sello .mlv-cobertura-accion{margin-top:auto;font-size:13px;white-space:nowrap}
.mlv.mlv-estilo-sello .mlv-link{justify-content:center;text-align:center;background:none;box-shadow:none;border:1.5px solid var(--linea-2)}
.mlv.mlv-estilo-sello .mlv-link-icono,.mlv.mlv-estilo-sello .mlv-link-flecha{display:none}
.mlv.mlv-estilo-sello .mlv-link-titulo{flex:none}

.mlv.mlv-estilo-botones .mlv-contactos{grid-template-columns:1fr}
.mlv.mlv-estilo-botones .mlv-contacto{min-height:58px;padding:10px 12px;border-radius:999px;background:var(--fuerte);border-color:transparent;color:#fff}
.mlv.mlv-estilo-botones .mlv-contacto-icono{background:rgba(255,255,255,.16);color:#fff;border-radius:50%}
.mlv.mlv-estilo-botones .mlv-contacto-texto{flex:1;text-align:center;margin-right:40px}
.mlv.mlv-estilo-botones .mlv-contacto-valor{color:rgba(255,255,255,.82)}
.mlv.mlv-estilo-botones .mlv-cobertura{border-radius:999px;padding:10px 20px 10px 10px}
.mlv.mlv-estilo-botones .mlv-cobertura-icono{border-radius:50%}
.mlv.mlv-estilo-botones .mlv-cobertura-descripcion,.mlv.mlv-estilo-botones .mlv-cobertura-accion-texto{display:none}
.mlv.mlv-estilo-botones .mlv-cobertura-accion{color:var(--texto-2)}
.mlv.mlv-estilo-botones .mlv-link{border-radius:999px;justify-content:center;text-align:center}
.mlv.mlv-estilo-botones .mlv-link-titulo{flex:none}
.mlv.mlv-estilo-botones .mlv-link-icono,.mlv.mlv-estilo-botones .mlv-link-flecha{display:none}
.mlv.mlv-estilo-botones .mlv-siniestro{border-radius:999px;padding:10px 20px 10px 10px}
.mlv.mlv-estilo-botones .mlv-siniestro-icono{border-radius:50%}

.mlv.mlv-estilo-marca .mlv-cabecera{margin:0 -16px;padding:44px 24px 36px;background:var(--fuerte);color:#fff;border-radius:0 0 28px 28px}
.mlv.mlv-estilo-marca .mlv-avatar{border-color:rgba(255,255,255,.9);background:var(--profundo)}
.mlv.mlv-estilo-marca .mlv-bio{color:rgba(255,255,255,.86)}
.mlv.mlv-estilo-marca .mlv-cabecera .mlv-decorado{inset:0;height:auto;border-radius:inherit}
.mlv.mlv-estilo-marca.mlv-fondo-franja .mlv-cabecera{padding-top:44px}
.mlv.mlv-estilo-marca.mlv-fondo-franja .mlv-decorado{background:linear-gradient(165deg,transparent 0 58%,rgba(255,255,255,.12) 58% 100%)}
.mlv.mlv-estilo-marca.mlv-fondo-degradado .mlv-decorado{background:linear-gradient(160deg,var(--acento) 0%,var(--fuerte) 45%,var(--profundo) 100%)}
.mlv.mlv-estilo-marca.mlv-fondo-iniciales .mlv-marca-de-agua{color:#fff;opacity:.1}
.mlv.mlv-estilo-marca.mlv-fondo-tarjeta .mlv-cabecera{margin:16px 0 0;border-radius:24px;background:var(--fuerte)}
.mlv.mlv-estilo-marca .mlv-seccion:first-of-type{margin-top:20px}
.mlv.mlv-estilo-marca .mlv-contactos{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.mlv.mlv-estilo-marca .mlv-contacto{min-height:0;padding:6px 14px 6px 6px;border-radius:999px;gap:8px}
.mlv.mlv-estilo-marca .mlv-contacto-icono{width:32px;height:32px;border-radius:50%}
.mlv.mlv-estilo-marca .mlv-contacto-icono .mlv-icono{width:18px;height:18px}
.mlv.mlv-estilo-marca .mlv-contacto-tipo{font-size:14px}
.mlv.mlv-estilo-marca .mlv-contacto-valor{display:none}
.mlv.mlv-estilo-marca .mlv-coberturas{grid-template-columns:1fr}
.mlv.mlv-estilo-marca .mlv-cobertura{flex-wrap:wrap;padding:18px;border-left:4px solid var(--fuerte)}
.mlv.mlv-estilo-marca .mlv-cobertura-icono{background:var(--fuerte);color:#fff}
.mlv.mlv-estilo-marca .mlv-cobertura-texto{width:auto}
.mlv.mlv-estilo-marca .mlv-cobertura-accion{width:100%;justify-content:flex-end;padding-top:10px;border-top:1px solid var(--linea)}
.mlv.mlv-estilo-marca .mlv-titulo-seccion{font-size:20px}

@container (min-width:600px){
  .mlv .mlv-pagina{padding:0 24px 48px}
  .mlv.mlv-fondo-franja .mlv-decorado,.mlv.mlv-fondo-degradado .mlv-decorado,.mlv.mlv-fondo-iniciales .mlv-decorado{inset:0 0 auto;border-radius:0 0 28px 28px}
  .mlv.mlv-estilo-marca .mlv-cabecera{margin:0}
  .mlv.mlv-estilo-sello .mlv-contactos>li{width:84px}
}

/* ── Lo del editor ─────────────────────────────────────────────────────────────────────────────
   El texto se edita en el lugar: un campo sin marco que hereda la letra de lo que reemplaza, con el
   borde punteado al pasar para que se note que se puede tocar. field-sizing hace que crezca con lo
   que se escribe, como el texto de la página. */
.mlv .mlv-editable{display:block;width:100%;margin:0;padding:2px 6px;background:transparent;border:1.5px dashed transparent;border-radius:10px;outline:none;resize:none;field-sizing:content;font:inherit;color:inherit;letter-spacing:inherit;text-align:inherit;line-height:inherit;overflow-wrap:anywhere;cursor:text;transition:border-color .12s ease,background .12s ease}
.mlv .mlv-editable::placeholder{color:currentColor;opacity:.45}
.mlv .mlv-editable:hover{border-color:var(--linea-2)}
.mlv .mlv-editable:focus{border-color:var(--acento);background:rgba(255,255,255,.7)}
.mlv.mlv-estilo-marca .mlv-cabecera .mlv-editable:hover{border-color:rgba(255,255,255,.55)}
.mlv.mlv-estilo-marca .mlv-cabecera .mlv-editable:focus{border-color:#fff;background:rgba(255,255,255,.12)}
.mlv .mlv-nombre .mlv-editable{margin:0 -6px;width:calc(100% + 12px)}
.mlv .mlv-bio .mlv-editable{min-width:16ch;margin:0 auto}

.mlv .mlv-bloque{position:relative;min-width:0}
.mlv .mlv-acciones{position:absolute;top:-14px;right:-6px;z-index:3;display:flex;gap:2px;padding:3px;background:#fff;color:#5d5d75;border:1px solid var(--linea);border-radius:10px;box-shadow:var(--sombra-alta);opacity:0;pointer-events:none;transition:opacity .12s ease}
.mlv .mlv-bloque:hover>.mlv-acciones,.mlv .mlv-bloque:focus-within>.mlv-acciones{opacity:1;pointer-events:auto}
.mlv .mlv-bloque:hover>.mlv-contacto,.mlv .mlv-bloque:hover>.mlv-cobertura,.mlv .mlv-bloque:hover>.mlv-link,.mlv .mlv-bloque:hover>.mlv-siniestro{outline:1.5px dashed var(--borde-acento);outline-offset:3px}
.mlv .mlv-accion{display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:none;color:inherit;cursor:pointer}
.mlv .mlv-accion:hover{background:#f1f1f6;color:#16162b}
.mlv .mlv-accion:disabled{opacity:.35;cursor:default;background:none}
.mlv .mlv-accion-borrar:hover{background:#fde4e1;color:#b42318}
.mlv .mlv-agregar{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;margin-top:12px;padding:10px 16px;border:1.5px dashed var(--linea-2);border-radius:var(--radio);background:none;color:var(--texto-2);font-size:14px;font-weight:600;cursor:pointer;transition:border-color .12s ease,color .12s ease,background .12s ease}
.mlv .mlv-agregar:hover{border-color:var(--fuerte);color:var(--fuerte);background:var(--suave)}
.mlv .mlv-agregar:disabled{opacity:.5;cursor:default;border-color:var(--linea-2);color:var(--texto-2);background:none}
.mlv .mlv-rotulo{margin:0 4px 10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--texto-2)}
.mlv .mlv-vacio{margin:0 4px;font-size:14px;color:var(--texto-2)}
.mlv .mlv-aviso{display:block;margin-top:2px;font-size:11px;font-weight:600;color:#b45309}
.mlv.mlv-estilo-botones .mlv-contacto .mlv-aviso{color:#fde68a}
`
