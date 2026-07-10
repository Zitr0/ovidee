import Anthropic from '@anthropic-ai/sdk'
import { getApiKey } from './env.js'
import { recordApiCall } from './models.js'

function client() {
  const key = getApiKey('anthropic')
  if (!key) throw new Error('no hay ANTHROPIC_API_KEY configurada')
  return new Anthropic({ apiKey: key })
}

// Descripción única de lo que el render realmente puede hacer — compartida por
// el planificador (chat pre-render) y el editor (generación del EDL) para que
// nunca se contradigan ni el modelo invente límites que no existen.
const RENDER_CAPABILITIES = `
CAPACIDADES REALES DEL RENDER (son parámetros libres, no "estilos" cerrados —
combínalos como pida el usuario):
- Cortar y reordenar segmentos en fronteras de palabra del transcript; recortar
  silencios y pausas, o conservarlos íntegros si así se pide.
- Eliminar falsos comienzos y repeticiones que aparezcan en el transcript.
- Color grade: none | auto (corrección sutil) | warm_cinematic | neutral_punch.
- Captions quemados, totalmente configurables (nunca "fijos"):
  · chunk_size (1-4): cuántas palabras se ven a la vez. Se ajusta solo si no
    caben en pantalla, pero el objetivo que pidas se respeta.
  · highlight_mode:
      "current_word" → se resalta SOLO la palabra exacta que se dice en ese
        instante; el resto del grupo queda neutro. No hay acumulación. Ideal
        para 2-3 palabras en pantalla al estilo reels/shorts.
      "cumulative" → relleno progresivo palabra por palabra, estilo karaoke
        clásico: las palabras ya dichas quedan coloreadas ("sing-along").
      "none" → todo el texto del mismo color, sin resaltado.
  · color: cualquier hex que pida el usuario.
  · position: top | middle | bottom — siempre centrado horizontalmente; el
    tamaño de fuente y los márgenes se recalculan según si el video es
    horizontal o vertical.
  Ejemplo: "2 palabras, resalta solo la que se dice, en verde, arriba" →
  chunk_size=2, highlight_mode="current_word", color="#22C55E", position="top".
- Títulos animados con tipografía cinética real (palabras que entran con
  stagger + easing cúbico, y un acento de color que se dibuja después) vía
  motor HTML/CSS/GSAP, en el centro o como lower third, color configurable.
  Sigue siendo tipografía en 2D — no son simulaciones 3D ni VFX complejos; si
  ese motor no está disponible en la máquina, se usa automáticamente una
  versión más simple (fade + desplazamiento) sin que el usuario tenga que
  notarlo ni pedirlo de nuevo.
- Insertar imágenes del usuario como overlay: "fullscreen" (corte tipo B-roll,
  el audio del video sigue debajo) o "corner" (esquina inferior derecha con
  transparencia, ~25% del ancho — logos, producto). Puedes proponer en qué
  momento del video tiene sentido cada imagen según el contenido.
- Transiciones entre cortes (campo "transitions", global para todo el video):
  crossfade | dissolve | fade_black | fade_white | wipe_left | wipe_right |
  slide_up | slide_down | circle_open, con duración configurable (0.3–0.8s
  recomendado). "none" = corte seco. Aplica entre TODOS los cortes.
- Efectos de cámara simulada por rango (campo "effect" en cada rango):
  "zoom_in" (acercamiento suave tipo punch-in, hasta ~12%), "zoom_out"
  (alejamiento suave), "none". Úsalos con criterio editorial — p. ej. zoom_in
  en el momento de énfasis de una frase, no en todos los cortes.
- Motion graphics por descripción libre (campo "motion_graphics"): describe EN
  DETALLE una escena gráfica y un motor de animación HTML/CSS/GSAP la genera y
  la compone sobre el video con fondo transparente. Sirve para: diagramas
  explicativos, gráficas animadas con datos reales (barras, líneas, donas,
  contadores), esquemas paso a paso, callouts y elementos decorativos animados.
  Puede integrar imágenes PNG del usuario (campo "assets" del motion graphic)
  DENTRO de la animación — p. ej. un PNG con transparencia que entra animado
  por detrás de un texto o de una gráfica y se integra con el metraje. La
  descripción debe decir: qué se ve exactamente, colores/estilo, datos o cifras
  concretas si es una gráfica, y cómo se anima (entrada, desarrollo, salida).
  Cada motion graphic cuesta una llamada extra al LLM: úsalos donde aporten
  (2-3 por video como máximo, salvo que el usuario pida más).

LO QUE GENUINAMENTE NO EXISTE TODAVÍA (sé honesto solo sobre esto — no inventes
otras limitaciones que no estén aquí):
- Música de fondo y voz en off.
- Eliminar muletillas que NO aparezcan en el transcript (la transcripción local
  a veces las omite).
- Siluetear o recortar al sujeto del metraje (keying/rotoscopia): los motion
  graphics y overlays se componen SOBRE el video (o como corte), nunca por
  detrás de la persona que aparece en cámara.
`.trim()

// Reglas de corte destiladas de las Hard Rules de video-use (SKILL.md).
// Ejerce criterio editorial real — no es un checklist rígido: decide lo que
// mejor sirva al material, dentro de las capacidades de abajo.
const EDITOR_RULES = `
Eres un editor de video profesional con buen criterio. Recibes el transcript
empaquetado de un video (cada línea: [inicio-fin] hablante texto) y produces
un plan de edición (EDL) que cumple lo que el usuario pidió.

${RENDER_CAPABILITIES}

REGLAS DE CORRECCIÓN (no negociables, son de calidad técnica, no de estilo):
- Cada corte empieza y termina en fronteras de palabra del transcript.
- Añade padding en los bordes: ~0.05s antes de la primera palabra, ~0.08s después de la última.
- Si vas a recortar silencios, prefiere cortar en gaps ≥ 0.4s. Nunca cortes dentro
  de una palabra ni a mitad de frase sin motivo editorial.
- Ordena los rangos por narrativa (beat), no necesariamente por orden cronológico,
  salvo que el usuario pida conservar el orden original.
- total_duration_s = suma de (end - start) de todos los rangos.
- Overlays de imagen: usa SOLO assets de la lista disponible (campo "asset" = nombre
  exacto del archivo). start_in_output es relativo al video YA CORTADO (empieza en 0).
  duration mínima 1.5s. Si no hay assets disponibles, overlays = [].
- Títulos: texto corto (≤ 6 palabras), duración 2-4s. Si hay captions activos, usa
  "center" para el título salvo que el usuario pida lo contrario.
- Transiciones: si el usuario no las pide ni el estilo las sugiere, transitions.type
  = "none". Duración entre 0.3 y 0.8s. Con transiciones activas la duración real del
  video se reduce en (número de cortes - 1) × duración; el servidor lo compensa.
- Efectos por rango: "none" por defecto. zoom_in/zoom_out solo donde haya un motivo
  editorial (énfasis, cambio de tema).
- Motion graphics: start_in_output relativo al video YA CORTADO, duración 3-8s
  típica. En "assets" usa SOLO nombres exactos de la lista disponible (o []).
  La descripción debe ser autocontenida: quien la lea no ve el video.
- captions.enabled: true solo si el usuario los pidió explícitamente o el contexto
  claramente lo sugiere (p. ej. "para redes sociales"); si no se mencionan, false.

Tu campo "strategy" debe explicar en 3-6 frases y en español: la forma del video,
qué cortaste y por qué, qué captions/títulos/overlays usaste (con sus parámetros
concretos), y el grade elegido.
`.trim()

const EDL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'ranges', 'grade', 'transitions', 'overlays', 'titles', 'motion_graphics', 'captions', 'total_duration_s'],
  properties: {
    strategy: { type: 'string', description: 'Estrategia de edición en español, texto plano' },
    ranges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'start', 'end', 'beat', 'reason', 'effect'],
        properties: {
          source: { type: 'string', description: 'Nombre de la fuente (stem del archivo)' },
          start: { type: 'number' },
          end: { type: 'number' },
          beat: { type: 'string', description: 'HOOK, DESARROLLO, CIERRE, etc.' },
          reason: { type: 'string' },
          effect: { type: 'string', enum: ['none', 'zoom_in', 'zoom_out'], description: 'Efecto de cámara simulada sobre este rango' },
        },
      },
    },
    grade: {
      type: 'string',
      enum: ['none', 'auto', 'warm_cinematic', 'neutral_punch'],
    },
    transitions: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'duration'],
      properties: {
        type: {
          type: 'string',
          enum: ['none', 'crossfade', 'dissolve', 'fade_black', 'fade_white', 'wipe_left', 'wipe_right', 'slide_up', 'slide_down', 'circle_open'],
        },
        duration: { type: 'number', description: 'Segundos por transición, 0.3-0.8 recomendado' },
      },
    },
    overlays: {
      type: 'array',
      description: 'Imágenes del usuario a insertar; vacío si no hay assets o no aplican',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['asset', 'start_in_output', 'duration', 'placement'],
        properties: {
          asset: { type: 'string', description: 'Nombre exacto del archivo del asset' },
          start_in_output: { type: 'number', description: 'Segundos desde el inicio del video cortado' },
          duration: { type: 'number' },
          placement: { type: 'string', enum: ['fullscreen', 'corner'] },
        },
      },
    },
    titles: {
      type: 'array',
      description: 'Títulos animados (motion graphics); vacío si no aplican',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'start_in_output', 'duration', 'color', 'position'],
        properties: {
          text: { type: 'string', description: 'Texto corto, ≤ 6 palabras' },
          start_in_output: { type: 'number' },
          duration: { type: 'number' },
          color: { type: 'string', description: 'Hex, p. ej. #FFFFFF' },
          position: { type: 'string', enum: ['center', 'lower_third'] },
        },
      },
    },
    motion_graphics: {
      type: 'array',
      description: 'Escenas de motion graphics por descripción libre (diagramas, gráficas animadas, callouts); vacío si no aplican',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'start_in_output', 'duration', 'assets'],
        properties: {
          description: {
            type: 'string',
            description: 'Descripción detallada y autocontenida de la escena: qué se ve, colores, datos concretos, y cómo se anima (entrada/desarrollo/salida)',
          },
          start_in_output: { type: 'number', description: 'Segundos desde el inicio del video cortado' },
          duration: { type: 'number', description: 'Típicamente 3-8s' },
          assets: {
            type: 'array',
            description: 'Nombres exactos de imágenes del usuario a integrar dentro de la animación; [] si ninguna',
            items: { type: 'string' },
          },
        },
      },
    },
    captions: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'highlight_mode', 'color', 'position', 'chunk_size'],
      properties: {
        enabled: { type: 'boolean' },
        highlight_mode: { type: 'string', enum: ['current_word', 'cumulative', 'none'] },
        color: { type: 'string', description: 'Hex; color del resaltado, o del texto si highlight_mode=none' },
        position: { type: 'string', enum: ['top', 'middle', 'bottom'] },
        chunk_size: { type: 'integer', description: 'Palabras visibles a la vez, objetivo entre 1 y 4 (se ajusta automáticamente si no caben en pantalla)' },
      },
    },
    total_duration_s: { type: 'number' },
  },
}

async function structuredCall({ modelId, projectId, purpose, system, userText, schema }) {
  // Streaming obligatorio: con max_tokens altos (composiciones HTML largas) el
  // SDK rechaza peticiones no-streaming que podrían superar los 10 minutos.
  const stream = client().messages.stream({
    model: modelId,
    max_tokens: 32000, // las composiciones web multi-escena pueden ser largas
    system,
    messages: [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema } },
  })
  const response = await stream.finalMessage()
  recordApiCall({ projectId, modelId, purpose, usage: response.usage })
  if (response.stop_reason === 'refusal') throw new Error('el modelo rechazó la solicitud')
  const text = response.content.find((b) => b.type === 'text')?.text
  return JSON.parse(text)
}

function assetsBlock(assets) {
  if (!assets?.length) return 'ASSETS DISPONIBLES: ninguno.\n\n'
  return `ASSETS DISPONIBLES (imágenes que se pueden insertar como overlay):\n${assets
    .map((a) => `- ${a.filename}`)
    .join('\n')}\n\n`
}

// Genera el EDL inicial (o revisado) a partir del transcript empaquetado
export async function generateEdl({ modelId, projectId, packedTranscript, assets, instructions, previousEdl, feedback }) {
  let userText = `TRANSCRIPT EMPAQUETADO:\n\n${packedTranscript}\n\n${assetsBlock(assets)}`
  if (instructions) userText += `BRIEF DE EDICIÓN ACORDADO CON EL USUARIO:\n${instructions}\n\n`
  if (previousEdl && feedback) {
    userText += `EDL ACTUAL (versión anterior):\n${JSON.stringify(previousEdl, null, 2)}\n\n`
    userText += `EL USUARIO PIDE ESTOS CAMBIOS: ${feedback}\n\nProduce el EDL revisado completo.`
  } else {
    userText += 'Produce el EDL para la primera versión de este video, siguiendo el brief acordado al pie de la letra.'
  }
  return structuredCall({
    modelId,
    projectId,
    purpose: previousEdl ? 'chat' : 'edl',
    system: EDITOR_RULES,
    userText,
    schema: EDL_SCHEMA,
  })
}

// —— Motion graphics por descripción libre (bucle agéntico HyperFrames) ——
// El contrato de composición de HyperFrames destilado de hyperframes-core:
// lo que `hyperframes lint` exige + los hallazgos empíricos del PRD §4.4
// (data-start="0" en la raíz es obligatorio; el runtime se carga LOCAL desde
// ./vendor/gsap.min.js, nunca de un CDN — el render corre sin red).
const MOTION_RULES = `
Eres un motion designer senior que escribe composiciones HyperFrames: un documento
HTML que un motor determinista convierte en video frame a frame. Produces UNA
composición completa y auto-contenida que se compondrá SOBRE un video real con
fondo transparente (canal alfa).

CONTRATO OBLIGATORIO (si lo violas, el lint falla):
- Documento HTML completo (<!doctype html>…) con <meta charset="UTF-8" /> y
  <meta name="viewport" content="width=W, height=H" /> usando el ancho/alto dados.
- Raíz: <div id="root" data-composition-id="motion" data-start="0"
  data-width="W" data-height="H" data-duration="D"> — data-start="0" en la raíz
  es OBLIGATORIO. D = duración exacta que se te da, en segundos.
- Cada escena es un hijo con class="clip" y data-start, data-duration,
  data-track-index (entero ≥ 1).
- html y body con background: transparent. NUNCA pongas un fondo opaco de página
  completa: el video debe verse a través de todo lo que no sea tu gráfica.
- Único script externo permitido: <script src="./vendor/gsap.min.js"></script>.
  PROHIBIDO cualquier URL http(s): ni CDNs, ni webfonts (usa fuentes del sistema:
  Helvetica Neue, Arial, Georgia…), ni fetch, ni imágenes remotas.
- Animación: UNA timeline GSAP pausada registrada así:
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    …tweens…
    window.__timelines["motion"] = tl;
  El motor hace seek frame a frame: la animación debe ser determinista.
  PROHIBIDO Math.random(), Date.now(), requestAnimationFrame propio, setTimeout,
  y cualquier estado que dependa del reloj real.
- Imágenes del usuario (si se te da una lista): referencia EXACTA ./assets/<nombre>.
  Puedes animarlas, escalarlas, ponerlas detrás o delante de otros elementos de
  la composición (z-index) — sus transparencias PNG se conservan.
- TRAMPA CLÁSICA — NO la cometas: el motor ya muestra/oculta cada clip según su
  ventana de tiempo. NUNCA pongas opacity: 0 en .clip por CSS: si luego solo
  animas la opacidad de un hijo, el padre sigue invisible y la escena sale
  vacía. Oculta y anima los ELEMENTOS INTERNOS, no el clip.
- Regla de salida (el lint la EXIGE): tras cada fade/slide de salida que muere
  en una frontera de clip, agrega el "hard kill" exacto:
  tl.set(selector, { opacity: 0 }, <tiempo_frontera>).

CALIDAD (esto separa un motion graphic profesional de un placeholder):
- Tipografía grande y legible sobre video: peso 700-900, text-shadow o placa
  semitransparente detrás del texto cuando el metraje pueda competir.
- Diagramas y gráficas: dibújalos con SVG inline (barras, líneas con
  stroke-dasharray para el efecto de trazo, donas con stroke-dashoffset).
  Gráficas con datos: usa los datos EXACTOS de la descripción; contadores con
  gsap y snap ("snap: { textContent: 1 }" sobre un objeto proxy o innerText).
- Coreografía completa: entrada (0.4-0.8s, easing power2/power3.out, stagger),
  desarrollo (la animación principal: la gráfica crece, el diagrama se conecta),
  y salida ANTES de que termine la duración (fade/slide out en los últimos 0.4s).
- Respeta márgenes seguros: nada importante en el 5% exterior del frame.

Devuelve SOLO el campo "html" con el documento completo.
`.trim()

const MOTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['html'],
  properties: {
    html: { type: 'string', description: 'Documento HTML completo de la composición HyperFrames' },
  },
}

// Genera (o corrige, si hay feedback de lint) la composición HTML de un motion graphic
export async function generateMotionComposition({ modelId, projectId, description, width, height, duration, assets, previousHtml, lintFeedback }) {
  let userText =
    `ESCENA PEDIDA:\n${description}\n\n` +
    `PARÁMETROS: width=${width}, height=${height}, duration=${duration}s (exacta).\n\n`
  if (assets?.length) {
    userText += `IMÁGENES DISPONIBLES en ./assets/: ${assets.join(', ')}\n\n`
  } else {
    userText += 'No hay imágenes del usuario: todo se dibuja con HTML/CSS/SVG.\n\n'
  }
  if (previousHtml && lintFeedback) {
    userText +=
      `TU COMPOSICIÓN ANTERIOR NO PASÓ EL LINT. Errores:\n${lintFeedback}\n\n` +
      `COMPOSICIÓN ANTERIOR:\n${previousHtml}\n\n` +
      'Corrige SOLO los errores señalados y devuelve el documento completo corregido. ' +
      'Si un error trae "fixHint", aplícalo LITERALMENTE. No rediseñes ni reescribas lo que ya funciona.'
  } else {
    userText += 'Produce la composición completa.'
  }
  const result = await structuredCall({
    modelId,
    projectId,
    purpose: 'motion',
    system: MOTION_RULES,
    userText,
    schema: MOTION_SCHEMA,
  })
  return result.html
}

// —— Website → video (capturas del sitio + composición HyperFrames) ——
// Qué puede hacer el generador de videos web — compartido por el planner web,
// el compositor y el chat de iteración para que nunca se contradigan.
const WEB_CAPABILITIES = `
CAPACIDADES REALES DEL VIDEO WEB (se genera como una composición animada, no
como una grabación del navegador):
- Escenas construidas con las CAPTURAS reales del sitio (screenshots de scroll):
  se pueden encuadrar en un marco de navegador o dispositivo, hacer paneos y
  zooms suaves sobre ellas (efecto Ken Burns), recortarlas por secciones y
  combinarlas con tipografía.
- Tipografía cinética con la paleta y el carácter del sitio (colores y fuentes
  extraídos de la captura; las fuentes se aproximan con fuentes del sistema).
- Integrar las imágenes/logos descargados del propio sitio y las imágenes que
  suba el usuario.
- Duración típica 10-45s, formato horizontal (1920×1080) o vertical (1080×1920).
- Estructura narrativa: gancho → qué es / qué ofrece → cierre con llamada a la
  acción (URL del sitio en pantalla, botón, etc.).
- Gráficas y diagramas animados si el contenido lo amerita.

LO QUE GENUINAMENTE NO EXISTE TODAVÍA (sé honesto solo sobre esto):
- Narración por voz y música de fondo.
- Grabación en vivo del sitio (scroll/cursor reales): las escenas se animan a
  partir de capturas estáticas, no de un screencast.
`.trim()

const WEB_PLANNER_RULES = `
Eres el asistente de planeación de Ovidee para videos generados desde un sitio
web. El usuario dio una URL; ya existe una captura local del sitio (texto
visible, paleta de colores, tipografía, screenshots y assets). Conversas para
entender QUÉ quiere lograr con el video y construyes el brief ("instructions")
que usará el generador. Tú no generas nada — solo conversas y refinas el brief.

${WEB_CAPABILITIES}

Cómo conversar:
- Lo primero que debe quedar claro: el objetivo (tour del sitio, presentación
  para redes, mostrar un producto/servicio del sitio…), el mensaje central, la
  duración y el formato (horizontal/vertical). Pregunta SOLO lo que falte.
- Propón cosas concretas a partir del contenido real del sitio (sus textos, sus
  secciones, sus colores) — no genéricas.
- Si el usuario subió imágenes propias, pregunta o propone dónde encajan.
- En cada turno reescribe COMPLETO el campo "instructions" con todo lo acordado:
  objetivo, mensaje, duración, formato, escenas sugeridas, qué capturas/imágenes
  usar, tono visual.
- "recommendations": 3 a 5 opciones seleccionables concretas.
- ready_to_render=true cuando objetivo + mensaje + duración + formato estén claros.
`.trim()

// El contrato HyperFrames del compositor web: igual que MOTION_RULES pero la
// composición es un VIDEO COMPLETO opaco (no un overlay con alfa).
const WEB_COMPOSE_RULES = `
Eres un motion designer senior que produce un VIDEO COMPLETO como composición
HyperFrames: un documento HTML que un motor determinista convierte en video
frame a frame. No hay metraje debajo: tu composición ES el video, con fondo
OPACO (usa la paleta del sitio).

CONTRATO OBLIGATORIO (si lo violas, el lint falla):
- Documento HTML completo (<!doctype html>…) con <meta charset="UTF-8" /> y
  <meta name="viewport" content="width=W, height=H" /> usando el ancho/alto dados.
- Raíz: <div id="root" data-composition-id="web" data-start="0"
  data-width="W" data-height="H" data-duration="D"> — data-start="0" en la raíz
  es OBLIGATORIO. D = la duración total que decidas según el brief.
- Cada escena es un hijo con class="clip" y data-start, data-duration,
  data-track-index (entero ≥ 1). Las escenas se suceden sin huecos; puedes
  solaparlas brevemente para transiciones.
- Único script externo permitido: <script src="./vendor/gsap.min.js"></script>.
  PROHIBIDO cualquier URL http(s): ni CDNs, ni webfonts (aproxima la tipografía
  del sitio con fuentes del sistema), ni fetch, ni imágenes remotas.
- Animación: UNA timeline GSAP pausada registrada así:
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    …tweens…
    window.__timelines["web"] = tl;
  Determinista: PROHIBIDO Math.random(), Date.now(), requestAnimationFrame
  propio, setTimeout, y cualquier estado que dependa del reloj real.
- Imágenes: referencia EXACTA ./assets/<nombre> de la lista que se te da
  (capturas del sitio, assets del sitio, imágenes del usuario).
- TRAMPA CLÁSICA — NO la cometas: el motor ya muestra/oculta cada clip según su
  ventana de tiempo (data-start/data-duration). NUNCA pongas opacity: 0 en
  .clip ni en las secciones de escena por CSS: si luego solo animas la opacidad
  de un hijo, el padre sigue invisible y la escena sale NEGRA en el render.
  Deja los clips visibles; oculta y anima los ELEMENTOS INTERNOS (titulares,
  imágenes, tarjetas) para las entradas.
- Regla de salida (el lint la EXIGE como error): toda animación de salida que
  termina en una frontera de clip debe ir seguida de un "hard kill" en esa
  frontera exacta: tl.set(selector, { opacity: 0 }, <tiempo_frontera>). Sin él,
  el seek no-lineal puede caer después del fade y dejar el elemento visible.
  Aplica el par fade-out + set a CADA elemento que salga.

CALIDAD (esto separa un video profesional de un slideshow):
- Las capturas del sitio se presentan con intención: dentro de un marco de
  navegador dibujado con CSS (barra con 3 puntos y la URL), o a sangre completa
  con un paneo/zoom suave (transform scale/translate animado — Ken Burns).
  Nunca una imagen estática sin movimiento.
- Jerarquía tipográfica clara: titulares grandes (peso 700-900), textos cortos.
  Usa los textos REALES del sitio (del resumen), no lorem ipsum.
- Paleta: fondo y acentos tomados de los colores extraídos del sitio; contraste
  AA como mínimo entre texto y fondo.
- Coreografía: cada escena tiene entrada (0.4-0.8s, power2/power3.out, stagger),
  desarrollo y salida/transición hacia la siguiente. El cierre muestra la URL
  del sitio como llamada a la acción.
- Respeta márgenes seguros: nada importante en el 5% exterior del frame.

Devuelve "strategy" (3-5 frases en español: escenas y por qué) y "html"
(el documento completo).
`.trim()

const WEB_COMPOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'html'],
  properties: {
    strategy: { type: 'string', description: 'Resumen en español de las escenas del video y su intención' },
    html: { type: 'string', description: 'Documento HTML completo de la composición HyperFrames' },
  },
}

// Genera (o revisa) la composición de un video web. `feedback` = cambios que
// pidió el usuario para una nueva versión; `lintFeedback` = errores del lint.
export async function generateWebComposition({ modelId, projectId, brief, siteContext, width, height, assets, previousHtml, feedback, lintFeedback }) {
  let userText =
    `${siteContext}\n\n` +
    `BRIEF ACORDADO CON EL USUARIO:\n${brief || '(sin brief: decide tú un video corto y profesional que presente el sitio)'}\n\n` +
    `PARÁMETROS: width=${width}, height=${height}.\n\n` +
    `IMÁGENES DISPONIBLES en ./assets/ (usa los nombres EXACTOS):\n${assets.length ? assets.map((a) => `- ${a}`).join('\n') : '(ninguna)'}\n\n`
  if (previousHtml && lintFeedback) {
    userText +=
      `TU COMPOSICIÓN ANTERIOR NO PASÓ EL LINT. Errores:\n${lintFeedback}\n\n` +
      `COMPOSICIÓN ANTERIOR:\n${previousHtml}\n\n` +
      'Corrige SOLO los errores señalados y devuelve el documento completo corregido. ' +
      'Si un error trae "fixHint", aplícalo LITERALMENTE. No rediseñes ni reescribas lo que ya funciona.'
  } else if (previousHtml && feedback) {
    userText +=
      `COMPOSICIÓN ACTUAL (versión anterior):\n${previousHtml}\n\n` +
      `EL USUARIO PIDE ESTOS CAMBIOS: ${feedback}\n\nProduce la composición revisada completa.`
  } else {
    userText += 'Produce la composición completa del video.'
  }
  return structuredCall({
    modelId,
    projectId,
    purpose: 'web_compose',
    system: WEB_COMPOSE_RULES,
    userText,
    schema: WEB_COMPOSE_SCHEMA,
  })
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'recommendations', 'instructions', 'ready_to_render'],
  properties: {
    reply: { type: 'string', description: 'Respuesta conversacional en español' },
    recommendations: {
      type: 'array',
      description: '3 a 5 opciones seleccionables, concretas y accionables, coherentes con la conversación',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'prompt'],
        properties: {
          label: { type: 'string', description: 'Etiqueta corta para el botón (≤ 6 palabras)' },
          prompt: { type: 'string', description: 'Mensaje completo listo para enviar si el usuario la elige' },
        },
      },
    },
    instructions: {
      type: 'string',
      description:
        'Brief COMPLETO y actualizado para el editor, en español, incorporando TODO lo acordado en la conversación hasta ahora (no un resumen del último mensaje solamente). Reescríbelo entero cada turno.',
    },
    ready_to_render: {
      type: 'boolean',
      description: 'true si ya hay suficiente información para producir una buena edición (los cortes básicos están claros; captions/título/imágenes pueden quedar explícitamente en "no")',
    },
  },
}

const PLANNER_RULES = `
Eres el asistente de planeación de Ovidee, un editor de video con IA. Conversas
con el usuario ANTES de procesar el video para entender qué edición quiere, y
construyes un brief claro (campo "instructions") que luego usará el editor real
para producir el plan de corte. Tú no editas nada — solo conversas y refinas el brief.

${RENDER_CAPABILITIES}

Cómo conversar:
- Haz preguntas cortas y específicas SOLO cuando falte información que cambiaría
  el resultado (p. ej. si quiere captions y de qué color/posición, si tiene una
  imagen para usar en un momento concreto, qué hacer con los silencios). Si el
  usuario ya fue específico, no preguntes de más — confirma y avanza.
- Si el usuario pide una combinación de las capacidades de arriba, tradúcela
  directamente a los parámetros exactos (chunk_size, highlight_mode, color,
  position, etc.) en tu respuesta y en "instructions" — eso SÍ es posible, no
  lo presentes como una limitación.
- En cada turno reescribe COMPLETO el campo "instructions" incorporando todo lo
  acordado hasta ahora en la conversación (no solo el último mensaje).
- "recommendations": 3 a 5 opciones seleccionables coherentes con la conversación,
  concretas (p. ej. "Captions: resalta solo la palabra actual, verde, arriba"),
  nunca genéricas.
- Marca ready_to_render=true solo cuando el brief ya es suficiente para editar.
`.trim()

// Chat de planeación PRE-render: refina el brief con turnos reales de LLM,
// no con texto estático concatenado. Se ejecuta antes de transcribir/editar.
export async function planEdit({ modelId, projectId, assets, history, message }) {
  const userText =
    `${assetsBlock(assets)}CONVERSACIÓN PREVIA:\n${history.map((h) => `${h.role}: ${h.text}`).join('\n') || '(ninguna — es el primer mensaje)'}\n\n` +
    `MENSAJE DEL USUARIO: ${message}`
  return structuredCall({ modelId, projectId, purpose: 'plan', system: PLANNER_RULES, userText, schema: PLAN_SCHEMA })
}

// Chat de planeación para videos web: mismo esquema, contexto = captura del sitio
export async function planWebVideo({ modelId, projectId, siteContext, assets, history, message }) {
  const userText =
    `${siteContext}\n\n${assetsBlock(assets)}` +
    `CONVERSACIÓN PREVIA:\n${history.map((h) => `${h.role}: ${h.text}`).join('\n') || '(ninguna — es el primer mensaje)'}\n\n` +
    `MENSAJE DEL USUARIO: ${message}`
  return structuredCall({ modelId, projectId, purpose: 'plan', system: WEB_PLANNER_RULES, userText, schema: PLAN_SCHEMA })
}

const CHAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'recommendations', 'proposes_new_version'],
  properties: {
    reply: { type: 'string', description: 'Respuesta conversacional en español' },
    recommendations: {
      type: 'array',
      description: '3 a 5 opciones seleccionables, cada una accionable con un clic',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'prompt'],
        properties: {
          label: { type: 'string', description: 'Etiqueta corta para el botón (≤ 6 palabras)' },
          prompt: { type: 'string', description: 'Mensaje listo para enviar si el usuario la elige' },
        },
      },
    },
    proposes_new_version: {
      type: 'boolean',
      description: 'true solo si el usuario pidió un cambio concreto que amerita re-render',
    },
  },
}

// FR7: chat de iteración — responde, recomienda, y señala si procede una nueva versión
export async function chatAboutEdit({ modelId, projectId, packedTranscript, assets, currentEdl, history, message }) {
  const system = `${EDITOR_RULES}\n\nAhora estás en modo conversación: el usuario ya tiene una versión
renderizada y quiere discutir cambios. Responde en español y con criterio editorial real
— no te limites a un checklist. Si piden algo que genuinamente no existe (música de
fondo, voz en off, keying del sujeto), dilo con honestidad, pero para todo lo que SÍ
está en tus capacidades (transiciones, zooms, motion graphics por descripción libre),
ofrece la combinación exacta de parámetros que lo logra. En "recommendations" da SIEMPRE
3 a 5 opciones seleccionables concretas (con parámetros específicos, no genéricas) que
enseñen lo que es posible con ESTE video — el usuario puede no saber qué se puede pedir.
Marca proposes_new_version=true SOLO si el usuario pidió un cambio accionable sobre el
corte, captions, títulos, overlays o grade (no si solo hace preguntas).`
  const userText =
    `TRANSCRIPT:\n${packedTranscript}\n\n${assetsBlock(assets)}EDL ACTUAL:\n${JSON.stringify(currentEdl, null, 2)}\n\n` +
    `CONVERSACIÓN PREVIA:\n${history.map((h) => `${h.role}: ${h.text}`).join('\n') || '(ninguna)'}\n\n` +
    `MENSAJE DEL USUARIO: ${message}`
  return structuredCall({ modelId, projectId, purpose: 'chat', system, userText, schema: CHAT_SCHEMA })
}

// Chat de iteración para videos web: el usuario ya tiene una versión renderizada
export async function chatAboutWebVideo({ modelId, projectId, siteContext, brief, strategy, assets, history, message }) {
  const system = `${WEB_PLANNER_RULES}\n\nAhora estás en modo iteración: el usuario ya tiene una versión
renderizada del video (estrategia actual: "${strategy || 'sin registro'}") y quiere discutir cambios.
Responde en español con criterio de motion designer. Para todo lo que SÍ está en las capacidades,
ofrece el cambio concreto; sé honesto solo sobre lo que genuinamente no existe. En
"recommendations" da SIEMPRE 3 a 5 opciones concretas basadas en el contenido real del sitio.
Marca proposes_new_version=true SOLO si el usuario pidió un cambio accionable sobre el video
(no si solo hace preguntas).`
  const userText =
    `${siteContext}\n\n${assetsBlock(assets)}BRIEF ORIGINAL:\n${brief || '(ninguno)'}\n\n` +
    `CONVERSACIÓN PREVIA:\n${history.map((h) => `${h.role}: ${h.text}`).join('\n') || '(ninguna)'}\n\n` +
    `MENSAJE DEL USUARIO: ${message}`
  return structuredCall({ modelId, projectId, purpose: 'chat', system, userText, schema: CHAT_SCHEMA })
}
