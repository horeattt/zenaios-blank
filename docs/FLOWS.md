# Hartă de fluxuri — ZenAIOS pilot

Sursa de adevăr: tabelele clinice + `flow_definitions` (Admin → Fluxuri). UI-ul localStorage este oglindă de demonstrație.

## Traseul pacientului

UPU / triaj → identificare (CNP / temporar) → internare pe secție+pat → foaie (note, diagnostice, alergii) → laborator / medicație → transfer (aceeași internare) → externare + scrisoare → arhivă pe disc (`data/files/patients`).

## Traseul angajatului

Înregistrare HR → atribuire secție/rol → planificare gardă → pontaj zilnic din gărzi → închidere lunară HR.

## Traseul analizelor

Cerere pe foaie → outbox LIS (held→sent, ACK local) → recoltare → rezultat preliminar → validare / critic → afișare pe foaie.

## Traseul medicației

Prescriere pe foaie → scădere stoc farmacie/secție → administrare documentată → istoric pe foaie.

## Traseul medicului

Sesiune (demo: open access) → panou secție → gardă afișată → foaie → dictare Zena / cereri lab-medicație.

## Operare spital

Structură → integrări (LIS simulator; SIUI/DES/SIPE/CEAS/PACS neconfigurat) → census unic `/api/census` → backup pe `data/backups` + test restore → rapoarte multi-format pe disc.

## Zena admin

Chat din dreapta, cu `zena.admin`: modifică flag-uri, mod integrări, seed fluxuri, stoc — imediat prin API, auditat în `zena_admin_actions`.
