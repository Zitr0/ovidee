import { readFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ROOT } from './env.js'

export const db = new Database(path.join(ROOT, 'db', 'app.db'))
db.pragma('journal_mode = WAL')
db.exec(readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'))

// Migración suave: columnas nuevas sobre bases creadas por versiones anteriores
const cols = db.prepare(`PRAGMA table_info(video_projects)`).all().map((c) => c.name)
for (const [name, def] of [
  ['source_filename', "TEXT DEFAULT ''"],
  ['project_type', "TEXT NOT NULL DEFAULT 'video'"],
  ['source_url', 'TEXT'],
  ['model_id', 'TEXT'],
  ['strategy_text', 'TEXT'],
  ['error_message', 'TEXT'],
  ['deleted_at', 'DATETIME'],
]) {
  if (!cols.includes(name)) db.exec(`ALTER TABLE video_projects ADD COLUMN ${name} ${def}`)
}
