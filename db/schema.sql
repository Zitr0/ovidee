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
    videos_dir TEXT NOT NULL,            -- workspace del proyecto; artefactos en <videos_dir>/edit/
    project_type TEXT NOT NULL DEFAULT 'video',  -- video (metraje subido) | web (video generado desde una URL)
    source_url TEXT,                     -- solo proyectos web: la URL capturada
    source_filename TEXT NOT NULL,
    video_duration_seconds REAL NOT NULL,
    -- video: uploaded | estimated | transcribing | editing | rendering | done | error
    -- web:   capturing | captured | estimated | editing | rendering | done | error
    execution_status TEXT NOT NULL,
    model_id TEXT,
    estimated_cost_usd REAL DEFAULT 0.0,
    actual_cost_usd REAL DEFAULT 0.0,
    tokens_input_consumed INTEGER DEFAULT 0,
    tokens_output_consumed INTEGER DEFAULT 0,
    transcription_seconds_elapsed REAL DEFAULT 0.0,
    strategy_text TEXT,
    error_message TEXT,
    -- Soft delete: el registro (y sus api_calls) se conserva para el historial de
    -- costos del dashboard; solo se eliminan los archivos del disco.
    deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

-- Assets del usuario por proyecto (imágenes que pueden insertarse en el video)
CREATE TABLE IF NOT EXISTS project_assets (
    asset_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS video_versions (
    version_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    edl_path TEXT NOT NULL,
    output_path TEXT NOT NULL,
    feedback TEXT,
    cost_usd REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
