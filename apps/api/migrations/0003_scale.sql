-- Scalabilitate pentru spitale mari: domenii pe secție, echipă de îngrijire,
-- indexuri de citire, mesaje LIS și urme de backup.

CREATE TABLE user_ward_scopes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ward_id)
);

CREATE INDEX user_ward_scopes_hospital ON user_ward_scopes (hospital_id, user_id);

CREATE TABLE care_team (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('attending', 'member', 'consult')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, patient_id, user_id)
);

CREATE INDEX care_team_user ON care_team (hospital_id, user_id) WHERE active;
CREATE INDEX care_team_patient ON care_team (hospital_id, patient_id) WHERE active;

CREATE TABLE emergency_access_events (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lis_messages (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  outbox_id uuid REFERENCES integration_outbox(id),
  service_request_id uuid REFERENCES service_requests(id),
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  message_type text NOT NULL,
  control_id text NOT NULL,
  hl7 text NOT NULL,
  ack_code text,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'acked', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lis_messages_hospital ON lis_messages (hospital_id, created_at DESC);

CREATE TABLE backup_runs (
  id uuid PRIMARY KEY,
  hospital_id uuid,
  kind text NOT NULL CHECK (kind IN ('logical', 'pg_dump', 'schedule')),
  status text NOT NULL CHECK (status IN ('ok', 'failed')),
  path text,
  bytes bigint,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admissions_active_ward ON admissions (hospital_id, current_ward_id) WHERE status = 'active';
CREATE INDEX admissions_hospital_started ON admissions (hospital_id, started_at DESC);
CREATE INDEX patients_hospital_name ON patients (hospital_id, lower(last_name), lower(first_name));
CREATE INDEX encounters_hospital_patient ON encounters (hospital_id, patient_id, started_at DESC);
CREATE INDEX beds_hospital_room ON beds (hospital_id, room_id, status);
CREATE INDEX rooms_hospital_ward ON rooms (hospital_id, ward_id);
CREATE INDEX service_requests_hospital_status ON service_requests (hospital_id, status, created_at DESC);
CREATE INDEX observations_hospital_created ON observations (hospital_id, created_at DESC);
CREATE INDEX audit_events_hospital_id ON audit_events (hospital_id, id DESC);

INSERT INTO permissions (code, description) VALUES
  ('ward.scope.admin', 'Atribuie domenii de secție utilizatorilor'),
  ('care.break_glass', 'Acces de urgență auditat la dosar în afara echipei'),
  ('ops.backup', 'Rulează și consultă copii de rezervă'),
  ('integration.lis', 'Trimite și confirmă mesaje LIS')
ON CONFLICT (code) DO NOTHING;

UPDATE integration_catalog SET status = 'testat' WHERE code = 'lis';

-- Rolurile admin existente primesc noile coduri; spitalele noi le iau la provizionare.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN ('ward.scope.admin', 'care.break_glass', 'ops.backup', 'integration.lis')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'integration.lis' FROM roles r WHERE r.code = 'lab'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'ward.scope.admin' FROM roles r WHERE r.code = 'ward_chief'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'care.break_glass' FROM roles r WHERE r.code = 'physician'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'ops.backup' FROM roles r WHERE r.code = 'auditor'
ON CONFLICT DO NOTHING;
