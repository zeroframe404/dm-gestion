// El contrato entre el tema y la hoja de estilos.
//
// Esta prueba existe por un error que llegó a las computadoras de la agencia: el botón de tema
// escribía `data-theme="oscuro"` y el CSS estaba escrito contra `html[data-theme='dark']`. Todo
// compilaba, el botón cambiaba de icono, la preferencia se guardaba… y la pantalla seguía blanca,
// porque no había una sola regla enganchada al valor que se estaba escribiendo.
//
// Es un error que ningún tipo puede atrapar: son dos archivos distintos, uno TypeScript y el otro
// CSS, que tienen que decir exactamente la misma palabra. Así que se prueba leyendo los dos.
//
// Se importa `tema-valores` y no `tema`: el segundo toca `document` y `localStorage`, que en el
// banco de pruebas no existen. Por eso el valor del atributo vive en un archivo aparte, sin nada del
// navegador adentro (ver src/renderer/tema-valores.ts).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { TEMAS, VALOR_EN_EL_ATRIBUTO } from '../src/renderer/tema-valores'

/** El banco de pruebas corre desde la raíz del repositorio (`npm run prueba`). */
function leerDelRepo(relativa: string): string {
  return readFileSync(path.join(process.cwd(), relativa), 'utf8')
}

const estilos = leerDelRepo('src/renderer/estilos.css')

test('el valor que el tema escribe en el <html> es uno que el CSS sabe leer', () => {
  for (const tema of TEMAS) {
    const valor = VALOR_EN_EL_ATRIBUTO[tema]
    assert.ok(valor, `el tema «${tema}» tiene que tener un valor para el atributo data-theme`)
    assert.ok(
      estilos.includes(`data-theme='${valor}'`) || estilos.includes(`data-theme="${valor}"`),
      `el tema «${tema}» escribe data-theme="${valor}" y estilos.css no tiene NINGUNA regla para ese ` +
        `valor: el botón se daría vuelta y la pantalla quedaría igual.`,
    )
  }
})

test('el tema oscuro usa el valor estándar, el que entiende color-scheme', () => {
  assert.equal(VALOR_EN_EL_ATRIBUTO.oscuro, 'dark')
  assert.equal(VALOR_EN_EL_ATRIBUTO.claro, 'light')
})

test('el tema se aplica desde el mapa compartido y no con la palabra escrita a mano', () => {
  // Si alguien vuelve a escribir el valor a mano en `tema.ts`, el mapa deja de ser la única verdad y
  // la prueba de arriba pasaría a comprobar algo que la aplicación ya no usa.
  assert.match(
    leerDelRepo('src/renderer/tema.ts'),
    /setAttribute\('data-theme',\s*VALOR_EN_EL_ATRIBUTO\[/,
    'tema.ts tiene que sacar el valor de VALOR_EN_EL_ATRIBUTO (ver src/renderer/tema-valores.ts)',
  )
})

test('el tema oscuro le da vuelta el fondo de la página, no sólo el de las tarjetas', () => {
  // `body` toma su color del `@apply` de `@layer base`, no de la clase `.bg-slate-50`, así que las
  // reglas de las clases no lo alcanzan: sin una regla propia, la página quedaba blanca por detrás.
  assert.match(
    estilos,
    /html\[data-theme='dark'\]\s+body\s*\{/,
    'falta la regla del `body` en el tema oscuro: el fondo de la página quedaría claro',
  )
})

// --- El censo: que el tema oscuro no vuelva a quedar a medias -------------------------------------
//
// El error del atributo dejó el tema apagado del todo, pero hay una segunda forma de romperlo, más
// silenciosa: agregar una pantalla con colores que el bloque oscuro no conoce. Ahí el tema «anda»,
// sólo que ese panel queda blanco en el medio de la pantalla oscura, o con la letra invisible.
//
// El caso que más duele es el par que usan todas las pantallas: un fondo pálido (`bg-marino-50`,
// `bg-red-50`, `bg-green-50`…) con tinta oscura del mismo color encima. Si el fondo no se da vuelta
// y la tinta sí —o al revés—, queda ilegible. Así que se cuentan las clases que las pantallas usan
// de verdad y se exige que cada una tenga su regla.

/** Colores que a propósito son iguales en los dos temas, con el motivo de cada uno. */
const IGUALES_EN_LOS_DOS_TEMAS: Record<string, string> = {
  cielo: 'el acento de la barra lateral, que ya es oscura en los dos temas',
  white: 'texto y bordes sobre botones y barras de color pleno',
  black: 'texto y bordes sobre botones y barras de color pleno',
}

function archivosDePantallas(carpeta: string): string[] {
  const encontrados: string[] = []
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const completo = path.join(carpeta, entrada.name)
    if (entrada.isDirectory()) encontrados.push(...archivosDePantallas(completo))
    else if (entrada.name.endsWith('.tsx') || entrada.name.endsWith('.ts')) encontrados.push(completo)
  }
  return encontrados
}

const fuenteDeLasPantallas = archivosDePantallas(path.join(process.cwd(), 'src/renderer'))
  .map((archivo) => readFileSync(archivo, 'utf8'))
  .join('\n')

function contar(patron: RegExp): Map<string, number> {
  const cuenta = new Map<string, number>()
  for (const [clase, tono] of fuenteDeLasPantallas.matchAll(patron)) {
    if (IGUALES_EN_LOS_DOS_TEMAS[tono]) continue
    cuenta.set(clase, (cuenta.get(clase) ?? 0) + 1)
  }
  return cuenta
}

/** Busca la clase en el bloque oscuro, con los dos puntos y la barra escapados como los escribe el CSS. */
function tieneReglaOscura(clase: string): boolean {
  const escapada = clase.replace(/[:/]/g, (caracter) => '\\\\' + caracter)
  return new RegExp(`data-theme='dark'\\]\\s[^{]*\\.${escapada}(?![\\w-])`).test(estilos)
}

test('todo fondo pálido que usan las pantallas tiene su regla en el tema oscuro', () => {
  // `-50` y `-100` son los fondos de los paneles, los carteles y las vistas previas: sin regla
  // oscura quedan como un rectángulo casi blanco en el medio de una pantalla oscura.
  const sinRegla = [
    ...contar(/\bbg-(marino|cielo|slate|red|green|emerald|amber|violet|sky|orange|white|black)-(?:50|100)\b/g).keys(),
  ]
    .filter((clase) => !tieneReglaOscura(clase))
    .sort()

  assert.deepEqual(
    sinRegla,
    [],
    `estos fondos pálidos no tienen regla en el tema oscuro y van a quedar casi blancos: ${sinRegla.join(', ')}`,
  )
})

test('los fondos pálidos CON TRANSPARENCIA también tienen su regla', () => {
  // El agujero que dejó la prueba de arriba y que llegó a las computadoras de la agencia: en el aviso
  // de Google Drive la ruta del config.json va adentro de un `<code class="bg-amber-100/70">`. La
  // variante con transparencia es OTRA clase —`.bg-amber-100\/70`— y ninguna regla de `.bg-amber-100`
  // la alcanza, así que el chip se quedaba con el ámbar clarito del tema claro mientras la letra
  // (`text-amber-800`, ya dada vuelta) pasaba a ser amarilla: amarillo sobre amarillo, ilegible.
  //
  // Como el `\b` de la prueba anterior corta justo antes de la barra, ahí el caso pasaba desapercibido:
  // se veía `bg-amber-100`, que sí tiene regla. Por eso ésta busca la clase ENTERA, con su `/NN`.
  const sinRegla = [
    ...contar(/\bbg-(marino|cielo|slate|red|green|emerald|amber|violet|sky|orange|white|black)-(?:50|100)\/\d{1,3}\b/g).keys(),
  ]
    .filter((clase) => !tieneReglaOscura(clase))
    .sort()

  assert.deepEqual(
    sinRegla,
    [],
    `estos fondos translúcidos no tienen regla en el tema oscuro y van a quedar como una banda clara: ${sinRegla.join(', ')}`,
  )
})

test('toda la tinta oscura que usan las pantallas tiene su regla en el tema oscuro', () => {
  // La tinta de `600` para arriba es la que va sobre los fondos pálidos de arriba: si no se aclara,
  // queda casi negra sobre casi negro. Desde tres usos: con uno o dos suele ser un detalle suelto.
  const sinRegla = [
    ...contar(/\btext-(marino|cielo|slate|red|green|emerald|amber|violet|sky|orange|white|black)-(?:600|700|800|900)\b/g),
  ]
    .filter(([clase, veces]) => veces >= 3 && !tieneReglaOscura(clase))
    .map(([clase]) => clase)
    .sort()

  assert.deepEqual(
    sinRegla,
    [],
    `esta tinta no tiene regla en el tema oscuro y va a quedar ilegible: ${sinRegla.join(', ')}`,
  )
})
