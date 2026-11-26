-- Module configurabile pe spital: schemă câmpuri + profil import (Excel / CSV / manual / API).

CREATE TABLE IF NOT EXISTS hospital_modules (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  module_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('dept', 'gest', 'people', 'ward')),
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  import_mode text NOT NULL DEFAULT 'excel_template'
    CHECK (import_mode IN ('excel_template', 'csv_map', 'manual', 'api', 'hl7')),
  import_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, module_key)
);

CREATE INDEX IF NOT EXISTS hospital_modules_hospital ON hospital_modules (hospital_id, kind);

CREATE TABLE IF NOT EXISTS hospital_module_records (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  module_id uuid NOT NULL REFERENCES hospital_modules(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hospital_module_records_module ON hospital_module_records (module_id, created_at DESC);

INSERT INTO permissions (code, description) VALUES
  ('module.read', 'Citește configurarea modulelor (schemă + import)'),
  ('module.write', 'Configurează câmpuri și import pe module')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN ('module.read', 'module.write')
ON CONFLICT DO NOTHING;
