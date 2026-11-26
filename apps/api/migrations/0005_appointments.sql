-- Programări ambulatoriu — model aliniat HL7 v2.5.1 SIU (SCH / AIP / AIL / PID).

CREATE TABLE IF NOT EXISTS ambulatory_schedules (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  ward_id uuid REFERENCES wards(id),
  practitioner_user_id uuid NOT NULL REFERENCES users(id),
  specialty text NOT NULL,
  location text NOT NULL DEFAULT 'Ambulatoriu',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, practitioner_user_id, ward_id, specialty)
);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  schedule_id uuid REFERENCES ambulatory_schedules(id),
  ward_id uuid REFERENCES wards(id),
  practitioner_user_id uuid NOT NULL REFERENCES users(id),
  patient_id uuid REFERENCES patients(id),
  patient_first_name text NOT NULL,
  patient_last_name text NOT NULL,
  patient_cnp text,
  specialty text NOT NULL,
  location text NOT NULL DEFAULT 'Ambulatoriu',
  reason text,
  -- HL7 SCH fields
  placer_appointment_id text NOT NULL,
  filler_appointment_id text,
  appointment_style text NOT NULL DEFAULT 'ambulatory' CHECK (appointment_style IN ('ambulatory', 'teleconsult', 'procedure')),
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'arrived', 'fulfilled', 'cancelled', 'noshow', 'rescheduled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  hl7_control_id text,
  last_siu_trigger text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointments_day ON appointments (hospital_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_practitioner ON appointments (hospital_id, practitioner_user_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_ward ON appointments (hospital_id, ward_id, starts_at);

CREATE TABLE IF NOT EXISTS appointment_hl7_messages (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  message_type text NOT NULL,
  trigger_event text NOT NULL,
  control_id text NOT NULL,
  hl7 text NOT NULL,
  direction text NOT NULL DEFAULT 'out' CHECK (direction IN ('out', 'in')),
  ack_code text,
  status text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'sent', 'acked', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (code, description) VALUES
  ('appointment.read', 'Citește programările ambulatoriu'),
  ('appointment.write', 'Creează și modifică programări ambulatoriu'),
  ('appointment.admin', 'Calendar global + statistici programări')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN ('appointment.read', 'appointment.write', 'appointment.admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'physician'
  AND p.code IN ('appointment.read', 'appointment.write')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'appointment.read'
FROM roles r
WHERE r.code IN ('nurse', 'ward_chief', 'auditor')
ON CONFLICT DO NOTHING;

INSERT INTO integration_catalog (code, name, status) VALUES
  ('hl7_siu', 'HL7 SIU — programări ambulatoriu', 'testat')
ON CONFLICT (code) DO NOTHING;
