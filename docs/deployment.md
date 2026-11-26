# Instalare

## Acest calculator

Docker nu este instalat și nu există un PostgreSQL de sistem. Dezvoltarea și testele folosesc PGlite (PostgreSQL în proces), persistent într-un director.

```powershell
copy .env.example .env
npm install
npm test
npm run dev
```

În alt terminal:

```powershell
npm run dev:web
```

Interfața de dezvoltare este la `http://127.0.0.1:5173` și proxiază `/api` către portul 3000.

Prima deschidere folosește „Instalare nouă”. Parola afișată se schimbă obligatoriu. Nu o reutiliza între spitale.

`AI_DATA_KEY` se generează local:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Fără această cheie, clinica merge, iar salvarea unui furnizor AI răspunde 503.

## Un spital nou

O instalare nouă înseamnă o bază goală și un `.env` nou. Nu se copiază `data/`, `backups/` sau `.env`.

Cu Docker, după ce este instalat:

```powershell
docker compose up --build
```

`DATABASE_URL` din Compose pointează la serviciul `db`. Schimbă parola `change-me` înainte de orice date reale. `NODE_ENV=production` refuză pornirea fără `DATABASE_URL`.

Compose pornește aplicația. Nu înseamnă că integrările funcționează și nu înseamnă că spitalul a validat utilizarea. Catalogul de integrări rămâne `neconfigurat`.

## Backup

```powershell
npm run backup -w @zenaios/api
npm run restore -w @zenaios/api -- backups\fisier.zenbackup
```

Ambele cer `AI_DATA_KEY`. Restaurarea înlocuiește rândurile operaționale din tabelele aplicației. Nu șterge jurnalul de audit.

## Actualizare

Migrațiile sunt fișiere SQL aplicate o singură dată, înregistrate în `schema_migrations`. A doua rulare nu le repetă. Nu există migrație distructivă în `0001_init`.

Revenirea la o versiune anterioară de cod nu restaurează singură datele. Dacă o migrație viitoare schimbă date, planul de revenire este copia făcută înainte de migrație, nu doar git checkout.
