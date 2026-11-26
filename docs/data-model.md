# Model de date

Migrația `apps/api/migrations/0001_init.sql` creează entitățile cerute. Identificatorii sunt UUID generate de aplicație.

## Distincții

- `patients` este persoana în spital. Poate fi neidentificată.
- `patient_identifiers` ține CNP-ul (`urn:cnas:cnp`) sau un identificator temporar (`urn:zenaios:temp`). Unicitatea este pe spital + sistem + valoare. CNP-ul nu este cheia primară și poate lipsi.
- `encounters` este episodul: `emergency`, `inpatient`, `day_hospital` sau `ambulatory`. Episodul de internare poate indica episodul UPU prin `part_of_id`.
- `admissions` este internarea: o singură înregistrare pe episod de spitalizare. `admitting_ward_id` nu se schimbă la transfer. `current_ward_id` și `bed_id` se schimbă.
- `transfers` este mișcarea. Nu este o internare nouă.
- Foaia nu este un tabel unic. Notele, diagnosticele, alergia, rezultatele și documentele stau în tabele proprii și se adună pe `patient_id` și `encounter_id`.

## Documente și rezultate

- `observations.status`: `preliminary`, `final`, `corrected`. Validarea umple `validated_by` și `validated_at`. Corecția inserează un rând cu `supersedes_id` și `correction_reason`. Rândul vechi rămâne.
- O observație `critical` deschide `critical_notifications`. Confirmarea trece notificarea în `acknowledged`.
- `documents` finalizate nu au rută de suprascriere. Corecția creează `version + 1`.
- Importul OCR nu este implementat. Când va exista, va scrie o propunere, nu un rând validat.

## Retenție

Nu există job de ștergere. Rectificarea unui rezultat sau a unei scrisori se face prin versiune. Anonimizarea nu este implementată și nu este simulată. Termenele de arhivă se stabilesc de spital înainte de pilot; nu au fost hardcodate.

## Audit

`audit_events` este adăugat doar prin insert. `audit_heads` ține ultimul hash pe spital. Rezumatul este scurt și nu include CNP, parolă sau cheie. Jurnalul nu se acoperă de restaurarea logică a copiei de lucru, ca să rămână urma restaurării.

## Tabele prezente fără flux de interfață

`medication_orders`, `medication_administrations`, `diagnoses`, `allergies`, `consents`, `shifts`, `inventory_items`. Există ca să nu fie nevoie de o migrație distructivă când li se construiește fluxul. Nu au încă ecrane.
