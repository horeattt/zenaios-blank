# Stare

Data: 26 noiembrie 2026. Versiune: 0.4.1 (programări ambulatoriu HL7 SIU).

## Demo vs pilot

- **Demo păstrat**: acces deschis (`OPEN_ACCESS`), fără identitate/MFA reală.
- **Pilot pregătit**: Postgres (`DATABASE_URL`), TLS, backup pe `data/backups`, monitor Admin, integrări configurabile.

## Sursă unică

Census și ocupare: `admissions` + `beds` prin `/api/census` și `/api/board` — nu localStorage.

## Livrat în 0.4

- Migrație `0004_pilot`: integrări, UPU, gărzi/pontaj, farmacie, fluxuri, Zena admin, dictare, artifacte raport, căi pe disc
- Admin: Operare · Integrări · Fluxuri (diagrame) · Identitate (stub) · AI local
- Secție: Gărzi, Laborator, Rapoarte (xlsx/csv/pdf/doc/json/html)
- Zena admin: comenzi declarative instant via `/api/zena/converse` mode=admin
- Dictare multi-limbă: `/api/zena/dictation`
- LIS: ACK local / simulator; SIUI/DES/SIPE/CEAS/PACS = neconfigurat; export documente pe disc

## Verificare

`cd apps/api && npm test` — inclusiv `appointments.test.ts` (HL7 SIU) și `ward-simulation.test.ts`.

**Programări ambulatoriu:** Admin → Programări (calendar global + statistici); pe secție → meniu ☰ → Programări Ambulatoriu. Structură HL7 v2.5.1 SIU^S12/S13/S14/S15/S26.
