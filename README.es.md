<div align="center">

# 🎬 Ovidee — Documentación

<sub>🏠 [Inicio](./README.md) · **🇪🇸 Español** · 🇬🇧 [English](./README.en.md)</sub>

</div>

Crea y edita videos conversando con una IA, **sin que tu material salga de tu máquina**.
Open source (MIT), local-first, y **la única API que necesitas es la de tu LLM**.

## 📚 Contenido

1. [Qué puede hacer](#-qué-puede-hacer)
2. [Instalación en 3 pasos](#-instalación-en-3-pasos)
3. [Seguridad y privacidad](#-seguridad-y-privacidad)
4. [Estructura del proyecto](#-estructura-del-proyecto)
5. [Apoya el proyecto](#-apoya-el-proyecto)
6. [Nota de licencias](#%EF%B8%8F-nota-de-licencias)

## ✨ Qué puede hacer

Dos formas de empezar:

- **🎬 Arrastra tu metraje** — Ovidee lo transcribe localmente (Whisper), propone la
  edición con el modelo de IA que elijas y renderiza con FFmpeg:
  - Cortes con criterio editorial en fronteras de palabra, eliminación de silencios y falsos comienzos.
  - **Transiciones** entre cortes (crossfade, dissolve, fades, wipes, slides) y **zooms** suaves por rango.
  - **Captions karaoke** totalmente parametrizables (resaltado por palabra, color, posición, tamaño de grupo).
  - **Títulos cinéticos** (HTML/CSS/GSAP vía HyperFrames, con respaldo automático).
  - **Motion graphics por descripción libre**: diagramas, gráficas animadas con datos, callouts,
    escenas con tus PNG transparentes integrados — generados, validados y renderizados con alfa.
- **🌐 Pega una URL** — Ovidee captura el sitio con tu navegador local (screenshots, textos,
  paleta de colores), conversa contigo sobre qué quieres lograr, y **genera un video del sitio**
  (tour, clip para redes, presentación de producto) con su propio material y su identidad visual.

En ambos casos: apruebas el costo antes de gastar un centavo, y luego pides cambios por chat
para generar nuevas versiones (v2, v3…), cada una con su costo visible.

<sub>[Contenido](#-contenido) · [Siguiente: Instalación ›](#-instalación-en-3-pasos)</sub>

## 🚀 Instalación en 3 pasos

Solo necesitas 4 herramientas base. Si ya las tienes, salta al paso 3.

### Paso 1 — Node.js 22+ y pnpm

```bash
# macOS (con Homebrew: https://brew.sh)
brew install node
corepack enable pnpm

# Windows (con winget) / Linux: instala Node 22+ desde https://nodejs.org y luego:
# corepack enable pnpm
```

### Paso 2 — Python 3.10+ y uv

```bash
# macOS
brew install python uv

# Windows / Linux: https://docs.astral.sh/uv/getting-started/installation/
# (uv puede instalar Python por ti: `uv python install 3.12`)
```

### Paso 3 — Descargar y arrancar Ovidee

```bash
git clone --recursive https://github.com/Zitr0/ovidee.git
cd ovidee
pnpm install
pnpm dev
```

Abre **http://127.0.0.1:3000** y la aplicación te guía con el resto:

1. **Pega tu API key** — la app te dice dónde obtenerla según tu proveedor
   (Anthropic, OpenAI, Gemini o DeepSeek). Es la única credencial de todo el sistema.
2. **Revisa el checklist de instalación** — la app detecta qué falta (FFmpeg, Remotion,
   HyperFrames, modelo Whisper…) y te muestra **el comando exacto y el tamaño de descarga**
   de cada cosa. Con un clic en "Instalar" lo hace por ti, con el log en vivo.
3. **Arrastra tu video o pega una URL** — calcula el costo, elige el modelo, aprueba,
   y recibe tu `final.mp4`. Pide cambios por chat para generar la versión 2, 3…

<sub>[‹ Qué puede hacer](#-qué-puede-hacer) · [Contenido](#-contenido) · [Siguiente: Seguridad ›](#-seguridad-y-privacidad)</sub>

## 🔒 Seguridad y privacidad

- **Tu video y tu audio nunca salen de tu máquina.** La transcripción es Whisper local;
  solo el texto viaja al LLM que tú elijas.
- **Los videos desde URL también son locales:** tu navegador (headless) visita la URL que
  tú eliges y guarda screenshots, textos y paleta en tu disco — esa visita es la única
  salida de red del feature. Al LLM solo viaja texto; las capturas nunca se suben.
- Todo corre en `127.0.0.1` (loopback): nada queda expuesto a tu red.
- Cadena de suministro blindada: **pnpm** con scripts de terceros bloqueados por defecto
  (`onlyBuiltDependencies`), `minimumReleaseAge: 4320` (rechaza paquetes publicados hace
  menos de 3 días) y lockfiles (`pnpm-lock.yaml`, `engine/uv.lock`) como única fuente de
  verdad. Nada se instala sin tu aprobación explícita en pantalla.
- Cero telemetría. Ver [`PRD.md`](./PRD.md) para el modelo de amenazas completo.

<sub>[‹ Instalación](#-instalación-en-3-pasos) · [Contenido](#-contenido) · [Siguiente: Estructura ›](#-estructura-del-proyecto)</sub>

## 🗂 Estructura del proyecto

```
apps/web/        Frontend Next.js (onboarding, editor, chat, dashboard) — 127.0.0.1:3000
apps/server/     Orquestador Fastify + SQLite — 127.0.0.1:3001
engine/          Motor Python: transcripción Whisper local compatible con Scribe
vendor/video-use Submódulo: skill de edición (12 Hard Rules, helpers ffmpeg)
scripts/         doctor CLI (equivalente al checklist de la app)
db/              Esquema SQLite (proyectos, versiones, llamadas API, tarifas)
THIRD_PARTY_NOTICES.md  Inventario de licencias de las herramientas instaladas
```

Los proyectos de video viven en `outputs/video1`, `video2`… y sus artefactos
(transcripciones, EDL, capturas, renders) en `outputs/videoN/edit/` (carpeta ignorada por git).

<sub>[‹ Seguridad](#-seguridad-y-privacidad) · [Contenido](#-contenido) · [Siguiente: Apoya el proyecto ›](#-apoya-el-proyecto)</sub>

## ☕ Apoya el proyecto

Ovidee es gratuito y open source — no se cobra nada por usarlo. Si te resulta útil,
puedes apoyar su desarrollo de forma voluntaria:

[![Buy Me a Coffee](https://img.shields.io/badge/☕_Buy_Me_a_Coffee-apoya_el_proyecto-FFDD00)](https://buymeacoffee.com/supportprojects)
[![MercadoPago](https://img.shields.io/badge/💛_MercadoPago-Colombia-00B1EA)](https://link.mercadopago.com.co/buymeacoffeecolombia)

Las donaciones no desbloquean funcionalidades: todo Ovidee es y seguirá siendo libre.

<sub>[‹ Estructura](#-estructura-del-proyecto) · [Contenido](#-contenido) · [Siguiente: Licencias ›](#%EF%B8%8F-nota-de-licencias)</sub>

## ⚖️ Nota de licencias

**El código de Ovidee es MIT** — puedes usarlo, modificarlo y redistribuirlo libremente.
Las herramientas que Ovidee instala en tu máquina para darte todo su alcance se instalan
**tal como las publica cada autor** (los mismos comandos que usarías desde la terminal),
no se redistribuyen con este repositorio, y cada una conserva su propia licencia:

- **HyperFrames** (motor de motion graphics: títulos cinéticos, diagramas, gráficas
  animadas, escenas por descripción libre, captura de sitios) es **Apache 2.0** — open source pleno.
- **GSAP** (el runtime de animación de esas composiciones) es **gratuita para todo uso,
  incluido el comercial**, pero su licencia no es MIT; por eso se descarga una sola vez
  desde su distribución oficial durante el onboarding y queda como copia local — los
  renders nunca la cargan de un CDN.
- **Remotion** es *source-available*: gratuita para individuos y equipos de hasta 3
  personas; organizaciones mayores requieren
  [licencia de compañía](https://www.remotion.dev/license). Esa obligación es de cada
  usuario/organización frente a Remotion — Ovidee no la redistribuye.
- **FFmpeg** (LGPL/GPL según el build) y **Whisper/faster-whisper** (MIT) completan el stack.

El inventario completo, con quién instala qué y qué obligaciones aplican, está en
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). Nada de esto cambia la promesa de
privacidad: la transcripción es Whisper local y tu audio y tu video nunca salen de tu máquina.

---

<div align="center">
<sub>[‹ Apoya el proyecto](#-apoya-el-proyecto) · [Contenido](#-contenido) · 🏠 [Inicio](./README.md) · 🇬🇧 [English](./README.en.md)</sub>
</div>
