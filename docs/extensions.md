# Extensii

## Declarativ

O specificație acceptă doar câmpuri `text`, `textarea`, `date`, `select`, `number` și resursa `leave_requests`. Cheile `script`, `sql`, `template`, `javascript` și `query` sunt respinse cu 422.

Fluxul testat:

1. Zena, modul configurare, cu fraza despre concedii, șef de secție și raport lunar.
2. Se salvează propunerea în status `draft`, cu checksum.
3. Activarea din `draft` este refuzată.
4. Previzualizarea folosește un rând etichetat sintetic și nu scrie în `leave_requests`.
5. Aprobarea cere permisiunea `extension.approve`.
6. Activarea scrie `extension_versions` și abia apoi `POST /api/hr/leave-requests` persistă date.
7. Raportul lunar grupează cererile spitalului după luna datei de început.

Specificația nu călătorește cu datele spitalului: manifestul nu conține pacienți sau chei. Copia lui în alt spital se face printr-o propunere nouă, nu prin exportul bazei.

## Cod

`POST /api/extensions/code/:id/publish` răspunde 501. Coloana `executable` rămâne falsă. Nu se scrie fișier, nu se rulează migrație generată și nu se atinge baza de producție. Acest lucru rămâne indisponibil până există un workspace izolat, fără socket Docker și fără secrete, plus un serviciu de publicare cu permisiuni separate.

Rollback-ul de cod și recuperarea datelor sunt proceduri diferite. Copia criptată restaurează rânduri. Ea nu este planul de revenire pentru o versiune de cod, iar în această versiune nu există versiune de cod publicată.
