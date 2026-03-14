-- INIT: initial_schema
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO models (id, name, description) VALUES 
  ('gpt-4o', 'GPT-4o', 'OpenAI flagship model'),
  ('claude-3-5-sonnet-latest', 'Claude 3.5 Sonnet', 'Anthropic performance model');
