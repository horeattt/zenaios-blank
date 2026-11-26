-- Pregătire pilot spital județean: integrări, gărzi/pontaj, farmacie, UPU, fluxuri, Zena admin, fișiere pe disk.

CREATE TABLE IF NOT EXISTS app_paths (
  id text PRIMARY KEY DEFAULT 'default',
  data_root text NOT NULL,
  backup_dir text NOT NULL,
  files_dir text NOT NULL,
  exports_dir text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_flags (
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  code text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hospital_id, code)
);

CREATE TABLE IF NOT EXISTS integration_endpoints (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  code text NOT NULL,
  name text NOT NULL,
  base_url text,
  mode text NOT NULL DEFAULT 'neconfigurat' CHECK (mode IN ('neconfigurat', 'simulator', 'test', 'productie')),
  auth_kind text NOT NULL DEFAULT 'none' CHECK (auth_kind IN ('none', 'bearer', 'basic', 'mutual_tls')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_detail text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, code)
);

CREATE TABLE IF NOT EXISTS flow_definitions (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  code text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('patient', 'employee', 'lab', 'medication', 'physician', 'hospital')),
  steps jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, code)
);

CREATE TABLE IF NOT EXISTS zena_admin_actions (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upu_presentations (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  triage_code text NOT NULL,
  location text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_care', 'admitted', 'discharged', 'left')),
  presented_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upu_hospital_status ON upu_presentations (hospital_id, status, presented_at DESC);

CREATE TABLE IF NOT EXISTS duty_shifts (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  ward_id uuid REFERENCES wards(id),
  duty_date date NOT NULL,
  role text NOT NULL,
  person_name text NOT NULL,
  employee_id uuid REFERENCES employees(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS duty_shifts_day ON duty_shifts (hospital_id, duty_date, ward_id);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  employee_id uuid REFERENCES employees(id),
  ward_id uuid REFERENCES wards(id),
  person_name text NOT NULL,
  work_date date NOT NULL,
  minutes integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'duty' CHECK (kind IN ('duty', 'regular', 'overtime', 'leave')),
  month_key text NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, person_name, work_date, kind, ward_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_items (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  ward_id uuid REFERENCES wards(id),
  sku text,
  name text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  min_quantity numeric NOT NULL DEFAULT 0,
  group_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pharmacy_movements (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  item_id uuid NOT NULL REFERENCES pharmacy_items(id),
  patient_id uuid REFERENCES patients(id),
  encounter_id uuid REFERENCES encounters(id),
  direction text NOT NULL CHECK (direction IN ('in', 'out', 'adjust')),
  quantity numeric NOT NULL,
  reason text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_artifacts (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  actor_user_id uuid REFERENCES users(id),
  report_key text NOT NULL,
  format text NOT NULL CHECK (format IN ('json', 'csv', 'xlsx', 'pdf', 'doc', 'html')),
  filename text NOT NULL,
  path text NOT NULL,
  media_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dictation_logs (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  actor_user_id uuid REFERENCES users(id),
  lang text NOT NULL,
  source_text text NOT NULL,
  normalized_text text NOT NULL,
  target text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (code, description) VALUES
  ('integration.admin', 'Configurează integrările spitalului'),
  ('ops.admin', 'Operare: căi pe disc, backup, monitorizare'),
  ('flow.admin', 'Editează definițiile de flux'),
  ('zena.admin', 'Zena poate modifica configurația declarativă a spitalului'),
  ('upu.write', 'Gestionează prezentările UPU'),
  ('duty.write', 'Setează gărzi și pontaj'),
  ('pharmacy.write', 'Mișcări de stoc farmacie'),
  ('report.ward', 'Exportă rapoarte pe secție')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN ('integration.admin','ops.admin','flow.admin','zena.admin','upu.write','duty.write','pharmacy.write','report.ward')
ON CONFLICT DO NOTHING;
