# Cerințe și matrice

Cerințele de mai jos sunt cele necesare primei versiuni rulabile. Modulele din hartă care nu au rând „implementat” rămân în roadmap.

## Principii care țin de această versiune

- Un pacient are un identificator intern. CNP-ul este un identificator opțional, nu cheie primară.
- Episodul UPU și internarea sunt înregistrări diferite, legate prin `part_of`, cu același pacient.
- Transferul nu creează o internare nouă.
- Documentul final și rezultatul validat nu se suprascriu. Corecția este o versiune nouă, cu motiv.
- Aplicația clinică răspunde când furnizorul AI lipsește.
- Două spitale nu își văd pacienții, exporturile sau cheile.

## Matrice

| Cerință | Sursă | Modul | Acceptare |
|---|---|---|---|
| Instalare inițială unică, parolă de unică folosință | Decizie de proiect, nu un ghid CNAS | Admin | `POST /api/setup` a doua oară răspunde 409. Parola nu este una universală. Testat. |
| Structură de spital: clădire, departament, secție, salon, pat | OpenMRS: locația nu este pacientul | Admin | Creare prin API și folosire la internare. Testat. |
| Roluri și refuz server-side | GDPR art. 9 și 32, ca obligație de măsuri; nu ca certificare | Auth | Asistentul fără `zena.report` primește 403. Testat. |
| Audit de acces și de modificare, fără conținut clinic în rezumat | GDPR art. 32, decizie de proiect | Audit | Rezumatul de audit nu conține CNP-ul. Lanț de hash pe spital. |
| Pacient neidentificat, apoi identificat, același id | Traseu UPU | Registratură | Testat pe prezentarea UPU și `identify`. |
| Internare, transfer, cerere, rezultat validat, externare | Traseu HIS; FHIR Observation/DiagnosticReport ca vocabular, nu ca stocare | Clinic | Același `patientId` pe tot traseul. Testat. |
| Valori critice cu notificare | Practică de laborator; fără standard românesc citat integral | Laborator | Validarea unui rezultat marcat critic creează notificarea. |
| Rezultat corectat fără ștergerea valorii anterioare | Decizie de proiect | Laborator | Ruta `correct` inserează un rând nou. |
| Scrisoare finală versionată | DES folosește CDA pentru documente; nu am implementat CDA | Documente | Două versiuni rămân în tabel. Testat. |
| Raport internări pe secții, luna anterioară, Excel | Cerere de produs. DMS/ICM oficial: raport INMSS 2024 | Management | Rezultatul coincide cu setul inserat. Testat. |
| Izolare între spitale | Decizie de replicare | Platformă | Spitalul B nu citește pacientul sau exportul spitalului A. Testat. |
| Cheie API criptată, mascată, fără ieșire în log | Documentația OpenAI, Anthropic, xAI, Google | AI admin | Prefixul secret nu apare în răspuns, în bază sau în jurnal. Testat. |
| Zena fără model pentru ajutor și raport | Decizie de proiect | Zena | `aiUsed: false`. Testat și cu `AI_DATA_KEY` absent. |
| Extensie declarativă de concedii, cu aprobare | Decizie de proiect, inspirată de limitele modulelor OpenMRS/OpenEMR | Extensii | Propunere, previzualizare, refuz la activare prematură, aprobare, activare, cerere persistentă. Testat. |
| Codul generat nu se publică fără sandbox | Decizie de proiect | Extensii | `available: false`, publicarea răspunde 501, `executable` rămâne fals. Testat. |
| Copie criptată și restaurare | Decizie de continuitate | Operare | Pacient șters și readus din copia criptată. Testat pe PGlite. |
| Integrare SIUI/DES/LIS/PACS | Specificația DES și PS3.18, fără endpoint utilizabil | Integrări | Catalogul stă pe `neconfigurat`. Outbox `held`. |
| FHIR ca graniță | HL7 FHIR R4 | Interoperabilitate | Un Patient R4 de citire. Nu înlocuiește modelul intern. |

## Harta modulelor

Implementat în această versiune, cu API și teste: administrare de structură, utilizatori și roluri, registratură și identitate, UPU (prezentare și triaj text), internare și transfer, dosar minim (notă, scrisoare), laborator până la validare și corecție, raportul operațional de internări, HR doar după activarea extensiei de concedii, configurarea furnizorilor AI, Zena, audit, integrări în starea neconfigurat.

Prezent doar ca tabele, fără flux complet: medicație și administrare, consimțăminte, gărzi, stocuri, diagnostice și alergii ca entități separate, imagistică ca tip de cerere.

Roadmap: ATI, bloc operator, ambulatoriu și spitalizare de zi ca fluxuri proprii, pontaj, financiar și decontare, portal de aparținători, calitate și incidente, gateway HL7 v2 și DICOMweb, export SMDP, MFA, TLS terminat în pachet.
