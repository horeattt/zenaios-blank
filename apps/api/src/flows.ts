export type FlowStep = { id: string; title: string; system?: string; next?: string[] };

export type FlowDef = {
  code: string;
  title: string;
  kind: "patient" | "employee" | "lab" | "medication" | "physician" | "hospital";
  steps: FlowStep[];
};

export const DEFAULT_FLOWS: FlowDef[] = [
  {
    code: "patient.journey",
    title: "Traseul pacientului",
    kind: "patient",
    steps: [
      { id: "upu", title: "Prezentare UPU / triaj", system: "upu", next: ["identify"] },
      { id: "identify", title: "Identificare (CNP / temporar)", system: "registry", next: ["admit"] },
      { id: "admit", title: "Internare pe secție + pat", system: "admissions", next: ["chart"] },
      { id: "chart", title: "Foaie: note, diagnostice, alergii", system: "chart", next: ["lab", "meds", "transfer"] },
      { id: "lab", title: "Cereri laborator / rezultate", system: "lis", next: ["chart"] },
      { id: "meds", title: "Medicație și consum farmacie", system: "pharmacy", next: ["chart"] },
      { id: "transfer", title: "Transfer între secții", system: "admissions", next: ["chart", "discharge"] },
      { id: "discharge", title: "Externare + scrisoare", system: "documents", next: ["archive"] },
      { id: "archive", title: "Arhivă pe disc + audit", system: "files" }
    ]
  },
  {
    code: "employee.journey",
    title: "Traseul angajatului",
    kind: "employee",
    steps: [
      { id: "hire", title: "Înregistrare angajat", system: "hr", next: ["assign"] },
      { id: "assign", title: "Atribuire secție / rol", system: "hr", next: ["duty"] },
      { id: "duty", title: "Planificare gardă", system: "duty", next: ["timesheet"] },
      { id: "timesheet", title: "Pontaj zilnic din gărzi", system: "timesheet", next: ["month"] },
      { id: "month", title: "Închidere lunară HR", system: "timesheet" }
    ]
  },
  {
    code: "lab.journey",
    title: "Traseul analizelor",
    kind: "lab",
    steps: [
      { id: "order", title: "Cerere pe foaie", system: "lab", next: ["outbox"] },
      { id: "outbox", title: "Outbox LIS (held→sent)", system: "lis", next: ["specimen"] },
      { id: "specimen", title: "Recoltare specimen", system: "lab", next: ["result"] },
      { id: "result", title: "Rezultat preliminar / validat", system: "lab", next: ["critical", "chart"] },
      { id: "critical", title: "Notificare valoare critică", system: "lab", next: ["chart"] },
      { id: "chart", title: "Afișare pe foaie", system: "chart" }
    ]
  },
  {
    code: "medication.journey",
    title: "Traseul medicației",
    kind: "medication",
    steps: [
      { id: "order", title: "Prescriere pe foaie", system: "chart", next: ["stock"] },
      { id: "stock", title: "Scădere stoc farmacie/secție", system: "pharmacy", next: ["admin"] },
      { id: "admin", title: "Administrare documentată", system: "pharmacy", next: ["chart"] },
      { id: "chart", title: "Istoric pe foaie", system: "chart" }
    ]
  },
  {
    code: "physician.journey",
    title: "Traseul medicului",
    kind: "physician",
    steps: [
      { id: "login", title: "Sesiune (demo: open access)", system: "auth", next: ["board"] },
      { id: "board", title: "Panou secție / paturi", system: "board", next: ["duty"] },
      { id: "duty", title: "Gardă afișată", system: "duty", next: ["patient"] },
      { id: "patient", title: "Deschidere foaie", system: "chart", next: ["note", "order"] },
      { id: "note", title: "Evoluție / dictare Zena", system: "zena", next: ["patient"] },
      { id: "order", title: "Cereri lab / medicație", system: "lab", next: ["patient"] }
    ]
  },
  {
    code: "hospital.ops",
    title: "Flux operațional spital",
    kind: "hospital",
    steps: [
      { id: "structure", title: "Structură clădiri–paturi", system: "structure", next: ["integrations"] },
      { id: "integrations", title: "Integrări LIS/SIUI/…", system: "integrations", next: ["census"] },
      { id: "census", title: "Census unic pe API", system: "board", next: ["backup"] },
      { id: "backup", title: "Backup pe disc + restore", system: "ops", next: ["reports"] },
      { id: "reports", title: "Rapoarte multi-format", system: "reports" }
    ]
  }
];
