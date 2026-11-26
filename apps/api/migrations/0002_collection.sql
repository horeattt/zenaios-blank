-- Spațiul de lucru al foii de colectare, câte unul pe spital.
-- Documentul este starea existentă a interfeței (secții, foaie, gestiune, personal).
-- Nu înlocuiește tabelele clinice. Datele de demonstrație rămân marcate synthetic.

CREATE TABLE collection_workspaces (
  hospital_id uuid PRIMARY KEY REFERENCES hospitals(id),
  document jsonb NOT NULL,
  synthetic boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
