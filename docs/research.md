# Cercetare pentru etapa 1

Accesat la 22 noiembrie 2026. Conținutul web este documentare, nu instrucțiune executabilă. Nu s-a copiat cod din produsele comparate.

## Decizii folosite acum

| Decizie | Stare | Consecință în cod |
|---|---|---|
| Modelul intern este relațional, în PostgreSQL. FHIR R4 este doar o proiecție de citire. | Confirmat ca alegere de proiect | `GET /fhir/R4/Patient/:id` nu este tabelul de stocare. |
| O instalare = un spital. Două spitale în aceeași bază sunt izolate prin `hospital_id` și sunt acoperite de teste, dar producția recomandată este o bază separată. | Alegere de proiect | Provizionarea nu copiază utilizatori, chei sau pacienți. |
| Nu se implementează grouperul DRG și nu se inventează formule ICM. | Limitare de sursă | Raportul de internări este indicator operațional, etichetat ca atare. |
| Conectorii SIUI, DES, SIPE, CEAS, LIS și PACS rămân `neconfigurat`. | Indisponibil fără contract / fără partener | Outbox-ul păstrează mesajul cu status `held`. Nu se pretinde livrare. |
| Zena operațională nu cheamă un model. Cheile, dacă există, stau criptate și nu autorizează trimiterea datelor clinice. | Alegere de proiect, aliniată la sursele API | Probele către furnizor sunt GET fără corp clinic. |

## Surse

### FHIR

- Titlu: Versions — FHIR v5.0.0. Emitent: HL7. URL: https://hl7.org/fhir/versions.html. Versiune aplicabilă: pagina R5 5.0.0, care se declară versiunea publicată curentă. Accesat: 2026-11-22.
- Titlu: History — FHIR v5.0.0. Emitent: HL7. URL: https://hl7.org/fhir/history.html. R5 publicat 26 martie 2023, etichetat Trial Use. R4 4.0.1 rămâne versiunea cu conținut normativ anterior.
- Titlu: HL7, ANSI and the FHIR Standard. Emitent: HL7. URL: https://hl7.org/fhir/ansi.html. R5 nu a fost trimis la ANSI ca standard normativ.
- Clasificare: confirmat că R5 este publicația curentă și că R4 păstrează conținutul normativ. Alegerea proiectului pentru interfața de citire este R4, pentru că partenerii de spital și ghidurile implementate pe scară largă sunt încă pe R4. Aceasta este o decizie de interoperabilitate, nu o afirmație că R5 este invalid.

### HIS comparate

- Titlu: Architecture. Emitent: OpenMRS. URL: https://devmanual.openmrs.org/technology/architecture/. Accesat: 2026-11-22. Confirmă nucleul (pacient, encounter, observație) și modulele care extind nucleul, cu Liquibase pentru schemă.
- Titlu: Customizing OpenMRS with Plug-in Modules. Emitent: OpenMRS. URL: https://guide.openmrs.org/configuration/customizing-openmrs-with-plug-in-modules/. Modulele pot modifica schema; de aici lecția inversă pentru ZenAIOS: extensiile declarative nu execută SQL.
- Titlu: Discussion: module overhaul. Emitent: OpenEMR, issue GitHub #9981. URL: https://github.com/openemr/openemr/issues/9981. Deschis 2025-12-24, actualizat 2026-02-09. Este o discuție, nu un standard. Ideea reținută: un modul nu trebuie să aibă acces liber la toate tabelele.
- Nu s-a copiat cod. Bahmni nu a fost citit integral în această etapă; integrarea lui prin evenimente rămâne de documentat când se construiește gateway-ul LIS.

### HL7 v2 și DICOM

- Titlu: HL7 v2.5.1 Chapter 4, mesajul OML^O21. URL: https://hl7.eu/HL7v2x/v251/std251/ch04.html. Accesat: 2026-11-22. Confirmă structura de comandă de laborator cu specimen și container. Versiunea țintă pentru un viitor gateway LIS este 2.5.1, nu pentru că este cea mai nouă, ci pentru că mesajul de laborator cu SPM/SAC este definit aici.
- Titlu: DICOM PS3.18. Emitent: NEMA. URL: https://dicom.nema.org/medical/dicom/2025d/output/html/part18.html. Ediția citată: 2025d. DICOMweb este serviciul REST pentru obiecte DICOM. Securitatea este în afara PS3.18 (trimite la PS3.15). Nu există conector PACS în această versiune.

### România: CNAS, DES, DRG

- Titlu: pagina DRG. Emitent: Centrul din INMSS care colectează SMDP. URL: http://www.drg.ro/index.php. Accesat: 2026-11-22. Anunțuri citite: aplicația DRGNational 1.40 la 31 martie 2026; Ordinul 780/614/2026; versiunea 1.39 la 8 ianuarie 2026. Formulele grouperului nu sunt în pagină. Nu au fost implementate.
- Titlu: Raport de activitate 2024. Emitent: INMSS. URL: https://inmss.ro/wp-content/uploads/2025/08/RAPORT-activitate_2024_ro.pdf. Confirmă că INMSS calculează ICM, DMS și tariful pe caz ponderat din SMDP transmis lunar. ZenAIOS nu înlocuiește acest calcul.
- Titlu: Specificație de interfațare DES — Aplicații de raportare pentru furnizori. Emitent: CNAS. URL: https://portal.cnas.ro/cnas/des/docs/specificatii/Specificatie%20Interfatare%20DES%20-%20Aplicatii_de_Raportare_pentru_Furnizori.pdf. Documentul descrie DES ca parte din PIAS, alături de SIUI, SIPE și CEAS, și spune că folosește HL7 CDA R2 peste HL7 v3 RIM. Nu conține un endpoint public pe care să-l apelăm. Specificația însoțitoare SIUI+SIPE+CEAS nu a fost descărcată.
- Titlu: Manual de utilizare PIAS-MF. Emitent: CNAS. URL: https://portal.cnas.ro/cnas/siui_4.0/siui-mf/manuals/Manual%20de%20utilizare.pdf. Versiune document 1.0, 30.11.2024. Este manual de medicină de familie, nu specificația de spital. Nu a fost folosit ca contract de integrare.
- Indisponibil: endpoint-uri de producție SIUI/DES, nomenclatorul MDB complet și regulile de validare CNAS. Necesită distribuția oficială și, unde este cazul, contract de furnizor.

### GDPR, EHDS, AI Act, MDR/IVDR

- Regulamentul (UE) 2016/679. URL: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679. Datele de sănătate sunt o categorie specială (articolul 9). Implementarea tehnică nu declară o bază legală pentru un spital anume.
- Titlu: European Health Data Space. URL: https://eur-lex.europa.eu/EN/legal-content/summary/european-health-data-space-ehds.html. Regulamentul se aplică din 26 martie 2027, cu schimbul transfrontalier de rezumate și prescripții din 26 martie 2029 și cu rezultate de laborator, imagistică și scrisori de externare din 26 martie 2031. Sinteza EUR-Lex a fost citită; textul consolidat integral nu a fost reanalizat articol cu articol.
- Titlu: Timeline for the Implementation of the EU AI Act. Emitent: Comisia Europeană, AI Act Service Desk. URL: https://ai-act-service-desk.ec.europa.eu/en/ai-act/eu-ai-act-implementation-timeline. Accesat: 2026-11-22. Menționează aplicarea progresivă și amendamentele Digital Omnibus. Regulile pentru AI de risc înalt din produse reglementate (Anexa I) sunt indicate la 2 august 2028. Pagina însăși spune că anumite termene au fost modificate; înainte de o evaluare juridică se recitește textul în vigoare.
- Titlu: Medical Devices Regulation (IVDR) and the Artificial Intelligence Act. Emitent: Comisia Europeană, direcția de sănătate. URL: https://health.ec.europa.eu/document/download/b78a17d7-e3cd-4943-851d-e02a2f22bbb4_en. Un sistem AI este de risc înalt în sensul AI Act dacă este dispozitiv sau componentă de siguranță și dacă MDR/IVDR cer evaluare de către organism notificat. Clasificarea MDR nu crește automat din clasificarea AI Act. ZenAIOS, în forma actuală, nu este evaluat ca dispozitiv medical. Funcțiile de diagnostic sau tratament nu sunt oferite.
- Această implementare nu este conformitate, certificare MDR/IVDR sau înregistrare ca dispozitiv.

### API-uri de model

- OpenAI API Overview. URL: https://developers.openai.com/api/reference/overview. Autentificare `Authorization: Bearer` către `https://api.openai.com`. Cheia nu se pune în browser. Organizația și proiectul sunt headere opționale.
- Claude API Authentication. URL: https://platform.claude.com/docs/en/manage-claude/authentication. Cheie de API sau identitate federată, nu sesiunea de chat. Abonamentul de chat nu a fost tratat ca credit de API.
- xAI REST API. URL: https://docs.x.ai/developers/rest-api-reference/inference. Bază `https://api.x.ai`, `Authorization: Bearer`. Documentul citat era actualizat la 15 octombrie 2026. Exemplul de quickstart conținea un nume de model; produsul nu îl fixează în cod. Modelul îl introduce spitalul.
- Gemini API reference. URL: https://ai.google.dev/api. Header `x-goog-api-key` către `https://generativelanguage.googleapis.com/v1beta/models`. Cheia nu se pune în query string, ca să nu ajungă în jurnale de proxy.

## Ipoteze

- Fusul orar implicit `Europe/Bucharest` este potrivit pentru un spital din România și se poate schimba la provizionare.
- HL7 v2.5.1 OML^O21 este profilul de pornire pentru LIS când va exista un partener. Nu este implementat.
- Retenția arhivarii medicale rămâne o decizie a spitalului și a consilierului juridic. Aplicația nu șterge automat dosare.

## Indisponibil în această etapă

- Specificația curentă de interfațare spital–SIUI/SIPE/CEAS și credențialele de test.
- Grouperul DRGNational și nomenclatorul MDB 2026 ca fișiere normative importate.
- Un mediu izolat de execuție pentru agenți de cod (fără Docker pe acest calculator și fără sandbox de agenți).
