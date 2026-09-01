// El manual del programa, en un solo PDF corto y para leer de una sentada.
//
// Para quién es: alguien que entra a la agencia el lunes y el martes tiene que poder atender. No es
// la documentación completa —eso ya está, y es el botón «?» de cada pantalla, que explica esa
// pantalla con detalle—. Esto es el mapa: qué hay, dónde está y en qué orden se hacen las cosas.
//
// De dónde sale el texto: de `CONTENIDO_AYUDA` y de `MODULOS`, que ya están escritos en el tono
// correcto y para la gente de la agencia. Reescribirlos acá crearía una segunda versión que se
// desactualiza sola: el día que cambie una pantalla, la ayuda se corrige y el manual quedaría
// mintiendo. Lo único escrito a mano son la portada, los primeros pasos y los atajos.
//
// Este archivo es TypeScript puro: sin DOM, sin React y sin Electron. Lo importan tres lugares —la
// pantalla, el banco de pruebas y el script de línea de comandos— y si se le mete un `document.` deja
// de andar en dos de los tres.
import { AREAS, DESCRIPCION_AREA, NOMBRE_NIVEL, permisosPorDefecto } from '../../shared/permisos'
import { SUCURSALES } from '../../shared/sucursales'
import { NOMBRE_ROL } from '../../shared/tipos'
import { MODULOS, MODULO_ADMINISTRACION, type Modulo } from '../modulos'
import { CONTENIDO_AYUDA } from './contenido'
import type { ContenidoDeAyuda } from './tipos'

export interface DatosDelManual {
  /** La versión del programa, para la portada. */
  version: string
  /** Cuándo se generó, ya escrito («29 de agosto de 2026»). */
  fecha: string
  /** El logo como data URI. Vacío = la portada va sin logo, que se ve bien igual. */
  logo?: string
}

/**
 * La clave 'imputados' es la única que no sigue la convención «módulo» o «módulo.pestaña»: vive en la
 * ayuda de Cobranzas pero se llama así porque la misma pantalla se abre desde Cartera. Sin esta
 * excepción escrita, quedaría afuera del manual sin que nadie se entere.
 */
const CLAVES_HUERFANAS: Record<string, string> = { imputados: 'cobranzas' }

/** Las entradas de ayuda que le corresponden a un módulo, en el orden en que están declaradas. */
export function clavesDeAyudaDe(idModulo: string): string[] {
  return Object.keys(CONTENIDO_AYUDA).filter(
    (clave) => clave === idModulo || clave.startsWith(`${idModulo}.`) || CLAVES_HUERFANAS[clave] === idModulo,
  )
}

function escapar(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** «Cartera → Planilla del mes» se queda con «Planilla del mes»: el módulo ya está en el encabezado. */
function tituloCorto(contenido: ContenidoDeAyuda): string {
  const partes = contenido.titulo.split('→')
  return (partes[partes.length - 1] ?? contenido.titulo).trim()
}

/** El primer párrafo de la primera sección: es el que explica de qué se trata la pantalla. */
function primerParrafo(contenido: ContenidoDeAyuda): string {
  return contenido.secciones[0]?.parrafos[0] ?? contenido.resumen
}

/** Un párrafo largo, recortado en la última oración que entra. Cortar a mitad de frase se nota. */
function recortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto
  const cortado = texto.slice(0, maximo)
  const ultimoPunto = cortado.lastIndexOf('. ')
  return ultimoPunto > maximo * 0.5 ? cortado.slice(0, ultimoPunto + 1) : `${cortado.trimEnd()}…`
}

// ---------------------------------------------------------------------------
// Lo poco que se escribe a mano
// ---------------------------------------------------------------------------

const PRIMEROS_PASOS: Array<{ titulo: string; texto: string }> = [
  {
    titulo: '1. Entrar',
    texto:
      'Se entra con el usuario y la contraseña que te dio el administrador. La primera vez el programa te va a pedir que cambies la contraseña: es sólo tuya y nadie más la ve, tampoco quien te la dio. Si un día no hay internet, podés entrar igual con la contraseña de siempre y trabajar normalmente; cuando vuelva la conexión, todo lo que hiciste viaja solo.',
  },
  {
    titulo: '2. Mirar la barra de arriba',
    texto:
      'Arriba a la derecha están las dos campanas y el estado de la sincronización. La campana con el número son tus tareas; la del triángulo, los débitos que rebotaron en tu sucursal y hay que salir a cobrar. Cuando llega algo nuevo, además suena. El parlante de al lado apaga los sonidos en esta computadora si molestan.',
  },
  {
    titulo: '3. Empezar por Cartera',
    texto:
      'Cartera es la planilla del mes y es donde se pasa la mayor parte del día. Cada fila es una cuota. El color dice cómo viene: verde es que está paga, amarillo que está dentro de los días que la compañía sigue cubriendo, naranja que hoy es el último día y rojo que se venció. Desde ahí se avisa por WhatsApp y se registra el pago.',
  },
  {
    titulo: '4. Buscar a alguien',
    texto:
      'Clientes es la ficha de cada persona: sus datos, sus vehículos, sus pólizas, lo que pagó y sus siniestros, todo en una pantalla. Se busca por nombre, por documento, por patente o por número de póliza. Si estás atendiendo por teléfono, es la pantalla que querés tener abierta.',
  },
  {
    titulo: '5. Si algo no aparece',
    texto:
      'El programa se sincroniza solo cada tanto con lo que cargan las otras sucursales. Si algo que se cargó hoy no aparece, andá a Administración → Sincronizar y tocá «Sincronizar todo». Si después de eso sigue faltando, avisale a un administrador con lo que dice esa pantalla.',
  },
  {
    titulo: '6. El botón «?»',
    texto:
      'Cada pantalla y cada pestaña tienen un botón con un signo de pregunta arriba a la derecha. Ahí está explicado en detalle qué hace esa pantalla, con las palabras de la agencia y no las del programa. Este manual es el mapa; ese botón es el detalle.',
  },
]

const ATAJOS: Array<{ que: string; como: string }> = [
  { que: 'Buscar en un listado', como: 'Escribí en el campo de arriba: busca por nombre, documento, patente o número de póliza al mismo tiempo.' },
  { que: 'Ver una pantalla como planilla', como: 'El botón «Ver como Excel» de cada módulo, o el módulo «General Excel» para verlas todas.' },
  { que: 'Copiar datos a Excel', como: 'En la vista de planilla: Shift con las flechas para seleccionar y Ctrl+C. Se pega en Excel con cada celda en su celda.' },
  { que: 'Cerrar una ventana', como: 'La tecla Escape cierra la que esté arriba de todo, sin perder lo que estabas cargando debajo.' },
  { que: 'Bajar cualquier listado', como: 'Reportes arma el archivo de Excel o el PDF de cualquier listado, con los filtros que le pongas.' },
  { que: 'Apagar los sonidos', como: 'El parlante de la barra de arriba. Es de esta computadora, no de tu usuario.' },
  {
    que: 'Agrandar o achicar todo',
    como: 'Los botones «− 100 % +» de la barra de arriba, o Ctrl con «+», «−» y «0». La flecha de la barra azul la achica a una tira de iconos y deja más lugar para la tabla. Las dos cosas son de esta computadora.',
  },
  {
    que: 'Elegir qué columnas ver',
    como: 'El botón «Columnas», al lado de los filtros, apaga las que no uses. El nombre siempre queda a la izquierda.',
  },
  { que: 'Saber qué versión tenés', como: 'Administración → Acerca de. Es lo primero que te van a preguntar si pedís ayuda.' },
]

const CIERRE = [
  'Este manual es corto a propósito. Todo lo que no está acá está en el botón «?» de cada pantalla, explicado con más detalle y con las palabras de la agencia.',
  'Si algo del programa no hace lo que esperabas, no es que lo estés usando mal: avisá. La mayoría de las pantallas se hicieron mirando cómo se trabajaba antes en la planilla, y si algo quedó incómodo se puede cambiar.',
]

// ---------------------------------------------------------------------------
// El armado de las páginas
// ---------------------------------------------------------------------------

function hoja(numero: number, total: number, titulo: string, cuerpo: string): string {
  return `<section class="hoja">
  <header class="cabecera">
    <span class="marca">DM Gestión · Manual</span>
    <span class="titulo-hoja">${escapar(titulo)}</span>
  </header>
  <div class="cuerpo">${cuerpo}</div>
  <footer class="pie"><span>Seguros Daniel Martínez</span><span>${numero} de ${total}</span></footer>
</section>`
}

function fichaDeModulo(modulo: Modulo): string {
  const claves = clavesDeAyudaDe(modulo.id)
  // Sólo la ayuda DEL MÓDULO sirve como explicación. Un módulo que no la tiene —Administración, que
  // sólo tiene la de cada pestaña— se queda con su propia descripción: usar el primer párrafo de la
  // primera pestaña haría que la ficha de Administración hablara de la pantalla de Usuarios.
  const principal = CONTENIDO_AYUDA[modulo.id]
  const explicacion = principal ? recortar(primerParrafo(principal), 380) : modulo.descripcion
  // Las pestañas de adentro, que es lo que alguien no encuentra si no se las nombran.
  const pestanas = claves
    .map((clave) => CONTENIDO_AYUDA[clave])
    .filter((contenido): contenido is ContenidoDeAyuda => contenido !== undefined && contenido.clave !== modulo.id)
    .map((contenido) => tituloCorto(contenido))

  // Sin ayuda propia, la explicación ES la descripción: mostrarla dos veces se lee como un error.
  const repetida = explicacion === modulo.descripcion

  return `<article class="modulo">
    <h3>${escapar(modulo.nombre)}</h3>
    ${repetida ? '' : `<p class="para-que">${escapar(modulo.descripcion)}</p>`}
    <p>${escapar(explicacion)}</p>
    ${pestanas.length > 0 ? `<p class="pestanas"><strong>Adentro:</strong> ${escapar(pestanas.join(' · '))}</p>` : ''}
  </article>`
}

/**
 * Los términos que un recién llegado necesita entender el primer día, en el orden en que se los
 * cruza. Se nombran a mano porque elegirlos automáticamente no funciona: casi todos están definidos
 * una sola vez, así que ordenar por frecuencia y cortar deja las catorce que empiezan con A.
 *
 * Los textos NO se escriben acá: se buscan por nombre en la ayuda, que es donde ya están redactados.
 * Si alguno cambia de nombre en la ayuda, deja de encontrarse y la prueba del manual lo caza.
 */
const TERMINOS_DEL_GLOSARIO = [
  'Semáforo',
  'Cobertura financiera',
  'Débito automático',
  'Cuota del mes abierto',
  'Vencida',
  'Activos',
  'Altas',
  'Baja',
  'Mes cerrado',
  'Vigente',
  'Tarea',
  'Sucursal del mostrador',
  'Sincronizar',
  'Área',
]

/**
 * El glosario del manual: los conceptos que atraviesan el programa.
 *
 * La ayuda define casi doscientos términos y en una página entran catorce, así que hay que elegir. Se
 * eligen los que están definidos en MÁS pantallas: si «cuota» aparece explicada en Cartera, en
 * Cobranzas y en Clientes, es porque se cruza en todos lados y es de las que hay que entender. Cortar
 * por orden alfabético daría las catorce que empiezan con A, que no es lo mismo que las catorce que
 * importan.
 *
 * Se descarta lo que no empieza con letra («.xlsx», ««vence en x días»»): son entradas útiles en su
 * pantalla y raras como primera línea de un glosario.
 */
function conceptosDelPrograma(tope: number): Array<{ termino: string; explicacion: string }> {
  const vistos = new Map<string, { termino: string; explicacion: string; veces: number }>()
  for (const contenido of Object.values(CONTENIDO_AYUDA)) {
    for (const concepto of contenido.conceptos ?? []) {
      const termino = concepto.termino.trim()
      if (!/^\p{L}/u.test(termino)) continue
      const clave = termino.toLocaleLowerCase('es')
      const previo = vistos.get(clave)
      if (previo) previo.veces++
      // Se guarda la explicación de la PRIMERA aparición: la ayuda está en orden de módulo, así que
      // la primera es la del módulo donde ese concepto nace.
      else vistos.set(clave, { termino, explicacion: concepto.explicacion, veces: 1 })
    }
  }
  // Primero los elegidos a mano, en el orden en que estén en la ayuda; después, si faltan, los que
  // están definidos en más pantallas, que son los que de verdad se cruzan en todos lados.
  const elegidos = TERMINOS_DEL_GLOSARIO.map((termino) => vistos.get(termino.toLocaleLowerCase('es'))).filter(
    (concepto): concepto is { termino: string; explicacion: string; veces: number } => concepto !== undefined,
  )
  const yaEstan = new Set(elegidos.map((concepto) => concepto.termino))
  const relleno = [...vistos.values()]
    .filter((concepto) => !yaEstan.has(concepto.termino))
    .sort((a, b) => b.veces - a.veces || a.termino.localeCompare(b.termino, 'es'))

  return [...elegidos, ...relleno]
    .slice(0, tope)
    // Elegidos por importancia, mostrados por orden alfabético: es un glosario, se busca leyendo.
    .sort((a, b) => a.termino.localeCompare(b.termino, 'es'))
    .map((concepto) => ({
      termino: concepto.termino.charAt(0).toLocaleUpperCase('es') + concepto.termino.slice(1),
      explicacion: recortar(concepto.explicacion, 250),
    }))
}

/**
 * El manual entero, en un HTML A4 listo para imprimir.
 *
 * Son once páginas: portada, para qué sirve, primeros pasos, cuatro de módulos, roles y permisos,
 * atajos, glosario y contratapa. El tope son doce; más que eso deja de ser un manual que alguien lee.
 */
export function htmlDelManual(datos: DatosDelManual): string {
  const modulos = MODULOS.filter((modulo) => modulo.id !== 'inicio')
  // Cinco fichas por página: es lo que entra sin apretarlas y sin dejar media hoja en blanco.
  const porPagina = 5
  const paginasDeModulos: Modulo[][] = []
  const todos = [...modulos, MODULO_ADMINISTRACION]
  for (let i = 0; i < todos.length; i += porPagina) paginasDeModulos.push(todos.slice(i, i + porPagina))

  // Las fijas son siete: portada, qué es, primeros pasos, roles, atajos, glosario y contratapa.
  const total = 7 + paginasDeModulos.length
  let numero = 0
  const paginas: string[] = []

  // --- 1. Portada ----------------------------------------------------------
  paginas.push(`<section class="hoja portada">
  <div class="portada-arriba">
    ${datos.logo ? `<img class="logo" src="${datos.logo}" alt="" />` : ''}
    <p class="portada-marca">Seguros Daniel Martínez</p>
    <h1>DM&nbsp;Gestión</h1>
    <p class="portada-bajada">Manual para empezar a usar el programa</p>
  </div>
  <div class="portada-abajo">
    <p class="portada-nota">Lo que hay, dónde está y en qué orden se hacen las cosas. Se lee en veinte minutos.</p>
    <p class="portada-version">Versión ${escapar(datos.version)} · ${escapar(datos.fecha)}</p>
  </div>
</section>`)
  numero++

  // --- 2. Qué es esto ------------------------------------------------------
  paginas.push(
    hoja(
      ++numero,
      total,
      'Qué es DM Gestión',
      `<h2>Es la planilla de siempre, con memoria</h2>
      <p>Durante años la agencia trabajó sobre una hoja de cálculo: una fila por póliza, una pestaña por mes. DM Gestión hace lo mismo, pero además se acuerda: sabe que esa fila es de una persona que tiene otras dos pólizas, un siniestro abierto y una cuota que venció en marzo, y puede decírtelo cuando esa persona llama.</p>
      <p>Lo que en la planilla eran pestañas, acá son módulos, y están en la barra azul de la izquierda. Se pasa de uno a otro con un clic y lo que se carga en uno aparece en los demás sin tener que copiarlo.</p>

      <h2>Lo que cargás acá, lo ven todos</h2>
      <p>El programa está en las computadoras de las ${SUCURSALES.length} sucursales de la agencia y todas trabajan sobre los mismos datos. Cuando registrás un pago en Dock Sud, en Lanús lo ven a los pocos minutos. No hay que mandarse nada por WhatsApp ni pasar planillas.</p>
      <p>Eso vale también al revés: si algo que cargaron hoy en otra sucursal todavía no aparece, no está perdido, está viajando. En Administración → Sincronizar hay un botón para apurarlo.</p>

      <h2>Trabaja sin internet</h2>
      <p>Si se corta la conexión, el programa sigue funcionando: podés entrar, buscar, cobrar y cargar. Todo queda guardado en esa computadora y sale solo cuando vuelve internet. No hay que hacer nada especial ni anotar nada en papel.</p>

      <h2>Lo que ves depende de tu usuario</h2>
      <p>No todos ven lo mismo, y no es desconfianza: es que nadie necesita tener a la vista lo que no usa. Un empleado tiene todo lo del día a día —cartera, clientes, cobranzas, siniestros, tareas— y no ve los números generales de la agencia. Si te falta algo que necesitás para trabajar, pedíselo a un administrador: se configura en un minuto.</p>`,
    ),
  )

  // --- 3. Primeros pasos ---------------------------------------------------
  paginas.push(
    hoja(
      ++numero,
      total,
      'Primeros pasos',
      `<p class="entrada">Seis cosas, en orden. Con esto ya se puede atender.</p>
      <ol class="pasos">
        ${PRIMEROS_PASOS.map((paso) => `<li><strong>${escapar(paso.titulo)}</strong><span>${escapar(paso.texto)}</span></li>`).join('\n        ')}
      </ol>`,
    ),
  )

  // --- 4 a 7. Los módulos --------------------------------------------------
  for (const [indice, grupo] of paginasDeModulos.entries()) {
    paginas.push(
      hoja(
        ++numero,
        total,
        indice === 0 ? 'Los módulos, uno por uno' : 'Los módulos (continuación)',
        (indice === 0
          ? '<p class="entrada">Cada uno es una parte del trabajo. En «Adentro» están las pestañas que tiene ese módulo, que es lo que después cuesta encontrar.</p>'
          : '') + grupo.map(fichaDeModulo).join('\n    '),
      ),
    )
  }

  // --- 8. Roles y permisos -------------------------------------------------
  const matriz = permisosPorDefecto()
  paginas.push(
    hoja(
      ++numero,
      total,
      'Quién ve qué',
      `<h2>Los tres roles</h2>
      <p><strong>${escapar(NOMBRE_ROL.EMPLEADO)}</strong> trabaja el día a día: la cartera, los clientes, la cobranza de su sucursal, los siniestros y las tareas. De Administración ve Compañías, Impresora, Sincronizar y Acerca de. Lo que no ve son los números generales de la agencia —lo recaudado del mes, las comisiones—, y sí ve todo lo que necesita para atender: la caja de su sucursal, la mora que tiene que cobrar y la cuota de la persona que tiene delante.</p>
      <p><strong>${escapar(NOMBRE_ROL.ADMIN)}</strong> ve además los números de la agencia, la base de datos, la sincronización y la conexión con Google.</p>
      <p><strong>${escapar(NOMBRE_ROL.SUPER_ADMIN)}</strong> tiene todo lo anterior más los usuarios y los permisos, y es el único que puede resolver un problema serio con la lista compartida de usuarios.</p>

      <h2>Se puede afinar módulo por módulo</h2>
      <p>Eso es lo que trae cada rol de fábrica, y en Administración → Permisos se puede recortar: dejar a los empleados con Cobranzas en «${escapar(NOMBRE_NIVEL.ver)}», por ejemplo, o sin Marketing. Lo que se configure ahí vale para todas las computadoras de la agencia.</p>
      <table class="permisos">
        <thead><tr><th>Módulo</th><th>${escapar(NOMBRE_ROL.ADMIN)}</th><th>${escapar(NOMBRE_ROL.EMPLEADO)}</th></tr></thead>
        <tbody>
          ${AREAS.map(
            (area) =>
              `<tr><td>${escapar(DESCRIPCION_AREA[area].nombre)}</td><td>${escapar(NOMBRE_NIVEL[matriz.ADMIN[area]])}</td><td>${escapar(NOMBRE_NIVEL[matriz.EMPLEADO[area]])}</td></tr>`,
          ).join('\n          ')}
        </tbody>
      </table>
      <p class="nota">Así viene de fábrica. Un superadministrador lo cambia cuando haga falta.</p>`,
    ),
  )

  // --- 9. Atajos -----------------------------------------------------------
  paginas.push(
    hoja(
      ++numero,
      total,
      'Para hacerlo más rápido',
      `<p class="entrada">Las cosas que más se buscan y dónde están.</p>
      <dl class="atajos">
        ${ATAJOS.map((atajo) => `<dt>${escapar(atajo.que)}</dt><dd>${escapar(atajo.como)}</dd>`).join('\n        ')}
      </dl>

      <h2>Tres cosas que conviene saber</h2>
      <p><strong>Nada se borra de verdad.</strong> Dar de baja una póliza, resolver un rechazo o cerrar una tarea no borra nada: queda registrado quién lo hizo y cuándo. Si te equivocaste, se puede volver atrás.</p>
      <p><strong>Dos personas no pueden tener el mismo documento.</strong> Si al cargar un cliente el programa te dice que ese DNI ya está, no insistas: es la misma persona. Abrí su ficha y cargale ahí lo que necesites.</p>
      <p><strong>Los textos de la planilla se muestran tal cual.</strong> Si una fecha vino escrita «12-05-80», así se ve. El programa no las reescribe, porque reescribirlas sería inventar.</p>`,
    ),
  )

  // --- 10. Glosario --------------------------------------------------------
  const conceptos = conceptosDelPrograma(14)
  paginas.push(
    hoja(
      ++numero,
      total,
      'Las palabras que se usan',
      `<p class="entrada">Las que aparecen en las pantallas y conviene tener claras.</p>
      <dl class="glosario">
        ${conceptos.map((concepto) => `<dt>${escapar(concepto.termino)}</dt><dd>${escapar(concepto.explicacion)}</dd>`).join('\n        ')}
      </dl>`,
    ),
  )

  // --- 11. Contratapa ------------------------------------------------------
  paginas.push(
    hoja(
      ++numero,
      total,
      'Para terminar',
      `${CIERRE.map((parrafo) => `<p class="cierre">${escapar(parrafo)}</p>`).join('\n      ')}
      <div class="recuadro">
        <h2>Si algo falla</h2>
        <p>Andá a <strong>Administración → Acerca de</strong> y anotá la versión que dice ahí. Con eso, y contando qué estabas haciendo cuando pasó, se resuelve mucho más rápido.</p>
        <p>Y si el problema es que algo que cargaron en otra sucursal no aparece, probá primero <strong>Administración → Sincronizar</strong>.</p>
      </div>
      <p class="firma">Seguros Daniel Martínez · DM Gestión ${escapar(datos.version)}</p>`,
    ),
  )

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Manual de DM Gestión</title><style>
  /* Los márgenes van en cero y el margen real lo hace el padding de cada hoja: printToPDF ya manda
     los suyos en cero y sumarlos dos veces cortaría el pie de página. */
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #1c2b45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* 296.9mm y no 297: con el alto exacto de A4, Chromium redondea para arriba y mete una hoja en
     blanco entre cada par. Probado. No lo «arregles» a 297. */
  .hoja {
    position: relative;
    width: 210mm;
    height: 296.9mm;
    padding: 16mm 18mm 14mm;
    page-break-after: always;
    break-after: page;
    overflow: hidden;
    background: #fff;
  }
  .hoja:last-child { page-break-after: auto; break-after: auto; }

  .cabecera { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #183f75; padding-bottom: 3mm; }
  .marca { font-size: 8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #7c88a0; }
  .titulo-hoja { font-size: 13pt; font-weight: 700; color: #183f75; }
  .cuerpo { margin-top: 7mm; font-size: 10pt; line-height: 1.55; }
  .pie { position: absolute; left: 18mm; right: 18mm; bottom: 9mm; display: flex; justify-content: space-between; border-top: 1px solid #dbe3ee; padding-top: 2.5mm; font-size: 8pt; color: #9aa5b8; }

  h2 { font-size: 11.5pt; color: #183f75; margin: 6mm 0 2mm; }
  .cuerpo > h2:first-child { margin-top: 0; }
  p { margin: 0 0 2.5mm; }
  .entrada { color: #55627a; font-style: italic; margin-bottom: 4mm; }
  .nota { font-size: 8.5pt; color: #7c88a0; margin-top: 2mm; }

  /* Portada */
  .portada { display: flex; flex-direction: column; justify-content: space-between; background: #0e254a; color: #fff; padding: 30mm 22mm 18mm; }
  .portada .logo { width: 22mm; height: 22mm; margin-bottom: 8mm; }
  .portada-marca { font-size: 10pt; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #93bcf0; margin: 0 0 4mm; }
  .portada h1 { font-size: 40pt; margin: 0; letter-spacing: -.02em; line-height: 1; }
  .portada-bajada { font-size: 14pt; color: #bfd8f8; margin: 5mm 0 0; }
  .portada-nota { font-size: 10.5pt; color: #93bcf0; margin: 0 0 4mm; max-width: 120mm; line-height: 1.6; }
  .portada-version { font-size: 9pt; color: #5d98e4; margin: 0; border-top: 1px solid rgba(147,188,240,.3); padding-top: 4mm; }

  /* Primeros pasos */
  .pasos { list-style: none; margin: 0; padding: 0; counter-reset: paso; }
  .pasos li { margin-bottom: 5mm; padding-left: 0; }
  .pasos strong { display: block; font-size: 10.5pt; color: #183f75; margin-bottom: 1mm; }
  .pasos span { display: block; color: #3c4a63; }

  /* Fichas de módulo */
  .modulo { margin-bottom: 4.5mm; padding-bottom: 4mm; border-bottom: 1px solid #eef2f9; }
  .modulo:last-child { border-bottom: none; }
  .modulo h3 { font-size: 11pt; color: #183f75; margin: 0 0 1mm; }
  .modulo .para-que { font-size: 9pt; color: #7c88a0; margin: 0 0 1.5mm; }
  .modulo p { font-size: 9.5pt; line-height: 1.5; margin: 0 0 1.5mm; color: #3c4a63; }
  .modulo .pestanas { font-size: 8.5pt; color: #55627a; margin: 0; }

  /* Tablas y listas de definición */
  table.permisos { width: 100%; border-collapse: collapse; margin: 3mm 0 0; font-size: 9pt; }
  table.permisos th { background: #eef2f9; color: #183f75; text-align: left; padding: 1.8mm 3mm; border-bottom: 1px solid #dbe3ee; }
  table.permisos td { padding: 1.5mm 3mm; border-bottom: 1px solid #f1f5fa; color: #3c4a63; }

  dl.atajos, dl.glosario { margin: 0; }
  dl.atajos dt, dl.glosario dt { font-weight: 700; color: #183f75; font-size: 9.5pt; margin-top: 3mm; }
  dl.atajos dd, dl.glosario dd { margin: .5mm 0 0; color: #3c4a63; font-size: 9.5pt; line-height: 1.5; }
  dl.glosario dt { margin-top: 2.5mm; }
  dl.glosario dd { font-size: 9pt; }

  .recuadro { margin: 6mm 0; padding: 5mm 6mm; background: #f0f6ff; border-left: 3px solid #183f75; border-radius: 0 2mm 2mm 0; }
  .recuadro h2 { margin-top: 0; }
  .cierre { font-size: 10.5pt; line-height: 1.6; color: #3c4a63; }
  .firma { margin-top: 8mm; font-size: 9pt; color: #7c88a0; }
</style></head><body>
${paginas.join('\n')}
</body></html>`
}

/** El nombre con el que se ofrece guardar. */
export function nombreDelManual(version: string): string {
  return `DM Gestion - Manual ${version}.pdf`
}
