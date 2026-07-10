import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ROOT } from './env.js'
import { GSAP_VERSION, VENDOR_GSAP } from './hyperframes.js'

const execFileP = promisify(execFile)

async function has(cmd, args = ['-version']) {
  try {
    await execFileP(cmd, args)
    return true
  } catch {
    return false
  }
}

// El ffmpeg mínimo de Homebrew core (8.x) no trae libass → no puede quemar subtítulos
async function ffmpegWithLibass() {
  try {
    const { stdout } = await execFileP('ffmpeg', ['-hide_banner', '-filters'])
    return /\bsubtitles\b/.test(stdout)
  } catch {
    return false
  }
}

// FR0: cada ítem declara el comando exacto y el tamaño de descarga que verá el
// usuario ANTES de aprobar. Nada corre sin ese consentimiento.
export async function getChecks() {
  const isMac = platform() === 'darwin'
  const hub = path.join(homedir(), '.cache', 'huggingface', 'hub')
  const whisperInstalled =
    existsSync(hub) && readdirSync(hub).some((d) => /faster-whisper/i.test(d))

  const checks = [
    {
      id: 'ffmpeg',
      name: 'FFmpeg + FFprobe (con subtítulos)',
      detail: 'Motor de video: cortes, concatenación, audio, render y subtítulos quemados (libass)',
      installed: (await has('ffmpeg')) && (await has('ffprobe')) && (await ffmpegWithLibass()),
      command: isMac ? 'brew install ffmpeg-full' : 'sudo apt-get install -y ffmpeg',
      downloadSize: '~250 MB',
      needsSudo: !isMac,
    },
    {
      id: 'engine',
      name: 'Motor Python (Whisper + helpers)',
      detail: 'Dependencias del motor de transcripción y edición',
      installed: existsSync(path.join(ROOT, 'engine', '.venv')),
      command: 'uv sync  (en ./engine)',
      execArgs: ['uv', ['sync'], path.join(ROOT, 'engine')],
      downloadSize: '~250 MB',
    },
    {
      id: 'remotion-browser',
      name: 'Remotion (Chromium headless)',
      detail: 'Motor de animaciones React; descarga un navegador aislado',
      installed:
        existsSync(path.join(ROOT, 'node_modules', '.remotion')) ||
        existsSync(path.join(homedir(), '.remotion')),
      command: 'pnpm exec remotion browser ensure',
      execArgs: ['pnpm', ['exec', 'remotion', 'browser', 'ensure'], ROOT],
      downloadSize: '~95 MB',
    },
    {
      id: 'hyperframes',
      name: 'Skills de HyperFrames',
      detail:
        'Motor de motion graphics agéntico (HTML/CSS → video, Apache 2.0): títulos cinéticos, ' +
        'diagramas, gráficas animadas y escenas por descripción libre compuestas sobre tu video. ' +
        'Se instala tal como lo publica su autor (heygen-com/hyperframes), igual que quien lo usa desde la terminal.',
      installed:
        existsSync(path.join(ROOT, '.agents', 'skills', 'hyperframes')) ||
        existsSync(path.join(homedir(), '.claude', 'skills', 'hyperframes')),
      command: 'npx skills add heygen-com/hyperframes --full-depth --yes',
      execArgs: ['npx', ['-y', 'skills', 'add', 'heygen-com/hyperframes', '--full-depth', '--yes'], ROOT],
      downloadSize: '~40 MB',
    },
    {
      id: 'hyperframes-gsap',
      name: 'Runtime de animación (GSAP local)',
      detail:
        'La librería de animación que usan los títulos y motion graphics de HyperFrames. Se descarga ' +
        'UNA VEZ aquí (con tu aprobación, como todo) y queda como copia local: los renders nunca ' +
        'necesitan cargarla de un CDN. Si falta, los títulos caen a una versión simple (fade) y los ' +
        'motion graphics se omiten — sin romper nada.',
      installed: existsSync(VENDOR_GSAP),
      command: `curl -fsSL https://unpkg.com/gsap@${GSAP_VERSION}/dist/gsap.min.js -o .vendor/gsap-${GSAP_VERSION}.min.js`,
      execArgs: [
        'sh',
        ['-c', `mkdir -p "${path.dirname(VENDOR_GSAP)}" && curl -fsSL https://unpkg.com/gsap@${GSAP_VERSION}/dist/gsap.min.js -o "${VENDOR_GSAP}"`],
        ROOT,
      ],
      downloadSize: '~75 KB',
    },
    {
      id: 'whisper-model',
      name: 'Modelo Whisper (transcripción local)',
      detail: 'Se descarga una sola vez con verificación de hash; tu audio nunca sale de tu máquina',
      installed: whisperInstalled,
      command: 'uv run python scripts/download_models.py  (en ./engine)',
      execArgs: ['uv', ['run', 'python', 'scripts/download_models.py'], path.join(ROOT, 'engine')],
      downloadSize: '~3 GB',
    },
  ]

  // ffmpeg vía brew (sin sudo) sí es ejecutable por la app en macOS
  if (isMac) {
    checks[0].execArgs = ['brew', ['install', 'ffmpeg-full'], ROOT]
  }

  return checks
}

// —— Job de instalación (uno a la vez, log en vivo) ——
const job = { running: false, current: null, log: [], done: [], failed: null }

export function getInstallStatus() {
  return { ...job, log: job.log.slice(-200) }
}

export async function startInstall(ids) {
  if (job.running) throw new Error('ya hay una instalación en curso')
  const checks = await getChecks()
  const selected = checks.filter((c) => ids.includes(c.id) && !c.installed)

  const runnable = selected.filter((c) => c.execArgs && !c.needsSudo)
  const manual = selected.filter((c) => !c.execArgs || c.needsSudo)

  job.running = true
  job.current = null
  job.log = []
  job.done = []
  job.failed = null

  for (const c of manual) {
    job.log.push(`⚠ ${c.name} requiere ejecución manual: ${c.command}`)
  }

  queueMicrotask(async () => {
    for (const check of runnable) {
      job.current = check.id
      job.log.push(`▶ ${check.name} — ejecutando: ${check.command}`)
      const ok = await runStep(check)
      if (!ok) {
        job.failed = check.id
        break
      }
      job.done.push(check.id)
      job.log.push(`✅ ${check.name} instalado`)
    }
    job.running = false
    job.current = null
  })

  return { started: runnable.map((c) => c.id), manual: manual.map((c) => c.id) }
}

function runStep(check) {
  const [cmd, args, cwd] = check.execArgs
  return new Promise((resolve) => {
    // stdin cerrado: los CLI interactivos (p. ej. skills) se auto-confirman en vez de colgarse
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const onData = (data) => {
      const line = data.toString().trim().split('\n').pop()
      if (line) job.log.push(`  ${line.slice(0, 160)}`)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('close', (code) => {
      if (code !== 0) job.log.push(`❌ ${check.name} falló (exit ${code})`)
      resolve(code === 0)
    })
    child.on('error', (err) => {
      job.log.push(`❌ ${check.name}: ${err.message}`)
      resolve(false)
    })
  })
}
