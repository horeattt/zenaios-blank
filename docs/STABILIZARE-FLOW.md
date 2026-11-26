# Stabilizare pe flux (fără focus pe securitate)

Branch: `stabilizare-pilot`  
Sursă: raportul de testare + planul de stabilizare (etapele de flux / date), fără S1–S12 și fără ecranele de auth stricte.

## Ce s-a făcut

1. **Indicatori reali pe home**
   - Ocuparea = census real (ocupate / paturi).
   - DMS = media zilelor pe foile închise.
   - ICM și Costuri = „indisponibil până la DRG” (fără cifre inventate).

2. **Salvare stabilă a spațiului de colectare**
   - Migrare `0007_flow_stability.sql`: coloană `version` pe `collection_workspaces`.
   - `PUT /api/collection` cere `expectedVersion` și răspunde `409 stale_version` la conflict.
   - UI-ul păstrează versiunea și arată mesaj clar la conflict.

3. **Transfer cu notă obligatorie**
   - UI: notă min. 8 caractere + verificare pe pat ocupat.
   - API: `note` obligatoriu, verificare pat liber → `409 bed_occupied`, notă salvată pe transfer + evoluție.

4. **Externare cu câmpuri de flux**
   - Stare (vindecat/ameliorat/…), tip (externat/la cerere/…), diagnostic, epicriză ≥ 50 caractere, recomandări.
   - API: aceleași câmpuri pe `POST /api/encounters/:id/discharge`.

5. **Internare stabilă**
   - Număr FO pe spital și an: `FO-YYYY-NNNNNN` (secvență `hospital_sequences`).
   - API: `cnp_exists` / `bed_occupied` / `no_free_bed` cu mesaje clare (nu 500).
   - UI: verificare CNP duplicat înainte de salvare; mesaj „pat ocupat”.

## Ce urmează (flux, nu securitate)

- Legarea foii din UI de tabelele clinice (pacienți / internări / note) pe o secție-pilot.
- UPU: 5 nivele de triaj, închiderea episodului, timpi.
- Import structură Excel + FOCG minimă.

## Verificare

```bash
cd apps/api && npm test
```
