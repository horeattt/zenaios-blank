# Arhitectură

## Alegere

Prima versiune este un monolit modular: un proces Node.js (Fastify) și o bază PostgreSQL. Interfața este o aplicație React servită de același proces după build, sau de Vite în dezvoltare. Nu există microservicii. Nu există un broker.

Motivul: spitalul pilot are nevoie de o instalare pe care o poate porni și opri, cu tranzacții între internare, pat și audit. OpenMRS desparte interfața, serviciile și accesul la date, dar rămâne o singură aplicație cu module. Aceeași idee, la o scară mai mică.

Interfața operațională este React (`apps/web/src/collection`): panoul de secții citește `admissions`/`beds` prin API paginat. Fișierul `zenaios-data-collection.html` rămâne demo la `/colectare-demo`, nu sursa de adevăr.

## Limite

- `apps/api` deține regulile, permisiunile și SQL-ul. Browserul nu alege spitalul din care citește: spitalul vine din sesiune.
- `apps/web` afișează și trimite formulare. Nu conține chei și nu decide autorizarea.
- Furnizorii AI sunt apelați doar din procesul server, și doar la proba de conexiune. Traseul clinic nu îi apelează.
- Extensiile declarative scriu în resurse înregistrate (`leave_requests`). Nu trimit SQL, JavaScript sau șabloane.
- Publicarea de cod este un răspuns 501. Nu există worker care scrie în arborele aplicației.

## Date și timp

Timestamp-urile sunt `timestamptz` (UTC în PostgreSQL). Raportul lunar folosește fusul din înregistrarea spitalului, implicit `Europe/Bucharest`.

## Mesaje către sisteme externe

`integration_outbox` păstrează o cheie de idempotență și statusul `held`. Nu există un proces care le marchează `sent`, pentru că nu există partener configurat. Unicitatea pe `(hospital_id, idempotency_key)` oprește dublarea cererii de laborator.

## Medii

- Dezvoltare fără Docker: PGlite, un PostgreSQL în proces, director `DATA_DIR`.
- Testele automate din această sesiune: PGlite, director temporar.
- Producție: `DATABASE_URL` obligatoriu. `docker-compose.yml` descrie PostgreSQL 16 și procesul API. Compose nu a fost executat aici: Docker nu este instalat pe calculator.

## Scală (0.2.0)

- Citirile de panou sunt agregări SQL cu `limit`/`offset` (max 100–200), nu un blob JSON pe spital.
- `user_ward_scopes` restrânge secțiile; fără domeniu, utilizatorul vede tot spitalul (derulare graduală). Adminul e nestânjenit.
- `care_team` + `care.break_glass` controlează dosarul; break-glass scrie în `emergency_access_events` și audit.
- LIS: outbox → HL7 OML^O21 → simulator ACK → `sent`. Catalogul LIS trece în `testat`.
- TLS poate rula în proces (`TLS_CERT_PATH`/`TLS_KEY_PATH`) sau în proxy (`ALLOW_INSECURE_HTTP=1` + cookie secure).

## Ce nu face această arhitectură

Nu promite disponibilitate ridicată. Un singur container de bază și un singur proces API sunt suficiente pentru pilot, nu pentru un spital care nu își poate permite oprirea. Pentru producție rămân: MFA, `pg_basebackup`/standby și un secret manager în locul variabilei `AI_DATA_KEY`.
