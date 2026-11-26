# Roadmap

## Făcut în 0.1.0

Etapele 0–4 în forma necesară unui nucleu verificabil: cercetare, schemă, autentificare, structură, traseu pacient–laborator–externare, raport, Zena fără model, furnizori cu cheie criptată, extensie declarativă de concedii.

Etapa 5 este marcată indisponibilă: propunerile de cod se stochează, publicarea răspunde 501.

## Făcut în 0.2.0 (scală)

- Domenii pe secție, echipă de îngrijire, break-glass auditat.
- Panou React pe date clinice, cu paginare (testat pe 240 paturi).
- Simulator LIS OML^O21 + outbox `sent`.
- Backup programabil (`backup-schedule`), retenție, cârlig `pg_dump`, TLS opțional în proces.

## Următoarea felie executabilă

Foaia de observație, alergii, diagnostice, medicație și gestiune pe aceleași API-uri, în module React (nu în HTML). Apoi LIS către un endpoint real (înlocuiește doar transportul; ACK rămâne obligatoriu).

Apoi studiu DICOM: UID + link, fără pixeli în PostgreSQL.

## Înainte de pilot

- MFA pentru administratori; exercițiu de restaurare pe mașină goală, măsurat.
- Import CSV cu previzualizare și raport de respingeri.
- Decizie juridică: bază de prelucrare, retenție, dacă vreo funcție Zena este dispozitiv medical.

## Explicit în afara versiunii

Grouper DRG, raportare SMDP, SIUI, DES, SIPE, CEAS, PACS de producție, financiar și decontare, portal de aparținători, execuție de cod generat.
