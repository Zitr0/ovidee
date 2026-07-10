# Avisos de terceros (Third-Party Notices)

**Ovidee es MIT** ([LICENSE](./LICENSE)) y eso cubre **el código de Ovidee**: el
orquestador, la UI, el motor Python propio y los scripts de este repositorio.

Para funcionar de verdad —transiciones, efectos, motion graphics, transcripción,
render— Ovidee **instala herramientas de terceros en tu máquina**, exactamente con
los mismos comandos de instalación que publica cada autor (lo mismo que haría
cualquier persona usándolas desde la terminal). Con una sola excepción declarada
abajo (video-use), **ninguna de esas herramientas se redistribuye dentro de este
repositorio**: cada una llega a tu máquina desde su fuente oficial, en el
onboarding y con tu aprobación explícita en pantalla, y su licencia aplica entre
tú y su autor. La licencia MIT de Ovidee ni amplía ni restringe lo que cada
herramienta te permite.

## Inventario

| Componente | Rol en Ovidee | Licencia | Cómo llega a tu máquina |
|---|---|---|---|
| [video-use](https://github.com/browser-use/video-use) (fork [Zitr0/video-use](https://github.com/Zitr0/video-use)) | Helpers de edición (EDL, render, grade, Hard Rules) | **MIT** © Browser Use | **Sí se redistribuye**: submódulo git de este repo, con su aviso MIT conservado en [LICENSE](./LICENSE) |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | Motor de motion graphics agéntico (títulos cinéticos, diagramas, gráficas animadas, escenas por descripción libre) | **Apache 2.0** © HeyGen | CLI como devDependency npm pinneada + skills vía `npx skills add heygen-com/hyperframes --full-depth` en el onboarding |
| [GSAP](https://gsap.com) | Runtime de animación que usan las composiciones HyperFrames | **Licencia estándar de GSAP** (gratuita para todo uso, incluido comercial, desde su adquisición por Webflow — pero **no es MIT ni OSI**) | Descarga única en el onboarding a `.vendor/` como copia local; no se incluye en el repo |
| [Remotion](https://www.remotion.dev) | Motor de animación React (instalación obligatoria del stack) | **Remotion License** (*source-available*, **no open source**): gratuita para individuos y organizaciones de hasta 3 personas; organizaciones mayores requieren [licencia de compañía](https://www.remotion.dev/license) | Dependencia npm + Chromium headless (`pnpm exec remotion browser ensure`) en el onboarding |
| Chromium headless | Navegador aislado que usan Remotion y HyperFrames para renderizar | **BSD 3-Clause** | Lo descargan Remotion/HyperFrames a un directorio propio |
| [FFmpeg / FFprobe](https://ffmpeg.org) | Motor de video: cortes, transiciones, efectos, concat, audio, subtítulos | **LGPL 2.1+**; los builds completos (p. ej. `ffmpeg-full` de Homebrew, necesario para libass) incluyen componentes **GPL** | Lo instalas tú (o la app por ti) vía brew/apt desde los repositorios oficiales del sistema |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) + modelos Whisper de OpenAI | Transcripción 100% local | **MIT** (librería y pesos del modelo) | `uv sync` + descarga del modelo con verificación de hash en el onboarding |
| Next.js, Fastify, better-sqlite3, SDKs de LLM y demás dependencias npm/PyPI | Infraestructura de la app | MIT / Apache 2.0 (ver lockfiles) | `pnpm install` / `uv sync` desde los registros oficiales, con lockfile como única fuente de verdad |

## Aclaraciones importantes

1. **Remotion es la única pieza con una obligación real de licencia.** Si usas
   Ovidee como individuo o en una organización de hasta 3 personas, Remotion es
   gratuita. Si tu organización es mayor, necesitas una
   [licencia de compañía de Remotion](https://www.remotion.dev/license) —
   esa obligación es tuya frente a Remotion, no algo que Ovidee pueda conceder
   ni eximir. Ovidee no redistribuye Remotion: la instala en tu máquina como lo
   haría `npm install`.

2. **GSAP es gratuita pero no open source en sentido OSI.** Por eso Ovidee no la
   incluye en el repositorio: se descarga una vez desde su distribución oficial
   durante el onboarding (con tu aprobación) y queda como copia local en
   `.vendor/`, de modo que los renders nunca dependen de un CDN.

3. **Las herramientas se usan tal como fueron diseñadas.** HyperFrames, Remotion
   y las skills asociadas se instalan con sus comandos oficiales y sin
   modificaciones — el mismo flujo que ya usan miles de personas desde la
   terminal con agentes de código. Lo único que Ovidee añade es la aprobación
   explícita en pantalla antes de instalar y la copia local del runtime de
   animación.

4. **Privacidad.** Nada de lo anterior cambia la promesa central: tu video y tu
   audio nunca salen de tu máquina. Las únicas salidas de red son (a) el texto
   que envías al proveedor LLM que tú elijas, (b) las descargas de instalación
   del onboarding, que ves y apruebas una por una, y (c) en los videos desde
   URL, la visita de tu navegador local al sitio que tú mismo pediste capturar
   — las capturas resultantes se quedan en tu disco.

5. **Si redistribuyes Ovidee** (un fork, un paquete, un instalador), este
   archivo y el [LICENSE](./LICENSE) deben acompañarlo. Los avisos de licencia
   de las herramientas de terceros los gestiona cada instalador upstream en la
   máquina del usuario final.
