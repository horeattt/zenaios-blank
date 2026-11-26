# AI și Zena

## Admin → Inteligență artificială

Furnizori acceptați și singurele gazde permise:

| Furnizor | Gazdă | Probă |
|---|---|---|
| openai | api.openai.com | GET /v1/models, header Bearer |
| anthropic | api.anthropic.com | GET /v1/models, Bearer și `anthropic-version: 2023-06-01` |
| xai | api.x.ai | GET /v1/models, Bearer |
| google | generativelanguage.googleapis.com | GET /v1beta/models, header `x-goog-api-key` |

Modelul este un câmp completat de spital. Nu există un nume de model implicit în cod. Endpoint-urile locale, IP-urile și alte gazde sunt respinse.

Cheia se criptează cu AES-256-GCM folosind `AI_DATA_KEY` (32 de octeți, base64). În bază rămân ciphertext-ul și ultimii 4 caractere. Răspunsurile și jurnalul nu conțin cheia. Dacă `AI_DATA_KEY` lipsește, salvarea furnizorului răspunde 503 și restul aplicației merge.

`allow_identifiable` este fals la salvare. Salvarea unei chei nu trimite pacienți. Proba de conexiune nu are corp. Nu există încă un comutator de categorii de date aprobat de spital: până există evaluarea transferului, Zena nu trimite conținut clinic către model.

Pseudonimizarea nu este implementată și nu este prezentată ca anonimizare.

## Zena

Panoul din dreapta trimite modul și mesajul la `POST /api/zena/converse`. Serverul verifică permisiunea `zena.help`, `zena.report`, `zena.configure`, `zena.develop` sau `zena.diagnose`. Textul utilizatorului nu acordă permisiuni.

| Mod | Comportament în această versiune |
|---|---|
| Ajutor | Text local despre traseu. Nu apelează un model. |
| Raport | Recunoaște cererea de internări pe secții și execută raportul din catalog. Alt text primește o întrebare de clarificare, nu SQL. |
| Configurare | Recunoaște cererea de concedii cu aprobarea șefului de secție și salvează o specificație declarativă. |
| Dezvoltare | Salvează propunerea și răspunde că execuția de cod este indisponibilă. |
| Diagnostic | Spune dacă baza răspunde și dacă cheia de criptare există. Nu trimite telemetrie clinică. |

Un răspuns de tip „am creat modulul” apare doar după ce există propunerea, versiunea activă și ruta de concedii. Până la activare, depunerea concediului răspunde 409.
