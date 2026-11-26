-- ZenAIOS Hospital OS — schema inițială. Migrație aditivă, fără date de pacient.
-- Identificatorii sunt generați de aplicație. CNP-ul nu este cheie primară.

CREATE TABLE schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hospitals (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Bucharest',
  country_code text NOT NULL DEFAULT 'RO',
  synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE buildings (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  building_id uuid REFERENCES buildings(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('clinical', 'support')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wards (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  name text NOT NULL,
  specialty text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rooms (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  ward_id uuid NOT NULL REFERENCES wards(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE beds (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  hospital_id uuid REFERENCES hospitals(id),
  username text NOT NULL,
  password_hash text NOT NULL,
  password_must_change boolean NOT NULL DEFAULT true,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_hospital_username ON users (hospital_id, lower(username)) WHERE hospital_id IS NOT NULL;
CREATE UNIQUE INDEX users_platform_username ON users (lower(username)) WHERE hospital_id IS NULL;

CREATE TABLE permissions (
  code text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  code text NOT NULL,
  name text NOT NULL,
  UNIQUE (hospital_id, code)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE practitioners (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  user_id uuid REFERENCES users(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  specialty text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employees (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  user_id uuid REFERENCES users(id),
  ward_id uuid REFERENCES wards(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  job_title text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE patients (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  birth_date date,
  sex text CHECK (sex IS NULL OR sex IN ('F', 'M', 'necunoscut')),
  identified boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE patient_identifiers (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  system text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX patient_identifier_unique ON patient_identifiers (hospital_id, system, value);

CREATE TABLE encounters (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  part_of_id uuid REFERENCES encounters(id),
  class text NOT NULL CHECK (class IN ('emergency', 'inpatient', 'day_hospital', 'ambulatory')),
  status text NOT NULL CHECK (status IN ('in_progress', 'finished')),
  practitioner_id uuid REFERENCES practitioners(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admissions (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  encounter_id uuid NOT NULL UNIQUE REFERENCES encounters(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  admitting_ward_id uuid NOT NULL REFERENCES wards(id),
  current_ward_id uuid NOT NULL REFERENCES wards(id),
  bed_id uuid REFERENCES beds(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_occupant_per_bed ON admissions (bed_id) WHERE status = 'active' AND bed_id IS NOT NULL;

CREATE TABLE transfers (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  admission_id uuid NOT NULL REFERENCES admissions(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  from_ward_id uuid NOT NULL REFERENCES wards(id),
  to_ward_id uuid NOT NULL REFERENCES wards(id),
  to_bed_id uuid REFERENCES beds(id),
  moved_at timestamptz NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE diagnoses (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  code text,
  display text NOT NULL,
  rank text NOT NULL CHECK (rank IN ('principal', 'secondary')),
  author_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE allergies (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  substance text NOT NULL,
  criticality text NOT NULL CHECK (criticality IN ('low', 'high', 'unable')),
  author_user_id uuid REFERENCES users(id),
  noted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinical_notes (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid REFERENCES encounters(id),
  kind text NOT NULL,
  body text NOT NULL,
  author_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_requests (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  category text NOT NULL CHECK (category IN ('laboratory', 'imaging')),
  code text NOT NULL,
  display text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'collected', 'resulted', 'cancelled')),
  requester_user_id uuid REFERENCES users(id),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX service_request_idem ON service_requests (hospital_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE specimens (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  service_request_id uuid NOT NULL REFERENCES service_requests(id),
  specimen_type text NOT NULL,
  collected_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('collected', 'in_transit', 'received')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE observations (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  service_request_id uuid REFERENCES service_requests(id),
  specimen_id uuid REFERENCES specimens(id),
  supersedes_id uuid REFERENCES observations(id),
  code text NOT NULL,
  display_name text NOT NULL,
  value_numeric numeric,
  value_text text,
  unit text,
  reference_low numeric,
  reference_high numeric,
  method text,
  status text NOT NULL CHECK (status IN ('preliminary', 'final', 'corrected')),
  critical boolean NOT NULL DEFAULT false,
  correction_reason text,
  entered_by uuid REFERENCES users(id),
  validated_by uuid REFERENCES users(id),
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE critical_notifications (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  observation_id uuid NOT NULL REFERENCES observations(id),
  status text NOT NULL CHECK (status IN ('open', 'acknowledged')),
  notified_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz
);

CREATE TABLE diagnostic_reports (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  service_request_id uuid REFERENCES service_requests(id),
  status text NOT NULL CHECK (status IN ('final', 'corrected')),
  conclusion text NOT NULL,
  author_user_id uuid REFERENCES users(id),
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE medication_orders (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  medication_name text NOT NULL,
  dose text NOT NULL,
  route text,
  status text NOT NULL CHECK (status IN ('active', 'stopped')),
  prescriber_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE medication_administrations (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  order_id uuid NOT NULL REFERENCES medication_orders(id),
  dose text NOT NULL,
  administered_at timestamptz NOT NULL,
  performer_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid REFERENCES encounters(id),
  doc_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'final')),
  version int NOT NULL,
  supersedes_id uuid REFERENCES documents(id),
  title text NOT NULL,
  body text NOT NULL,
  source text NOT NULL,
  correction_reason text,
  author_user_id uuid REFERENCES users(id),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consents (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('granted', 'refused', 'withdrawn')),
  recorded_by uuid REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shifts (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  practitioner_id uuid NOT NULL REFERENCES practitioners(id),
  ward_id uuid REFERENCES wards(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leave_requests (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  ward_id uuid REFERENCES wards(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('submitted', 'approved', 'rejected')),
  approver_user_id uuid REFERENCES users(id),
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  name text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_heads (
  scope text PRIMARY KEY,
  last_hash text NOT NULL
);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL,
  hospital_id uuid,
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  summary text NOT NULL,
  prev_hash text NOT NULL,
  row_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_provider_configs (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'xai', 'google')),
  endpoint_host text NOT NULL,
  model text NOT NULL,
  api_key_ciphertext text NOT NULL,
  api_key_last4 text NOT NULL,
  organization text,
  project_id text,
  enabled boolean NOT NULL DEFAULT false,
  allow_identifiable boolean NOT NULL DEFAULT false,
  timeout_ms int NOT NULL DEFAULT 20000,
  monthly_budget_units numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, provider)
);

CREATE TABLE zena_requests (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL,
  tool text NOT NULL,
  outcome text NOT NULL,
  redacted_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE change_proposals (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  kind text NOT NULL CHECK (kind IN ('declarative', 'code')),
  module_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'preview', 'approved', 'active', 'rejected', 'stored')),
  spec jsonb NOT NULL,
  checksum text NOT NULL,
  author_user_id uuid REFERENCES users(id),
  approver_user_id uuid REFERENCES users(id),
  executable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE extension_versions (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  proposal_id uuid NOT NULL REFERENCES change_proposals(id),
  module_key text NOT NULL,
  version int NOT NULL,
  manifest jsonb NOT NULL,
  checksum text NOT NULL,
  author_user_id uuid,
  approver_user_id uuid,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, module_key, version)
);

CREATE TABLE integration_outbox (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  idempotency_key text NOT NULL,
  destination text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, idempotency_key)
);

CREATE TABLE report_exports (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  report_key text NOT NULL,
  filename text NOT NULL,
  content_base64 text NOT NULL,
  media_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integration_catalog (
  code text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'neconfigurat' CHECK (status IN ('neconfigurat', 'testat', 'validat'))
);

INSERT INTO permissions (code, description) VALUES
  ('structure.read', 'Citește structura spitalului'),
  ('structure.write', 'Modifică structura spitalului'),
  ('patient.read', 'Citește pacienți'),
  ('patient.write', 'Creează și identifică pacienți'),
  ('encounter.read', 'Citește episoade'),
  ('encounter.write', 'Deschide episoade, internări, transferuri și externări'),
  ('chart.read', 'Citește foaia'),
  ('chart.write', 'Scrie note, diagnostice și alergii'),
  ('lab.read', 'Citește cereri și rezultate'),
  ('lab.write', 'Creează cereri și rezultate preliminare'),
  ('lab.validate', 'Validează rezultate de laborator'),
  ('report.read', 'Citește rapoarte'),
  ('report.export', 'Exportă rapoarte'),
  ('hr.read', 'Citește resurse umane'),
  ('hr.write', 'Înregistrează angajați și cereri de concediu'),
  ('hr.approve', 'Aprobă concedii'),
  ('ai.admin', 'Configurează furnizori AI'),
  ('audit.read', 'Citește jurnalul de audit'),
  ('extension.propose', 'Propune extensii declarative'),
  ('extension.approve', 'Aprobă și activează extensii'),
  ('zena.help', 'Zena — ajutor'),
  ('zena.report', 'Zena — rapoarte'),
  ('zena.configure', 'Zena — configurare'),
  ('zena.develop', 'Zena — propuneri de cod'),
  ('zena.diagnose', 'Zena — diagnostic tehnic'),
  ('user.admin', 'Administrează utilizatori și roluri');

INSERT INTO integration_catalog (code, name, status) VALUES
  ('siui', 'SIUI / PIAS', 'neconfigurat'),
  ('des', 'Dosarul electronic de sănătate', 'neconfigurat'),
  ('sipe', 'Prescripție electronică', 'neconfigurat'),
  ('ceas', 'Card electronic de asigurări', 'neconfigurat'),
  ('drg', 'DRG Național / SMDP', 'neconfigurat'),
  ('lis', 'LIS', 'neconfigurat'),
  ('pacs', 'PACS / DICOMweb', 'neconfigurat');
