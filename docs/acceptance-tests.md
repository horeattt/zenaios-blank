# Teste de acceptare

Rulate la 22 noiembrie 2026 cu `npm test` în `apps/api`, Vitest 3, PGlite. Rezultat: 3 teste, toate trecute, durata circa 19 secunde de execuție. Nu s-a rulat Docker. Nu s-a rulat `pg_dump`. Nu s-a apelat un API de model și nu s-a apelat SIUI, DES, un LIS sau un PACS.

| # | Criteriu | Rezultat |
|---|---|---|
| 1 | Instalare, inițializare, date după repornirea bazei | Trecut pe PGlite: închidere, redeschidere, pacientul există. Compose nu a fost pornit. |
| 2 | Două spitale fără amestec | Trecut. Spitalul B primește 404 la pacientul și la exportul spitalului A. Lista lui de pacienți este goală. Cheia AI a spitalului A nu apare la B. |
| 3 | Același pacient pe traseu | Trecut: UPU, identificare, internare, transfer, cerere idempotentă, specimen, rezultat validat, externare, două versiuni de scrisoare, Patient FHIR cu același id. |
| 4 | Refuz server-side | Trecut: asistent fără drept de raport Zena primește 403. Mesajul care cere ștergerea nu șterge pacientul. |
| 5 | Raport egal cu referința | Trecut pentru ceasul înghețat 15 decembrie 2026, fus Europe/Bucharest, luna anterioară. Chirurgie: 4 internări, 1 deschisă, medie 2,67 zile (inclusiv transferul numărat la secția de internare). Neurologie: 1 internare, medie 3 zile. Internarea din decembrie nu intră. |
| 6 | Concedii prin conversație | Trecut: propunere, previzualizare sintetică, aprobare, activare, cerere persistată, raport lunar cu o aprobare. |
| 7 | Neaprobat nu ajunge activ | Trecut: activarea din `draft` răspunde 409. Specificația cu `script`/`sql` răspunde 422. Publicarea de cod răspunde 501 și `executable` rămâne fals. |
| 8 | Clinica merge fără AI | Trecut cu `aiDataKey: null`: pacient creat, ajutor Zena cu `aiUsed: false`, salvarea furnizorului 503. |
| 9 | Cheia nu iese | Trecut: prefixul de test nu este în JSON, în ciphertext sau în jurnalul colectat. |
| 10 | Restaurare și migrație | Trecut: migrația a doua nu reaplică `0001_init`. Copia criptată, după ștergerea pacientului, îl aduce înapoi. Nu este un test de `pg_restore`. |

Datele din teste sunt sintetice și stau în directoare temporare, nu în `data/` de dezvoltare.
