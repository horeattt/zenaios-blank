# ZenAIOS — varianta curată de test (blank)

Copie publică **fără pacienți și fără date clinice salvate**. Ideală pentru instalare și test de flux pe un spital gol.

Repo-ul cu date de demonstrație rămâne: [zenaios-data-collection](https://github.com/horeattt/zenaios-data-collection).

## Ce e diferit față de varianta demo

- Niciun pacient internat sau externat la pornire
- Nicio arhivă / istoric generat
- Cheie de sesiune separată (`zena-spital-blank-v1`) — nu preia datele din browserul demo
- Secțiile există goale (paturi + magazie + personal), ca să puteți testa **Internare** imediat
- Spitalul se numește „Spital test (gol)”

## Pornire

```powershell
npm install
npm test
npm run dev
npm run dev:web
```

Deschide `http://127.0.0.1:5173`. Datele locale stau în `data/` (ignorat de git).

## Limită

Nu este un HIS validat clinic. Varianta blank e pentru test de instalare și flux, nu pentru producție.
