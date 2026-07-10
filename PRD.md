# Documento de Requerimientos de Producto (PRD): Versión Hardened & Secure

**Proyecto:** Ovidee — Agentic Video Editor
**Fecha:** 2026-07-08
**Licencia:** MIT (proyecto independiente, sin afiliación corporativa)
**Bases técnicas:** [`video-use`](https://github.com/Zitr0/video-use) (fork de `browser-use/video-use`, MIT © Browser Use) · [`hyperframes`](https://github.com/heygen-com/hyperframes) (Apache 2.0, HeyGen)

## 1. Resumen Ejecutivo

**Ovidee** es una suite de interfaz gráfica web local, 100% open source, para postproducción de video dirigida por agentes de IA. Envuelve la skill de terminal `video-use` (transcripción → razonamiento del LLM → EDL → render → auto-evaluación) en una interfaz web con control de costos, human-in-the-loop y una política estricta de seguridad de la cadena de suministro. Todo el procesamiento multimedia es local: **FFmpeg**, **FFprobe** y **Remotion** (instalaciones obligatorias), **Whisper local** para transcripción, captions/overlays parametrizables (PIL + libass), transiciones y efectos de cámara simulada vía pre-corte ffmpeg (`xfade`/`zoompan`), títulos con tipografía cinética real y **motion graphics por descripción libre** (diagramas, gráficas animadas, PNG del usuario integrados) vía **HyperFrames** (HTML/CSS/GSAP con bucle agéntico generar → lint → autocorregir → render; GSAP con copia local, el render no toca la red) con respaldo automático a PIL para títulos. Ver §4.4 para el estado exacto de cada motor de animación — qué está conectado al pipeline y qué no. La plataforma tiene dos puertas de entrada: **editar metraje propio** (drag & drop) y **generar un video desde una URL** (FR-W: captura local del sitio + composición HyperFrames). Las herramientas de terceros se instalan con sus flujos oficiales y no se redistribuyen (`THIRD_PARTY_NOTICES.md`). Las únicas salidas de datos a Internet en operación son la API del proveedor LLM elegido y — solo en proyectos web — la visita del navegador local a la URL que el propio usuario pidió capturar.

---

## 2. Objetivos de Gobernanza, Seguridad y Negocio

* **Proyecto independiente y open source:** licencia **MIT**, titularidad de "Ovidee contributors". Sin vínculos, branding, telemetría ni dependencias de infraestructura de ninguna empresa (incluida cualquier organización empleadora de los contribuidores). El código derivado de `video-use` conserva la atribución MIT a Browser Use, como exige su licencia.
* **Aislamiento de la Cadena de Suministro:** la instalación local de herramientas de edición no debe comprometer la máquina del usuario.
* **Soberanía de Datos:** ni el video ni el audio salen de la máquina. La única salida de red son las transcripciones/prompts hacia el LLM elegido, mostrada en la UI antes de ocurrir. Cero telemetría y cero servidores analíticos. **No se requiere ninguna API adicional a la del LLM.**
* **Predictibilidad Financiera:** mitigar el riesgo de llamadas infinitas a la API mediante un calculador predictivo de tokens local.
* **Sostenibilidad sin cobro:** Ovidee no cobra por nada. El proyecto acepta donaciones voluntarias (Buy Me a Coffee y MercadoPago, enlazadas en el README y en el pie de la interfaz); las donaciones nunca desbloquean funcionalidades ni introducen telemetría.

---

## 3. Arquitectura del Sistema y Stack Tecnológico

```
[ FRONTEND ] (Next.js/Tailwind)
      ↕  (WebSockets sobre 127.0.0.1, autenticados con token de sesión)
[ BACKEND ORQUESTADOR ] (Node.js/Fastify o Python/FastAPI) ➔ [ SQLite (app.db) ]
      ⬇  (Procesos del sistema con mínimo privilegio)
[ AGENTE MULTI-LLM ] (Claude Code / Antigravity vía LiteLLM)   ← única salida a Internet
      ⬇  (invoca la skill video-use y sus helpers)
[ MOTOR DE VIDEO — 100% LOCAL ]
   FFmpeg / FFprobe (obligatorios) · Remotion (obligatorio)
   Whisper local (transcripción)  · HyperFrames (animación agéntica)
   Manim / PIL (opcionales)
```

### Componentes del Stack

* **Frontend:** Next.js (SPA estática) + Tailwind CSS.
* **Gestor de dependencias JS:** **pnpm ≥ 10** (árbol estricto, scripts de ciclo de vida bloqueados por defecto).
* **Backend:** Node.js (Fastify) o Python (FastAPI) bajo mínimo privilegio.
* **Motor lógico Python (heredado de video-use):** `requests`, `librosa`, `matplotlib`, `pillow`, `numpy`; gestionado con `uv` + lockfile.
* **Persistencia:** SQLite (`app.db`) local.
* **Abstracción de IA:** Vercel AI SDK o LiteLLM.
* **Transcripción — Whisper local (sin API):** `faster-whisper` (CTranslate2) con `word_timestamps=True`, o `whisper.cpp` con Metal/CoreML en Apple Silicon. Ver §4.5 para cómo se cumplen los requisitos editoriales de video-use sin ElevenLabs.
* **Animación agéntica — HyperFrames (Apache 2.0):** framework open source de HeyGen que convierte HTML/CSS/animaciones seekeables en MP4 determinista, diseñado para agentes. Requisitos: Node 22+ y FFmpeg (ya obligatorios en este stack).

### Modelo de amenazas: qué mitiga pnpm y qué no

pnpm aporta dos defensas reales y verificables:

1. **Árbol no plano:** un paquete solo puede importar las dependencias que declaró (elimina *phantom dependencies*).
2. **Bloqueo de scripts de instalación:** desde pnpm 10, los scripts `preinstall`/`postinstall` de dependencias no se ejecutan por defecto; solo corren los paquetes aprobados en `onlyBuiltDependencies`.

**Límite explícito:** nada de esto es un sandbox en tiempo de ejecución. Un paquete malicioso que sí se importe tiene los privilegios del proceso. Defensas complementarias obligatorias: superficie mínima de dependencias, lockfile con checksums y `minimumReleaseAge` (FR1).

---

## 4. Base técnica: inventario de `video-use` + `hyperframes`

El backend no reimplementa la edición: orquesta la skill `video-use` (incluida como submódulo git) y expone su pipeline en la UI. Las animaciones se delegan por defecto a las skills de HyperFrames.

### 4.1 Helpers de Python de video-use (`helpers/`)

| Helper | Función | Interfaz |
| --- | --- | --- |
| `transcribe.py` | **[Se reemplaza — ver §4.5]** El original llama a ElevenLabs Scribe; nuestra versión usa Whisper local y emite el mismo formato JSON, de modo que el resto de helpers funciona sin cambios | `python helpers/transcribe.py <video> [--num-speakers N] [--language xx]` → `edit/transcripts/<name>.json` |
| `transcribe_batch.py` | Transcripción paralela de un directorio completo, con caché por archivo (con Whisper local el paralelismo se ajusta a los cores/VRAM disponibles) | `python helpers/transcribe_batch.py <videos_dir>` |
| `pack_transcripts.py` | Empaqueta todos los transcripts en `takes_packed.md` a nivel de frase (corta en silencios ≥ 0.5 s o cambio de hablante) — la vista de lectura primaria del LLM, ~1/10 de los tokens del JSON crudo | `python helpers/pack_transcripts.py --edit-dir <dir>` |
| `timeline_view.py` | Composite PNG de filmstrip + waveform + etiquetas de palabras + gaps de silencio para un rango de tiempo; drill-down visual bajo demanda | `python helpers/timeline_view.py <video> <start> <end>` |
| `render.py` | Pipeline de render: extracción por segmento con grade + fades de 30 ms → concat lossless `-c copy` → overlays con PTS shift → subtítulos AL FINAL | `python helpers/render.py <edl.json> -o final.mp4 [--preview] [--build-subtitles]` |
| `grade.py` | Color grade vía ffmpeg: modo auto (corrección matemática acotada a ±8%), presets (`warm_cinematic`, `neutral_punch`) o filtro crudo | `python helpers/grade.py <in> -o <out> [--preset X \| --filter '<raw>']` |

### 4.2 Las 12 Hard Rules de producción (no negociables)

La skill separa corrección de gusto. Estas reglas son corrección — violarlas produce salida rota de forma silenciosa — y la UI y el backend deben imponerlas:

1. Subtítulos se aplican **al final** de la cadena de filtros, después de todos los overlays.
2. Extracción por segmento → concat lossless `-c copy` (nunca filtergraph de una pasada con overlays: doble re-encode).
3. **Fades de audio de 30 ms** en cada frontera de segmento (evita pops).
4. Overlays con `setpts=PTS-STARTPTS+T/TB` (el frame 0 del overlay coincide con el inicio de su ventana).
5. El SRT maestro usa offsets del timeline de salida (`output_time = word.start - segment_start + segment_offset`).
6. Nunca cortar dentro de una palabra: cada corte se ancla a fronteras de palabra del transcript.
7. Padding de 30–200 ms en cada borde de corte (absorbe la deriva de timestamps del ASR — igual de necesario con Whisper que con Scribe).
8. ASR verbatim a nivel de palabra únicamente (nunca SRT/frases, nunca fillers normalizados). Ver §4.5 para cómo se cumple con Whisper.
9. Transcripciones cacheadas por fuente: nunca re-transcribir si el archivo no cambió.
10. Sub-agentes paralelos para múltiples animaciones, nunca secuenciales.
11. **Confirmación de estrategia antes de ejecutar** (base del FR5).
12. Todas las salidas de sesión van a `<videos_dir>/edit/`, nunca dentro del directorio de la skill.

### 4.3 Pipeline y artefactos

```
Transcribe (local) ──> Pack ──> LLM razona ──> EDL ──> Render ──> Self-Eval
                                                                     │
                                                                     └─ ¿problema? corregir + re-render (máx. 3 pasadas)
```

Artefactos por proyecto (en `<videos_dir>/edit/`): `project.md` (memoria de sesión), `takes_packed.md`, `edl.json` (decisiones de corte: sources, ranges con beat/quote/reason, grade, overlays, subtitles), `transcripts/*.json`, `animations/slot_<id>/`, `clips_graded/`, `master.srt`, `preview.mp4`, `final.mp4`. La UI web lee y visualiza estos mismos artefactos — no inventa un formato propio.

### 4.4 Motores de animación — lo instalado vs. lo conectado al pipeline (honestidad de alcance)

**Importante — no confundir "instalado" con "usado por el render":**

* **Lo que el pipeline HOY realmente ejecuta (`apps/server/src/pipeline.js`):**
  * Overlays de imagen del usuario (`fullscreen`/`corner`) vía `ffmpeg` puro.
  * Captions parametrizables vía `captions.py` (libass) — ver FR6.
  * **Títulos animados con tipografía cinética real (HyperFrames, HTML/CSS/GSAP) como motor primario**, con `title_card.py` (PIL: fade-in/rise, easing cúbico) como **respaldo automático** — ver el desglose completo de esta integración más abajo.
  * **Transiciones entre cortes** (crossfade, dissolve, fades a negro/blanco, wipes, slides, circle open) y **efectos de cámara simulada por rango** (zoom_in/zoom_out suaves, hasta 12%, con escalado 2x previo a `zoompan` para precisión subpixel): el servidor construye un **pre-corte** (`buildPrecut` en `pipeline.js`) — extrae cada rango como segmento uniforme (misma escala/fps/audio que `render.py`, con tone-mapping HDR→SDR idéntico), aplica el efecto por segmento, y une todo con `xfade`/`acrossfade` con offsets medidos por `ffprobe`. `render.py` recibe entonces un EDL de un único rango sobre el precut y sigue haciendo grade/overlays/loudnorm sin modificarse. Los captions compensan el solape de los crossfades con `--transition-overlap` en `captions.py`.
  * **Motion graphics por descripción libre (bucle agéntico HyperFrames):** el EDL admite `motion_graphics[]` (descripción detallada + tiempo + duración + PNG del usuario a integrar). `generateMotionComposition` (`llm.js`) genera la composición HTML bajo el contrato de HyperFrames destilado en su system prompt; `renderHyperframesMotion` (`hyperframes.js`) ejecuta el bucle generar → `lint` → autocorrección con el feedback del lint (hasta 3 intentos) → `render --format mov` (ProRes 4444 con alfa), y el resultado se compone sobre el video como overlay. Cubre diagramas, gráficas animadas con datos (SVG + GSAP), callouts, y escenas que integran PNG transparentes del usuario dentro de la animación. Una escena que no pase el lint tras los reintentos se **omite con aviso en el log** — nunca rompe el render. Cada intento es una llamada real al LLM (propósito `motion` en el dashboard de costos).

* **HyperFrames — conectado para títulos, con una excepción de red resuelta explícitamente:** las 20 skills se instalan en el onboarding (`npx skills add heygen-com/hyperframes --full-depth`) para agentes de código, y el CLI (`hyperframes`, paquete npm) se agrega como devDependency **pinneado** en el `package.json` raíz (respeta `minimumReleaseAge` — la versión más reciente en npm en el momento de escribir esto fue rechazada automáticamente por tener menos de 3 días). `apps/server/src/hyperframes.js` orquesta `init` → escribir la composición → `lint` → `render --format mov` para cada título.

  **Hallazgo relevante durante la integración — CDN de GSAP:** por diseño, las 20 skills de HyperFrames (y sus propios ejemplos) cargan su motor de animación (GSAP, Three.js, anime.js, Lottie) desde CDNs públicos (`jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`) en cada `render`/`preview`. Usarlo tal cual habría significado que cada render hiciera una llamada de red a un tercero — justo lo contrario de "tu video nunca sale de tu máquina". Se resolvió vendorizando GSAP: se descarga **una sola vez** durante el onboarding (`~75 KB`, checklist FR0, igual patrón que Whisper/Remotion) a `.vendor/gsap-3.14.2.min.js`, y cada composición generada referencia la copia local (`./vendor/gsap.min.js`, relativa, sin red) en vez del CDN. Verificado con `ffprobe`: sin la copia local, HyperFrames queda deshabilitado (fallback automático a PIL); con ella, el render corre sin ninguna conexión externa.

  **Otros hallazgos empíricos (no documentados, encontrados por prueba real, no asumidos):**
  * El esqueleto de ejemplo de la skill `hyperframes-core` omite `data-start="0"` en la raíz de la composición — `hyperframes lint` lo exige y falla si falta. Nuestro generador lo incluye.
  * `--format webm` **no preservó transparencia** en la versión probada (0.7.37) — el render salió con `pix_fmt: yuv420p` (opaco). `--format mov` (ProRes 4444, `yuva444p12le`) sí la preserva — es el formato que usamos, igual que `title_card.py`.
  * `hyperframes lint` sí sale con código de error (1) cuando hay problemas — verificado forzando una composición rota — por lo que el wrapper de Node puede confiar en el código de salida para decidir si hace fallback a PIL.

  **Robustez:** cualquier falla en `hasHyperframesSupport()` (GSAP no vendorizado, CLI no disponible) o en cualquier paso de `renderHyperframesTitle()` (init/lint/render) cae automáticamente a `title_card.py` sin interrumpir el render — un `catch` explícito en `pipeline.js` registra el motivo en el log de progreso del usuario.

  **Lo que esta integración cubre hoy** (construido sobre la base composición generada + GSAP local, tal como se anticipó): el **bucle agéntico de autoría** que describe el SKILL.md de `hyperframes-core` — `renderHyperframesMotion` genera la composición con el LLM, corre `lint`, realimenta los errores al LLM hasta 3 intentos, y renderiza con alfa. Con eso quedaron conectados: composiciones por descripción libre, diagramas, gráficas animadas y PNG del usuario integrados en la animación. Las **transiciones y los zooms sobre el metraje** se resolvieron por la vía correcta (ffmpeg `xfade`/`zoompan` en el pre-corte, ver arriba), no forzándolos a través de HyperFrames. **Lo que sigue sin construirse (declarado con la misma honestidad):** música de fondo, voz en off, y keying/rotoscopia del sujeto (los motion graphics se componen SOBRE el metraje, no por detrás de la persona).

  **Salvaguarda de red en composiciones generadas:** `enforceLocalRuntime()` reescribe cualquier referencia CDN a GSAP hacia la copia local y **rechaza** la composición si contiene cualquier otra URL http(s) (los namespaces `xmlns` de SVG están exentos: son identificadores, no requests) — el error es visible antes del render, nunca una llamada de red silenciosa.

* **Remotion (obligatorio en la instalación, FR0):** composiciones React; scaffold por slot con `npx create-video@latest`. El pipeline actual no genera ni invoca composiciones Remotion.
* **Manim (opcional):** la skill vendorizada `skills/manim-video/` (SKILL.md + 15 referencias) para diagramas formales — no conectada al pipeline.

`RENDER_CAPABILITIES` en `llm.js` es la única fuente de verdad que el chat de planeación y el editor usan para decidir qué es posible — se actualizó para reflejar la tipografía cinética real de los títulos, y sigue declarando explícitamente lo que no existe todavía.

### 4.5 Transcripción con Whisper local (reemplazo de ElevenLabs)

Decisión de producto: **cero APIs adicionales a la del LLM**. Se reemplaza ElevenLabs Scribe por Whisper ejecutado localmente. El upstream de video-use marca "Whisper local" como anti-patrón por tres razones concretas; cada una se mitiga explícitamente:

| Objeción del upstream | Mitigación |
| --- | --- |
| Salida SRT/por frases pierde los gaps sub-segundo | Se usa `faster-whisper` con `word_timestamps=True` (timestamps por palabra, nunca modo SRT). Además, los **gaps de silencio se calculan directamente del waveform** con `librosa` (ya es dependencia del proyecto) — señal más precisa que cualquier ASR para candidatos de corte. |
| Whisper normaliza/omite fillers ("umm", "uh") — pierde señal editorial | Decodificación orientada a verbatim: `condition_on_previous_text=False`, `initial_prompt` con fillers de ejemplo, y detección complementaria de disfluencias por audio (islas de voz cortas entre silencios que el ASR no transcribió se marcan como `(filler?)` en el JSON). Limitación residual documentada en §8. |
| Lento en CPU | Modelos `large-v3` / `distil-large-v3` sobre GPU (CUDA) o Apple Silicon (`whisper.cpp` con Metal/CoreML); `medium` como fallback en CPU puro. El doctor (FR0) mide el throughput real de la máquina y recomienda modelo. |

**Contrato de compatibilidad:** nuestro `transcribe.py` emite el **mismo esquema JSON que Scribe** (palabras con `start`/`end`, hablante, eventos de audio) para que `pack_transcripts.py`, `timeline_view.py` y `render.py --build-subtitles` funcionen sin modificación. Diarización de hablantes: `pyannote.audio` ejecutado localmente (descarga única del modelo desde Hugging Face en el setup; sin API en tiempo de ejecución). Los modelos se descargan una sola vez, con checksum verificado, en el paso explícito `pnpm setup:models`.

**Beneficios directos:** costo de transcripción $0, sin cuota de terceros, y la promesa de privacidad pasa de "local con excepciones" a **local salvo el LLM**.

---

## 5. Experiencia de Usuario: el flujo completo

Principio rector: **cualquier persona debe poder usar Ovidee instalando solo 4 herramientas base** (Node.js, pnpm, Python, uv — con instrucciones copy-paste en el README). Todo lo demás lo aprovisiona la propia aplicación, con transparencia y aprobación explícita.

```
README (4 herramientas) → git clone → pnpm install → pnpm dev
        ⬇
[1. API Key]      Primera pantalla: pegar la API key del LLM, con enlaces de
                  dónde obtenerla por proveedor. Se guarda en .env (0600).
        ⬇
[2. Onboarding]   La app muestra qué está instalado y qué falta (FFmpeg, FFprobe,
                  Remotion+Chromium, HyperFrames, modelo Whisper, motor Python).
                  Un botón "Instalar" ejecuta los pasos faltantes — mostrando ANTES
                  el comando exacto y el tamaño de descarga de cada uno, y el log
                  en vivo durante la instalación.
        ⬇
[3. Editor]       Arrastrar el video → la app mide duración (ffprobe) →
                  botón "Calcular costo" → selección de modelo (según el
                  proveedor de la API key) → "Aprobar y editar".
        ⬇
[4. Pipeline]     Transcripción local (Whisper) → el LLM propone estrategia y
                  EDL → render (ffmpeg) → v1 del video con reproductor.
        ⬇
[5. Chat]         Chat sobre el resultado: el asistente responde, recomienda
                  mejoras y propone un nuevo EDL; si el usuario aprueba, se
                  renderiza la versión 2 (y sucesivas).
        ⬇
[6. Dashboard]    Costos por video, llamadas a la API (tokens in/out, costo),
                  totales acumulados.
```

## 6. Requerimientos Funcionales (FR)

### FR0: Onboarding Guiado en la Aplicación (Instalación Asistida)

* **Descripción:** Los prerrequisitos multimedia (FFmpeg, FFprobe, Remotion + Chromium headless, HyperFrames, modelo Whisper, dependencias Python) son **obligatorios pero auto-aprovisionados por la app**, no por el usuario.
* **Comportamiento:**
  * Al abrir la app por primera vez, la primera pantalla pide la **API key del LLM**, con instrucciones por proveedor de dónde obtenerla (console.anthropic.com, platform.openai.com, etc.).
  * Con la key guardada, la app ejecuta el diagnóstico y muestra **checklist visual** de qué está instalado y qué falta, con el **comando exacto que se ejecutará y el tamaño estimado de descarga** de cada ítem faltante.
  * El usuario aprueba con un botón; el backend ejecuta los pasos en secuencia mostrando el log en vivo. Nada se instala sin aprobación explícita (los comandos que requieren `sudo` se muestran para ejecución manual — la app nunca pide privilegios).
  * `pnpm setup:doctor` sigue existiendo como equivalente CLI para usuarios avanzados.

### FR6: Editor Intuitivo (Drag & Drop → Assets → Chat de Planeación → Costo → Aprobación)

* El editor muestra una zona de arrastre; al soltar el video, el backend lo copia al workspace del proyecto (`outputs/video1`, `video2`… dentro del proyecto) y mide su duración con FFprobe.
* **Assets del usuario:** tras subir el video se pueden agregar imágenes (png/jpg/webp) al proyecto. El LLM puede insertarlas como overlay **fullscreen** (corte a pantalla completa tipo B-roll, el audio continúa) o **corner** (esquina inferior derecha con transparencia, ~25% del ancho — logos, producto). El servidor convierte cada imagen en un clip componible (MP4 opaco o MOV con alfa) del tamaño exacto del frame de salida.
* **Chat de planeación pre-render (turnos reales de LLM, no texto estático):** entre los assets y la estimación de costo, la UI ofrece una conversación real — el usuario describe con sus palabras la edición que quiere, y en cada turno el asistente (`planEdit` en `llm.js`, endpoint `POST /projects/:id/plan`) responde, hace preguntas cuando falta información relevante, propone 3-5 recomendaciones concretas seleccionables, y **reescribe completo** el brief de edición (`instructions`) incorporando todo lo acordado. Marca `ready_to_render` cuando el brief ya alcanza para editar. Esto reemplazó un enfoque anterior de chips estáticos concatenados sin LLM — no era un chat real porque no mejoraba el prompt, solo enviaba las opciones elegidas tal cual. El brief resultante es el que recibe la **primera** llamada de edición al aprobar, evitando el ciclo "editar en blanco → corregir por chat → pagar una segunda llamada". Se cobra una llamada por turno de esta conversación (propósito `plan` en el dashboard), igual que cualquier otro chat con el LLM — es una llamada real, no gratuita, y así se declara.
* **Lista de proyectos:** paginada de a 5, con eliminación por proyecto. La eliminación exige confirmación en un pop-up y es un **soft delete**: se borran los archivos del workspace (video, assets, renders) pero el registro y sus `api_calls` se conservan (`deleted_at`), de modo que el dashboard sigue reflejando los tokens y el costo que ese proyecto consumió.
* **Captions totalmente parametrizables (no "estilos" cerrados):** `captions.py` genera .ass desde los timestamps por palabra de Whisper y los quema con libass DESPUÉS de los overlays (Hard Rule 1). Parámetros: `chunk_size` (1-4 palabras visibles, objetivo — se recorta automáticamente si no caben, medido con PIL usando la misma fuente que renderiza libass, nunca por conteo fijo de palabras), `highlight_mode` (`current_word` = se resalta ÚNICAMENTE la palabra exacta que se dice en ese instante, sin acumulación, un evento ASS por palabra con overrides de color `\c`; `cumulative` = relleno progresivo clásico vía `\kf`, las palabras dichas quedan coloreadas; `none` = texto uniforme sin resaltado), `color` (cualquier hex) y `position` (`top` | `middle` | `bottom`, siempre centrado horizontalmente, con márgenes y tamaño de fuente recalculados según si el video es horizontal o vertical). El límite entre líneas se recorta contra el inicio de la siguiente para que libass nunca apile dos líneas en pantalla. Requiere ffmpeg con libass — en macOS `ffmpeg-full` (el `ffmpeg` core de Homebrew 8.x no lo trae; el onboarding lo detecta).
* **Títulos animados con tipografía cinética real:** motor primario HyperFrames (HTML/CSS/GSAP — palabras que entran con stagger + acento de color animado), GSAP con copia local (§4.4, el render no toca la red); respaldo automático a `title_card.py` (PIL: fade-in/rise, easing cúbico) si HyperFrames no está disponible o falla. Posiciones: center y lower third, color configurable.
* **Transiciones, efectos de cámara y motion graphics por descripción libre:** ver §4.4 — transiciones `xfade` y zooms por rango vía pre-corte ffmpeg; diagramas, gráficas animadas y escenas libres (con PNG del usuario integrados) vía el bucle agéntico HyperFrames. El EDL los expone como `transitions`, `ranges[].effect` y `motion_graphics[]`.
* **Capacidades declaradas con honestidad, sin inventar límites que no existen:** `RENDER_CAPABILITIES` en `llm.js` es la única fuente de verdad de lo que el sistema puede hacer, compartida por el chat de planeación y el editor — así ninguno de los dos rechaza algo que el otro sí sabe hacer. La eliminación de muletillas se limita a las que aparezcan en el transcript (Whisper a veces las omite — §4.5); música de fondo, voz en off y keying del sujeto se declaran explícitamente como no disponibles todavía — y solo eso, nada más.
* Botón **"Calcular costo"**: aplica la fórmula del FR3 con el modelo seleccionado y muestra el rango (optimizado con caching vs plano) más el tiempo estimado de transcripción local.
* **Panel de configuración**: selección del modelo según el proveedor detectado por la API key (catálogo en SQLite, FR4), con precios visibles por modelo. El mismo modelo seleccionado alimenta tanto el chat de planeación como la edición final.
* Botón **"Aprobar y editar"** (FR5, human-in-the-loop): solo entonces arranca el pipeline. La UI muestra el progreso por etapas (transcripción → estrategia del LLM → render).

### FR7: Chat de Iteración y Versionado (post-render)

* Terminada la v1, la UI muestra el video renderizado junto a la **estrategia en texto plano** que produjo el LLM y un panel de chat — mismo patrón conversacional que el chat de planeación (FR6), pero operando sobre el EDL ya renderizado en lugar del brief inicial.
* El usuario pide cambios en lenguaje natural; el asistente responde con **recomendaciones seleccionables** (`{label, prompt}`, 3-5 opciones concretas con parámetros reales, nunca genéricas) y, cuando aplica, propone un **nuevo EDL**. Si el usuario aprueba la propuesta, se renderiza la **versión N+1** (el historial de versiones queda navegable, cada una con su costo).
* Cada mensaje del chat es una llamada a la API registrada en el dashboard (FR8, propósito `chat`).

### FR-W: Website → Video (generar un video desde una URL)

La segunda puerta de entrada de la plataforma, junto al drag & drop de metraje: el usuario pega una **URL** y Ovidee genera un video DEL sitio (tour, presentación para redes, showcase de producto), con el mismo patrón de la edición de metraje — capturar localmente → planear por chat → aprobar costo → generar → iterar por versiones. Es la adaptación servidor-orquestada del workflow `website-to-video` de las skills de HyperFrames (captura → identidad de marca → brief → storyboard → composición → validación), el mismo que ya usan agentes de código desde la terminal; herramientas comerciales (Lumen5, Pictory, InVideo) siguen el mismo patrón URL → guion → escenas, pero en la nube y con el material del usuario en servidores de terceros — aquí todo el material se queda en la máquina.

* **FR-W1 — Captura local:** `hyperframes capture <url>` con el navegador headless local produce en `<videos_dir>/capture/`: screenshots de scroll, assets del sitio (logos, imágenes), texto visible, y tokens de diseño (paleta con estadísticas de uso, tipografía, encabezados, CTAs). Sin costo de LLM. **Privacidad:** el navegador local visita la URL que el usuario eligió (única salida de red del feature); al LLM solo viaja **texto** (resumen + paleta + nombres de archivo) — los screenshots y assets nunca salen de la máquina, se usan como archivos locales de la composición.
* **FR-W2 — Planeación por chat + generación:** el chat de planeación (mismo patrón FR6, prompt específico de sitios: objetivo, mensaje, duración, formato horizontal/vertical) produce el brief; al aprobar (estimación FR3 con `estimateWebCost` — sin transcripción, el costo dominante es la composición), `generateWebComposition` produce una composición HyperFrames **opaca multi-escena** (capturas con paneos Ken Burns o en marco de navegador dibujado en CSS, tipografía cinética con la paleta real del sitio, textos reales del sitio, cierre con la URL como CTA) a través del mismo bucle agéntico generar → lint → autocorregir → `render --format mp4` de §4.4. El brief se persiste (`edit/brief.txt`) y la composición HTML de cada versión es su "EDL" (`video_versions.edl_path`).
* **FR-W3 — Iteración:** chat post-render (`chatAboutWebVideo`) con el contexto del sitio + brief + estrategia actual; cada cambio aprobado regenera la composición (revisión sobre el HTML anterior) y renderiza vN+1. Estados del proyecto web: `capturing → captured → estimated → editing → rendering → done`.
* Los proyectos web conviven con los de metraje en la misma tabla (`project_type = 'web'`, `source_url`), la misma lista paginada, el mismo dashboard de costos y el mismo soft-delete.

### FR8: Dashboard de Costos y Llamadas

* Vista con: costo total acumulado, costo por proyecto (estimado vs real), tabla de llamadas a la API (fecha, propósito — `edl` / `plan` / `chat` / `motion` (motion graphics) / `web_compose` (composición de video web) —, modelo, tokens de entrada/salida, costo), y tiempo de transcripción local acumulado (costo $0).
* Fuente de datos: tablas `api_calls`, `video_projects` y `video_versions` en SQLite.

### FR1: Gestión de Paquetes Segura (Anti-Supply-Chain)

* pnpm 10+ bloquea los scripts de ciclo de vida por defecto; los paquetes que legítimamente los requieren (`esbuild`, `@remotion/compositor-*`, `better-sqlite3`) se aprueban vía `onlyBuiltDependencies` tras revisión manual.
* `minimumReleaseAge` (p. ej. 4320 minutos = 3 días) para rechazar versiones recién publicadas — defensa principal contra cuentas de mantenedores comprometidas.
* `pnpm audit` en CI como control complementario de CVEs conocidos.
* Paridad en Python: `uv` con `uv.lock` para las dependencias del motor lógico (incluidas `faster-whisper` y `pyannote.audio`).
* Los modelos de ML (Whisper, pyannote) se fijan por versión y checksum en el setup — nunca "latest".

### FR2: Gestión de Credenciales Locales

* **Descripción:** Almacenamiento local de la única credencial necesaria: la API Key del proveedor LLM (Anthropic, OpenAI, Gemini, DeepSeek). **No se requiere ninguna otra API key** — la transcripción es local.
* **Comportamiento:** La interfaz recibe la clave y el backend la escribe en `.env` local con permisos `0600`. Las claves nunca aparecen en logs ni vuelven al frontend (la UI muestra solo los últimos 4 caracteres).
* **Control:** `.env` en `.gitignore` raíz.
* **Mejora futura (v2):** llavero del sistema operativo.

### FR3: Motor Predictivo de Costos e Historial

* **Lógica:** FFprobe mide la duración del metraje antes de que intervenga el LLM:

  `Costo Estimado = (Tokens de Contexto + Tokens de Transcripción Proyectada) × F × Tarifa del Modelo`

  con `F` = factor de sobrecarga del agente (iteraciones, tool calls, reintentos), valor inicial **2.5**, calibrable contra `actual_cost_usd` por proyecto. La transcripción local tiene costo monetario $0; la UI muestra en su lugar el **tiempo estimado de transcripción** según el benchmark del doctor.
* **Visualización:** rango de costo optimizado (con *Prompt Caching*) y costo plano.

### FR4: Sincronización Dinámica de Tarifas (Auto-Update)

* Cron job semanal local descarga el JSON de `https://openrouter.ai/api/v1/models`, parsea tarifas y actualiza `llm_models` en SQLite. Si falla, conserva tarifas anteriores y muestra la fecha del último sync en la UI.

### FR5: Interfaz Humana en el Bucle (Human-in-the-Loop)

* Implementa la Hard Rule 11 de video-use: la IA propone la estrategia en texto plano (forma, elección de takes, dirección de corte, plan de animación, grade, subtítulos, duración estimada) y el pipeline queda bloqueado hasta que el usuario presione *"Aprobar Estrategia"* o modifique las instrucciones. Tras el render, la UI muestra el resultado del self-eval (máx. 3 pasadas) antes del render final.

---

## 7. Requerimientos No Funcionales (NFR)

| Categoría | Especificación Técnica |
| --- | --- |
| **Seguridad de Red** | Backend solo en loopback (`127.0.0.1`). WebSockets con token de sesión generado al arranque (defensa contra DNS rebinding y webs abiertas apuntando a localhost). |
| **Integridad de Código** | `pnpm-lock.yaml` + `uv.lock` obligatorios; CI instala con `--frozen-lockfile`. Modelos ML fijados por checksum. |
| **Privacidad de Datos** | Cero telemetría externa (`NEXT_TELEMETRY_DISABLED=1`, telemetría de Remotion y HyperFrames desactivadas). Salidas de red en operación: la API del LLM y, solo en proyectos web, la visita del navegador local a la URL que el usuario pidió capturar (FR-W1). Ni video, ni audio, ni las capturas del sitio salen de la máquina — al LLM solo viaja texto. |
| **Robustez de Audio** | Micro-fades de 30 ms en cada corte (Hard Rule 3), implementados por `render.py`. |
| **Independencia** | Ninguna referencia, credencial, dominio o infraestructura corporativa en código, docs o CI. Repositorio público en GitHub bajo cuenta personal u organización propia del proyecto. |

---

## 8. Modelo de Datos Local (SQLite - `app.db`)

```sql
CREATE TABLE IF NOT EXISTS configurations (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_models (
    model_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    friendly_name TEXT NOT NULL,
    input_cost_per_million REAL NOT NULL,
    output_cost_per_million REAL NOT NULL,
    context_window_size INTEGER NOT NULL,
    last_synced DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS video_projects (
    project_id TEXT PRIMARY KEY,
    videos_dir TEXT NOT NULL,            -- workspace del proyecto; los artefactos viven en <videos_dir>/edit/
    source_filename TEXT NOT NULL,
    video_duration_seconds REAL NOT NULL,
    execution_status TEXT NOT NULL,      -- uploaded | estimated | transcribing | editing | rendering | done | error
    model_id TEXT,
    estimated_cost_usd REAL DEFAULT 0.0,
    actual_cost_usd REAL DEFAULT 0.0,
    tokens_input_consumed INTEGER DEFAULT 0,
    tokens_output_consumed INTEGER DEFAULT 0,
    transcription_seconds_elapsed REAL DEFAULT 0.0,  -- tiempo de Whisper local (costo $0)
    strategy_text TEXT,                  -- estrategia en texto plano propuesta por el LLM (FR5)
    deleted_at DATETIME,                 -- soft delete: el costo consumido sobrevive a la eliminación
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cada llamada a la API del LLM (dashboard FR8)
CREATE TABLE IF NOT EXISTS api_calls (
    call_id TEXT PRIMARY KEY,
    project_id TEXT,
    model_id TEXT NOT NULL,
    purpose TEXT NOT NULL,               -- edl | chat
    tokens_input INTEGER NOT NULL,
    tokens_output INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Assets del usuario por proyecto (imágenes insertables como overlay, FR6)
CREATE TABLE IF NOT EXISTS project_assets (
    asset_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Versiones renderizadas por proyecto (FR7)
CREATE TABLE IF NOT EXISTS video_versions (
    version_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    edl_path TEXT NOT NULL,
    output_path TEXT NOT NULL,
    feedback TEXT,                       -- petición del usuario que originó esta versión
    cost_usd REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Los artefactos de edición (EDL, transcripts, animaciones) **no** se duplican en SQLite: la fuente de verdad es `<videos_dir>/edit/`, como define la Hard Rule 12. SQLite solo indexa proyectos, estados y costos.

---

## 9. Licenciamiento y Riesgos Abiertos

* **Licencia del proyecto:** MIT, © 2026 Ovidee contributors — cubre **el código de Ovidee**. Las porciones derivadas de `video-use` conservan el aviso MIT de Browser Use. HyperFrames (Apache 2.0) y Whisper/faster-whisper (MIT) son compatibles sin restricciones.
* **Modelo "instalar, no redistribuir" (documentado en `THIRD_PARTY_NOTICES.md`):** las herramientas internas (HyperFrames, Remotion, GSAP, FFmpeg, modelos Whisper) **no se redistribuyen con el repo** — la app las instala en la máquina del usuario con los comandos oficiales de cada autor, exactamente el mismo flujo que ya usa cualquier persona desde la terminal con agentes de código. Así el proyecto MIT puede apoyarse en herramientas con licencias heterogéneas sin recortar capacidades: cada licencia aplica entre el usuario y el autor de la herramienta. `THIRD_PARTY_NOTICES.md` (raíz del repo, enlazado desde README y LICENSE) es el inventario canónico con las aclaraciones por componente.
* **Licencia de Remotion:** Remotion es obligatorio en la instalación pero **no es open source** — es *source-available*: gratuito para individuos y organizaciones de hasta 3 personas; las empresas mayores necesitan licencia de compañía. Como se instala en la máquina de cada usuario (no se redistribuye), la obligación recae en cada usuario/organización; el README y `THIRD_PARTY_NOTICES.md` lo declaran de forma visible. Mitigación estructural: HyperFrames (Apache 2.0) es el motor por defecto y existe la ruta de migración `/remotion-to-hyperframes` si el proyecto decide unificar motores en el futuro.
* **Licencia de GSAP:** gratuita para todo uso (incluido comercial) desde su adquisición por Webflow, pero **no es MIT ni OSI** — por eso no se incluye en el repo: se descarga una vez desde su distribución oficial durante el onboarding (con aprobación del usuario) y queda como copia local en `.vendor/`, lo que además garantiza renders sin CDN.
* **Calidad verbatim de Whisper:** aun con la decodificación orientada a verbatim (§4.5), Whisper puede omitir fillers que Scribe sí capturaba. Impacto: el LLM pierde algo de señal editorial para detectar false starts. Mitigación parcial vía detección de disfluencias por waveform; se acepta como trade-off explícito a cambio de $0 de costo y privacidad total. Revisar periódicamente ASRs locales verbatim (p. ej. variantes fine-tuned de Whisper para transcripción literal).
* **Diarización local:** `pyannote.audio` requiere aceptar términos y descargar el modelo desde Hugging Face una única vez durante el setup (no es una API en runtime). Para material de un solo hablante la diarización se omite por completo.
* **Divergencia del upstream:** el submódulo apunta al fork `Zitr0/video-use`; definir política de sync con `browser-use/video-use` (pull periódico con revisión de diff, coherente con la política `minimumReleaseAge`). Igual para el pin de versión de las skills de HyperFrames.

---

## 10. Plantilla del `README.md` (Instalación Simple)

**Estructura bilingüe del README publicado:** `README.md` es un landing corto y bilingüe
(resumen ES/EN lado a lado, botones-insignia hacia la documentación completa de cada idioma,
quick start y la sección de apoyo al proyecto — que se mantiene en las tres piezas);
`README.es.md` y `README.en.md` contienen la documentación completa por idioma, cada una con
barra de idioma (🏠 Inicio · 🇪🇸 · 🇬🇧), tabla de contenido y navegación de "paginado" entre
secciones (`‹ anterior · contenido · siguiente ›`). Todo con Markdown/HTML estático de GitHub
(anclas + badges-enlace), sin JavaScript. La plantilla de contenido de referencia:

```markdown
# 🎬 Ovidee (Open-Source)

Editor de video agéntico, local-first y open source (MIT). Interfaz web sobre la skill
[video-use](https://github.com/browser-use/video-use), con animaciones
[HyperFrames](https://github.com/heygen-com/hyperframes), transcripción Whisper 100% local,
control de costos y human-in-the-loop. La única API que necesitas es la de tu LLM.

## 🔒 Directiva de Seguridad de la Cadena de Suministro

Este proyecto usa **pnpm** de forma obligatoria (no npm):
- Scripts de instalación de terceros bloqueados por defecto; solo compilan los paquetes
  aprobados en `onlyBuiltDependencies`.
- `minimumReleaseAge` impide instalar versiones publicadas hace menos de 3 días.
- `pnpm-lock.yaml` y `uv.lock` son la única fuente de verdad de versiones y checksums.
- Los modelos de ML (Whisper, pyannote) se descargan una sola vez, fijados por checksum.

## 🚀 Requisitos Previos (obligatorios)

* **Node.js** (v22+) y **pnpm** (v10+)
* **Python** (v3.10+) y **uv**
* **FFmpeg y FFprobe** — obligatorios: `brew install ffmpeg` (macOS) / `apt-get install -y ffmpeg` (Debian/Ubuntu)
* Una API key de tu proveedor LLM (Anthropic, OpenAI, Gemini o DeepSeek). Nada más.

## 📦 Instalación

    # 1. Clonar con el submódulo de la skill video-use
    git clone --recursive https://github.com/<org>/ovidee.git
    cd ovidee

    # 2. Dependencias JS (scripts de terceros bloqueados por defecto)
    pnpm install --frozen-lockfile

    # 3. Dependencias Python (motor de edición + faster-whisper)
    uv sync

    # 4. Remotion (obligatorio) y su Chromium headless — paso explícito, nunca postinstall
    pnpm exec remotion browser ensure

    # 5. Skills de HyperFrames (motor de animación por defecto)
    npx skills add heygen-com/hyperframes --full-depth --yes

    # 6. Modelos locales de transcripción (descarga única, con checksum)
    pnpm setup:models

    # 7. Verificar el entorno completo (ffmpeg, ffprobe, remotion, hyperframes, whisper)
    pnpm setup:doctor

    # 8. Lanzar
    pnpm dev

La plataforma se despliega aislada en `http://127.0.0.1:3000` (solo loopback).

## ⚖️ Nota de licencias

El código de Ovidee es MIT. Las herramientas internas se instalan con los flujos oficiales
de cada autor y no se redistribuyen: HyperFrames es Apache 2.0 (open source pleno); GSAP es
gratuita para todo uso pero no-MIT (se descarga una vez y queda como copia local);
**Remotion** es source-available: gratuita para individuos y equipos de hasta 3 personas;
organizaciones mayores requieren [licencia de compañía](https://www.remotion.dev/license).
Inventario completo en `THIRD_PARTY_NOTICES.md`. La transcripción es Whisper local: tu
audio y tu video nunca salen de tu máquina.
```
