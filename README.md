# ZenAIOS — varianta curată de test (blank)

Copie publică **fără pacienți inventați** și **fără rezultate clinice fabricate**. Ideală pentru instalare pe structură IT reală și test de flux pe baza clinică.

Repo-ul cu date de demonstrație (doar cu `?demo=1`): [zenaios-data-collection](https://github.com/horeattt/zenaios-data-collection).

## Reguli dure

- Softul **nu inventează** istoric, aparținători, antecedente, rezultate de laborator sau texte RX/CT.
- Secțiile/paturile se **citesc** din `/api/structure` pe id. La deschidere **nu** se creează secții.
- Internare, constante, analize, tratament, transfer, externare și consimțăminte scriu în **baza clinică** (API), nu doar în JSON.
- Medic curant = medici din practicians / HR / conturi pe secție.

## Pornire

```powershell
npm install
npm test
npm run dev
npm run dev:web
```

Deschide `http://127.0.0.1:5173`. Datele locale stau în `data/` (ignorat de git).

## Limită

Nu este un HIS validat clinic. PDF-urile generate pe server sunt text arhivat în `documents` (nu FOCG tipărit CNAS încă).
