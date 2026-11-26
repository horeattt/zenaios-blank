# Securitate și confidențialitate

Această pagină descrie ce face aplicația. Nu este o evaluare de impact, un acord de prelucrare sau o declarație de conformitate.

## Ce este aplicat

- Sesiune opacă, hash SHA-256 în bază, cookie `HttpOnly`, `SameSite=Lax`. `COOKIE_SECURE=1` îl marchează Secure.
- Parola este scrypt. Contul nou are `password_must_change` și nu poate lucra clinic până o schimbă. Nu există parolă universală în cod.
- Permisiunile se citesc din bază la fiecare cerere. Rolul unui spital nu se aplică în alt spital.
- Fiecare interogare clinică filtrează `hospital_id` din sesiune.
- Audit append-only, cu hash legat de înregistrarea anterioară. Rezumatul nu conține CNP, parolă sau cheie.
- Cheile de model sunt cifrate cu o cheie separată și mascate la citire.
- Instrumentele Zena verifică permisiunea independent de textul mesajului. Un mesaj care cere ștergerea pacienților nu ajunge la SQL.
- Cererile de laborator repetate cu aceeași cheie de idempotență nu se dublează.

## Ce nu este aplicat

- MFA pentru administratori.
- TLS în pachetul Compose. Trebuie terminat în fața procesului înainte de un pilot în rețea.
- Criptare de disc. PostgreSQL și copia logică criptată nu înlocuiesc criptarea volumului.
- Drepturi contextuale „doar pacienții din grija mea”. Acum drepturile sunt pe rol și pe spital, nu pe relația de îngrijire.
- Acces de urgență (break-glass).
- Politica de transfer în afara SEE. Implicit, datele identificabile nu pleacă. Nu există încă lista de categorii aprobate.
- Încadrarea MDR/IVDR. Nu se oferă diagnostic, recomandare de tratament sau interpretare de buletin ca dispozitiv.

## Continuitate

Copia logică `ZENBACKUP1` este criptată cu `AI_DATA_KEY` și a fost restaurată în test. Nu înlocuiește `pg_dump` / `pg_basebackup`.

Propunere de discutat cu spitalul, nu angajament: RPO de 24 de ore dacă backup-ul rulează noaptea; RTO de 4 ore pentru restaurarea unei copii logice pe o instalare goală. Ambele se măsoară în exercițiul spitalului.

Nu există mod offline de editare. Dacă rețeaua internă cade, secția nu scrie în aplicație până la revenire; nu se promit conflicte rezolvate automat.

## Jurnale

Jurnalul de aplicație ocolește câmpurile cu nume de cheie, parolă, token sau ciphertext și trece textul prin mascarea șabloanelor `sk-` și a secvențelor de 13 cifre. Testul cu o cheie cunoscută nu a găsit prefixul secret în răspuns, în ciphertext sau în jurnal.
