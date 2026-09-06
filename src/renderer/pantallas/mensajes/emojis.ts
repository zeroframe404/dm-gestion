// El cajón de emojis del selector, con su buscador en castellano.
//
// Por qué una lista propia y no una biblioteca. Las bibliotecas de emojis pesan entre 300 KB y 2 MB
// (traen los 3.800 emojis de Unicode, sus nombres en veinte idiomas y las cinco variantes de tono de
// piel de cada uno) y hay que bajarlas de internet, cosa que la CSP de producción no permite. Acá
// hacen falta los que se usan de verdad para hablar entre compañeros de trabajo: un pulgar, una
// carita, un tilde, un auto, un teléfono. Doscientos y pico alcanzan y entran en el propio programa.
//
// Que la lista sea corta NO limita lo que se puede escribir: la caja de texto acepta cualquier
// carácter Unicode, incluido cualquier emoji pegado desde otro lado o escrito con el teclado de
// emojis de Windows (Win + .). Esto es un atajo para no tener que ir a buscarlo, nada más.
//
// Dos cosas de las que depende que esto funcione bien:
//   1. Los emojis se cuentan y se recortan por PUNTO DE CÓDIGO, nunca por posición de la cadena.
//      Casi todos ocupan dos unidades UTF-16 (un par sustituto) y varios de los de acá —👍🏽, 👨‍👩‍👧,
//      ❤️— son secuencias de varios puntos de código unidos por modificadores o por ZWJ. Cortar una
//      cadena por la mitad de una de esas secuencias no «acorta el emoji»: lo convierte en otro, o en
//      un rombo con un signo de pregunta. Por eso contar y recortar vive en `src/shared/texto.ts`
//      (`largoEnPuntos`, `recortarPorPuntos`) y acá se recorre con `Array.from`, nunca con `slice`.
//   2. Las palabras de búsqueda van sin tildes y en minúscula, y el buscador normaliza lo que se
//      escribe de la misma forma: en el mostrador nadie escribe «teléfono» con tilde cuando está
//      apurado.

export interface Emoji {
  /** El carácter, tal cual va al mensaje. */
  emoji: string
  /** Cómo se llama, para el título del botón. */
  nombre: string
  /** Con qué palabras se lo encuentra. Sin tildes y en minúscula. */
  palabras: string[]
}

export interface CategoriaDeEmojis {
  id: string
  nombre: string
  /** El emoji que representa la categoría en la fila de pestañas del selector. */
  icono: string
  emojis: Emoji[]
}

export const CATEGORIAS_DE_EMOJIS: CategoriaDeEmojis[] = [
  {
    id: 'caras',
    nombre: 'Caras',
    icono: '🙂',
    emojis: [
      { emoji: '😀', nombre: 'Sonrisa', palabras: ['sonrisa', 'feliz', 'contento', 'risa'] },
      { emoji: '😃', nombre: 'Sonrisa grande', palabras: ['sonrisa', 'feliz', 'alegre'] },
      { emoji: '😄', nombre: 'Sonrisa con ojos alegres', palabras: ['sonrisa', 'feliz', 'alegre'] },
      { emoji: '😁', nombre: 'Sonrisa radiante', palabras: ['sonrisa', 'dientes', 'feliz'] },
      { emoji: '😆', nombre: 'Risa', palabras: ['risa', 'carcajada', 'gracioso'] },
      { emoji: '😅', nombre: 'Risa nerviosa', palabras: ['risa', 'nervios', 'transpirando', 'uf'] },
      { emoji: '🤣', nombre: 'Tirado de risa', palabras: ['risa', 'carcajada', 'gracioso', 'jaja'] },
      { emoji: '😂', nombre: 'Llorando de risa', palabras: ['risa', 'llanto', 'gracioso', 'jaja'] },
      { emoji: '🙂', nombre: 'Sonrisa leve', palabras: ['sonrisa', 'bien', 'ok'] },
      { emoji: '🙃', nombre: 'Cara al revés', palabras: ['ironia', 'sarcasmo', 'reves'] },
      { emoji: '😉', nombre: 'Guiño', palabras: ['guino', 'complice', 'ojo'] },
      { emoji: '😊', nombre: 'Sonrisa tímida', palabras: ['sonrisa', 'timido', 'gracias', 'dulce'] },
      { emoji: '😇', nombre: 'Angelito', palabras: ['angel', 'santo', 'inocente'] },
      { emoji: '🥰', nombre: 'Enamorado', palabras: ['amor', 'corazones', 'carino'] },
      { emoji: '😍', nombre: 'Ojos de corazón', palabras: ['amor', 'enamorado', 'me encanta'] },
      { emoji: '😘', nombre: 'Beso', palabras: ['beso', 'carino', 'amor'] },
      { emoji: '😗', nombre: 'Besito', palabras: ['beso'] },
      { emoji: '😋', nombre: 'Sabroso', palabras: ['rico', 'comida', 'lengua', 'sabroso'] },
      { emoji: '😜', nombre: 'Lengua y guiño', palabras: ['lengua', 'joda', 'broma'] },
      { emoji: '🤪', nombre: 'Loco', palabras: ['loco', 'chiflado', 'broma'] },
      { emoji: '🤨', nombre: 'Ceja levantada', palabras: ['duda', 'sospecha', 'ceja', 'en serio'] },
      { emoji: '🧐', nombre: 'Con monóculo', palabras: ['duda', 'analizando', 'monoculo'] },
      { emoji: '🤓', nombre: 'Nerd', palabras: ['nerd', 'anteojos', 'estudioso'] },
      { emoji: '😎', nombre: 'Con anteojos de sol', palabras: ['copado', 'anteojos', 'sol', 'facil'] },
      { emoji: '🥳', nombre: 'Festejando', palabras: ['fiesta', 'festejo', 'cumpleanos'] },
      { emoji: '😏', nombre: 'Sonrisita', palabras: ['picaro', 'sonrisa', 'complice'] },
      { emoji: '😒', nombre: 'Sin ganas', palabras: ['fastidio', 'sin ganas', 'aburrido'] },
      { emoji: '😞', nombre: 'Decepcionado', palabras: ['triste', 'decepcion', 'lastima'] },
      { emoji: '😔', nombre: 'Pensativo triste', palabras: ['triste', 'pensativo', 'lastima'] },
      { emoji: '😟', nombre: 'Preocupado', palabras: ['preocupado', 'inquieto'] },
      { emoji: '😕', nombre: 'Confundido', palabras: ['confundido', 'duda', 'no entiendo'] },
      { emoji: '🙁', nombre: 'Con el ceño fruncido', palabras: ['triste', 'mal'] },
      { emoji: '😣', nombre: 'Aguantando', palabras: ['esfuerzo', 'aguante', 'complicado'] },
      { emoji: '😖', nombre: 'Angustiado', palabras: ['angustia', 'complicado', 'mal'] },
      { emoji: '😫', nombre: 'Cansado', palabras: ['cansado', 'agotado', 'basta'] },
      { emoji: '😩', nombre: 'Agotado', palabras: ['cansado', 'agotado', 'no doy mas'] },
      { emoji: '🥺', nombre: 'Ojitos', palabras: ['porfa', 'ruego', 'pena', 'ojitos'] },
      { emoji: '😢', nombre: 'Llorando', palabras: ['llanto', 'triste', 'pena'] },
      { emoji: '😭', nombre: 'Llorando a mares', palabras: ['llanto', 'triste', 'mucho'] },
      { emoji: '😤', nombre: 'Resoplando', palabras: ['bronca', 'enojo', 'decidido'] },
      { emoji: '😠', nombre: 'Enojado', palabras: ['enojo', 'bronca', 'molesto'] },
      { emoji: '😡', nombre: 'Furioso', palabras: ['furia', 'enojo', 'bronca'] },
      { emoji: '🤯', nombre: 'Cabeza explotando', palabras: ['sorpresa', 'increible', 'no puede ser'] },
      { emoji: '😳', nombre: 'Sonrojado', palabras: ['verguenza', 'sorpresa', 'sonrojo'] },
      { emoji: '🥵', nombre: 'Con calor', palabras: ['calor', 'sofocado'] },
      { emoji: '🥶', nombre: 'Con frío', palabras: ['frio', 'helado'] },
      { emoji: '😱', nombre: 'Gritando de miedo', palabras: ['miedo', 'susto', 'grito'] },
      { emoji: '😨', nombre: 'Asustado', palabras: ['miedo', 'susto'] },
      { emoji: '😰', nombre: 'Angustiado con sudor', palabras: ['nervios', 'angustia', 'susto'] },
      { emoji: '😥', nombre: 'Aliviado con pena', palabras: ['alivio', 'pena', 'uf'] },
      { emoji: '😓', nombre: 'Transpirando', palabras: ['cansado', 'esfuerzo', 'uf'] },
      { emoji: '🤗', nombre: 'Abrazo', palabras: ['abrazo', 'carino', 'bienvenido'] },
      { emoji: '🤔', nombre: 'Pensando', palabras: ['pensar', 'duda', 'mmm'] },
      { emoji: '🤫', nombre: 'Silencio', palabras: ['silencio', 'secreto', 'shh'] },
      { emoji: '🤭', nombre: 'Tapándose la boca', palabras: ['ups', 'risa', 'verguenza'] },
      { emoji: '😐', nombre: 'Cara neutra', palabras: ['neutro', 'sin palabras', 'nada'] },
      { emoji: '😑', nombre: 'Sin expresión', palabras: ['neutro', 'aburrido', 'sin palabras'] },
      { emoji: '😶', nombre: 'Sin boca', palabras: ['mudo', 'sin palabras', 'silencio'] },
      { emoji: '😬', nombre: 'Mueca', palabras: ['incomodo', 'ups', 'nervios'] },
      { emoji: '🙄', nombre: 'Ojos en blanco', palabras: ['obvio', 'fastidio', 'ojos'] },
      { emoji: '😴', nombre: 'Durmiendo', palabras: ['dormir', 'sueno', 'cansado'] },
      { emoji: '🤒', nombre: 'Con fiebre', palabras: ['enfermo', 'fiebre', 'termometro'] },
      { emoji: '🤕', nombre: 'Lastimado', palabras: ['golpe', 'lastimado', 'accidente'] },
      { emoji: '🤧', nombre: 'Estornudando', palabras: ['resfrio', 'enfermo', 'estornudo'] },
      { emoji: '😷', nombre: 'Con barbijo', palabras: ['barbijo', 'enfermo', 'cuidado'] },
      { emoji: '🥴', nombre: 'Mareado', palabras: ['mareado', 'confundido'] },
      { emoji: '🤝', nombre: 'Apretón de manos', palabras: ['trato', 'acuerdo', 'saludo', 'hecho'] },
    ],
  },
  {
    id: 'gestos',
    nombre: 'Gestos',
    icono: '👍',
    emojis: [
      { emoji: '👍', nombre: 'Pulgar arriba', palabras: ['bien', 'ok', 'dale', 'listo', 'aprobado', 'pulgar'] },
      { emoji: '👎', nombre: 'Pulgar abajo', palabras: ['mal', 'no', 'rechazado', 'pulgar'] },
      { emoji: '👌', nombre: 'Perfecto', palabras: ['ok', 'perfecto', 'listo', 'dale'] },
      { emoji: '🤌', nombre: 'Dedos juntos', palabras: ['pero', 'que', 'gesto'] },
      { emoji: '✌️', nombre: 'Victoria', palabras: ['paz', 'victoria', 'dos'] },
      { emoji: '🤞', nombre: 'Dedos cruzados', palabras: ['suerte', 'ojala', 'esperemos'] },
      { emoji: '🙏', nombre: 'Gracias / por favor', palabras: ['gracias', 'por favor', 'ruego', 'manos'] },
      { emoji: '👏', nombre: 'Aplausos', palabras: ['aplauso', 'bravo', 'felicitaciones', 'bien'] },
      { emoji: '🙌', nombre: 'Manos arriba', palabras: ['festejo', 'bravo', 'alegria'] },
      { emoji: '👋', nombre: 'Saludo', palabras: ['hola', 'chau', 'saludo', 'adios'] },
      { emoji: '🤙', nombre: 'Llamame', palabras: ['llamar', 'telefono', 'llamame'] },
      { emoji: '💪', nombre: 'Fuerza', palabras: ['fuerza', 'aguante', 'vamos'] },
      { emoji: '🫡', nombre: 'Saludo militar', palabras: ['listo', 'a la orden', 'entendido'] },
      { emoji: '👇', nombre: 'Abajo', palabras: ['abajo', 'mira', 'aca'] },
      { emoji: '👆', nombre: 'Arriba', palabras: ['arriba', 'mira', 'aca'] },
      { emoji: '👉', nombre: 'A la derecha', palabras: ['derecha', 'mira', 'ese'] },
      { emoji: '👈', nombre: 'A la izquierda', palabras: ['izquierda', 'mira', 'ese'] },
      { emoji: '✍️', nombre: 'Escribiendo', palabras: ['escribir', 'firma', 'anotar'] },
      { emoji: '🫶', nombre: 'Corazón con las manos', palabras: ['amor', 'carino', 'gracias'] },
    ],
  },
  {
    id: 'trabajo',
    nombre: 'Trabajo',
    icono: '📄',
    emojis: [
      { emoji: '📄', nombre: 'Documento', palabras: ['documento', 'hoja', 'papel', 'poliza'] },
      { emoji: '📋', nombre: 'Planilla', palabras: ['planilla', 'lista', 'checklist', 'tareas'] },
      { emoji: '📁', nombre: 'Carpeta', palabras: ['carpeta', 'archivo', 'legajo'] },
      { emoji: '📎', nombre: 'Clip', palabras: ['adjunto', 'clip', 'archivo'] },
      { emoji: '🖨️', nombre: 'Impresora', palabras: ['imprimir', 'impresora'] },
      { emoji: '✅', nombre: 'Listo', palabras: ['listo', 'hecho', 'ok', 'tilde', 'aprobado'] },
      { emoji: '☑️', nombre: 'Tildado', palabras: ['tilde', 'listo', 'marcado'] },
      { emoji: '❌', nombre: 'Error', palabras: ['no', 'error', 'mal', 'cruz', 'rechazado'] },
      { emoji: '⚠️', nombre: 'Atención', palabras: ['atencion', 'cuidado', 'alerta', 'ojo'] },
      { emoji: '❗', nombre: 'Importante', palabras: ['importante', 'urgente', 'atencion'] },
      { emoji: '❓', nombre: 'Pregunta', palabras: ['pregunta', 'duda', 'consulta'] },
      { emoji: '📌', nombre: 'Fijado', palabras: ['fijar', 'chinche', 'importante', 'nota'] },
      { emoji: '📅', nombre: 'Calendario', palabras: ['fecha', 'calendario', 'vencimiento', 'dia'] },
      { emoji: '⏰', nombre: 'Reloj', palabras: ['hora', 'reloj', 'urgente', 'vence'] },
      { emoji: '⏳', nombre: 'Esperando', palabras: ['esperar', 'reloj', 'pendiente'] },
      { emoji: '💰', nombre: 'Plata', palabras: ['plata', 'dinero', 'pago', 'cobro'] },
      { emoji: '💵', nombre: 'Billetes', palabras: ['plata', 'efectivo', 'billete', 'pago'] },
      { emoji: '💳', nombre: 'Tarjeta', palabras: ['tarjeta', 'debito', 'credito', 'pago'] },
      { emoji: '🧾', nombre: 'Recibo', palabras: ['recibo', 'comprobante', 'factura', 'ticket'] },
      { emoji: '🏦', nombre: 'Banco', palabras: ['banco', 'transferencia'] },
      { emoji: '📞', nombre: 'Teléfono', palabras: ['telefono', 'llamar', 'llamado'] },
      { emoji: '📱', nombre: 'Celular', palabras: ['celular', 'telefono', 'whatsapp'] },
      { emoji: '💻', nombre: 'Computadora', palabras: ['computadora', 'pc', 'sistema'] },
      { emoji: '📧', nombre: 'Correo', palabras: ['mail', 'correo', 'email'] },
      { emoji: '🔒', nombre: 'Cerrado', palabras: ['cerrado', 'candado', 'seguro', 'clave'] },
      { emoji: '🔑', nombre: 'Llave', palabras: ['llave', 'clave', 'acceso'] },
      { emoji: '📊', nombre: 'Gráfico', palabras: ['grafico', 'metricas', 'numeros', 'estadistica'] },
      { emoji: '📈', nombre: 'Subiendo', palabras: ['subir', 'grafico', 'crece', 'aumento'] },
      { emoji: '📉', nombre: 'Bajando', palabras: ['bajar', 'grafico', 'cae', 'baja'] },
      { emoji: '🏢', nombre: 'Oficina', palabras: ['oficina', 'sucursal', 'edificio', 'agencia'] },
      { emoji: '🚗', nombre: 'Auto', palabras: ['auto', 'vehiculo', 'coche', 'poliza'] },
      { emoji: '🏍️', nombre: 'Moto', palabras: ['moto', 'vehiculo'] },
      { emoji: '🚙', nombre: 'Camioneta', palabras: ['camioneta', 'auto', 'vehiculo'] },
      { emoji: '🚚', nombre: 'Camión', palabras: ['camion', 'vehiculo', 'carga'] },
      { emoji: '💥', nombre: 'Choque', palabras: ['choque', 'golpe', 'siniestro', 'accidente'] },
      { emoji: '🔥', nombre: 'Fuego', palabras: ['fuego', 'incendio', 'siniestro', 'urgente'] },
      { emoji: '🏠', nombre: 'Casa', palabras: ['casa', 'hogar', 'domicilio', 'combinado'] },
      { emoji: '🩺', nombre: 'Salud', palabras: ['salud', 'medico', 'art'] },
      { emoji: '⚖️', nombre: 'Legal', palabras: ['legal', 'abogado', 'juicio', 'balanza'] },
    ],
  },
  {
    id: 'varios',
    nombre: 'Varios',
    icono: '⭐',
    emojis: [
      { emoji: '❤️', nombre: 'Corazón', palabras: ['amor', 'corazon', 'me gusta'] },
      { emoji: '🧡', nombre: 'Corazón naranja', palabras: ['corazon', 'amor'] },
      { emoji: '💚', nombre: 'Corazón verde', palabras: ['corazon', 'amor'] },
      { emoji: '💙', nombre: 'Corazón azul', palabras: ['corazon', 'amor'] },
      { emoji: '💜', nombre: 'Corazón violeta', palabras: ['corazon', 'amor'] },
      { emoji: '🖤', nombre: 'Corazón negro', palabras: ['corazon', 'amor'] },
      { emoji: '💔', nombre: 'Corazón roto', palabras: ['corazon', 'roto', 'triste'] },
      { emoji: '⭐', nombre: 'Estrella', palabras: ['estrella', 'favorito', 'destacado'] },
      { emoji: '🌟', nombre: 'Estrella brillante', palabras: ['estrella', 'brillo', 'excelente'] },
      { emoji: '✨', nombre: 'Brillos', palabras: ['brillo', 'nuevo', 'lindo'] },
      { emoji: '🎉', nombre: 'Festejo', palabras: ['fiesta', 'festejo', 'felicitaciones'] },
      { emoji: '🎊', nombre: 'Papelitos', palabras: ['fiesta', 'festejo'] },
      { emoji: '🎂', nombre: 'Torta', palabras: ['cumpleanos', 'torta', 'feliz cumple'] },
      { emoji: '🎁', nombre: 'Regalo', palabras: ['regalo', 'premio', 'sorpresa'] },
      { emoji: '☕', nombre: 'Café', palabras: ['cafe', 'descanso', 'desayuno'] },
      { emoji: '🧉', nombre: 'Mate', palabras: ['mate', 'descanso', 'cebar'] },
      { emoji: '🍕', nombre: 'Pizza', palabras: ['pizza', 'comida', 'almuerzo'] },
      { emoji: '🍔', nombre: 'Hamburguesa', palabras: ['hamburguesa', 'comida', 'almuerzo'] },
      { emoji: '🥗', nombre: 'Ensalada', palabras: ['ensalada', 'comida', 'almuerzo'] },
      { emoji: '🍺', nombre: 'Birra', palabras: ['cerveza', 'birra', 'after'] },
      { emoji: '☀️', nombre: 'Sol', palabras: ['sol', 'lindo dia', 'calor'] },
      { emoji: '🌧️', nombre: 'Lluvia', palabras: ['lluvia', 'mal tiempo', 'granizo'] },
      { emoji: '⛈️', nombre: 'Tormenta', palabras: ['tormenta', 'granizo', 'mal tiempo'] },
      { emoji: '❄️', nombre: 'Nieve', palabras: ['nieve', 'frio'] },
      { emoji: '🚨', nombre: 'Sirena', palabras: ['urgente', 'alerta', 'sirena', 'policia'] },
      { emoji: '🆗', nombre: 'OK', palabras: ['ok', 'listo', 'bien'] },
      { emoji: '🔴', nombre: 'Rojo', palabras: ['rojo', 'punto', 'vencido', 'semaforo'] },
      { emoji: '🟡', nombre: 'Amarillo', palabras: ['amarillo', 'punto', 'por vencer', 'semaforo'] },
      { emoji: '🟢', nombre: 'Verde', palabras: ['verde', 'punto', 'al dia', 'semaforo'] },
      { emoji: '⚫', nombre: 'Negro', palabras: ['negro', 'punto'] },
      { emoji: '➡️', nombre: 'Flecha', palabras: ['flecha', 'derecha', 'sigue'] },
      { emoji: '🔁', nombre: 'Repetir', palabras: ['repetir', 'de nuevo', 'ciclo'] },
      { emoji: '🔍', nombre: 'Buscar', palabras: ['buscar', 'lupa', 'revisar'] },
      { emoji: '💡', nombre: 'Idea', palabras: ['idea', 'lamparita', 'propuesta'] },
      { emoji: '🧠', nombre: 'Cerebro', palabras: ['pensar', 'cerebro', 'idea'] },
      { emoji: '👀', nombre: 'Mirando', palabras: ['mirar', 'ojos', 'atento', 'viendo'] },
      { emoji: '🎯', nombre: 'En el blanco', palabras: ['objetivo', 'meta', 'justo'] },
      { emoji: '🏆', nombre: 'Trofeo', palabras: ['trofeo', 'ganador', 'premio', 'felicitaciones'] },
    ],
  },
]

/** Todos los emojis de todas las categorías, en el orden en que se muestran. */
export const TODOS_LOS_EMOJIS: Emoji[] = CATEGORIAS_DE_EMOJIS.flatMap((categoria) => categoria.emojis)

/**
 * Los que se ofrecen como reacción rápida arriba de todo, sin abrir el cajón. Son los seis que
 * resuelven el 90 % de las respuestas de trabajo: «recibido», «gracias», «me río», «qué bueno»,
 * «uh», «ojo con esto».
 */
export const EMOJIS_RAPIDOS = ['👍', '🙏', '😂', '❤️', '😮', '⚠️'] as const

/** Sin tildes, en minúscula y sin dobles espacios: la forma en que se comparan las búsquedas. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Los emojis que responden a lo que se escribió en el buscador del cajón. Primero los que empiezan
 * con esa palabra («list» → «listo» antes que «checklist»), después los que la contienen.
 */
export function buscarEmojis(consulta: string): Emoji[] {
  const busqueda = normalizar(consulta)
  if (!busqueda) return TODOS_LOS_EMOJIS

  const empiezan: Emoji[] = []
  const contienen: Emoji[] = []
  for (const emoji of TODOS_LOS_EMOJIS) {
    const palabras = [normalizar(emoji.nombre), ...emoji.palabras]
    if (palabras.some((palabra) => palabra.startsWith(busqueda))) empiezan.push(emoji)
    else if (palabras.some((palabra) => palabra.includes(busqueda))) contienen.push(emoji)
  }
  return [...empiezan, ...contienen]
}

/**
 * ¿El mensaje es sólo emojis (hasta tres)? Se muestran en grande, como hacen todos los chats: un
 * «👍» solo dicho en tamaño de texto normal casi no se ve.
 *
 * Se recorren PUNTOS DE CÓDIGO con `Array.from` y no unidades UTF-16, porque un emoji ocupa dos (o
 * más, si tiene modificador de tono o va unido con ZWJ) y `texto.length` los contaría de a dos.
 */
export function esSoloEmojis(texto: string): boolean {
  const limpio = texto.trim()
  if (!limpio) return false
  const puntos = Array.from(limpio).filter((punto) => punto !== '\uFE0F' && punto !== '\u200D' && punto.trim() !== '')
  if (puntos.length === 0 || puntos.length > 6) return false
  return puntos.every((punto) => {
    const codigo = punto.codePointAt(0) ?? 0
    return (
      (codigo >= 0x1f300 && codigo <= 0x1faff) || // pictogramas, caritas, objetos, banderas
      (codigo >= 0x2600 && codigo <= 0x27bf) || // símbolos varios y dingbats (☀️, ✅, ❗)
      (codigo >= 0x1f900 && codigo <= 0x1f9ff) || // caritas y gestos nuevos
      (codigo >= 0x1f3fb && codigo <= 0x1f3ff) // modificadores de tono de piel
    )
  })
}
