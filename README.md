# ZenAIOS Hospital OS

Nucleu de spital: o bază, un proces, module care nu își țin pacienții separat. Versiunea 0.2.0 adaugă panou pe date clinice, domenii pe secție, LIS cu simulator și backup/TLS pentru pilot pe spitale mari.

Fișierul `zenaios-data-collection.html` rămâne demo la `/colectare-demo`. Interfața operațională este React în `apps/web`.

## Pornire

```powershell
npm install
npm test
npm run dev
npm run dev:web
```

Deschide `http://127.0.0.1:5173`. Prima dată: Instalare nouă. Parola afișată se schimbă imediat. Datele rămân în `data/pglite` (director ignorat de git).

Backup: `npm run backup` sau `npm run backup-schedule` (cu `AI_DATA_KEY`). Producție: `DATABASE_URL`, `TLS_CERT_PATH`/`TLS_KEY_PATH` sau proxy TLS cu `ALLOW_INSECURE_HTTP=1`.

Docker nu este necesar pentru această dezvoltare. `docker-compose.yml` este pachetul pentru o instalare cu PostgreSQL 16.

## Documente

- [Cercetare](docs/research.md)
- [Cerințe](docs/requirements.md)
- [Arhitectură](docs/architecture.md)
- [Model de date](docs/data-model.md)
- [AI și Zena](docs/ai-and-zena.md)
- [Extensii](docs/extensions.md)
- [Securitate](docs/security-and-privacy.md)
- [Instalare](docs/deployment.md)
- [Teste de acceptare](docs/acceptance-tests.md)
- [Roadmap](docs/ROADMAP.md)
- [Stare](docs/STATUS.md)

OpenAPI este servit la `GET /api/openapi.json` după pornirea procesului.

## Limită

Aplicația nu este un HIS validat clinic și nu este conectată la CNAS, DES sau la aparate. Indicatorul de durată medie nu este DMS-ul sau ICM-ul calculate de INMSS.
