-- Stabilitate flux: versiune pe spațiul de colectare + notă pe transfer + câmpuri de externare.

ALTER TABLE collection_workspaces
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('requested', 'accepted', 'rejected', 'completed'));

ALTER TABLE admissions
  ADD COLUMN IF NOT EXISTS file_no text,
  ADD COLUMN IF NOT EXISTS admission_criterion text,
  ADD COLUMN IF NOT EXISTS referral_number text,
  ADD COLUMN IF NOT EXISTS insurance_category text;

CREATE UNIQUE INDEX IF NOT EXISTS admissions_file_no_unique
  ON admissions (hospital_id, file_no)
  WHERE file_no IS NOT NULL;

ALTER TABLE encounters
  ADD COLUMN IF NOT EXISTS discharge_status text,
  ADD COLUMN IF NOT EXISTS discharge_type text,
  ADD COLUMN IF NOT EXISTS discharge_dx_code text,
  ADD COLUMN IF NOT EXISTS discharge_dx_display text;

CREATE TABLE IF NOT EXISTS hospital_sequences (
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  seq_key text NOT NULL,
  last_value int NOT NULL DEFAULT 0,
  PRIMARY KEY (hospital_id, seq_key)
);
