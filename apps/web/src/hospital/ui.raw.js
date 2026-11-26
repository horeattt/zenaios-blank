
const KEY = "zena-spital-v5";
var live = false;
var apiMe = null;
const KIT = [["Mănuși sterile", 1], ["Comprese sterile", 2]];
const BEDS = 20;
const LAST = ["Ionescu","Popa","Radu","Moldovan","Suciu","Nagy","Costea","Dumitru","Kiss","Luca","Barbu","Stan","Mureșan","Florescu","Toma","Horvat","Sabău","Vlad","Neagu","Crișan","Bodea","Rusu","Filip","Matei"];
const FEMALE = ["Maria","Ioana","Elena","Eva","Ana","Andreea","Cristina","Gabriela","Laura","Sofia","Diana","Raluca"];
const MALE = ["Gheorghe","Constantin","Paul","Andrei","Mihai","Vasile","Dan","Ion","Alexandru","Radu","Ovidiu","Claudiu"];
const DX = {
  cardio: [["I21.4","Infarct miocardic acut subendocardic"],["I50.0","Insuficiență cardiacă congestivă"],["I48.0","Fibrilație atrială paroxistică"],["I20.0","Angină pectorală instabilă"],["I11.0","Boală cardiacă hipertensivă cu insuficiență cardiacă"],["I25.1","Boală cardiacă ischemică"]],
  surg: [["K35.8","Apendicită acută"],["K80.0","Litiază biliară cu colecistită acută"],["K40.9","Hernie inghinală unilaterală"],["K56.6","Ileus"],["K57.3","Boală diverticulară de intestin gros"],["L02.2","Abces cutanat"]],
  med: [["J18.9","Pneumonie"],["E11.6","Diabet zaharat tip 2 cu complicații"],["N18.3","Boală cronică de rinichi, stadiul 3"],["J44.1","BPOC cu exacerbare"],["D64.9","Anemie"],["K74.6","Ciroză hepatică"]],
  general: [["Z00.0","Evaluare generală"]]
};
const RECS = {
  cardio: "Regim hiposodat. Control cardiologic peste 7 zile, cu această scrisoare. Prezentare la urgență la durere toracică, dispnee bruscă sau sincopă.",
  surg: "Îngrijirea plăgii conform indicației de la externare. Control chirurgical peste 7 zile. Prezentare la urgență la febră, sângerare sau durere în creștere.",
  med: "Regim adaptat afecțiunii. Control la medicul de familie peste 7 zile. Prezentare la urgență la febră, dispnee sau stare generală alterată.",
  general: "Control la medicul de familie peste 7 zile. Prezentare la urgență dacă starea se agravează."
};
const SUPPLY = [["Seringă 5 ml","buc","Puncție și perfuzie"],["Mănuși sterile","perechi","Protecție"],["Branulă 18G","buc","Puncție și perfuzie"],["Perfuzor","buc","Puncție și perfuzie"],["Comprese sterile","buc","Pansament"],["Pansament","buc","Pansament"],["Cateter periferic","buc","Puncție și perfuzie"]];
function supplyClass(name) {
  const known = SUPPLY.find(s => s[0].toLowerCase() === String(name || "").toLowerCase());
  return known ? known[2] : "Alte materiale";
}

let state = loadState();
function fillSupplyGroups(wards) {
  let added = false;
  (wards || []).forEach(w => {
    (w.stock || []).forEach(s => {
      if (s.group) return;
      s.group = supplyClass(s.name);
      added = true;
    });
  });
  return added;
}
function ensureConfig() {
  let dirty = false;
  if (!state.hospital) {
    state.hospital = { name: "Spital demonstrație", code: "DEMO", country: "România", timezone: "Europe/Bucharest", locale: "ro-RO" };
    dirty = true;
  }
  if (!state.integrations) {
    state.integrations = { openaiKey: "", openaiModel: "gpt-4o-mini", openaiBase: "https://api.openai.com/v1", aiLetter: true, aiAlerts: true, fhir: "", lis: "", pacs: "", adt: "" };
    dirty = true;
  }
  return dirty;
}
function icdCode(text) {
  const m = String(text || "").trim().match(/^([A-Z]\d{2}(?:\.\d{1,2})?)\b/i);
  return m ? m[1].toUpperCase() : "";
}
function routeFor(name, dose) {
  const blob = (String(name || "") + " " + String(dose || "")).toLowerCase();
  if (/comprimate/.test(blob)) return "Oral";
  if (/subcut|enoxaparin/.test(blob)) return "Subcutanat";
  if (/inhal|salbutamol/.test(blob)) return "Inhalator";
  if (/ml|fiol|flacon|perfuz|sering|ui\//.test(blob)) return "Intravenos";
  return "Oral";
}
function rhythmFor(name) {
  if (/enoxaparin|heparină|heparina|furosemid/i.test(name)) return "la 12 ore";
  if (/paracetamol|metamizol|ceftriaxon|amoxicilin/i.test(name)) return "la 8 ore";
  if (/bisoprolol|atorva|ramipril|enalapril|digoxin|apixaban|pantoprazol/i.test(name)) return "la 24 ore";
  return "o dată";
}
function fillChart(wards) {
  let dirty = false;
  (wards || []).forEach(w => {
    [...(w.patients || []), ...(w.discharged || [])].forEach(p => {
      if (!p.dxAdmit) { p.dxAdmit = p.dx || ""; dirty = true; }
      const code = icdCode(p.dx);
      if (!icdCode(p.dxCode)) { p.dxCode = code; dirty = true; }
      if (p.bodyKg == null) {
        const n = fnv(p.cnp || p.id);
        p.bodyKg = 52 + (n % 45);
        p.heightCm = 155 + (n % 35);
        dirty = true;
      }
      if (!p.kinName) {
        const k = kinOf(p);
        p.kinName = k.name;
        p.kinWho = k.who;
        p.kinPhone = k.phone;
        dirty = true;
      }
      if (!p.antecedents) {
        p.antecedents = antecedentsOf(p).filter(x => !/^Alergie/.test(x)).join(". ") + ".";
        dirty = true;
      }
      if (!p.reason) {
        p.reason = "Internare " + String(p.type || "de urgență").toLowerCase() + " pentru " + (p.dx || "evaluare") + ".";
        dirty = true;
      }
      if (!p.referrer) {
        p.referrer = p.type === "Programată" ? "Medic de familie" : "Ambulanță";
        dirty = true;
      }
      if (p.consentAdmit == null) { p.consentAdmit = true; p.consentProc = !!(w && (w.focus === "surg" || w.id === "chir")); dirty = true; }
      (p.vitals || []).forEach(v => {
        if (v.rr == null) { v.rr = /dispnee|bradicard|șoc|soc/i.test(v.note || "") ? "28" : "16"; dirty = true; }
      });
      (p.meds || []).forEach(m => {
        if (!m.route) { m.route = routeFor(m.name, m.dose); m.schedule = rhythmFor(m.name); m.by = m.by || p.physician || ""; dirty = true; }
      });
    });
  });
  return dirty;
}
const seeded = fillArchive(state.wards);
const profiles = fillProfiles(state.wards);
const groups = fillSupplyGroups(state.wards);
const chart = fillChart(state.wards);
if (seeded || profiles || groups || ensureConfig() || chart) persist();
let ui = { page: "home", wardId: null, patientId: null, tab: "sumar", filter: "all", query: "", bed: null, draft: null, view: "paturi", gest: "materiale", medQuery: "", magQuery: "", magClass: "", studyQuery: "", studyKind: "analize", drill: null, period: "azi", staffCat: "medici", deptId: null, labGroup: "uzuale", holdMed: null, doctor: null, compose: false, sheetPage: 0, calOpen: false, calMonth: "", rangeFrom: "", rangeTo: "", zenaOpen: false, zenaThread: [], zenaDraft: "", aiHeard: "", aiReply: "", aiDemo: 0, letterDraft: null, supClass: "Toate", imgKind: "", histOpen: false, histQuery: "", histDoc: "", openAlerts: [], adminIn: true, wardScopeIds: null, hospitalWideAccess: true, apiBoardTotal: 0, platformNote: "" };
let toastTimer;
let micTimer;

function loadState() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.wards) && Array.isArray(data.people) && Array.isArray(data.departments)) return data;
    }
  } catch (err) { /* datele demo se regenerează */ }
  return { wards: seedWards(), people: seedPeople(), departments: seedDepartments(), gestTypes: seedGestTypes() };
}
let saveTimer = 0;
function collectionSnapshot() {
  return { wards: state.wards, people: state.people, departments: state.departments, gestTypes: state.gestTypes, hospital: state.hospital, integrations: state.integrations, synthetic: state.synthetic !== false };
}
function persist() {
  const body = collectionSnapshot();
  sessionStorage.setItem(KEY, JSON.stringify(body));
  if (!live) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch("/api/collection", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(response => { if (!response.ok) toast("Salvarea în baza spitalului a eșuat.", "err"); })
      .catch(() => toast("Salvarea în baza spitalului a eșuat.", "err"));
  }, 400);
}
function applyCollection(doc) {
  state.wards = doc.wards;
  state.people = doc.people || [];
  state.departments = doc.departments || [];
  state.gestTypes = doc.gestTypes || [];
  if (doc.hospital) state.hospital = doc.hospital;
  if (doc.integrations) state.integrations = doc.integrations;
  state.synthetic = doc.synthetic !== false;
}
function showLiveBar(text) {
  let bar = document.getElementById("live-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "live-bar";
    bar.style.cssText = "position:sticky;top:0;z-index:40;background:#17234A;color:#fff;font:13px/1.4 Segoe UI,sans-serif;padding:7px 16px";
    document.body.prepend(bar);
  }
  bar.textContent = text;
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function pad(n) { return String(n).padStart(2, "0"); }
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function stamp(daysAgo, hour) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, (daysAgo * 7) % 50, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function nowStamp() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmt(s) { if (!s) return "—"; const d = new Date(s); return d.toLocaleString("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function fmtDay(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ro-RO", { day: "2-digit", month: "long", year: "numeric" }); }
function stayDays(iso) {
  const a = new Date(iso), b = new Date();
  a.setHours(0,0,0,0); b.setHours(0,0,0,0);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}
function ageOf(birth) {
  const b = new Date(birth), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function visibleWards() {
  if (ui.wardScopeIds == null) return state.wards;
  const scoped = state.wards.filter(w => w.apiId && ui.wardScopeIds.includes(w.apiId));
  return scoped.length ? scoped : state.wards;
}
function ward() { return state.wards.find(w => w.id === ui.wardId) || null; }
function freeCount(w) {
  if (typeof w.apiFree === "number") return w.apiFree;
  return freeBeds(w).length;
}
function occCount(w) {
  if (typeof w.apiOccupied === "number") return w.apiOccupied;
  return occupied(w).length;
}
function findPatient(w, id) { return w.patients.find(p => p.id === id) || w.discharged.find(p => p.id === id) || null; }
function patient() { const w = ward(); return w && ui.patientId ? findPatient(w, ui.patientId) : null; }
function occupied(w) { return w.patients.filter(p => p.bed); }
function bedCount(w) { return w && w.bedCount ? w.bedCount : BEDS; }
function isClosed(w, n) { return ((w && w.closed) || []).includes(n); }
function freeBeds(w) { const used = new Set(occupied(w).map(p => p.bed)); const out = []; for (let b = 1; b <= bedCount(w); b++) if (!used.has(b) && !isClosed(w, b)) out.push(b); return out; }
function onBed(w, bed) { return w.patients.find(p => p.bed === bed) || null; }
function pendingCount(w) { return w.patients.reduce((n, p) => n + p.studies.filter(s => s.status === "in-lucru").length, 0); }
function statusLabel(s) { return { internat: "Internat", critic: "Critic", pregatit: "Pregătit externare", externat: "Externat", decedat: "Decedat", transferat: "Transferat" }[s] || s; }
function sexLabel(s) { return s === "F" ? "Feminin" : "Masculin"; }
function onDay(iso, day = todayKey()) { return (iso || "").slice(0, 10) === day; }
function notedToday(p) { return (p.notes || []).some(n => onDay(n.at)); }
function vitalToday(p) { return (p.vitals || []).some(v => onDay(v.at)); }
function roleLabel(role) { return { medic: "Medic", asistenta: "Asistentă", infirmiera: "Infirmieră", brancardier: "Brancardier" }[role] || role; }
function dutyLabel(role) { return { medic: "Medic de gardă", asistenta: "Asistentă de gardă", infirmiera: "Infirmieră", brancardier: "Brancardier" }[role] || role; }
function medics(w) {
  const from = (w.staff || []).filter(s => s.role === "medic").map(s => s.name);
  return from.length ? from : (w.physicians || [w.chief]);
}
function lowStock(w) { return (w.stock || []).filter(s => s.qty < s.min); }
function kitGap(w) {
  const n = occupied(w).length;
  const gaps = [];
  KIT.forEach(([name, qty]) => {
    const item = (w.stock || []).find(s => s.name === name);
    const have = item ? item.qty : 0;
    const need = qty * n;
    if (n && have < need) gaps.push(`${name}: ${have} în stoc, ${need} necesare`);
  });
  return gaps;
}
function dutyName(w, role) { return (w.duty && w.duty[role]) || "—"; }

function makeCnp(sexDigit, birth, serial) {
  const [y, m, d] = birth.split("-");
  const base = `${sexDigit}${y.slice(2)}${m}${d}05${String(serial).padStart(3, "0")}`;
  const key = [2,7,9,1,4,6,3,5,8,2,7,9];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * key[i];
  let c = sum % 11;
  if (c === 10) c = 1;
  return base + String(c);
}
function parseCnp(cnp) {
  if (!/^\d{13}$/.test(cnp)) return { ok: false, reason: "CNP-ul trebuie să aibă 13 cifre." };
  const key = [2,7,9,1,4,6,3,5,8,2,7,9];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(cnp[i]) * key[i];
  let control = sum % 11;
  if (control === 10) control = 1;
  if (control !== Number(cnp[12])) return { ok: false, reason: "Cifra de control a CNP-ului nu corespunde." };
  const sexDigit = Number(cnp[0]);
  const yy = Number(cnp.slice(1, 3));
  const mm = Number(cnp.slice(3, 5));
  const dd = Number(cnp.slice(5, 7));
  let year = 1900 + yy;
  if (sexDigit === 5 || sexDigit === 6) year = 2000 + yy;
  if (sexDigit === 3 || sexDigit === 4) year = 1800 + yy;
  const iso = `${year}-${pad(mm)}-${pad(dd)}`;
  const date = new Date(iso + "T00:00:00");
  if (date.getMonth() + 1 !== mm || date.getDate() !== dd) return { ok: false, reason: "Data din CNP nu este validă." };
  return { ok: true, sex: sexDigit % 2 === 1 ? "M" : "F", iso };
}
function personName(i) {
  const sex = i % 2 === 0 ? "F" : "M";
  const first = sex === "F" ? FEMALE[(i / 2) % FEMALE.length] : MALE[((i - 1) / 2) % MALE.length];
  return { sex, first, last: LAST[i % LAST.length] };
}
function birthFor(i) {
  const year = 1948 + (i * 3) % 52;
  const month = (i % 12) + 1;
  const day = (i % 27) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}
function baseRows() {
  return [
    ["Hemoglobină","13,6","g/dL","12,0–15,5"],
    ["Leucocite","7,4","10³/µL","4,0–10,0"],
    ["Trombocite","228","10³/µL","150–400"],
    ["Glicemie","94","mg/dL","70–99"],
    ["Creatinină","0,9","mg/dL","0,6–1,2"],
    ["Uree","34","mg/dL","15–45"],
    ["Sodiu","139","mmol/L","136–145"],
    ["Potasiu","4,1","mmol/L","3,5–5,1"],
    ["ALT","24","U/L","0–41"],
    ["CRP","4","mg/L","< 5"]
  ].map(([name, value, unit, ref]) => ({ name, value, unit, ref, flag: "" }));
}
function tuneLabs(rows, code) {
  const set = (name, value, flag) => { const row = rows.find(r => r.name === name); if (row) { row.value = value; row.flag = flag; } };
  if (code.startsWith("I21")) { rows.push({ name: "Troponină I", value: "1,80", unit: "ng/mL", ref: "< 0,04", flag: "H" }); set("CRP", "22", "H"); }
  if (code.startsWith("J18") || code.startsWith("J44") || code.startsWith("K35") || code.startsWith("L02")) { set("Leucocite", "14,6", "H"); set("CRP", "48", "H"); }
  if (code.startsWith("E11")) set("Glicemie", "214", "H");
  if (code.startsWith("D64")) set("Hemoglobină", "9,1", "L");
  if (code.startsWith("N18")) { set("Creatinină", "1,8", "H"); set("Uree", "68", "H"); }
  if (code.startsWith("K74")) { set("ALT", "86", "H"); set("Trombocite", "110", "L"); }
  return rows;
}
function rxText(focus, code) {
  if (code.startsWith("J18") || code.startsWith("J44")) return "Infiltrat bazal drept. Sinusul costo-frenic drept șters.";
  if (code.startsWith("I")) return "Cord mărit de volum. Fără condensare pulmonară. Sinusuri libere.";
  if (focus === "surg") return "Fără aer liber subdiafragmatic. Distribuție gazoasă intestinală prezentă.";
  return "Fără condensare pulmonară. Sinusuri costo-frenice libere.";
}
function ctPack(focus, code) {
  if (focus === "surg" && code.startsWith("K35")) return ["CT abdomen și pelvis", "Apendice îngroșat, cu grăsime pericecală infiltrată. Fără colecție organizată."];
  if (focus === "surg" && code.startsWith("K80")) return ["CT abdomen și pelvis", "Calcul vezicular. Perete vezicular îngroșat. Căile biliare nu sunt dilatate."];
  if (focus === "surg") return ["CT abdomen și pelvis", "Fără colecție intraabdominală. Fără aer liber."];
  if (code.startsWith("I") || code.startsWith("J")) return ["CT torace", "Fără embolie pulmonară pe ramurile vizualizate. Fără revărsat pleural important."];
  return ["CT craniu", "Fără hemoragie intracraniană acută. Fără efect de masă."];
}
function buildStudies(focus, i, code) {
  const list = [];
  if (i === 4 || i === 15) {
    list.push({ id: uid(), kind: "analize", title: "Buletin de analize", at: stamp(0, 7), status: "in-lucru", result: "", rows: [] });
  } else {
    list.push({ id: uid(), kind: "analize", title: "Buletin de analize", at: stamp(Math.min(i % 4, 2), 9), status: "finalizat", result: "", rows: tuneLabs(baseRows(), code) });
  }
  if (i % 2 === 0) list.push({ id: uid(), kind: "rx", title: focus === "surg" && i % 4 === 0 ? "Radiografie abdominală" : "Radiografie toracică", at: stamp(1, 11), status: "finalizat", result: rxText(focus, code), rows: [] });
  if (i % 5 === 0) {
    const [title, result] = ctPack(focus, code);
    list.push({ id: uid(), kind: "ct", title, at: stamp(1, 15), status: "finalizat", result, rows: [] });
  }
  return list;
}
function buildVitals(i, critic) {
  const rows = [
    { ta: "136/80", av: "86", temp: "36,7", spo2: "97", rr: "16", note: "" },
    { ta: "130/78", av: "82", temp: "36,6", spo2: "98", rr: "16", note: "" },
    { ta: "126/74", av: "78", temp: "36,5", spo2: "98", rr: "15", note: "" }
  ];
  rows.push(critic
    ? { ta: "96/58", av: "118", temp: "37,8", spo2: "91", rr: "28", note: "Dispnee, supraveghere apropiată" }
    : { ta: "122/72", av: "74", temp: "36,6", spo2: "98", rr: "16", note: "" });
  const list = rows.map((v, idx) => ({ ...v, at: stamp(rows.length - 1 - idx, 7 + idx) }));
  if (i % 3 === 2 && !critic) list[list.length - 1].at = stamp(1, 18);
  return list;
}
function buildSupplies(i) {
  const count = 2 + (i % 3);
  const out = [];
  for (let k = 0; k < count; k++) {
    const [name, unit] = SUPPLY[(i + k) % SUPPLY.length];
    out.push({ id: uid(), name, qty: 1 + (k % 3), unit, at: stamp(k % 3, 8 + k) });
  }
  return out;
}
function buildNotes(focus, status, physician, i) {
  const course = status === "critic"
    ? "Necesită supraveghere apropiată. Ultimele constante sunt în afara intervalului obișnuit."
    : focus === "surg" ? "Plagă îngrijită. Tranzit intestinal prezent. Afebril."
    : focus === "cardio" ? "Fără durere toracică în repaus. Dispneea de efort este în scădere."
    : "Afebril la ultima evaluare. Apetit prezent. Diureză păstrată.";
  const notes = [{ at: stamp(2, 9), author: physician, text: "Internare. Evaluare inițială efectuată. Plan de investigații stabilit." }];
  if (i % 3 === 2 && status !== "critic") notes.push({ at: stamp(1, 18), author: physician, text: "Evoluție staționară față de ziua precedentă." });
  else notes.push({ at: stamp(0, 8), author: physician, text: course });
  return notes;
}
function epicrisis(p, w) {
  const verb = p.sex === "F" ? "internată" : "internat";
  const done = (p.studies || []).filter(s => s.status === "finalizat").map(s => s.title);
  const inv = done.length ? done.join(", ") : "investigațiile rămase în lucru";
  const notes = (p.notes || []).slice().sort((a, b) => a.at.localeCompare(b.at));
  const last = notes[notes.length - 1];
  const evo = last ? ` Evoluție: ${last.text}` : "";
  return `${p.last} ${p.first} a fost ${verb} în secția ${w.name} pentru ${p.dx}. Evoluția sub supraveghere a fost favorabilă. Investigații efectuate: ${inv}.${evo} Se externează în stare stabilă.`;
}
function makePatient(spec, i, mode) {
  const who = personName(i);
  const birth = birthFor(i);
  const sexDigit = Number(birth.slice(0, 4)) >= 2000 ? (who.sex === "M" ? 5 : 6) : (who.sex === "M" ? 1 : 2);
  const dxPair = (DX[spec.focus] || DX.general)[i % (DX[spec.focus] || DX.general).length];
  const status = mode === "out" ? "externat" : (i === 2 ? "critic" : (i === 6 || i === 13 ? "pregatit" : "internat"));
  const physician = spec.physicians[i % spec.physicians.length];
  const admittedDays = mode === "out" ? 6 + (i % 3) : (i === 2 ? 1 : (status === "pregatit" ? 5 : i % 8));
  const p = {
    id: spec.id + "-" + i + "-" + mode,
    ...who, birth,
    cnp: makeCnp(sexDigit, birth, 100 + spec.serial + i),
    phone: "07" + String(20000000 + spec.serial + i).slice(0, 2) + " " + String(100 + i).slice(-3) + " " + String(200 + spec.serial).slice(-3),
    insured: true, casa: "CJAS Bihor",
    admitted: stamp(admittedDays, 8 + (i % 6)),
    type: i % 3 === 0 ? "Programată" : "Urgență",
    bed: mode === "out" ? null : i + 1,
    physician, dxCode: dxPair[0], dx: dxPair[0] + " " + dxPair[1],
    allergies: i % 5 === 0 ? "Penicilină" : "Nu se cunosc",
    ...profileFor(i),
    status, fileNo: "FO-2026-" + spec.tag + "-" + pad(i + 1),
    vitals: buildVitals(i, status === "critic"),
    studies: buildStudies(spec.focus, i, dxPair[0]),
    supplies: buildSupplies(i),
    meds: [],
    secondary: "",
    weight: (({ cardio: [2.4, 1.6, 3.1, 1.8, 2.2, 1.5], surg: [2.8, 1.9, 2.3, 3.4, 1.7, 2.1], med: [1.4, 2.2, 1.8, 1.3, 2.6, 1.6] })[spec.focus] || [1.4])[i % 6],
    notes: buildNotes(spec.focus, status, physician, i),
    letter: null, discharged: null
  };
  if (mode === "out") {
    p.discharged = stamp(i === 20 ? 0 : (i - 20), 12);
    p.letter = { number: "SM-2026-" + spec.tag + "-" + pad(i + 1), issued: p.discharged, dx: p.dx, secondary: "", epicrisis: "", recommendations: RECS[spec.focus] || RECS.general };
    p.letter.epicrisis = epicrisis(p, { name: spec.name });
  }
  return p;
}
function profileFor(i) {
  const bloods = ["0(I) Rh+", "A(II) Rh+", "B(III) Rh+", "AB(IV) Rh+", "A(II) Rh−", "0(I) Rh−"];
  const streets = ["Str. Republicii", "Str. Independenței", "Calea Clujului", "Str. Mihai Eminescu", "Str. Nufărului", "Str. Primăriei"];
  const towns = ["Oradea", "Oradea", "Oradea", "Beiuș", "Marghita", "Salonta"];
  const n = Math.abs(Number(i) || 0);
  return { blood: bloods[n % bloods.length], address: streets[n % streets.length] + " " + (8 + (n % 36)) + ", " + towns[n % towns.length] };
}
function fillProfiles(wards) {
  let added = false;
  (wards || []).forEach(w => {
    [...(w.patients || []), ...(w.discharged || [])].forEach(p => {
      if (p.blood && p.address) return;
      let n = 0;
      for (const ch of String(p.cnp || p.id || "0")) n += ch.charCodeAt(0);
      const prof = profileFor(n);
      if (!p.blood) p.blood = prof.blood;
      if (!p.address) p.address = prof.address;
      added = true;
    });
  });
  return added;
}
function makeArchive(spec, i, outcome, group) {
  const p = makePatient(spec, i, "out");
  p.archive = true;
  p.archiveGroup = group;
  p.status = outcome;
  p.formerBed = (i % 20) + 1;
  p.discharged = stamp(4 + (i % 45), 11);
  if (p.letter && outcome === "decedat") p.letter.epicrisis += " Deces în secție. Familia a fost anunțată.";
  if (p.letter && outcome === "transferat") p.letter.epicrisis += " Transfer către o altă secție, cu foaia și investigațiile.";
  return p;
}
function fillArchive(wards) {
  let added = false;
  (wards || []).forEach(w => {
    if ((w.discharged || []).some(p => p.archive)) return;
    const spec = { id: w.id, name: w.name, physicians: (w.physicians && w.physicians.length) ? w.physicians : [w.chief || "Medic"], focus: w.focus || "general", tag: String(w.id || "SEC").slice(0, 3).toUpperCase(), serial: 90 };
    const batch = [];
    for (let i = 0; i < 5; i++) batch.push(makeArchive(spec, 100 + i, "externat", "recent"));
    const outcomes = ["externat", "decedat", "transferat"];
    for (let n = 0; n < 60; n++) batch.push(makeArchive(spec, 200 + n, outcomes[n % 3], "page"));
    w.discharged = (w.discharged || []).concat(batch);
    added = true;
  });
  return added;
}
function defaultStaff(spec) {
  const extra = {
    cardio: [["Dr. Luca Andrei", "medic"], ["Nagy Elena", "asistenta"], ["Moldovan Ioana", "infirmiera"], ["Stan Vasile", "brancardier"]],
    surg: [["Dr. Barbu Mihai", "medic"], ["Florescu Maria", "asistenta"], ["Toma Elena", "infirmiera"], ["Bodea Ion", "brancardier"]],
    med: [["Dr. Stan Radu", "medic"], ["Sabău Laura", "asistenta"], ["Crișan Ioana", "infirmiera"], ["Rusu Dan", "brancardier"]]
  }[spec.focus] || [];
  return [[spec.chief, "medic"], [spec.nurse, "asistenta"], ...extra].filter(r => r[0]).map(([name, role]) => ({ id: uid(), name, role }));
}
function defaultDuty(staff) {
  const pick = role => (staff.find(s => s.role === role) || {}).name || "";
  return { date: todayKey(), medic: pick("medic"), asistenta: pick("asistenta"), infirmiera: pick("infirmiera"), brancardier: pick("brancardier") };
}
function defaultStock(bias) {
  const rows = [
    ["Seringă 5 ml", "buc", 80, 20],
    ["Mănuși sterile", "perechi", bias === 1 ? 8 : 28, 30],
    ["Branulă 18G", "buc", 36, 12],
    ["Perfuzor", "buc", 24, 8],
    ["Comprese sterile", "buc", bias === 2 ? 16 : 70, 40],
    ["Pansament", "buc", 50, 15],
    ["Cateter periferic", "buc", 22, 10]
  ];
  return rows.map(([name, unit, qty, min]) => ({ name, unit, qty, min, group: supplyClass(name) }));
}
function defaultMeds() {
  const rows = [
    ["Soluții perfuzabile", "Ser fiziologic 0,9%", "500 ml", "flacon", 36, 12],
    ["Soluții perfuzabile", "Glucoză 5%", "500 ml", "flacon", 24, 10],
    ["Soluții perfuzabile", "Glucoză 10%", "500 ml", "flacon", 9, 8],
    ["Soluții perfuzabile", "Ringer lactat", "500 ml", "flacon", 18, 8],
    ["Soluții perfuzabile", "Manitol 20%", "250 ml", "flacon", 4, 6],
    ["Cardiace", "Bisoprolol", "5 mg", "comprimate", 70, 20],
    ["Cardiace", "Ramipril", "5 mg", "comprimate", 48, 16],
    ["Cardiace", "Atorvastatină", "40 mg", "comprimate", 40, 12],
    ["Cardiace", "Enoxaparină", "40 mg/0,4 ml", "seringă", 11, 10],
    ["Cardiace", "Amiodaronă", "150 mg/3 ml", "fiole", 8, 6],
    ["Antibiotice", "Ceftriaxonă", "1 g", "flacon", 20, 8],
    ["Antibiotice", "Amoxicilină/clavulanat", "1,2 g", "flacon", 7, 8],
    ["Analgezice", "Paracetamol", "10 mg/ml", "flacon", 16, 6],
    ["Analgezice", "Metamizol", "1 g/2 ml", "fiole", 22, 8],
    ["Cardiace", "Digoxină", "0,25 mg", "comprimate", 18, 6],
    ["Cardiace", "Enalapril (Enap)", "10 mg", "comprimate", 30, 10],
    ["Anticoagulante", "Heparină", "5000 UI/ml", "fiole", 12, 6],
    ["Anticoagulante", "Apixaban (Eliquis)", "5 mg", "comprimate", 16, 6],
    ["Diuretice", "Furosemid", "20 mg/2 ml", "fiole", 19, 8],
    ["Gastro", "Pantoprazol", "40 mg", "flacon", 14, 6],
    ["Respirator", "Salbutamol", "5 mg/ml", "soluție", 6, 4]
  ];
  return rows.map((r, i) => ({ id: "m" + i, group: r[0], name: r[1], dose: r[2], unit: r[3], qty: r[4], min: r[5] }));
}
function seedWards() {
  const specs = [
    { id: "cardio", name: "Cardiologie", chief: "Dr. Popescu Ion", nurse: "Popa Adriana", physicians: ["Dr. Popescu Ion", "Dr. Luca Andrei"], focus: "cardio", tag: "CAR", serial: 10 },
    { id: "chir", name: "Chirurgie generală", chief: "Dr. Andrei Cosmin", nurse: "Ioana Cristina", physicians: ["Dr. Andrei Cosmin", "Dr. Barbu Mihai"], focus: "surg", tag: "CHI", serial: 40 },
    { id: "med", name: "Medicină internă", chief: "Dr. Ionescu Ana", nurse: "Popa Adriana", physicians: ["Dr. Ionescu Ana", "Dr. Stan Radu"], focus: "med", tag: "MED", serial: 70 }
  ];
  const wards = specs.map((spec, idx) => {
    const staff = defaultStaff(spec);
    return {
      id: spec.id, name: spec.name, chief: spec.chief, nurse: spec.nurse, physicians: spec.physicians, focus: spec.focus,
      staff, duty: defaultDuty(staff), stock: defaultStock(idx), meds: defaultMeds(), bedCount: BEDS, closed: [],
      patients: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => makePatient(spec, i, "in")),
      discharged: [20, 21, 22].map(i => makePatient(spec, i, "out"))
    };
  });
  armSafety(wards);
  return wards;
}
function giveSeedMed(w, p, name) {
  const item = (w.meds || []).find(m => m.name === name);
  if (item && item.qty > 0) item.qty -= 1;
  p.meds.push({ id: uid(), name, dose: item ? item.dose : "", group: item ? item.group : "", qty: 1, unit: item ? item.unit : "", route: routeFor(name, item ? item.dose : ""), schedule: rhythmFor(name), by: p.physician || "", at: stamp(0, 10) });
}
function armSafety(wards) {
  const cardio = wards.find(w => w.id === "cardio");
  const heart = cardio.patients.find(p => p.bed === 3);
  const vital = heart.vitals[heart.vitals.length - 1];
  vital.ta = "80/60";
  vital.av = "40";
  vital.rr = "28";
  vital.note = "Hipotensiune și bradicardie";
  heart.notes.push({ at: stamp(0, 9), author: heart.physician, text: "Șoc cardiogen la internare. Insuficiență cardiacă congestivă asociată." });
  giveSeedMed(cardio, heart, "Bisoprolol");
  const surg = wards.find(w => w.id === "chir");
  const bleed = surg.patients.find(p => p.bed === 2);
  bleed.notes.push({ at: stamp(0, 9), author: bleed.physician, text: "Melena de azi, scaun negru. Pacientul sângerează." });
  giveSeedMed(surg, bleed, "Heparină");
  const med = wards.find(w => w.id === "med");
  const coag = med.patients.find(p => p.bed === 4);
  const labs = coag.studies.find(s => s.kind === "analize" && s.rows && s.rows.length);
  if (labs) {
    labs.rows.push({ name: "INR", value: "4,2", unit: "", ref: "0,8–1,2", flag: "H" });
    labs.rows.push({ name: "TQ", value: "28", unit: "s", ref: "11–15", flag: "H" });
  }
  coag.notes.push({ at: stamp(0, 9), author: coag.physician, text: "INR 4,2 și TQ alungit. Risc de sângerare." });
  giveSeedMed(med, coag, "Apixaban (Eliquis)");
}

function toast(message, kind) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 3200);
}
function go(patch, scroll) {
  const prev = document.querySelector(".content");
  const top = prev ? prev.scrollTop : 0;
  Object.assign(ui, patch);
  render();
  const next = document.querySelector(".content");
  if (next) next.scrollTop = scroll ? 0 : top;
}

function icon(id) { return `<svg><use href="#${id}"/></svg>`; }
function badge(status) {
  const cls = status === "critic" || status === "decedat" ? "bad" : status === "pregatit" || status === "transferat" ? "warn" : status === "externat" ? "ok" : "";
  return `<span class="badge ${cls}">${esc(statusLabel(status))}</span>`;
}
function signal(p) {
  if (p.status === "critic") return `<span class="danger">Critic</span>`;
  if (p.status === "pregatit") return `<span class="badge warn">Externare</span>`;
  if (p.studies.some(s => s.status === "in-lucru")) return `<span class="badge warn">Rezultat în lucru</span>`;
  return `<span class="muted">—</span>`;
}
function isSurg(w) { return !!(w && (w.focus === "surg" || w.id === "chir")); }
function orRoomOf(p) {
  const key = String((p && (p.id || p.cnp)) || "1");
  let n = 2166136261;
  for (let i = 0; i < key.length; i++) {
    n ^= key.charCodeAt(i);
    n = Math.imul(n, 16777619);
  }
  return ((n >>> 5) & 1) + 1;
}
function isoLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function shiftMin(iso, mins) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + mins);
  return isoLocal(d);
}
function fmtClock(s) {
  const d = new Date(s);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function orStartIso(p, room) {
  const base = new Date(p.admitted || nowStamp());
  if (Number.isNaN(base.getTime())) return nowStamp();
  const bed = p.bed || p.formerBed || 1;
  const slot = new Date(base);
  slot.setHours(room === 1 ? 8 : 12, (bed * 11) % 40, 0, 0);
  if (slot.getTime() < base.getTime()) slot.setDate(slot.getDate() + 1);
  return isoLocal(slot);
}
function orScript(p) {
  const code = String(p.dxCode || "");
  const allergy = /penicil/i.test(p.allergies || "");
  const ab = allergy
    ? ["Ciprofloxacină", "400 mg i.v.", "Antibiotic profilactic. Fără beta-lactam: alergie la penicilină."]
    : ["Cefuroximă", "1,5 g i.v.", "Antibiotic profilactic, la inducție."];
  const fluids = ["NaCl 0,9%", "500 ml i.v.", "Perfuzie de umplere."];
  const pain = ["Paracetamol", "1 g i.v.", "Analgezie de fond."];
  const antiem = ["Metoclopramid", "10 mg i.v.", "Antiemetic."];
  const guard = ["Omeprazol", "40 mg i.v.", "Protecție gastrică."];
  if (code.startsWith("K35")) return { op: "Apendicectomie laparoscopică", anType: "ag", an: "Anestezie generală cu intubație oro-traheală", induce: "Inducție: propofol, fentanil, rocuroniu.", keep: "Menținere: sevofluran și remifentanil.", pre: [ab, antiem, pain, guard, fluids], times: ["Pneumoperitoneu", "Identificarea apendicelui", "Ligatură de mezou și de bază", "Extracție în endobag", "Controlul hemostazei, fără dren"], kit: "Trusă de laparoscopie, trocare 10 mm și 5 mm, cameră, pense, foarfece, endobag", count: "Comprese 10/10 · ace 1/1 · instrumente complete, numărătoare concordantă", dur: 55, after: "Mobilizare în seara intervenției. Regim hidric, apoi lichide. Pansament controlat a doua zi." };
  if (code.startsWith("K80") || code.startsWith("K81")) return { op: "Colecistectomie laparoscopică", anType: "ag", an: "Anestezie generală cu intubație oro-traheală", induce: "Inducție: propofol, fentanil, rocuroniu.", keep: "Menținere: sevofluran și remifentanil.", pre: [ab, antiem, pain, guard, fluids], times: ["Pneumoperitoneu", "Disecția triunghiului Calot", "Clipare canal și arteră cistică", "Extracția veziculei", "Dren subhepatic, controlul hemostazei"], kit: "Trusă de laparoscopie, trocare, cameră, cârlig, clipuri, endobag, dren", count: "Comprese 10/10 · ace 2/2 · instrumente complete, numărătoare concordantă", dur: 75, after: "Dren pe decliv. Mobilizare precoce. Reluarea lichidelor după tranzit." };
  if (code.startsWith("K40")) return { op: "Cura herniei inghinale cu plasă", anType: "spinal", an: "Rahianestezie", induce: "Bupivacaină 0,5%, puncție lombară.", keep: "Bloc senzitiv până la T10. Fără sedare profundă.", pre: [ab, pain, fluids], times: ["Incizie inghinală", "Disecția sacului herniar", "Plasă, fixare", "Închidere în planuri"], kit: "Trusă de hernie, depărtătoare, plasă, fire neresorbabile", count: "Comprese 8/8 · ace 2/2 · instrumente complete, numărătoare concordantă", dur: 50, after: "Mobilizare în câteva ore. Fără efort și fără ridicare de greutăți 4 săptămâni." };
  if (code.startsWith("K43")) return { op: "Cura herniei ventrale cu plasă", anType: "ag", an: "Anestezie generală cu intubație oro-traheală", induce: "Inducție: propofol, fentanil, rocuroniu.", keep: "Menținere: sevofluran.", pre: [ab, antiem, pain, guard, fluids], times: ["Incizie pe defect", "Disecția sacului", "Plasă, închidere"], kit: "Trusă de perete abdominal, plasă, depărtătoare", count: "Comprese 10/10 · ace 2/2 · instrumente complete, numărătoare concordantă", dur: 70, after: "Centură abdominală la mobilizare. Controlul plăgii zilnic." };
  if (code.startsWith("K56")) return { op: "Laparotomie cu aderențioliză", anType: "ag", an: "Anestezie generală cu intubație oro-traheală", induce: "Inducție rapidă: propofol, fentanil, rocuroniu.", keep: "Menținere: sevofluran. Sondă nazogastrică.", pre: [ab, antiem, pain, guard, fluids], times: ["Laparotomie mediană", "Aderențioliză", "Controlul viabilității ansei", "Închidere"], kit: "Trusă de laparotomie, depărtător, pense intestinale, aspirație", count: "Comprese 20/20 · ace 3/3 · instrumente complete, numărătoare concordantă", dur: 95, after: "Sondă nazogastrică până la reluarea tranzitului. Mobilizare asistată." };
  if (code.startsWith("K57")) return { op: "Rezecție segmentară de sigmoid", anType: "ag", an: "Anestezie generală cu intubație oro-traheală", induce: "Inducție: propofol, fentanil, rocuroniu.", keep: "Menținere: sevofluran și remifentanil.", pre: [ab, antiem, pain, guard, fluids], times: ["Laparotomie", "Rezecția segmentului inflamat", "Anastomoză", "Lavaj, dren, închidere"], kit: "Trusă de chirurgia colonului, staplere, dren", count: "Comprese 20/20 · ace 3/3 · instrumente complete, numărătoare concordantă", dur: 110, after: "Dren pe decliv. Reluarea alimentației după tranzit. Antibioterapie de continuare pe secție." };
  if (code.startsWith("K61")) return { op: "Drenaj de abces anal", anType: "spinal", an: "Rahianestezie în șa", induce: "Bupivacaină 0,5% hipobară.", keep: "Bloc perineal. Pacient conștient.", pre: [ab, pain], times: ["Incizie la locul de maximă fluctuență", "Evacuare și lavaj", "Lamelă de dren, pansament"], kit: "Trusă de mica chirurgie, lamelă, pense, comprese", count: "Comprese 5/5 · instrumente complete, numărătoare concordantă", dur: 25, after: "Pansament zilnic. Baie de șezut. Control chirurgical peste 48 de ore." };
  if (code.startsWith("L02") || code.startsWith("L03")) return { op: "Incizie și drenaj de abces", anType: "local", an: "Anestezie locală cu sedare ușoară", induce: "Lidocaină 1% infiltrată la locul inciziei.", keep: "Respirație spontană, pacient contactabil.", pre: [ab, pain], times: ["Incizie", "Evacuare și debridare", "Lavaj, lamelă, pansament"], kit: "Trusă de mica chirurgie, lamelă, seringă, comprese", count: "Comprese 6/6 · instrumente complete, numărătoare concordantă", dur: 30, after: "Pansament zilnic. Antibioterapie pe secție dacă semnele locale persistă." };
  const name = (p.dx || "afecțiunea curentă").replace(/^[A-Z]\d+(\.\d+)?\s*/, "");
  return { op: "Intervenție pentru " + name, anType: "ag", an: "Anestezie generală cu intubație oro-traheală", induce: "Inducție: propofol, fentanil, rocuroniu.", keep: "Menținere: sevofluran.", pre: [ab, antiem, pain, fluids], times: ["Incizie", "Gestul principal", "Hemostază", "Închidere"], kit: "Trusă de chirurgie generală, depărtătoare, aspirație", count: "Comprese 10/10 · ace 2/2 · instrumente complete, numărătoare concordantă", dur: 60, after: "Mobilizare precoce. Controlul plăgii. Analgezie la nevoie." };
}
function orPlan(w, p) {
  const room = orRoomOf(p);
  const script = orScript(p);
  const docs = (w.physicians || []).filter(Boolean);
  const operator = p.physician || docs[0] || w.chief || "Operator";
  const help = docs.find(name => name !== operator) || "Dr. Vlad Mihai";
  const bench = room === 1
    ? { anest: "Dr. Mureșan Dan", anestNurse: "Nagy Ana", scrub: "Florescu Maria", circ: "Ioana Cristina" }
    : { anest: "Dr. Kiss Elena", anestNurse: "Popa Ioana", scrub: "Radu Elena", circ: "Florescu Maria" };
  const start = orStartIso(p, room);
  const cut = shiftMin(start, 15);
  const end = shiftMin(start, script.dur);
  const wakeAt = shiftMin(end, script.anType === "local" ? 5 : 15);
  const hand = shiftMin(wakeAt, script.anType === "ag" ? 20 : 10);
  const now = Date.now();
  const phase = now >= new Date(hand).getTime() ? "Încheiată" : now >= new Date(start).getTime() ? "În sală" : "Programată";
  const wake = script.anType === "ag"
    ? "Extubare în sală. Aldrete 9. Orientat, durere controlată, fără greață."
    : script.anType === "spinal"
      ? "Bloc motor în regres. Fără cefalee. Pacient stabil hemodinamic."
      : "Pacient conștient pe tot parcursul. Pansament uscat.";
  const allergy = p.allergies && p.allergies !== "Nu se cunosc" ? "Alergie cunoscută: " + p.allergies + "." : "Fără alergii cunoscute.";
  return {
    room, phase, start, end, wakeAt, hand, operator, help, ...bench, ...script, wake, allergy,
    preLines: [
      "Identitate, consimțământ și grupă " + (p.blood || "neprecizată") + " verificate.",
      allergy,
      ...script.pre.map(([drug, dose, why]) => drug + " " + dose + " — " + why)
    ],
    opLines: [
      "Timeout: pacient, intervenție, sală și echipă confirmate.",
      "Operator " + operator + ". Ajutor " + help + ".",
      ...script.times
    ]
  };
}
function matches(p) {
  const w = ward();
  if (w && ui.doctor && boardDoctor(w, p) !== ui.doctor) return false;
  if (ui.filter === "critic" && p.status !== "critic") return false;
  if (ui.filter === "ready" && p.status !== "pregatit") return false;
  if (ui.filter === "pending" && !p.studies.some(s => s.status === "in-lucru")) return false;
  const q = (ui.query || "").trim().toLowerCase();
  if (!q) return true;
  const bedNo = p.bed || p.formerBed || 0;
  const salon = bedNo ? Math.ceil(bedNo / 4) : 0;
  const local = bedNo ? ((bedNo - 1) % 4) + 1 : 0;
  const doc = w ? boardDoctor(w, p) : p.physician;
  const age = String(ageOf(p.birth));
  return `${bedNo} ${pad(bedNo)} salon ${salon} pat ${local} ${p.last} ${p.first} ${age} ${p.cnp || ""} ${p.dx} ${doc} ${p.status || ""}`.toLowerCase().includes(q);
}
function dutyRoster(w) {
  if (w && (w.id === "cardio" || w.focus === "cardio")) return ["Dr. Ion Andrei", "Dr. Vasile Sticlaru", "Dr. Maria Ioana", "Dr. Andreea Crăciun"];
  const list = w ? medics(w) : [];
  return list.length ? list : (w && w.chief ? [w.chief] : []);
}
function boardDoctor(w, p) {
  const roster = dutyRoster(w);
  const n = p.bed || p.formerBed || 1;
  if (w && (w.id === "cardio" || w.focus === "cardio") && roster.length) return roster[(n - 1) % roster.length];
  return p.physician || roster[0] || "—";
}
const DOC_COLORS = ["#038387", "#107c10", "#5c2d91", "#ca5010", "#881798"];
function doctorColor(w, name) {
  const i = dutyRoster(w).indexOf(name);
  return DOC_COLORS[(i < 0 ? 0 : i) % DOC_COLORS.length];
}
function bedMarks(p) {
  const marks = [];
  const studies = p.studies || [];
  if (studies.some(s => s.status !== "finalizat")) marks.push("course");
  if (p.status === "critic" || zenaChart(p).some(a => a.level === "bad")) marks.push("alert");
  if (studies.some(s => s.status === "finalizat")) marks.push("result");
  if (p.status !== "critic" && notedToday(p) && !marks.includes("alert")) marks.push("treat");
  return marks.length ? marks : ["treat"];
}
function localPat(bedNo) { return ((bedNo - 1) % 4) + 1; }
function studyLine(s) {
  if (s.status !== "finalizat") return s.title + " — în lucru";
  if (s.kind === "analize") {
    const abn = (s.rows || []).filter(r => r.flag);
    if (!abn.length) return s.title + " — valori în intervalul de referință";
    return s.title + " — " + abn.map(r => `${r.name} ${r.value} ${r.unit}`).join("; ");
  }
  return s.title + " — " + s.result;
}
function kindLabel(k) { return { analize: "Analize", rx: "RX", ct: "CT", rmn: "RMN", echo: "Ecografie" }[k] || k; }

function staffSpec() {
  return {
    medici: { label: "Medici", cols: [["last","Nume"],["first","Prenume"],["code","Cod parafă"],["grade","Grad"],["spec","Specialitate"],["ward","Secție"],["phone","Telefon"],["mail","Email"]] },
    asistenti: { label: "Asistenți", cols: [["last","Nume"],["first","Prenume"],["cert","Certificat OAMGMAMR"],["ward","Secție"],["skill","Competență"],["shift","Tură"],["phone","Telefon"]] },
    infirmieri: { label: "Infirmieri", cols: [["last","Nume"],["first","Prenume"],["ward","Secție"],["shift","Tură"],["skill","Atestat"],["phone","Telefon"]] },
    brancardieri: { label: "Brancardieri", cols: [["last","Nume"],["first","Prenume"],["zone","Zonă"],["shift","Tură"],["phone","Telefon"]] },
    rezidenti: { label: "Rezidenți", cols: [["last","Nume"],["first","Prenume"],["year","An"],["spec","Specialitate"],["mentor","Îndrumător"],["ward","Secție"],["phone","Telefon"]] },
    contractual: { label: "Personal contractual", cols: [["last","Nume"],["first","Prenume"],["firm","Firmă"],["role","Funcție"],["contract","Contract"],["until","Valabil până la"],["dept","Departament"]] },
    voluntari: { label: "Voluntari", cols: [["last","Nume"],["first","Prenume"],["org","Organizație"],["accord","Acord"],["span","Perioadă"],["mentor","Supervizor"],["dept","Loc"]] },
    tesa: { label: "Personal TESA", cols: [["last","Nume"],["first","Prenume"],["dept","Departament"],["role","Funcție"],["ext","Interior"],["mail","Email"]] }
  };
}
function seedPeople() {
  const row = (cat, fields) => ({ id: uid(), cat, fields });
  return [
    row("medici", { last:"Popescu", first:"Ion", code:"P10234", grade:"Primar", spec:"Cardiologie", ward:"Cardiologie", phone:"0259 412 101", mail:"ion.popescu@spital.ro" }),
    row("medici", { last:"Luca", first:"Andrei", code:"P11820", grade:"Specialist", spec:"Cardiologie", ward:"Cardiologie", phone:"0259 412 102", mail:"andrei.luca@spital.ro" }),
    row("medici", { last:"Andrei", first:"Cosmin", code:"P10411", grade:"Primar", spec:"Chirurgie generală", ward:"Chirurgie generală", phone:"0259 412 140", mail:"cosmin.andrei@spital.ro" }),
    row("medici", { last:"Ionescu", first:"Ana", code:"P10990", grade:"Primar", spec:"Medicină internă", ward:"Medicină internă", phone:"0259 412 170", mail:"ana.ionescu@spital.ro" }),
    row("asistenti", { last:"Popa", first:"Adriana", cert:"OAMGMAMR 45210", ward:"Cardiologie", skill:"Terapie coronariană", shift:"Zi", phone:"0722 100 201" }),
    row("asistenti", { last:"Ioana", first:"Cristina", cert:"OAMGMAMR 39811", ward:"Chirurgie generală", skill:"Bloc operator", shift:"Zi", phone:"0722 100 202" }),
    row("asistenti", { last:"Nagy", first:"Elena", cert:"OAMGMAMR 41002", ward:"Cardiologie", skill:"Sală", shift:"Noapte", phone:"0722 100 203" }),
    row("asistenti", { last:"Sabău", first:"Laura", cert:"OAMGMAMR 43318", ward:"Medicină internă", skill:"Sală", shift:"Zi", phone:"0722 100 204" }),
    row("infirmieri", { last:"Moldovan", first:"Ioana", ward:"Cardiologie", shift:"Zi", skill:"Igienă și curățenie", phone:"0722 200 301" }),
    row("infirmieri", { last:"Toma", first:"Elena", ward:"Chirurgie generală", shift:"Zi", skill:"Igienă și curățenie", phone:"0722 200 302" }),
    row("infirmieri", { last:"Crișan", first:"Ioana", ward:"Medicină internă", shift:"Noapte", skill:"Igienă și curățenie", phone:"0722 200 303" }),
    row("infirmieri", { last:"Filip", first:"Maria", ward:"Cardiologie", shift:"Noapte", skill:"Igienă și curățenie", phone:"0722 200 304" }),
    row("brancardieri", { last:"Stan", first:"Vasile", zone:"Cardiologie și imagistică", shift:"Zi", phone:"0722 300 401" }),
    row("brancardieri", { last:"Bodea", first:"Ion", zone:"Chirurgie și bloc operator", shift:"Zi", phone:"0722 300 402" }),
    row("brancardieri", { last:"Rusu", first:"Dan", zone:"Internă și laborator", shift:"Zi", phone:"0722 300 403" }),
    row("brancardieri", { last:"Matei", first:"Paul", zone:"UPU și garda", shift:"Noapte", phone:"0722 300 404" }),
    row("rezidenti", { last:"Horvat", first:"Ana", year:"III", spec:"Cardiologie", mentor:"Dr. Popescu Ion", ward:"Cardiologie", phone:"0722 400 501" }),
    row("rezidenti", { last:"Vlad", first:"Mihai", year:"II", spec:"Chirurgie generală", mentor:"Dr. Andrei Cosmin", ward:"Chirurgie generală", phone:"0722 400 502" }),
    row("rezidenti", { last:"Neagu", first:"Ioana", year:"I", spec:"Medicină internă", mentor:"Dr. Ionescu Ana", ward:"Medicină internă", phone:"0722 400 503" }),
    row("rezidenti", { last:"Kiss", first:"Radu", year:"IV", spec:"Cardiologie", mentor:"Dr. Luca Andrei", ward:"Cardiologie", phone:"0722 400 504" }),
    row("contractual", { last:"Georgescu", first:"Dan", firm:"CleanMed SRL", role:"Curățenie", contract:"C-214", until:"31.12.2026", dept:"Administrativ" }),
    row("contractual", { last:"Pop", first:"Irina", firm:"GastroLine SRL", role:"Dietetică", contract:"C-088", until:"30.06.2027", dept:"Alimentație" }),
    row("contractual", { last:"Nagy", first:"Andrei", firm:"SecurGuard", role:"Pază", contract:"C-301", until:"31.12.2026", dept:"Administrativ" }),
    row("contractual", { last:"Luca", first:"Elena", firm:"LabExtern", role:"Recoltare", contract:"C-155", until:"31.03.2027", dept:"Laborator" }),
    row("voluntari", { last:"Mureșan", first:"Dana", org:"Crucea Roșie", accord:"14/2026", span:"01.01–31.12.2026", mentor:"Popa Adriana", dept:"Cardiologie" }),
    row("voluntari", { last:"Stan", first:"Ioana", org:"Hospice", accord:"3/2026", span:"01.03–31.08.2026", mentor:"Dr. Ionescu Ana", dept:"Medicină internă" }),
    row("voluntari", { last:"Barbu", first:"Paul", org:"Student medicină", accord:"9/2026", span:"01.10–30.11.2026", mentor:"Dr. Andrei Cosmin", dept:"Chirurgie generală" }),
    row("voluntari", { last:"Toma", first:"Andrei", org:"Capelanie", accord:"2/2026", span:"Permanent", mentor:"Secretariat", dept:"Departamente" }),
    row("tesa", { last:"Marin", first:"Claudia", dept:"Resurse umane", role:"Inspector RU", ext:"120", mail:"claudia.marin@spital.ro" }),
    row("tesa", { last:"Duma", first:"Sorin", dept:"Financiar-contabilitate", role:"Economist", ext:"140", mail:"sorin.duma@spital.ro" }),
    row("tesa", { last:"Kiss", first:"Enikő", dept:"Achiziții publice", role:"Referent", ext:"160", mail:"eniko.kiss@spital.ro" }),
    row("tesa", { last:"Popescu", first:"Maria", dept:"Juridic", role:"Consilier juridic", ext:"180", mail:"maria.popescu@spital.ro" })
  ];
}
function seedDepartments() {
  const row = (name, chief, phone, mission) => ({ id: uid(), name, chief, phone, mission });
  return [
    row("IT", "Ing. Radu Pop", "200", "Rețea, conturi și aplicația de spital."),
    row("SPIAAM", "Dr. Elena Nagy", "210", "Infecții asociate asistenței medicale, supraveghere și precauții."),
    row("Managementul calității", "Ec. Ioana Stan", "220", "Proceduri, acreditare și neconformități."),
    row("Resurse umane", "Marin Claudia", "120", "State de funcții, contracte și pontaj."),
    row("Financiar-contabilitate", "Duma Sorin", "140", "Buget, deconturi și casierie."),
    row("Achiziții publice", "Kiss Enikő", "160", "Proceduri de achiziție și contracte."),
    row("Statistică medicală", "Vlad Ana", "230", "DRG, ICM și raportări."),
    row("Farmacie", "Farm. primar Luca Ioana", "240", "Eliberare și stoc de medicament."),
    row("Laborator", "Dr. biolog Mureșan Paul", "250", "Analize de urgență și programate."),
    row("Imagistică", "Dr. Radu Mihai", "260", "RX, CT și RMN."),
    row("Bloc operator", "As. med. prin. Ioana Cristina", "270", "Program operator și circuite."),
    row("UPU", "Dr. Filip Andrei", "280", "Urgențe și transfer intern."),
    row("Sterilizare", "As. med. Toma Elena", "290", "Circuite curat și murdar."),
    row("Administrativ", "Ing. Bodea Mihai", "300", "Clădiri, utilități și pază.")
  ];
}
function seedGestTypes() {
  const item = (name, qty, unit) => ({ id: uid(), name, qty, unit, min: 10 });
  return [
    { id: "materiale", name: "Materiale", mode: "ward" },
    { id: "medicamente", name: "Medicamente", mode: "ward" },
    { id: "lenjerie", name: "Lenjerie", mode: "list", items: [item("Cearșaf", 80, "buc"), item("Față de pernă", 80, "buc"), item("Pijama pacient", 40, "buc"), item("Pătură", 30, "buc")] },
    { id: "dezinfectanti", name: "Dezinfectanți", mode: "list", items: [item("Clorhexidină", 12, "flacon"), item("Alcool 70°", 18, "flacon"), item("Dezinfectant suprafețe", 9, "bidon")] }
  ];
}
function navHtml() {
  const item = (act, id, label, ico, on) => `<button class="nav-item${on ? " active" : ""}" type="button" data-act="${act}" data-id="${esc(id || "")}">${icon(ico)}${esc(label)}</button>`;
  const head = (label, act, tip) => `<div class="nav-label">${label}<button class="nav-plus" type="button" data-act="${act}" title="${esc(tip)}">+</button></div>`;
  const wards = visibleWards().map(w => item("ward", w.id, w.name, "i-bed", false)).join("");
  const gest = (state.gestTypes || []).map(t => item("gest", t.id, t.name, "i-file", ui.page === "gest" && ui.gest === t.id)).join("");
  const people = Object.entries(staffSpec()).map(([id, meta]) => item("people", id, meta.label, "i-file", ui.page === "people" && ui.staffCat === id)).join("");
  const depts = (state.departments || []).map(d => item("dept", d.id, d.name, "i-grid", ui.page === "dept" && ui.deptId === d.id)).join("");
  return `
    <button class="brand" type="button" data-act="home"><div class="mark">Z</div><div><b>ZenAIos</b><span>Administrare</span></div></button>
    <div class="nav-scroll">
      <button class="nav-item zena-entry${ui.page === "ai-zena" ? " active" : ""}" type="button" data-act="ai-zena">${icon("i-mic")}AI Zena</button>
      ${head("Secții", "setup", "Adaugă sau configurează o secție")}
      ${wards}
      ${head("Gestiune", "gest-new", "Adaugă un tip de gestiune")}
      ${gest}
      <div class="nav-label">Personal</div>
      ${people}
      ${head("Departamente", "dept-new", "Adaugă un departament")}
      ${depts}
    </div>
    <div class="sidebar-foot">
      <button class="user user-btn${ui.page === "admin" ? " on" : ""}" type="button" data-act="admin" title="Configurare spital"><div class="avatar">${esc((ui.accountName || "DH").slice(0, 2).toUpperCase())}</div><div><b>${esc(ui.accountName || "Dr. Horea")}</b><span>${esc(ui.accountRole || "Administrator")}</span></div></button>
      <button class="linkish" type="button" data-act="ops-sync">Sincronizează structura</button>
      <button class="linkish" type="button" data-act="ops-lis">Trimite LIS</button>
      <button class="linkish" type="button" data-act="ops-backup">Copie de rezervă</button>
      <button class="linkish" type="button" data-act="panou">Panou tehnic</button>
      <button class="linkish" type="button" data-act="reset">Resetează demonstrația</button>
    </div>`;
}

function topHtml(title, crumb, action, back) {
  const today = new Date().toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long" });
  return `<header class="topbar">${back || ""}<div class="title"><h1>${esc(title)}</h1><div class="crumb">${esc(crumb)}</div></div>
    <div class="top-actions"><div class="context">${esc(today)}</div>${action || ""}</div></header>`;
}
function avg(list) { return list.length ? list.reduce((sum, n) => sum + Number(n), 0) / list.length : 0; }
function num(n) { return (Math.round(Number(n) * 10) / 10).toFixed(1).replace(".", ","); }
function inPeriod(iso) {
  if (!iso) return false;
  const period = ui.period || "azi";
  if (period === "azi") return iso.slice(0, 10) === todayKey();
  const diff = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (period === "sapt") return diff >= 0 && diff <= 7;
  if (period === "luna") return diff >= 0 && diff <= 31;
  return diff >= 0 && diff <= 366;
}
function periodBar() {
  const opts = [["azi", "Azi"], ["sapt", "7 zile"], ["luna", "Lună"], ["an", "An"]];
  return `<div class="chips">${opts.map(([id, label]) => `<button type="button" class="${(ui.period || "azi") === id ? "on" : ""}" data-act="period" data-id="${id}">${label}</button>`).join("")}</div>`;
}
function liveOcc(w) {
  if (typeof w.apiOccupied === "number" && bedCount(w)) {
    const open = Math.max(0, bedCount(w) - (w.closed || []).length);
    return open ? Math.round(w.apiOccupied / open * 100) : 0;
  }
  const open = Math.max(0, bedCount(w) - (w.closed || []).length);
  return open ? Math.round(occupied(w).length / open * 100) : 0;
}
function seriesOf(w, key) {
  const pack = wardPack(w);
  if (key === "occ") return pack.occS;
  if (key === "dms") return pack.dmsS;
  if (key === "icm") return pack.icmS;
  return pack.costS;
}
function seriesValue(w, key) {
  const series = seriesOf(w, key);
  const period = ui.period || "azi";
  if (period === "sapt") return avg(series.slice(-Math.min(7, series.length)));
  if (period === "an") return avg(series);
  return series[series.length - 1];
}
function fig(key, value) {
  if (key === "occ") return Math.round(value) + "%";
  if (key === "cost") {
    const sign = value > 0 ? "+" : "−";
    return sign + num(Math.abs(value)) + "%";
  }
  return num(value);
}
function horizon(w, key) {
  if ((ui.period || "azi") !== "azi") return seriesValue(w, key);
  const rows = occupied(w);
  if (key === "occ") return liveOcc(w);
  if (key === "dms") return rows.length ? avg(rows.map(p => stayDays(p.admitted))) : 0;
  if (key === "icm") return rows.length ? avg(rows.map(p => p.weight || 1)) : 0;
  return seriesValue(w, key);
}
function drillRow(main, sub, figure, hint, act, extra) {
  const attrs = act ? ` type="button" data-act="${act}" ${extra || ""}` : "";
  const tag = act ? "button" : "div";
  return `<${tag} class="drill-row"${attrs}><span class="name">${main}</span><span class="muted">${sub}</span><span class="drill-fig"><b>${figure}</b><i>${hint}</i></span></${tag}>`;
}
function bedsDrill() {
  const rows = visibleWards().map(w => {
    const free = freeCount(w);
    const where = typeof w.apiFree === "number"
      ? (free ? free + " libere din baza clinică" : "Niciun pat liber în baza clinică")
      : (freeBeds(w).length ? "Libere acum: " + freeBeds(w).map(pad).join(", ") : "Niciun pat liber acum");
    const closed = (w.closed || []).length;
    return drillRow(esc(w.name), `${where}${closed ? " · " + closed + " închise" : ""} · ${occCount(w)} ocupate din ${bedCount(w)}`, String(free), "libere", "ward", `data-id="${esc(w.id)}"`);
  }).join("");
  const total = visibleWards().reduce((n, w) => n + freeCount(w), 0);
  return `<section class="drill"><div class="drill-head"><div><h2>Paturi libere</h2><div class="muted">${total} libere acum. Intervalul schimbă media de ocupare, lista rămâne situația de azi.</div></div>${periodBar()}</div>${rows}</section>`;
}
function moveDrill(kind) {
  const label = { azi: "azi", sapt: "7 zile", luna: "lună", an: "an" }[ui.period || "azi"];
  const groups = state.wards.map(w => {
    const source = kind === "outs" ? w.discharged : w.patients.concat(w.discharged);
    const list = source.filter(p => inPeriod(kind === "outs" ? p.discharged : p.admitted));
    const head = drillRow(esc(w.name), list.length + (kind === "outs" ? " externări" : " internări"), String(list.length), label, "ward", `data-id="${esc(w.id)}"`);
    const body = list.map(p => {
      const letter = p.letter ? `<button class="btn btn-sm" type="button" data-act="open-letter" data-id="${esc(w.id)}" data-pid="${esc(p.id)}">Scrisoare</button>` : `<span class="muted">Internat</span>`;
      return `<div class="drill-sub"><span class="name">${esc(p.last)} ${esc(p.first)}</span><span>${esc(p.dx)}</span><span><button class="btn btn-sm" type="button" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}">Foaie</button> ${letter}</span></div>`;
    }).join("");
    return head + body;
  }).join("");
  const title = kind === "outs" ? "Externări" : "Internări";
  return `<section class="drill"><div class="drill-head"><div><h2>${title}</h2><div class="muted">Pe secții, în intervalul ales: nume, diagnostic, foaie și scrisoare.</div></div>${periodBar()}</div>${groups}</section>`;
}
function forecastDrill() {
  const groups = state.wards.map(w => {
    const list = w.patients.filter(p => p.status === "pregatit");
    const where = list.length ? "Se eliberează paturile " + list.map(p => pad(p.bed)).join(", ") : "Nicio externare pregătită";
    const head = drillRow(esc(w.name), where, String(list.length), "24 h");
    const body = list.map(p => `<button class="drill-sub" type="button" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}" data-tab="externare"><span class="name">${esc(p.last)} ${esc(p.first)}</span><span>${esc(p.dx)}</span><span class="drill-fig"><b>${pad(p.bed)}</b><i>pat</i></span></button>`).join("");
    const done = w.discharged.filter(p => inPeriod(p.discharged)).length;
    return head + body + `<div class="drill-sub"><span class="muted">Deja externate în interval</span><span></span><span class="drill-fig"><b>${done}</b><i>scrisori</i></span></div>`;
  }).join("");
  return `<section class="drill"><div class="drill-head"><div><h2>Externări posibile în 24 de ore</h2><div class="muted">Pacienții marcați pentru externare. Patul se eliberează odată cu scrisoarea.</div></div>${periodBar()}</div>${groups}</section>`;
}
function mixRows(w, key) {
  const rows = occupied(w);
  const docs = [...new Set(rows.map(p => p.physician))];
  const docHtml = docs.map(name => {
    const list = rows.filter(p => p.physician === name);
    const value = key === "dms" ? avg(list.map(p => stayDays(p.admitted))) : avg(list.map(p => p.weight || 1));
    return `<div class="drill-sub"><span>${esc(name)}</span><span class="muted">${list.length} foi deschise</span><span class="drill-fig"><b>${num(value)}</b><i>medic</i></span></div>`;
  }).join("");
  const foaie = rows.map(p => `<button class="drill-sub" type="button" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}"><span class="name">${esc(p.last)} ${esc(p.first)}</span><span class="muted">${esc(p.dxCode || p.dx)} · ${esc(p.physician)}</span><span class="drill-fig"><b>${key === "dms" ? stayDays(p.admitted) : num(p.weight || 1)}</b><i>foaie</i></span></button>`).join("");
  return docHtml + foaie;
}
function indexDrill(key) {
  const titles = { occ: "Grad de ocupare", dms: "DMS", icm: "ICM", cost: "Costuri / venituri" };
  const blocks = state.wards.map(w => {
    let figure, hint, sub, extra = "";
    if (key === "occ") {
      figure = liveOcc(w) + "%";
      hint = "azi";
      sub = `Ocupați ${occupied(w).length} · libere ${freeBeds(w).length} · media interval ${fig("occ", seriesValue(w, "occ"))}`;
    } else if (key === "cost") {
      figure = fig("cost", seriesValue(w, "cost"));
      hint = "interval";
      sub = wardPack(w).costRead;
    } else {
      figure = fig(key, horizon(w, key));
      hint = key === "dms" ? "zile" : "index";
      sub = key === "dms" ? "Pe medic și pe foaie, mai jos" : "Complexitate pe medic și pe foaie, mai jos";
      extra = mixRows(w, key);
    }
    return drillRow(esc(w.name), sub, figure, hint, "ward", `data-id="${esc(w.id)}"`) + extra;
  }).join("");
  const note = key === "occ" ? "Fiecare secție, de sus în jos. Cifra din dreapta este ocuparea de azi." : "Fiecare secție, apoi medicul, apoi foaia pacientului.";
  return `<section class="drill"><div class="drill-head"><div><h2>${titles[key]}</h2><div class="muted">${note}</div></div>${periodBar()}</div>${blocks}</section>`;
}
function drillHtml() {
  if (ui.drill === "beds") return bedsDrill();
  if (ui.drill === "admits") return moveDrill("admits");
  if (ui.drill === "outs") return moveDrill("outs");
  if (ui.drill === "forecast") return forecastDrill();
  if (["occ", "dms", "icm", "cost"].includes(ui.drill)) return indexDrill(ui.drill);
  return "";
}
function pageHome() {
  const today = todayKey();
  const wards = visibleWards();
  const free = wards.reduce((n, w) => n + freeCount(w), 0);
  const admits = wards.reduce((n, w) => n + w.patients.concat(w.discharged).filter(p => (p.admitted || "").slice(0, 10) === today).length, 0);
  const outs = wards.reduce((n, w) => n + w.discharged.filter(p => (p.discharged || "").slice(0, 10) === today).length, 0);
  const soon = wards.reduce((n, w) => n + w.patients.filter(p => p.status === "pregatit").length, 0);
  const btn = (id, label, value, sub) => `<button class="stat${ui.drill === id ? " on" : ""}" type="button" data-act="drill" data-id="${id}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="muted">${sub}</div></button>`;
  const cards = wards.map(w => {
    const n = bedCount(w);
    const cells = Array.from({ length: Math.min(n, 40) }, (_, i) => {
      const p = onBed(w, i + 1);
      const cls = isClosed(w, i + 1) ? "closed" : !p ? "" : p.status === "critic" ? "critic" : p.status === "pregatit" ? "ready" : "occ";
      return `<i class="${cls}"></i>`;
    }).join("");
    const liveTag = w.apiId ? " · API" : "";
    return `<button class="ward-card" type="button" data-act="ward" data-id="${esc(w.id)}">
      <h2>${esc(w.name)}</h2>
      <div class="muted">${esc(w.chief)} · garda ${esc(dutyName(w, "medic"))} · ${occCount(w)}/${n} paturi${liveTag}</div>
      <div class="mini">${cells}</div>
      <div class="muted">${freeCount(w)} libere · ${w.patients.filter(p => p.status === "pregatit").length} de externat în 24 h · ${w.discharged.length} scrisori</div>
    </button>`;
  }).join("");
  const topDrill = ["beds", "admits", "outs", "forecast"].includes(ui.drill) ? drillHtml() : "";
  const midDrill = ["occ", "dms", "icm", "cost"].includes(ui.drill) ? drillHtml() : "";
  const scopeNote = ui.hospitalWideAccess === false
    ? ` Domeniu: ${ui.wardScopeIds?.length || 0} secții.`
    : (live ? " Acces pe tot spitalul." : "");
  return topHtml("Situație spital", "ZenAIos · Spital", "") + `<div class="content">
    <p class="lead">Deschideți un card. Situația coboară pe secții. La DMS și ICM ajunge până la medic și la foaia pacientului.${scopeNote}</p>
    <div class="stats">
      ${btn("beds", "Paturi libere", free, "pe ce secție sunt")}
      ${btn("admits", "Internări azi", admits, "interval: zi, săptămână, lună, an")}
      ${btn("outs", "Externări", outs, "nume, diagnostic, scrisoare, foaie")}
      ${btn("forecast", "În 24 de ore", soon, "paturi care se eliberează")}
    </div>
    ${topDrill}
    ${hospitalGauges()}
    ${midDrill}
    <div class="wards">${cards}</div>
  </div>`;
}

const WARD_KPI = {
  cardio: { occ: "91%", dms: "6,2", icm: "2,4", cost: "−8%", occP: 91, dmsP: 62, icmP: 80, costP: 8, occRead: "În parametrii optimi", dmsRead: "Ușor peste țintă", icmRead: "În parametrii optimi", costRead: "Balanță negativă", occS: [86,88,87,90,89,91,92,90,93,91,90,92,94,91], dmsS: [5.4,5.5,5.6,5.7,5.9,6.0,6.1,6.2], icmS: [2.1,2.15,2.2,2.25,2.3,2.4], costS: [-5,-5,-6,-6,-7,-8] },
  chir: { occ: "86%", dms: "7,4", icm: "2,3", cost: "−18%", occP: 86, dmsP: 74, icmP: 76, costP: 18, occRead: "În parametrii optimi", dmsRead: "Crescută cu 1,5%", icmRead: "În parametrii optimi", costRead: "Alertă financiară", occS: [90,88,87,85,84,86,83,85,87,86,84,85,86,86], dmsS: [6.4,6.6,6.8,6.9,7.0,7.2,7.3,7.4], icmS: [2.0,2.1,2.15,2.2,2.25,2.3], costS: [-12,-13,-14,-15,-16,-18] },
  med: { occ: "84%", dms: "6,5", icm: "1,9", cost: "−10%", occP: 84, dmsP: 65, icmP: 63, costP: 10, occRead: "În parametrii optimi", dmsRead: "Ușor peste țintă", icmRead: "În parametrii optimi", costRead: "Balanță negativă", occS: [80,82,81,83,84,82,85,83,84,86,84,83,85,84], dmsS: [5.8,5.9,6.0,6.1,6.2,6.3,6.4,6.5], icmS: [1.7,1.75,1.8,1.85,1.9,1.9], costS: [-7,-8,-8,-9,-9,-10] }
};
function kpiLines(key) {
  return state.wards.filter(w => WARD_KPI[w.id]).map(w => `<div class="sec">${esc(w.name)} <b>${WARD_KPI[w.id][key]}</b></div>`).join("");
}
function hospitalGauges() {
  const item = (id, tone, pct, value, title, hint, read) => `<button class="gauge ${tone}${ui.drill === id ? " on" : ""}" type="button" data-act="drill" data-id="${id}">
      <div class="donut ${tone}" style="--p:${pct}"><b>${value}</b></div>
      <div><h2>${title}</h2><div class="muted">${hint}</div><div class="read ${tone}">${read}</div></div>
    </button>`;
  return `<div class="block-label">Indicatori principali</div><div class="gauges">
    ${item("occ", "ok", 87, "87%", "Grad de ocupare", "Spital · deschideți secțiile", "În parametrii optimi")}
    ${item("dms", "warn", 67, "6,7", "DMS", "Pe secție, pe medic, pe foaie", "Crescută cu 1,5%")}
    ${item("icm", "ok", 73, "2,2", "ICM", "Complexitatea cazului", "În parametrii optimi")}
    ${item("cost", "bad", 12, "−12%", "Costuri / venituri", "Pe secție", "Balanță negativă · alertă financiară")}
  </div>`;
}

function bedHtml(w, bedNo) {
  const local = localPat(bedNo);
  const head = `<span class="patline"><span class="patno">Pat ${local}</span><span class="no">${pad(bedNo)}</span></span>`;
  if (isClosed(w, bedNo)) return `<div class="bed dim">${head}<span class="who">Închis</span><span class="meta">Din administrare</span></div>`;
  const p = onBed(w, bedNo);
  if (!p) return `<button class="bed" type="button" data-act="bed" data-bed="${bedNo}">${head}<span class="who">Liber</span><span class="meta">Internare</span></button>`;
  if (ui.doctor && boardDoctor(w, p) !== ui.doctor) return `<div class="bed dim">${head}<span class="who">Alt medic</span></div>`;
  const visible = matches(p);
  return `<button class="bed occ${visible ? "" : " dim"}" type="button" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}">${head}<span class="who">${esc(p.last)} ${esc(p.first)}</span><span class="meta">${esc(p.dxCode)} · ${esc(boardDoctor(w, p))}</span></button>`;
}
function clinicActions() {
  const b = (id, label) => `<button class="btn${ui.view === id ? " on" : ""}" type="button" data-act="view" data-id="${id}">${label}</button>`;
  return `${b("saloane", "Saloane")}${b("magazie", "Magazie")}${b("statistica", "Statistică")}<button class="btn btn-primary" type="button" data-act="admit">Internare</button>`;
}
function rosterCards(w) {
  const all = occupied(w);
  const toti = `<button type="button" class="doc-card${!ui.doctor ? " on" : ""}" data-act="doctor" data-id=""><span class="doc-dot"></span><span class="doc-copy"><b>Toți</b><span>Pacienți internați</span></span><span class="doc-n">${all.length}</span></button>`;
  const docs = dutyRoster(w).map((name) => {
    const n = all.filter(p => boardDoctor(w, p) === name).length;
    const label = n === 1 ? "1 pacient" : n + " pacienți";
    return `<button type="button" class="doc-card${ui.doctor === name ? " on" : ""}" data-act="doctor" data-id="${esc(name)}"><span class="doc-dot" style="background:${doctorColor(w, name)}"></span><span class="doc-copy"><b>${esc(name)}</b><span>${label}</span></span><span class="doc-n">${n}</span></button>`;
  }).join("");
  return `<div class="doc-row">${toti}${docs}</div>`;
}
function boardHead(w) {
  const today = new Date().toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long" });
  const back = `<button class="back" type="button" data-act="home" title="Înapoi la situație">←</button>`;
  return `<header class="topbar board">
    <div class="board-line">${back}<div class="title"><h1>${esc(w.name)}</h1></div>
      <div class="search"><input id="ward-q" type="text" placeholder="Nume, prenume, pat, vârstă, CNP" value="${esc(ui.query)}" aria-label="Caută"></div>
      <div class="top-actions"><div class="context">${esc(today)}</div>${clinicActions()}</div>
    </div>
  </header>`;
}
function pageWard() {
  const w = ward();
  const view = ui.view === "magazie" || ui.view === "statistica" || ui.view === "saloane" ? ui.view : "paturi";
  const back = `<button class="back" type="button" data-act="home" title="Înapoi la situație">←</button>`;
  if (view === "paturi" || view === "saloane") {
    const body = view === "saloane" ? saloaneHtml(w) : paturiHtml(w);
    return boardHead(w) + `<div class="content ward-canvas">${body}</div>`;
  }
  const body = view === "statistica" ? statisticaHtml(w) : magazieHtml(w);
  return topHtml(w.name, "Secție · " + w.name, clinicActions(), back) + `<div class="content">${body}</div>`;
}
function periodLabels(count, unit) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date();
    if (unit === "month") {
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      out.push(d.toLocaleDateString("ro-RO", { month: "short" }));
    } else {
      d.setDate(d.getDate() - (unit === "week" ? i * 7 : i));
      out.push(d.toLocaleDateString("ro-RO", { day: "numeric", month: "short" }));
    }
  }
  return out;
}
function chartPts(values, w, h, pad) {
  let min = Math.min(...values), max = Math.max(...values);
  const slack = (max - min) * 0.35 || Math.abs(max) * 0.15 || 1;
  min -= slack;
  max += slack;
  const span = max - min || 1;
  return values.map((v, i) => {
    const x = pad + (values.length < 2 ? 0 : i * (w - pad * 2) / (values.length - 1));
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
}
function areaChart(values, color, labels) {
  const w = 360, h = 132, pad = 12;
  const pts = chartPts(values, w, h, pad);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L${pts[0][0].toFixed(1)} ${h - pad} Z`;
  const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.4" fill="${color}"/>`).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img"><path d="${area}" fill="${color}" opacity="0.22"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}</svg><div class="chart-x"><span>${esc(labels[0])}</span><span>${esc(labels[Math.floor((labels.length - 1) / 2)])}</span><span>${esc(labels[labels.length - 1])}</span></div>`;
}
function wardKpiFrame(w) {
  const k = wardPack(w);
  const cell = (tone, pct, value, label) => `<span class="kpi-cell ${tone}"><span class="donut sm ${tone}" style="--p:${pct}"><b>${esc(value)}</b></span><em>${label}</em></span>`;
  return `<div class="ward-kpis">${cell("ok", k.occP, k.occ, "Ocupare")}${cell("warn", k.dmsP, k.dms, "DMS")}${cell("ok", k.icmP, k.icm, "ICM")}${cell("bad", k.costP, k.cost, "Cost")}</div>`;
}
function wardPack(w) {
  if (WARD_KPI[w.id]) return WARD_KPI[w.id];
  const pct = Math.round((occupied(w).length / BEDS) * 100);
  return { occ: pct + "%", dms: "5,4", icm: "1,2", cost: "−4%", occP: pct, dmsP: 54, icmP: 40, costP: 4, occRead: "Secție nouă", dmsRead: "Fără istoric", icmRead: "Fără istoric", costRead: "Fără istoric", occS: Array(14).fill(pct), dmsS: Array(8).fill(5.4), icmS: Array(6).fill(1.2), costS: Array(6).fill(-4) };
}
function magazieHtml(w) {
  const q = (ui.magQuery || "").trim().toLowerCase();
  const groups = [...new Set((w.meds || []).map(m => m.group))];
  const classes = groups.concat(["Materiale"]);
  const current = classes.includes(ui.magClass) ? ui.magClass : classes[0];
  ui.magClass = current;
  const menu = `<nav class="mag-menu">${classes.map(name => `<button type="button" class="${name === current ? "on" : ""}" data-act="mag-class" data-id="${esc(name)}">${esc(name)}</button>`).join("")}</nav>`;
  if (current === "Materiale") {
    const mats = (w.stock || []).filter(s => s.name.toLowerCase().includes(q)).map(s => `<tr class="${s.qty < s.min ? "low" : ""}"><td class="name">${esc(s.name)}</td><td class="mono">${s.qty}</td><td>${esc(s.unit)}</td><td>${s.qty < s.min ? `<span class="danger">Sub prag</span>` : `<span class="muted">În regulă</span>`}</td></tr>`).join("");
    return `${menu}<p class="lead">Clasa aleasă stă singură pe ecran. Stocul scade când materialul se trece pe pacient.</p>
      <div class="search" style="max-width:420px;margin-bottom:12px"><input id="mag-q" type="text" placeholder="Caută în clasă" value="${esc(ui.magQuery || "")}" aria-label="Caută în magazie"></div>
      <div class="card"><div class="card-head"><h2>Materiale</h2><button class="btn btn-sm" type="button" data-act="apply-kit">Descarcă kitul pe pacienți</button></div><div class="card-body tight"><table><thead><tr><th>Material</th><th>Stoc</th><th>UM</th><th></th></tr></thead><tbody>${mats || `<tr><td colspan="4" class="muted" style="padding:16px">Nimic în această clasă.</td></tr>`}</tbody></table></div></div>`;
  }
  const rows = (w.meds || []).filter(m => m.group === current && `${m.name} ${m.dose}`.toLowerCase().includes(q)).map(m => `<tr class="${m.qty < m.min ? "low" : ""}"><td class="name">${esc(m.name)}</td><td>${esc(m.dose)}</td><td class="mono">${m.qty}</td><td>${esc(m.unit)}</td><td>${m.qty < m.min ? `<span class="danger">Sub prag</span>` : `<span class="muted">În regulă</span>`}</td></tr>`).join("");
  return `${menu}<p class="lead">Clasa aleasă stă singură pe ecran. Stocul scade când medicamentul se trece pe pacient.</p>
    <div class="search" style="max-width:420px;margin-bottom:12px"><input id="mag-q" type="text" placeholder="Caută în clasă" value="${esc(ui.magQuery || "")}" aria-label="Caută în magazie"></div>
    <div class="card"><div class="card-head"><h2>${esc(current)}</h2></div><div class="card-body tight"><table><thead><tr><th>Medicament</th><th>Dozaj</th><th>Stoc</th><th>UM</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="muted" style="padding:16px">Nimic în această clasă.</td></tr>`}</tbody></table></div></div>`;
}
function caseMixHtml(w) {
  const rows = occupied(w);
  const docs = [...new Set(rows.map(p => p.physician))];
  const docRows = docs.map(name => {
    const list = rows.filter(p => p.physician === name);
    return `<tr><td class="name">${esc(name)}</td><td class="mono">${list.length}</td><td class="mono">${num(avg(list.map(p => stayDays(p.admitted))))}</td><td class="mono">${num(avg(list.map(p => p.weight || 1)))}</td></tr>`;
  }).join("");
  const foaie = rows.map(p => `<tr class="click" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}"><td class="mono">${pad(p.bed)}</td><td class="name">${esc(p.last)} ${esc(p.first)}</td><td>${esc(p.physician)}</td><td class="mono">${stayDays(p.admitted)}</td><td class="mono">${num(p.weight || 1)}</td></tr>`).join("");
  return `<div class="charts" style="margin-bottom:12px">
    <div class="card"><div class="card-head"><h2>DMS și ICM pe medici</h2></div><div class="card-body tight"><table><thead><tr><th>Medic</th><th>Foi</th><th>DMS</th><th>ICM</th></tr></thead><tbody>${docRows}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>DMS și ICM pe foi</h2></div><div class="card-body tight"><table><thead><tr><th>Pat</th><th>Pacient</th><th>Medic</th><th>Zile</th><th>ICM</th></tr></thead><tbody>${foaie}</tbody></table></div></div>
  </div>`;
}
function statisticaHtml(w) {
  const k = wardPack(w);
  const present = occupied(w).length;
  const month = todayKey().slice(0, 7);
  const all = w.patients.concat(w.discharged);
  const admits = all.filter(p => (p.admitted || "").slice(0, 7) === month).length;
  const outs = w.discharged.filter(p => (p.discharged || "").slice(0, 7) === month).length;
  const urgent = all.filter(p => p.type === "Urgență").length;
  const planned = all.filter(p => p.type === "Programată").length;
  const denom = urgent + planned || 1;
  const studies = all.flatMap(p => p.studies || []);
  const finalS = studies.filter(s => s.status === "finalizat");
  const openS = studies.filter(s => s.status !== "finalizat");
  const flags = finalS.filter(s => s.kind === "analize").flatMap(s => s.rows || []);
  const abnormal = flags.filter(r => r.flag).length;
  const normal = flags.filter(r => !r.flag).length;
  const medsUsed = all.reduce((n, p) => n + (p.meds || []).reduce((a, m) => a + Number(m.qty || 0), 0), 0);
  const matsUsed = all.reduce((n, p) => n + (p.supplies || []).reduce((a, m) => a + Number(m.qty || 0), 0), 0);
  const low = lowStock(w).length + (w.meds || []).filter(m => m.qty < m.min).length;
  const allergies = w.patients.filter(p => p.allergies && p.allergies !== "Nu se cunosc").length;
  const readyN = w.patients.filter(p => p.status === "pregatit").length;
  const crit = w.patients.filter(p => p.status === "critic").length;
  const days = all.reduce((n, p) => n + stayDays(p.admitted), 0);
  const iup = (k.occP || 80) - 3;
  const tiles = [
    ["Internări lună", admits], ["Externări lună", outs], ["Prezenți", present], ["Ocupare lunară", k.occ || "—"],
    ["DMS", k.dms || "—"], ["ICM", k.icm || "—"], ["IUP", iup + "%"], ["Urgențe", Math.round(urgent / denom * 100) + "%"],
    ["Programate", Math.round(planned / denom * 100) + "%"], ["Critici", crit], ["Reinternări 30 zile", 4], ["Zile spitalizare", days],
    ["Scrisori", w.discharged.length], ["În lucru", openS.length], ["Buletine finalizate", finalS.filter(s => s.kind === "analize").length],
    ["Analize anormale", abnormal], ["Analize în limite", normal], ["RX", finalS.filter(s => s.kind === "rx").length],
    ["CT", finalS.filter(s => s.kind === "ct").length], ["RMN", finalS.filter(s => s.kind === "rmn").length],
    ["Medicamente descărcate", medsUsed], ["Materiale descărcate", matsUsed], ["Stocuri sub prag", low],
    ["Paturi libere", freeBeds(w).length], ["Paturi închise", (w.closed || []).length], ["Ore până la rezultat", "6,4"],
    ["Cu alergii", allergies], ["De externat", readyN], ["Rapoarte nepredate", openS.length], ["Rapoarte emise", finalS.length + w.discharged.length]
  ];
  const extra = { cardio: [["I25.1","Boală ischemică cronică"],["I10","Hipertensiune esențială"],["I47.1","Tahicardie supraventriculară"],["I35.0","Stenoză aortică"]], surg: [["K81.0","Colecistită acută"],["K43.9","Hernie ventrală"],["K61.0","Abces anal"],["L03.1","Celulită de membru"]], med: [["J96.0","Insuficiență respiratorie acută"],["E87.6","Hipopotasemie"],["N39.0","Infecție urinară"],["I10","Hipertensiune"]], general: [["Z00.0","Evaluare"],["R50.9","Febră"],["R10.4","Durere abdominală"],["R07.4","Durere toracică"]] };
  const secPool = [["I10","Hipertensiune"],["E11.9","Diabet zaharat tip 2"],["E78.5","Hiperlipidemie"],["N18.3","Boală cronică de rinichi"],["J44.9","BPOC"],["I48.9","Fibrilație atrială"],["E87.6","Hipopotasemie"],["D64.9","Anemie"],["K21.0","Boală de reflux"],["I25.9","Boală ischemică cronică"]];
  const base = (DX[w.focus] || DX.general).concat(extra[w.focus] || extra.general);
  const countLive = (list, pick) => {
    const map = new Map(list.map((p, i) => [p[0] + " " + p[1], 22 - i * 2]));
    all.forEach(p => { const key = pick(p); if (key) map.set(key, (map.get(key) || 8) + 1); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  };
  const table = (title, rows) => `<div class="card"><div class="card-head"><h2>${title}</h2></div><div class="card-body tight"><table><thead><tr><th>Denumire</th><th>Nr.</th></tr></thead><tbody>${rows.map(([name, n]) => `<tr><td>${esc(name)}</td><td class="mono">${n}</td></tr>`).join("")}</tbody></table></div></div>`;
  const named = (arr) => arr.map((name, i) => [name, 30 - i * 2]);
  const gauge = (tone, pct, value, title, hint, read) => `<article class="gauge ${tone}"><div class="donut ${tone}" style="--p:${pct}"><b>${esc(value)}</b></div><div><h2>${title}</h2><div class="muted">${hint}</div><div class="read ${tone}">${read}</div></div></article>`;
  const chart = (title, sub, svg) => `<article class="card chart-card"><h2>${title}</h2><div class="muted">${sub}</div>${svg}</article>`;
  return `<p class="lead">Aceeași statistică este vizibilă pentru medic și asistentă. Cifrele de lună stau lângă activitatea deja înregistrată pe secție.</p>
    <div class="stat-grid">${tiles.map(([label, value]) => `<article class="stat"><div class="stat-label">${label}</div><div class="stat-value">${esc(value)}</div></article>`).join("")}</div>
    <div class="gauges">
      ${gauge("ok", k.occP, k.occ, "Grad de ocupare", "Luna curentă", k.occRead)}
      ${gauge("warn", k.dmsP, k.dms, "DMS", "Zile", k.dmsRead)}
      ${gauge("ok", k.icmP, k.icm, "ICM", "Case-mix", k.icmRead)}
      ${gauge("bad", k.costP, k.cost, "Costuri / venituri", "Raport", k.costRead)}
    </div>
    ${caseMixHtml(w)}
    <div class="charts" style="margin-bottom:12px">
      ${table("Primele 10 diagnostice principale", countLive(base, p => p.dx))}
      ${table("Primele 10 diagnostice secundare", countLive(secPool, () => ""))}
      ${table("Top analize", named(CATALOG.analize.slice(0, 10)))}
      ${table("Top RX", named(CATALOG.rx))}
      ${table("Top CT", named(CATALOG.ct))}
      ${table("Top RMN", named(CATALOG.rmn))}
    </div>
    <div class="charts">
      ${chart("Ocupare zilnică", "Ultimele 14 zile", areaChart(k.occS, "#8fbf9c", periodLabels(14, "day")))}
      ${chart("DMS săptămânal", "Ultimele 8 săptămâni", areaChart(k.dmsS, "#e4c56a", periodLabels(8, "week")))}
      ${chart("ICM lunar", "Ultimele 6 luni", areaChart(k.icmS, "#7eb0d4", periodLabels(6, "month")))}
      ${chart("Costuri / venituri", "Balanță lunară", areaChart(k.costS, "#e8b4b4", periodLabels(6, "month")))}
    </div>`;
}
function panouHtml(w) {
  const occ = occupied(w);
  const missing = occ.filter(p => !notedToday(p));
  const ready = occ.filter(p => p.status === "pregatit").length;
  const crit = occ.filter(p => p.status === "critic").length;
  const low = lowStock(w);
  const gaps = kitGap(w);
  const stale = w.duty && w.duty.date !== todayKey();
  const roles = ["medic", "asistenta", "infirmiera", "brancardier"].map(role => `<article class="duty-card"><div class="role">${dutyLabel(role)}</div><div class="who">${esc(dutyName(w, role))}</div></article>`).join("");
  const rows = missing.sort((a, b) => a.bed - b.bed).map(p => `<tr class="click" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}" data-tab="evolutie"><td class="mono">${pad(p.bed)}</td><td class="name">${esc(p.last)} ${esc(p.first)}</td><td>${vitalToday(p) ? "Înregistrate" : `<span class="danger">Lipsesc</span>`}</td><td><span class="badge warn">De scris</span></td></tr>`).join("");
  const alerts = [];
  if (stale) alerts.push(`<div class="msg">Garda salvată este din ${esc(fmtDay(w.duty.date))}. Confirmați tura de azi.</div>`);
  if (crit) alerts.push(`<div class="msg err">${crit} ${crit === 1 ? "pacient necesită" : "pacienți necesită"} supraveghere apropiată.</div>`);
  if (gaps.length) alerts.push(`<div class="msg">Kitul de tură nu poate fi descărcat. ${esc(gaps.join(" · "))}</div>`);
  return `${alerts.join("")}
    <div class="stats">
      <article class="stat"><div class="stat-label">Paturi ocupate</div><div class="stat-value">${occ.length}</div><div class="muted">${freeBeds(w).length} libere</div></article>
      <article class="stat${missing.length ? " attention" : ""}"><div class="stat-label">Fără evoluție azi</div><div class="stat-value">${missing.length}</div><div class="muted">din ${occ.length} internați</div></article>
      <article class="stat"><div class="stat-label">De externat</div><div class="stat-value">${ready}</div><div class="muted">${pendingCount(w)} investigații în lucru</div></article>
      <article class="stat${low.length ? " attention" : ""}"><div class="stat-label">Materiale sub prag</div><div class="stat-value">${low.length}</div><div class="muted">${low.length ? esc(low.map(s => s.name).join(", ")) : "gestiune în regulă"}</div></article>
    </div>
    <div class="duty">${roles}</div>
    <div class="card"><div class="card-head"><h2>De scris în tura de azi</h2><span class="sub">${missing.length ? "deschide foaia pe Evoluție" : "completați"}</span></div><div class="card-body tight"><table><thead><tr><th>Pat</th><th>Pacient</th><th>Constante azi</th><th>Evoluție</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="muted" style="padding:16px">Toți pacienții internați au evoluție în ziua de azi.</td></tr>`}</tbody></table></div></div>`;
}
function sheetBtn(w, p) {
  return `<button class="btn btn-sheet" type="button" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}">Vezi foaia</button>`;
}
function placeOf(p) {
  const bedNo = p.bed || p.formerBed;
  if (!bedNo) return "—";
  return `S${Math.ceil(bedNo / 4)} P${localPat(bedNo)}`;
}
function orBtn(w, p) {
  const n = orRoomOf(p);
  const sub = p.status === "decedat" || p.status === "transferat" ? `<div class="or-sub">${esc(statusLabel(p.status))}</div>` : "";
  return `<button class="btn btn-or" type="button" data-act="protocol" data-id="${esc(w.id)}" data-pid="${esc(p.id)}">Sala ${n}</button>${sub}`;
}
function listRow(w, p) {
  const doc = boardDoctor(w, p);
  const surg = isSurg(w);
  const mark = (p.status === "decedat" || p.status === "transferat" || p.status === "externat")
    ? (p.status === "decedat" ? `<span class="danger">Decedat</span>` : p.status === "transferat" ? `<span class="badge">Transferat</span>` : `<span class="badge ok">Externat</span>`)
    : signal(p);
  const flag = surg ? `<td class="or-cell">${orBtn(w, p)}</td>` : `<td class="signal-cell">${mark}</td>`;
  const name = `${esc(p.last)} ${esc(p.first)}${surg && p.status === "critic" ? " " + badge("critic") : ""}`;
  return `<tr class="click" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}"><td class="mono"><span class="salon-cell"><i class="doc-dot sm" style="background:${doctorColor(w, doc)}"></i>${placeOf(p)}</span></td><td class="name">${name}</td><td>${esc(doc)}</td><td>${ageOf(p.birth)}</td><td class="clip">${esc(p.dx)}</td><td>${stayDays(p.admitted)}</td><td>${p.discharged ? esc(fmtDay(p.discharged)) : (notedToday(p) ? "Azi" : `<span class="danger">Lipsește</span>`)}</td>${flag}<td class="sheet-cell">${sheetBtn(w, p)}</td></tr>`;
}
function patientTable(w, title, sub, people) {
  const rows = people.map(p => listRow(w, p)).join("");
  const flagHead = isSurg(w) ? `<th class="or-col">Sala de operație</th>` : `<th>Semnal</th>`;
  return `<div class="card" style="margin-bottom:12px"><div class="card-head"><h2>${title}</h2><span class="sub">${sub}</span></div><div class="card-body tight"><table class="plist"><thead><tr><th>Salon</th><th>Pacient</th><th>Medic</th><th>Vârstă</th><th>Diagnostic la internare</th><th>Zile</th><th>Evoluție</th>${flagHead}<th class="sheet-col"></th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="muted" style="padding:16px">Niciun pacient pentru filtrul curent.</td></tr>`}</tbody></table></div></div>`;
}
function inSheetRange(iso) {
  const day = (iso || "").slice(0, 10);
  if (!ui.rangeFrom && !ui.rangeTo) return true;
  if (!day) return false;
  if (ui.rangeFrom && day < ui.rangeFrom) return false;
  if (ui.rangeTo && day > ui.rangeTo) return false;
  return true;
}
function sheetPager(count) {
  const nums = Array.from({ length: count }, (_, i) => `<button type="button" class="pg${ui.sheetPage === i ? " on" : ""}" data-act="sheet-page" data-id="${i}">${i + 1}</button>`).join("");
  const span = ui.rangeFrom ? (ui.rangeTo && ui.rangeTo !== ui.rangeFrom ? `${ui.rangeFrom.slice(8)}–${ui.rangeTo.slice(8)}` : ui.rangeFrom.slice(8) + "." + ui.rangeFrom.slice(5, 7)) : "Interval";
  return `<div class="hpages">${nums}<button type="button" class="pg cal${ui.calOpen ? " on" : ""}" data-act="cal-toggle">${esc(span)}</button>${ui.calOpen ? calendarHtml() : ""}</div>`;
}
function calendarHtml() {
  const now = new Date();
  const key = ui.calMonth || `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const [y, m] = key.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const padDays = (first.getDay() + 6) % 7;
  const total = new Date(y, m, 0).getDate();
  const name = first.toLocaleDateString("ro-RO", { month: "long", year: "numeric" });
  let cells = "";
  for (let i = 0; i < padDays; i++) cells += `<span></span>`;
  for (let d = 1; d <= total; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const on = iso === ui.rangeFrom || iso === ui.rangeTo;
    const mid = ui.rangeFrom && ui.rangeTo && iso > ui.rangeFrom && iso < ui.rangeTo;
    cells += `<button type="button" class="${on ? "on" : mid ? "mid" : ""}" data-act="cal-day" data-id="${iso}">${d}</button>`;
  }
  const heads = ["L", "Ma", "Mi", "J", "V", "S", "D"].map(d => `<span>${d}</span>`).join("");
  return `<div class="cal-pop"><div class="cal-nav"><button type="button" data-act="cal-shift" data-id="-1" aria-label="Luna anterioară">‹</button><b>${esc(name)}</b><button type="button" data-act="cal-shift" data-id="1" aria-label="Luna următoare">›</button></div><div class="cal-grid">${heads}${cells}</div><button class="linkish" type="button" data-act="cal-clear">Șterge intervalul</button></div>`;
}
function paturiHtml(w) {
  const who = ui.doctor ? " · " + esc(ui.doctor) : "";
  const mine = occupied(w).filter(matches).filter(p => inSheetRange(p.admitted)).sort((a, b) => a.bed - b.bed);
  const recent = (w.discharged || []).filter(p => p.archive && p.status === "externat" && p.archiveGroup === "recent").filter(matches).filter(p => inSheetRange(p.discharged));
  const rest = (w.discharged || []).filter(p => p.archive && p.archiveGroup !== "recent").filter(matches).filter(p => inSheetRange(p.discharged));
  const all = mine.concat(recent, rest);
  const size = 10;
  const count = Math.max(1, Math.ceil(all.length / size));
  if (ui.sheetPage >= count) ui.sheetPage = 0;
  const start = ui.sheetPage * size;
  const slice = all.slice(start, start + size);
  const onWard = slice.filter(p => p.bed).length;
  const title = !slice.length ? "Pacienți" : onWard === slice.length ? "Pacienți internați" : onWard === 0 ? "Externări și istoric" : "Pacienți";
  const sub = all.length ? `${start + 1}–${start + slice.length} din ${all.length}${who}` : "Niciun pacient pentru filtrul curent";
  return `${rosterCards(w)}
    ${patientTable(w, title, sub, slice)}
    ${sheetPager(count)}`;
}
function saloaneHtml(w) {
  const n = bedCount(w);
  const count = Math.ceil(n / 4);
  const rooms = Array.from({ length: count }, (_, s) => {
    const beds = [];
    for (let b = 1; b <= 4; b++) {
      const no = s * 4 + b;
      if (no <= n) beds.push(bedHtml(w, no));
    }
    return `<section class="salon tone-${s % 5}"><h2>Salon ${s + 1}<span>pat 1–${beds.length}</span></h2><div class="salon-beds">${beds.join("")}</div></section>`;
  }).join("");
  return `${rosterCards(w)}<p class="lead">Saloane de câte patru paturi. Patul 1 este primul loc din salon.</p>${rooms}`;
}
function gardaHtml(w) {
  const roles = ["medic", "asistenta", "infirmiera", "brancardier"];
  const fields = roles.map(role => {
    const current = dutyName(w, role) === "—" ? "" : dutyName(w, role);
    const names = (w.staff || []).filter(s => s.role === role).map(s => s.name);
    if (current && !names.includes(current)) names.unshift(current);
    const opts = names.map(n => `<option${n === current ? " selected" : ""}>${esc(n)}</option>`).join("") || `<option value="">Niciun angajat</option>`;
    return `<div><label class="lbl" for="duty-${role}">${dutyLabel(role)}</label><select id="duty-${role}">${opts}</select></div>`;
  }).join("");
  const people = (w.staff || []).map(s => `<tr><td class="name">${esc(s.name)}</td><td>${esc(roleLabel(s.role))}</td><td><button class="btn btn-sm" type="button" data-act="del-staff" data-sid="${esc(s.id)}">Scoate</button></td></tr>`).join("");
  return `<p class="lead">Garda este tura de azi. Medicul scrie evoluția, asistenta trece constantele și descarcă materialele, infirmiera și brancardierul sunt vizibili pentru toată secția.</p>
    <div class="card" style="margin-bottom:12px"><div class="card-head"><h2>Tura de azi</h2><span class="sub">${esc(fmtDay(todayKey()))}</span></div><div class="card-body">
      <div class="fields">${fields}</div>
      <div class="form-actions"><button class="btn btn-primary" type="button" data-act="save-duty">Salvează garda</button></div>
    </div></div>
    <div class="card"><div class="card-head"><h2>Personalul secției</h2><span class="sub">${(w.staff || []).length} persoane</span></div>
      <div class="card-body tight"><table><thead><tr><th>Nume</th><th>Rol</th><th></th></tr></thead><tbody>${people || `<tr><td colspan="3" class="muted" style="padding:16px">Nicio persoană adăugată.</td></tr>`}</tbody></table></div>
      <div class="card-body"><div class="fields">
        <div><label class="lbl" for="stf-name">Nume <span class="req">*</span></label><input id="stf-name" type="text" placeholder="Nume și prenume"></div>
        <div><label class="lbl" for="stf-role">Rol</label><select id="stf-role"><option value="medic">Medic</option><option value="asistenta">Asistentă</option><option value="infirmiera">Infirmieră</option><option value="brancardier">Brancardier</option></select></div>
      </div><div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-staff">Adaugă în secție</button></div></div>
    </div>`;
}
function materialeHtml(w) {
  const rows = (w.stock || []).map(s => `<tr class="${s.qty < s.min ? "low" : ""}"><td class="name">${esc(s.name)}</td><td class="mono">${s.qty}</td><td>${esc(s.unit)}</td><td class="mono">${s.min}</td><td>${s.qty < s.min ? `<span class="danger">Sub prag</span>` : `<span class="muted">În regulă</span>`}</td></tr>`).join("");
  const gaps = kitGap(w);
  const kitNote = occupied(w).length
    ? (gaps.length ? `Nu se poate descărca acum. ${gaps.join(" · ")}.` : `Se descarcă câte 1 pereche de mănuși și 2 comprese pentru fiecare din cei ${occupied(w).length} pacienți internați.`)
    : "Nu există pacienți internați.";
  return `<p class="lead">Gestiunea este a secției. Ce se înregistrează pe un pacient se scade automat din stoc. Kitul de tură face aceeași descărcare pentru toate paturile ocupate.</p>
    <div class="card" style="margin-bottom:12px"><div class="card-head"><h2>Stoc secție</h2><span class="sub">${lowStock(w).length} sub prag</span></div><div class="card-body tight"><table><thead><tr><th>Material</th><th>Stoc</th><th>UM</th><th>Prag</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card-body"><div class="section-title">Intrare în gestiune</div><div class="fields">
        <div><label class="lbl" for="stk-name">Material</label><input id="stk-name" type="text" list="stk-list" placeholder="Alegeți sau scrieți un material nou"><datalist id="stk-list">${SUPPLY.map(([name]) => `<option value="${esc(name)}"></option>`).join("")}</datalist></div>
        <div><label class="lbl" for="stk-qty">Cantitate</label><input id="stk-qty" type="number" min="1" value="10"></div>
      </div><div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-stock">Înregistrează intrarea</button></div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Descărcare automată pe tură</h2></div><div class="card-body">
      <p class="lead">${esc(kitNote)}</p>
      <button class="btn btn-primary" type="button" data-act="apply-kit">Descarcă kitul pe pacienți</button>
    </div></div>`;
}

function stepsHtml(p) {
  const monitored = p.vitals.length > 0;
  const studied = p.studies.some(s => s.status === "finalizat");
  const done = p.status === "externat";
  const items = [
    ["Internare", true],
    ["Monitorizare", monitored],
    ["Investigații", studied],
    ["Externare", done || p.status === "pregatit"],
    ["Scrisoare", done]
  ];
  return `<ol class="steps">${items.map(([label, ok], idx) => `<li class="${ok ? "done" : ""}">${idx + 1}. ${label}</li>`).join("")}</ol>`;
}
function noteText(p) { return (p.notes || []).map(n => n.text).join(" ") + " " + ((p.letter && p.letter.epicrisis) || ""); }
function vitalPair(p) {
  const v = latestVital(p);
  if (!v) return {};
  const match = String(v.ta || "").match(/(\d+)\s*\/\s*(\d+)/);
  return { sys: match ? Number(match[1]) : null, dia: match ? Number(match[2]) : null, hr: parseInt(v.av, 10) };
}
function labRow(p, name) {
  return (p.studies || []).flatMap(s => s.rows || []).find(r => r.name === name && r.flag) || null;
}
function zenaChart(p) {
  const alerts = [];
  const meds = (p.meds || []).map(m => m.name);
  const vit = vitalPair(p);
  const low = (vit.sys && vit.sys <= 90) || (vit.hr && vit.hr <= 50);
  const pressure = meds.filter(name => /bisoprolol|digoxin|furosemid|enalapril|enap|ramipril/i.test(name));
  if (low && pressure.length) alerts.push({ level: "bad", title: "Contraindicație hemodinamică", why: `TA ${vit.sys}/${vit.dia || "—"} mmHg, frecvență ${vit.hr}/min.`, text: `${pressure.join(", ")} nu se administrează la hipotensiune sau bradicardie. Betablocantul, digoxina, furosemidul și enalaprilul (Enap) pot scădea și mai mult tensiunea sau frecvența.`, fix: "Opriți doza. Nu o reluați până când tensiunea și frecvența ies din zona de risc." });
  const bleed = /melen|sânger|sangere|hemorag|hematemez/i.test(noteText(p));
  const anti = meds.filter(name => /heparin|enoxaparin|apixaban|eliquis/i.test(name));
  if (bleed && anti.length) alerts.push({ level: "bad", title: "Sângerare și anticoagulant", why: "Foaia descrie melenă sau sângerare, iar anticoagulantul este deja trecut.", text: `${anti.join(", ")} întreține sângerarea. Nu continuați heparina, enoxaparina sau apixabanul (Eliquis) cât timp pacientul sângerează.`, fix: "Opriți anticoagulantul și notați ora ultimei doze. O doză nouă se decide doar după reevaluare." });
  const inr = labRow(p, "INR");
  const tq = labRow(p, "TQ");
  if ((inr || tq) && anti.length && !bleed) alerts.push({ level: "bad", title: "Coagulare în afara intervalului", why: [inr && `INR ${inr.value}`, tq && `TQ ${tq.value} s`].filter(Boolean).join(" · "), text: `${anti.join(", ")} nu se introduce peste un INR sau un TQ deja modificat.`, fix: "Nu dați o doză nouă. Repetați coagulograma înainte de orice anticoagulant." });
  if (/penicil/i.test(p.allergies || "") && meds.some(name => /amoxic|ampicil|penicil/i.test(name))) alerts.push({ level: "bad", title: "Alergie la penicilină", why: "Alergia este scrisă în foaie.", text: "Amoxicilina și ampicilina sunt peniciline. Nu le introduceți la acest pacient.", fix: "Alegeți un antibiotic din altă clasă, potrivit secției." });
  const sec = (p.secondary || "") + " " + ((p.letter && p.letter.secondary) || "");
  const blob = noteText(p);
  if (/șoc|soc cardiogen|insuficiență cardiacă|insuficienta cardiaca/i.test(blob) && !/I50|R57/.test(sec)) alerts.push({ level: "warn", title: "DRG incomplet", why: "Evoluția descrie șoc sau insuficiență cardiacă, dar foaia nu are diagnostic secundar pentru ele.", text: "Diagnosticul principal rămâne motivul internării. Lipsește codul de complicație, iar grupul DRG iese mai simplu decât cazul real.", fix: "Adăugați R57.0 șoc cardiogen sau I50.0 insuficiență cardiacă congestivă la diagnostice secundare. ICM-ul secției se calculează din această grupare." });
  if (/melen/i.test(blob) && !/K92/.test(sec)) alerts.push({ level: "warn", title: "DRG: melena nu este codificată", why: "Melena este scrisă în evoluție și nu apare ca diagnostic secundar.", text: "Dacă melena este prezentă în episod, ea schimbă gruparea.", fix: "Adăugați K92.1 melenă la diagnostice secundare. Nu înlocuiți diagnosticul principal dacă motivul internării este altul." });
  if ((inr || tq) && /N18/.test(p.dx || "") && !/D68|K92|R58/.test(sec)) alerts.push({ level: "warn", title: "DRG: coagularea nu intră în grupare", why: "Cazul este codat ca boală cronică de rinichi, iar buletinul arată INR sau TQ modificat.", text: "Dacă internarea este pentru tulburarea de coagulare, aceasta trebuie să fie diagnosticul principal.", fix: "Verificați motivul internării. Dacă este coagulopatia, treceți D68.9 pe principal și lăsați N18.3 secundar." });
  return alerts;
}
function zenaMed(p, name) {
  return zenaChart({ ...p, meds: [{ name }] }).find(item => item.level === "bad") || null;
}
function zenaHtml(p) {
  const items = zenaChart(p);
  if (!items.length) return "";
  const open = ui.openAlerts || [];
  const cards = items.map(item => {
    const id = p.id + "|" + item.title;
    const on = open.includes(id);
    return `<button class="zena ${item.level}${on ? " open" : ""}" type="button" data-act="alert-toggle" data-id="${esc(id)}" aria-expanded="${on ? "true" : "false"}"><span class="zena-h"><b>Zena · ${esc(item.title)}</b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="zena-body"><span>${esc(item.why)}</span><span>${esc(item.text)}</span><span><b>Cum se corectează.</b> ${esc(item.fix)}</span></span></button>`;
  }).join("");
  return `<aside class="alert-rail">${cards}</aside>`;
}
function bannerHtml(w, p) {
  const allergy = p.allergies && p.allergies !== "Nu se cunosc" ? `<p class="danger">Alergie: ${esc(p.allergies)}</p>` : "";
  const place = p.bed ? `Pat ${pad(p.bed)} · ziua ${stayDays(p.admitted)}` : `Externat ${fmtDay(p.discharged)}`;
  return `<div class="banner"><div style="flex:1"><div class="muted">${esc(p.fileNo)} · ${esc(w.name)}</div><h2>${esc(p.last)} ${esc(p.first)}</h2><p>${ageOf(p.birth)} ani · ${sexLabel(p.sex)} · ${place} · ${esc(p.physician)}</p><p>${esc(p.dx)}</p>${allergy}</div><div>${badge(p.status)}</div></div>`;
}
function latestVital(p) { return p.vitals[p.vitals.length - 1]; }
function panelCard(title, sub, body, canAdd, form) {
  const btn = canAdd ? `<button class="btn btn-primary" type="button" data-act="compose">Adaugă</button>` : "";
  const zone = form ? `<div class="add-zone">${form}</div>` : "";
  return `<section class="chart-dash"><div class="dash-body"><div class="panel-head"><div><h2>${title}</h2>${sub ? `<span class="sub">${sub}</span>` : ""}</div>${btn}</div>${zone}${body}</div></section>`;
}
function chartDash(w, p) {
  const v = latestVital(p);
  const closed = p.status === "externat" || p.status === "decedat" || p.status === "transferat";
  const tab = ui.tab || "sumar";
  const can = !closed;
  const badTa = v && /^(7|8|9)\d\//.test(String(v.ta));
  const badAv = v && (Number(v.av) >= 110 || Number(v.av) <= 50);
  const badSp = v && Number(v.spo2) < 94;
  const badRr = v && (Number(v.rr) >= 24 || Number(v.rr) <= 10);
  const vitals = `<div class="vrow">
      <article><span>Tensiune</span><b class="${badTa ? "bad" : ""}">${v ? esc(v.ta) : "—"}</b></article>
      <article><span>Frecvență</span><b class="${badAv ? "bad" : ""}">${v ? esc(v.av) : "—"}</b></article>
      <article><span>Respirație</span><b class="${badRr ? "bad" : ""}">${v && v.rr ? esc(v.rr) : "—"}</b></article>
      <article><span>Temperatură</span><b>${v ? esc(v.temp) : "—"}</b></article>
      <article><span>SpO₂</span><b class="${badSp ? "bad" : ""}">${v ? esc(v.spo2) + "%" : "—"}</b></article>
    </div>`;
  if (tab === "evolutie") {
    const notes = (p.notes || []).slice().sort((a, b) => b.at.localeCompare(a.at));
    const body = notes.map(n => `<div class="evo"><strong>${esc(n.author)}</strong> · <span class="muted">${esc(fmt(n.at))}</span><p>${esc(n.text)}</p></div>`).join("") || `<p class="muted">Nicio evoluție scrisă.</p>`;
    return panelCard("Evoluție", `${notes.length} notițe în foaie`, body, can, can && ui.compose ? evolutionHtml(w, p) : "");
  }
  if (tab === "monitor") return panelCard("Monitorizare", v ? `Ultima înregistrare · ${esc(fmt(v.at))}` : "Nicio constantă în foaie", vitals, can, can && ui.compose ? monitorForm() : "");
  if (tab === "analize") {
    const list = (p.studies || []).filter(s => s.kind === "analize");
    const body = list.map(studyCard).join("") || `<p class="muted">Niciun buletin de analize.</p>`;
    return panelCard("Analize", `${list.length} buletine`, body, can, can && ui.compose ? labOrderHtml(w) : "");
  }
  if (tab === "imagistica") {
    const kinds = [["echo","Ecografie"],["rx","RX"],["ct","CT"],["rmn","RMN"]];
    const ids = kinds.map(k => k[0]);
    const present = (p.studies || []).filter(s => ids.includes(s.kind)).map(s => s.kind);
    const current = ids.includes(ui.imgKind) ? ui.imgKind : (present[0] || "echo");
    ui.imgKind = current;
    ui.studyKind = current;
    const list = (p.studies || []).filter(s => s.kind === current);
    const label = kinds.find(k => k[0] === current)[1];
    const menu = `<nav class="mag-menu">${kinds.map(([id, name]) => `<button type="button" class="${id === current ? "on" : ""}" data-act="img-kind" data-id="${id}">${name}</button>`).join("")}</nav>`;
    const body = list.map(studyCard).join("") || `<p class="muted">Nicio examinare ${esc(label)}.</p>`;
    const btn = can ? `<button class="btn btn-primary" type="button" data-act="compose">Adaugă</button>` : "";
    const zone = can && ui.compose ? `<div class="add-zone">${imageOrderHtml()}</div>` : "";
    return `<section class="chart-dash"><div class="dash-body"><div class="panel-head"><div><h2>Imagistică</h2><span class="sub">${list.length} examinări · ${esc(label)}</span></div>${btn}</div>${menu}${zone}${body}</div></section>`;
  }
  if (tab === "medicatie") {
    const meds = (p.meds || []).slice().reverse();
    const body = meds.slice(0, 5).map(m => `<div class="evo"><strong>${esc(m.name)}</strong> · ${esc(m.dose)}${m.route ? " · " + esc(m.route) : ""}${m.schedule ? " · " + esc(m.schedule) : ""}<p class="muted">${esc(m.group)} · ${esc(fmt(m.at))}${m.by ? " · " + esc(m.by) : ""}</p></div>`).join("") || `<p class="muted">Nicio prescriere pe foaie.</p>`;
    return panelCard("Medicație", `${meds.length} administrări`, body, can, medsCompose(w, p));
  }
  if (tab === "consum") {
    const classes = ["Toate", ...new Set((w.stock || []).map(s => s.group || supplyClass(s.name)))];
    const current = classes.includes(ui.supClass) ? ui.supClass : "Toate";
    ui.supClass = current;
    const inClass = s => current === "Toate" || (s.group || supplyClass(s.name)) === current;
    const items = (p.supplies || []).slice().reverse().filter(inClass);
    const menu = `<nav class="mag-menu">${classes.map(name => `<button type="button" class="${name === current ? "on" : ""}" data-act="sup-class" data-id="${esc(name)}">${esc(name)}</button>`).join("")}</nav>`;
    const body = items.slice(0, 5).map(s => `<div class="evo"><strong>${esc(s.name)}</strong><p class="muted">${esc(String(s.qty))} ${esc(s.unit)} · ${esc(fmt(s.at))}</p></div>`).join("") || `<p class="muted">Niciun consumabil în această clasă.</p>`;
    const btn = can ? `<button class="btn btn-primary" type="button" data-act="compose">Adaugă</button>` : "";
    const zone = can && ui.compose ? `<div class="add-zone">${supplyForm(w, current)}</div>` : "";
    return `<section class="chart-dash"><div class="dash-body"><div class="panel-head"><div><h2>Consumabile</h2><span class="sub">${items.length} poziții pe foaie</span></div>${btn}</div>${menu}${zone}${body}</div></section>`;
  }
  if (tab === "externare") {
    return `<section class="chart-dash"><div class="dash-body">
      <div class="panel-head"><div><h2>Scrisoare medicală</h2><span class="sub">compusă automat din foaie · fiecare card se dictează și se corectează</span></div>
        <div class="panel-actions"><button class="btn" type="button" data-act="letter-reset">Reia din foaie</button><button class="btn" type="button" data-act="preview">Previzualizează</button><button class="btn btn-primary" type="button" data-act="emit">Emite și externează</button></div>
      </div>
      ${letterEditor(w, p)}
    </div></section>`;
  }
  if (tab === "scrisoare") {
    const letter = p.letter;
    const text = letter ? esc(letter.epicrisis) : "";
    return panelCard("Scrisoare", letter ? esc(letter.number) : "Emisă", `<p class="dx-line">${esc((letter && letter.dx) || p.dx)}</p><p class="muted">${text}</p>`, false, "");
  }
  const notes = (p.notes || []).slice().sort((a, b) => a.at.localeCompare(b.at));
  const last = notes[notes.length - 1];
  const meds = (p.meds || []).slice(-3).map(m => `${m.name} ${m.dose}${m.route ? " " + m.route : ""}${m.schedule ? ", " + m.schedule : ""}`).join(" · ") || "Nicio prescriere pe foaie.";
  const pending = (p.studies || []).filter(s => s.status !== "finalizat").map(s => s.title);
  const abn = (p.studies || []).flatMap(s => (s.rows || []).filter(r => r.flag).map(r => `${r.name} ${r.value}`));
  const studyLineText = [pending.length ? "În lucru: " + pending.join(", ") : "", abn.length ? "În afara intervalului: " + abn.slice(0, 3).join(", ") : "Buletine în limite sau fără rezultat nou."].filter(Boolean).join(" ");
  return `<section class="chart-dash"><div class="dash-body">${vitals}
    <div class="dgrid">
      <article><h3>Ultima evoluție</h3><p>${last ? esc(last.text) : "Nicio evoluție scrisă."}</p></article>
      <article><h3>Medicație</h3><p>${esc(meds)}</p></article>
      <article><h3>Investigații</h3><p>${esc(studyLineText)}</p></article>
    </div></div></section>`;
}
function pagePatient() {
  const w = ward(), p = patient();
  if (ui.tab === "studii") ui.tab = "analize";
  const closed = p.status === "externat" || p.status === "decedat" || p.status === "transferat";
  const tabs = closed
    ? [["sumar","Sumar"],["evolutie","Evoluție"],["monitor","Monitorizare"],["analize","Analize"],["imagistica","Imagistică"],["medicatie","Medicație"],["consum","Consumabile"],["scrisoare","Scrisoare"]]
    : [["sumar","Sumar"],["evolutie","Evoluție"],["monitor","Monitorizare"],["analize","Analize"],["imagistica","Imagistică"],["medicatie","Medicație"],["consum","Consumabile"],["externare","Externare"]];
  const menu = tabs.map(([id, label]) => `<button class="tab${ui.tab === id ? " on" : ""}" type="button" data-act="tab" data-tab="${id}">${label}</button>`).join("");
  const doc = boardDoctor(w, p);
  const place = p.bed ? `Salon ${Math.ceil(p.bed / 4)} · Pat ${localPat(p.bed)}` : `${statusLabel(p.status)} · ${fmtDay(p.discharged)}`;
  const knownAllergy = p.allergies && p.allergies !== "Nu se cunosc";
  const today = new Date().toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long" });
  const dot = ` <span class="sep">·</span> `;
  return `<header class="topbar patient">
    <div class="title pid">
      <div class="pid-main"><h1>${esc(p.last)} ${esc(p.first)}</h1>${badge(p.status)}<span class="rest">${ageOf(p.birth)} ani${dot}${sexLabel(p.sex)}${dot}${esc(doc)}${dot}<span class="dx">${esc(p.dx)}</span></span>${ui.histOpen ? "" : `<button class="hist-toggle" type="button" data-act="hist-toggle" aria-expanded="false" aria-label="Istoric pacient" title="Istoricul pacientului"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`}</div>
      <div class="pid-meta">${esc(p.fileNo)}${dot}${esc(w.name)}${dot}${esc(place)}${dot}ziua ${stayDays(p.admitted)}${dot}<span class="${knownAllergy ? "allergy" : ""}">Alergie: ${esc(knownAllergy ? p.allergies : "nu se cunosc")}</span>${dot}Grupa ${esc(p.blood || "—")}${dot}${esc(p.address || "—")}</div>
    </div>
    <div class="top-side"><div class="top-actions"><div class="context">${esc(today)}</div><button class="btn" type="button" data-act="back-ward">Înapoi la secție</button></div></div>
  </header>
  <nav class="tabs chart-menu">${menu}</nav>
  <div class="content sheet-canvas no-print-scope">
    <div class="sheet-row">
      <div class="sheet-main">${chartDash(w, p)}${tabBody(w, p)}</div>
      ${zenaHtml(p)}
    </div>
  </div>`;
}
function tabBody(w, p) {
  if (ui.tab === "evolutie" || ui.tab === "analize" || ui.tab === "imagistica") return "";
  if (ui.tab === "monitor") return monitorHtml(p);
  if (ui.tab === "medicatie") return medsHtml(w, p);
  if (ui.tab === "consum") return suppliesHtml(w, p);
  if (ui.tab === "externare") return "";
  if (ui.tab === "scrisoare") return `<div class="letter-wrap">${letterHtml(w, p, p.letter)}</div><div class="form-actions no-print"><button class="btn btn-primary" type="button" data-act="print">Tipărește</button></div>`;
  return summaryHtml(w, p);
}
function summaryHtml(w, p) {
  const place = p.bed ? `Salon ${Math.ceil(p.bed / 4)} · Pat ${localPat(p.bed)}` : "Externat";
  const studies = (p.studies || []).slice(0, 4).map(s => `<li>${esc(studyLine(s))}</li>`).join("") || "<li>Nicio investigație.</li>";
  const meds = (p.meds || []).map(m => `<li>${esc(m.name)} ${esc(m.dose)}${m.route ? " · " + esc(m.route) : ""}${m.schedule ? " · " + esc(m.schedule) : ""}</li>`).join("") || "<li>Nicio prescriere.</li>";
  const vitals = (p.vitals || []).slice().reverse().map(v => `<tr><td class="muted">${esc(fmt(v.at))}</td><td>${esc(v.ta)}</td><td class="${Number(v.av) > 110 || Number(v.av) <= 50 ? "danger" : ""}">${esc(v.av)}</td><td class="${Number(v.rr) >= 24 || Number(v.rr) <= 10 ? "danger" : ""}">${esc(v.rr || "—")}</td><td>${esc(v.temp)}</td><td class="${Number(v.spo2) < 94 ? "danger" : ""}">${esc(v.spo2)}</td></tr>`).join("");
  const notes = (p.notes || []).slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3).map(n => `<p><strong>${esc(n.author)}</strong> · <span class="muted">${esc(fmt(n.at))}</span><br>${esc(n.text)}</p>`).join("");
  return `<div class="split trio">
    <div class="card"><div class="card-head"><h2>Internare</h2></div><div class="card-body"><dl class="kv">
      <dt>Loc</dt><dd>${esc(place)}</dd>
      <dt>De gardă</dt><dd>${esc(boardDoctor(w, p))}</dd>
      <dt>Medic curant</dt><dd>${esc(p.physician)}</dd>
      <dt>Tip</dt><dd>${esc(p.type)}</dd>
      <dt>Data</dt><dd>${esc(fmt(p.admitted))}</dd>
      <dt>Zile</dt><dd>${stayDays(p.admitted)}</dd>
      <dt>CNP</dt><dd class="mono">${esc(p.cnp)}</dd>
      <dt>Asigurare</dt><dd>${p.insured ? esc(p.casa) : "Neasigurat"}</dd>
      <dt>Alergii</dt><dd>${esc(p.allergies)}</dd>
      <dt>Grupa</dt><dd>${esc(p.blood || "—")}</dd>
      <dt>Adresă</dt><dd>${esc(p.address || "—")}</dd>
      <dt>Telefon</dt><dd>${esc(p.phone)}</dd>
      <dt>Aparținător</dt><dd>${esc(p.kinName || "—")}${p.kinWho ? " · " + esc(p.kinWho) : ""}${p.kinPhone ? " · " + esc(p.kinPhone) : ""}</dd>
      <dt>Trimis de</dt><dd>${esc(p.referrer || "—")}</dd>
      <dt>Constituție</dt><dd>${p.bodyKg ? esc(String(p.bodyKg)) + " kg" : "—"} · ${p.heightCm ? esc(String(p.heightCm)) + " cm" : "—"}</dd>
      <dt>Acord internare</dt><dd>${p.consentAdmit ? "Da" : "Nu"}</dd>
      <dt>Acord procedură</dt><dd>${p.consentProc ? "Da" : "Nu"}</dd>
      <dt>Diagnostic internare</dt><dd>${esc(p.dxAdmit || p.dx || "—")}</dd>
      <dt>Diagnostic de lucru</dt><dd>${esc(p.dx || "—")}${p.dxCode ? " · " + esc(p.dxCode) : ""}</dd>
      <dt>Secundare</dt><dd>${esc(p.secondary || "—")}</dd>
      <dt>Motiv</dt><dd>${esc(p.reason || "—")}</dd>
      <dt>Antecedente</dt><dd>${esc(p.antecedents || "—")}</dd>
    </dl>${p.bed ? `<form class="fields" style="margin-top:14px" onsubmit="return false">
      <div class="span-2"><label class="lbl" for="ch-dx">Diagnostic de lucru</label><input id="ch-dx" type="text" value="${esc(p.dx || "")}"></div>
      <div class="span-2"><label class="lbl" for="ch-sec">Diagnostice secundare</label><input id="ch-sec" type="text" value="${esc(p.secondary || "")}" placeholder="Cod și denumire, separate prin virgulă"></div>
      <div class="span-2"><label class="lbl" for="ch-reason">Motivul internării</label><textarea id="ch-reason">${esc(p.reason || "")}</textarea></div>
      <div class="span-2"><label class="lbl" for="ch-ante">Antecedente</label><textarea id="ch-ante">${esc(p.antecedents || "")}</textarea></div>
      <div><label class="lbl" for="ch-kg">Greutate (kg)</label><input id="ch-kg" type="number" value="${p.bodyKg || ""}"></div>
      <div><label class="lbl" for="ch-cm">Înălțime (cm)</label><input id="ch-cm" type="number" value="${p.heightCm || ""}"></div>
      <div class="span-2"><label class="check"><input id="ch-ca" type="checkbox"${p.consentAdmit ? " checked" : ""}> Acord pentru internare</label></div>
      <div class="span-2"><label class="check"><input id="ch-cp" type="checkbox"${p.consentProc ? " checked" : ""}> Acord pentru procedură</label></div>
      <div class="span-2 form-actions"><button class="btn btn-primary" type="button" data-act="save-chart">Salvează pe foaie</button></div>
    </form>` : ""}</div></div>
    <div class="card"><div class="card-head"><h2>Constante în foaie</h2></div><div class="card-body tight"><table><thead><tr><th>Moment</th><th>TA</th><th>AV</th><th>FR</th><th>Temp.</th><th>SpO₂</th></tr></thead><tbody>${vitals || `<tr><td colspan="6" class="muted" style="padding:16px">Nicio înregistrare.</td></tr>`}</tbody></table></div><div class="card-body"><div class="section-title">Evoluție recentă</div>${notes || `<p class="muted">Nicio evoluție.</p>`}</div></div>
    <div class="card"><div class="card-head"><h2>Plan</h2></div><div class="card-body">
      <div class="section-title">Medicație</div><ul>${meds}</ul>
      <div class="section-title">Investigații</div><ul>${studies}</ul>
    </div></div>
  </div>`;
}
function evolutionHtml(w, p) {
  const notes = (p.notes || []).slice().sort((a, b) => b.at.localeCompare(a.at));
  const names = (w.staff || []).filter(s => s.role === "medic" || s.role === "asistenta").map(s => s.name);
  const current = (w.duty && w.duty.medic) || p.physician;
  if (current && !names.includes(current)) names.unshift(current);
  const authors = names.map(n => `<option${n === current ? " selected" : ""}>${esc(n)}</option>`).join("");
  const form = p.status === "externat" || !ui.compose ? "" : `<div class="card" style="margin-top:12px"><div class="card-head"><h2>Evoluția zilei</h2><button class="mic" type="button" data-act="mic" aria-pressed="false" title="Dictare vocală, demonstrație">${icon("i-mic")}</button></div><div class="card-body">
      <div class="fields">
        <div class="span-2"><label class="lbl" for="evo-author">Scrie</label><select id="evo-author">${authors}</select></div>
        <div class="span-2"><label class="lbl" for="evo-text">Text <span class="req">*</span></label><textarea id="evo-text" placeholder="Stare generală, simptome, evoluție față de ziua precedentă"></textarea></div>
      </div>
      <p class="muted" id="mic-hint">Microfonul este ilustrativ. Dictarea nu este activă în acest MVP.</p>
      <div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-note">Salvează evoluția</button></div>
    </div></div>`;
  return form;
}
function monitorForm() {
  return `<div class="card"><div class="card-head"><h2>Înregistrare nouă</h2></div><div class="card-body"><div class="fields">
      <div><label class="lbl" for="v-ta">Tensiune</label><input id="v-ta" type="text" placeholder="120/70"></div>
      <div><label class="lbl" for="v-av">Alură ventriculară</label><input id="v-av" type="number" placeholder="76"></div>
      <div><label class="lbl" for="v-temp">Temperatură</label><input id="v-temp" type="text" placeholder="36,6"></div>
      <div><label class="lbl" for="v-spo">SpO₂</label><input id="v-spo" type="number" placeholder="98"></div>
      <div><label class="lbl" for="v-rr">Frecvență respiratorie</label><input id="v-rr" type="number" placeholder="16"></div>
      <div><label class="lbl" for="v-note">Notă</label><input id="v-note" type="text" placeholder="Opțional"></div>
    </div><div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-vital">Salvează constantele</button></div></div></div>`;
}
function monitorHtml(p) {
  const rows = p.vitals.slice().reverse().map(v => `<tr><td class="muted">${esc(fmt(v.at))}</td><td>${esc(v.ta)}</td><td class="${Number(v.av) > 110 ? "danger" : ""}">${esc(v.av)}</td><td class="${Number(v.rr) >= 24 || Number(v.rr) <= 10 ? "danger" : ""}">${esc(v.rr || "—")}</td><td>${esc(v.temp)}</td><td class="${Number(v.spo2) < 94 ? "danger" : ""}">${esc(v.spo2)}</td><td>${esc(v.note || "—")}</td></tr>`).join("");
  return `<div class="card"><div class="card-head"><h2>Istoric constante</h2></div><div class="card-body tight"><table><thead><tr><th>Moment</th><th>TA</th><th>AV</th><th>FR</th><th>Temp.</th><th>SpO₂</th><th>Notă</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="muted" style="padding:16px">Nicio înregistrare.</td></tr>`}</tbody></table></div></div>`;
}
function studyCard(s) {
  const head = `<div class="study-h"><span class="badge">${kindLabel(s.kind)}</span><h3>${esc(s.title)}</h3><span class="muted">${esc(fmt(s.at))}</span>${s.status === "finalizat" ? `<span class="badge ok">Finalizat</span>` : `<span class="badge warn">În lucru</span>`}</div>`;
  let body = "";
  if (s.status !== "finalizat") body = `<p class="muted">Rezultatul nu a sosit.</p><button class="btn btn-sm" type="button" data-act="finalize" data-sid="${esc(s.id)}">Marchează rezultat primit</button>`;
  else if (s.kind === "analize") {
    body = `<table><thead><tr><th>Analit</th><th>Rezultat</th><th>Unitate</th><th>Interval</th><th></th></tr></thead><tbody>${(s.rows || []).map(r => `<tr class="${r.flag ? "abn" : ""}"><td>${esc(r.name)}</td><td class="val">${esc(r.value)}</td><td>${esc(r.unit)}</td><td class="muted">${esc(r.ref)}</td><td>${r.flag ? `<span class="danger">${esc(r.flag)}</span>` : ""}</td></tr>`).join("")}</tbody></table>`;
  } else if (s.kind === "rx" || s.kind === "ct" || s.kind === "rmn" || s.kind === "echo") body = `<div class="film-row">${filmSvg(s.kind)}<div><p>${esc(s.result || "")}</p><p class="muted">Schemă de demonstrație, nu un examen real.</p></div></div>`;
  else body = `<p>${esc(s.result)}</p>`;
  return `<article class="study">${head}${body}</article>`;
}
function filmSvg(kind) {
  if (kind === "ct") return `<svg class="film" viewBox="0 0 160 188" role="img" aria-label="Schemă CT"><rect width="160" height="188" fill="#121416"/><circle cx="80" cy="78" r="58" fill="#2b3033"/><circle cx="80" cy="78" r="36" fill="none" stroke="#7d868c" stroke-width="14"/><ellipse cx="80" cy="86" rx="18" ry="12" fill="#a8b0b6"/><text x="8" y="176" fill="#9aa0a6" font-size="8" font-family="Segoe UI, sans-serif">Demonstrație CT</text></svg>`;
  if (kind === "rmn") return `<svg class="film" viewBox="0 0 160 188" role="img" aria-label="Schemă RMN"><rect width="160" height="188" fill="#101418"/><circle cx="80" cy="78" r="56" fill="#243038"/><ellipse cx="80" cy="78" rx="34" ry="22" fill="none" stroke="#8aa0a8" stroke-width="6"/><circle cx="68" cy="74" r="6" fill="#c5d0d4"/><circle cx="92" cy="74" r="6" fill="#c5d0d4"/><text x="8" y="176" fill="#9aa0a6" font-size="8" font-family="Segoe UI, sans-serif">Demonstrație RMN</text></svg>`;
  if (kind === "echo") return `<svg class="film" viewBox="0 0 160 188" role="img" aria-label="Schemă ecografie"><rect width="160" height="188" fill="#0e1418"/><path d="M80 28 L28 150 L132 150 Z" fill="#16303a"/><path d="M80 48 L48 138 L112 138 Z" fill="#1f4452"/><ellipse cx="80" cy="108" rx="16" ry="10" fill="#7eb8c4"/><text x="8" y="176" fill="#9aa0a6" font-size="8" font-family="Segoe UI, sans-serif">Demonstrație ecografie</text></svg>`;
  return `<svg class="film" viewBox="0 0 160 188" role="img" aria-label="Schemă RX"><rect width="160" height="188" fill="#1a1c1e"/><path d="M80 24 C52 24 26 70 28 112 C48 100 64 90 80 90 C96 90 112 100 132 112 C134 70 108 24 80 24Z" fill="#3a4246"/><ellipse cx="78" cy="112" rx="24" ry="28" fill="#667077"/><path d="M18 40 C40 70 40 120 18 150" fill="none" stroke="#4e565b" stroke-width="3"/><path d="M142 40 C120 70 120 120 142 150" fill="none" stroke="#4e565b" stroke-width="3"/><text x="8" y="176" fill="#9aa0a6" font-size="8" font-family="Segoe UI, sans-serif">Demonstrație RX</text></svg>`;
}
const LAB_SETS = {
  uzuale: {
    cardio: ["Troponină I", "NT-proBNP", "CK-MB", "Hemoleucogramă", "Creatinină", "Ionogramă", "INR", "D-dimeri"],
    surg: ["Hemoleucogramă", "CRP", "Creatinină", "Ionogramă", "Amilază", "Lipază", "INR", "Grup sanguin"],
    med: ["Hemoleucogramă", "CRP", "Creatinină", "Uree", "Ionogramă", "Glicemie", "ALT", "Sumar de urină"]
  },
  coagulare: ["INR", "APTT", "TQ", "D-dimeri", "Fibrinogen"],
  hematologie: ["Hemoleucogramă", "VSH", "Feritină"],
  biochimie: ["Glicemie", "HbA1c", "Creatinină", "Uree", "Ionogramă", "ALT", "AST", "GGT", "Fosfatază alcalină", "Bilirubină totală", "Amilază", "Lipază", "Lipidogramă"],
  markeri: ["Troponină I", "CK-MB", "NT-proBNP", "CRP", "Procalcitonină"],
  micro: ["Sumar de urină", "Urocultură", "Hemocultură"]
};
const CATALOG = {
  analize: ["Hemoleucogramă","VSH","CRP","Procalcitonină","Fibrinogen","Troponină I","CK-MB","NT-proBNP","Glicemie","HbA1c","Creatinină","Uree","Ionogramă","ALT","AST","GGT","Fosfatază alcalină","Bilirubină totală","Amilază","Lipază","INR","APTT","D-dimeri","Gazometrie arterială","Sumar de urină","Urocultură","Hemocultură","TSH","Lipidogramă","Feritină"],
  rx: ["Radiografie toracică PA","Radiografie toracică profil","Radiografie abdominală","Radiografie coloană lombară","Radiografie coloană cervicală","Radiografie craniu","Radiografie bazin","Radiografie umăr","Radiografie genunchi","Radiografie gleznă"],
  ct: ["CT craniu nativ","CT craniu cu contrast","CT torace","CT angio pulmonar","CT abdomen și pelvis","CT coloană lombară","CT coloană cervicală","CT sinusuri","CT membre","Angio-CT aortă"],
  rmn: ["RMN craniu","RMN coloană lombară","RMN coloană cervicală","RMN cord","RMN abdomen","RMN bazin","RMN genunchi","RMN umăr","RMN angio intracranian","RMN prostată"],
  echo: ["Ecografie abdominală","Ecografie cardiacă","Ecografie Doppler vase","Ecografie tiroidă","Ecografie renală","Ecografie pelvină","Ecografie mamară","Ecografie părți moi"]
};
function labOrderHtml(w) {
  const q = (ui.studyQuery || "").trim().toLowerCase();
  const group = ui.labGroup || "uzuale";
  const groups = [["uzuale","Uzuale"],["coagulare","Coagulare"],["hematologie","Hematologie"],["biochimie","Biochimie"],["markeri","Markeri"],["micro","Microbiologie"]];
  const groupChips = groups.map(([id, label]) => `<button type="button" class="${group === id ? "on" : ""}" data-act="lab-group" data-id="${id}">${label}</button>`).join("");
  const source = group === "uzuale" ? (LAB_SETS.uzuale[w.focus] || LAB_SETS.uzuale.med) : (LAB_SETS[group] || []);
  const hits = source.filter(name => name.toLowerCase().includes(q)).map(name => `<button type="button" data-act="order-catalog" data-kind="analize" data-title="${esc(name)}">${esc(name)}</button>`).join("") || `<p class="muted" style="padding:12px">Niciun rezultat.</p>`;
  const setBtn = group === "uzuale" ? `<div class="form-actions"><button class="btn btn-primary" type="button" data-act="order-set">Cere setul uzual al secției</button></div>` : "";
  return `<div class="card"><div class="card-head"><h2>Adaugă analize</h2><span class="sub">buletin nou, în partea de sus</span></div><div class="card-body">
      <div class="chips" style="margin-bottom:10px">${groupChips}</div>
      <p class="pareto-note">${group === "uzuale" ? "Cele mai folosite pe această secție stau la vedere." : "Grupul deschis. Uzuale rămâne primul loc de unde se comandă."}</p>
      <div class="search" style="max-width:none;margin-bottom:10px"><input id="cat-q" type="text" placeholder="Caută analiza" value="${esc(ui.studyQuery || "")}" aria-label="Caută analiza"></div>
      ${setBtn}<div class="catalog${group === "uzuale" ? " pareto" : ""}">${hits}</div>
    </div></div>`;
}
function imageOrderHtml() {
  const kind = ["echo","rx","ct","rmn"].includes(ui.imgKind) ? ui.imgKind : "rx";
  const q = (ui.studyQuery || "").trim().toLowerCase();
  const label = { echo: "Ecografie", rx: "RX", ct: "CT", rmn: "RMN" }[kind];
  const hits = (CATALOG[kind] || []).filter(name => name.toLowerCase().includes(q)).map(name => `<button type="button" data-act="order-catalog" data-kind="${kind}" data-title="${esc(name)}">${esc(name)}</button>`).join("") || `<p class="muted" style="padding:12px">Niciun rezultat.</p>`;
  return `<div class="card"><div class="card-head"><h2>Adaugă ${esc(label)}</h2><span class="sub">din clasa aleasă</span></div><div class="card-body">
      <div class="search" style="max-width:none;margin-bottom:10px"><input id="cat-q" type="text" placeholder="Caută examinarea" value="${esc(ui.studyQuery || "")}" aria-label="Caută examinarea"></div>
      <div class="catalog">${hits}</div>
    </div></div>`;
}
function medsCompose(w, p) {
  if (!ui.compose && !(ui.holdMed && ui.holdMed.patientId === p.id)) return "";
  const q = (ui.medQuery || "").trim().toLowerCase();
  const classes = [...new Set((w.meds || []).map(m => m.group))];
  const current = classes.includes(ui.medClass) ? ui.medClass : (classes[0] || "");
  ui.medClass = current;
  const stock = (w.meds || []).filter(m => m.group === current && `${m.name} ${m.dose}`.toLowerCase().includes(q));
  const menu = `<nav class="mag-menu">${classes.map(name => `<button type="button" class="${name === current ? "on" : ""}" data-act="med-class" data-id="${esc(name)}">${esc(name)}</button>`).join("")}</nav>`;
  const hits = stock.map(m => `<button type="button" data-act="give-med" data-mid="${esc(m.id)}"><span>${esc(m.name)} · ${esc(m.dose)}</span><span class="${m.qty < m.min ? "danger" : "muted"}">${m.qty} ${esc(m.unit)}</span></button>`).join("") || `<p class="muted" style="padding:12px">Niciun medicament în această clasă.</p>`;
  const hold = ui.holdMed && ui.holdMed.patientId === p.id ? `<aside class="zena bad"><b>Zena oprește prescrierea · ${esc(ui.holdMed.title)}</b><div>${esc(ui.holdMed.text)}</div><div>${esc(ui.holdMed.fix)}</div><div class="fields" style="margin-top:8px"><div class="span-2"><label class="lbl" for="zena-why">Motiv, dacă totuși prescrieți</label><input id="zena-why" type="text" placeholder="De ce treceți peste alertă"></div></div><div class="form-actions"><button class="btn" type="button" data-act="cancel-med">Renunț</button><button class="btn btn-primary" type="button" data-act="confirm-med">Prescriu cu motiv</button></div></aside>` : "";
  const finder = ui.compose ? `<div class="card"><div class="card-head"><h2>Adaugă medicație</h2><span class="sub">din magazia secției</span></div><div class="card-body">
      ${menu}
      <div class="search" style="max-width:none;margin-bottom:10px"><input id="med-q" type="text" placeholder="Caută în clasă" value="${esc(ui.medQuery || "")}" aria-label="Caută medicament"></div>
      <div class="fields" style="margin-bottom:10px"><div><label class="lbl" for="med-qty">Cantitate</label><input id="med-qty" type="number" min="1" value="1"></div><div><label class="lbl" for="med-route">Cale</label><select id="med-route"><option>Oral</option><option>Intravenos</option><option>Subcutanat</option><option>Intramuscular</option><option>Perfuzie</option><option>Inhalator</option></select></div><div><label class="lbl" for="med-rhythm">Ritm</label><select id="med-rhythm"><option>o dată</option><option>la 8 ore</option><option>la 12 ore</option><option>la 24 ore</option><option>la nevoie</option></select></div></div>
      <div class="catalog">${hits}</div>
    </div></div>` : "";
  return hold + finder;
}
function medsHtml(w, p) {
  const given = (p.meds || []).slice().reverse().map(m => `<tr><td class="name">${esc(m.name)}</td><td>${esc(m.dose)}</td><td>${esc(m.route || "—")}</td><td>${esc(m.schedule || "—")}</td><td class="mono">${m.qty}</td><td>${esc(m.by || "—")}</td><td class="muted">${esc(fmt(m.at))}</td></tr>`).join("");
  return `<div class="card"><div class="card-head"><h2>Administrat pe foaie</h2><span class="sub">${(p.meds || []).length}</span></div><div class="card-body tight"><table><thead><tr><th>Medicament</th><th>Doză</th><th>Cale</th><th>Ritm</th><th>Cant.</th><th>Cine</th><th>Moment</th></tr></thead><tbody>${given || `<tr><td colspan="7" class="muted" style="padding:16px">Nicio prescriere.</td></tr>`}</tbody></table></div></div>`;
}
function supplyForm(w, current) {
  const stock = (w.stock || []).filter(s => s.qty > 0 && (current === "Toate" || (s.group || supplyClass(s.name)) === current));
  const hits = stock.map(s => `<button type="button" data-act="add-supply" data-name="${esc(s.name)}"><span>${esc(s.name)}</span><span class="${s.qty < s.min ? "danger" : "muted"}">${s.qty} ${esc(s.unit)}</span></button>`).join("") || `<p class="muted" style="padding:12px">Niciun material în această clasă.</p>`;
  return `<div class="card"><div class="card-head"><h2>Adaugă consumabil</h2><span class="sub">${esc(current)}</span></div><div class="card-body">
      <div class="fields" style="margin-bottom:10px"><div><label class="lbl" for="sup-qty">Cantitate</label><input id="sup-qty" type="number" min="1" value="1"></div></div>
      <div class="catalog">${hits}</div>
    </div></div>`;
}
function suppliesHtml(w, p) {
  const current = ui.supClass || "Toate";
  const rows = p.supplies.slice().reverse().filter(s => current === "Toate" || (s.group || supplyClass(s.name)) === current).map(s => `<tr><td class="name">${esc(s.name)}</td><td class="mono">${esc(s.qty)}</td><td>${esc(s.unit)}</td><td>${s.source === "tura" ? `<span class="badge">Tură</span>` : s.source === "manual" ? `<span class="muted">Manual</span>` : `<span class="muted">Foaie</span>`}</td><td class="muted">${esc(fmt(s.at))}</td></tr>`).join("");
  return `<div class="card"><div class="card-head"><h2>Consumabile pe foaie</h2><span class="sub">${current === "Toate" ? p.supplies.length + " poziții" : esc(current)}</span></div><div class="card-body tight"><table><thead><tr><th>Denumire</th><th>Cant.</th><th>UM</th><th>Sursă</th><th>Moment</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="muted" style="padding:16px">Niciun consumabil în această clasă.</td></tr>`}</tbody></table></div></div>`;
}
function letterSeed(p, w) {
  const verb = p.sex === "F" ? "internată" : "internat";
  const done = (p.studies || []).filter(s => s.status === "finalizat");
  const pending = (p.studies || []).filter(s => s.status !== "finalizat");
  let studies = done.length ? done.map(s => studyLine(s)).join(" ") : "Nu există investigații finalizate pe foaie.";
  if (pending.length) studies += " În lucru, neîncheiate: " + pending.map(s => s.title).join(", ") + ".";
  const meds = (p.meds || []).map(m => m.name + (m.dose ? " " + m.dose : ""));
  const treat = meds.length ? "Pe durata internării: " + meds.join(", ") + "." : "Nu sunt înregistrate prescrieri noi pe foaie. Tratamentul de fond rămâne cel al medicului curant.";
  const v = latestVital(p);
  const stateTxt = v
    ? `La ultima evaluare: TA ${v.ta}, AV ${v.av}/min, temperatură ${v.temp}°C, SpO₂ ${v.spo2}%. Stare stabilă, apt pentru externare.`
    : "Stare clinică stabilă, apt pentru externare.";
  return [
    { key: "dx", title: "Diagnostic de externare", wide: false, text: p.dx },
    { key: "secondary", title: "Diagnostice secundare", wide: false, text: p.secondary || "" },
    { key: "history", title: "Motivul internării", wide: true, text: p.reason || `${p.last} ${p.first} a fost ${verb} în secția ${w.name} la ${fmtDay(p.admitted)}, internare ${(p.type || "urgență").toLowerCase()}, pentru ${p.dxAdmit || p.dx}.` },
    { key: "epic", title: "Epicriză", wide: true, text: epicrisis(p, w) },
    { key: "studies", title: "Investigații", wide: true, text: studies },
    { key: "treat", title: "Tratament", wide: false, text: treat },
    { key: "state", title: "Stare la externare", wide: false, text: stateTxt },
    { key: "recs", title: "Recomandări", wide: true, text: RECS[w.focus] || RECS.general }
  ];
}
function ensureLetter(p, w) {
  if (!ui.letterDraft || ui.letterDraft.patientId !== p.id) {
    const cards = {};
    letterSeed(p, w).forEach(c => { cards[c.key] = c.text; });
    ui.letterDraft = { patientId: p.id, cards };
  }
  return ui.letterDraft;
}
function letterEditor(w, p) {
  const draft = ensureLetter(p, w);
  return `<div class="let-grid">${letterSeed(p, w).map(c => `<article class="let-card${c.wide ? " wide" : ""}">
      <div class="let-top"><h3>${esc(c.title)}</h3><div class="tools"><button class="mic" type="button" data-act="letter-mic" data-key="${c.key}" aria-label="Microfon" title="Dictare">${icon("i-mic")}</button><button class="btn btn-sm" type="button" data-act="letter-fix" data-key="${c.key}">Corectează</button></div></div>
      <textarea class="let-field" id="let-${c.key}" data-key="${c.key}">${esc(draft.cards[c.key] || "")}</textarea>
      <p class="let-note" id="let-note-${c.key}"></p>
    </article>`).join("")}</div>`;
}
const DIAC = {
  sectie: "secție", sectia: "secția", evolutie: "evoluție", evolutia: "evoluția", favorabila: "favorabilă",
  arteriala: "arterială", esentiala: "esențială", toracica: "toracică", brat: "braț", scadere: "scădere",
  modificari: "modificări", staza: "stază", internarii: "internării", retetei: "rețetei", reteta: "rețetă",
  investigatii: "investigații", recomandari: "recomandări", insuficienta: "insuficiență", cardiaca: "cardiacă",
  fara: "fără", buna: "bună", stabila: "stabilă", urgenta: "urgență", aceasta: "această", sincopa: "sincopă",
  in: "în", si: "și",
  generala: "generală", alterata: "alterată", febra: "febră", sangerare: "sângerare", crestere: "creștere",
  plaga: "plagă", plagii: "plăgii", ingrijirea: "îngrijirea", indicatiei: "indicației", afectiunii: "afecțiunii",
  troponina: "troponină", aspirina: "aspirină", atorvastatina: "atorvastatină", enoxaparina: "enoxaparină",
  durata: "durată", saptamana: "săptămână", pacienta: "pacientă"
};
function zenaPolish(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t.replace(/\b([a-zăâîșțA-ZĂÂÎȘȚ]+)\b/g, word => {
    const fix = DIAC[word.toLowerCase()];
    if (!fix) return word;
    return word[0] === word[0].toUpperCase() ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix;
  });
  t = t.replace(/\bta\b/gi, "TA").replace(/\bav\b/gi, "AV").replace(/\bekg\b/gi, "ECG").replace(/\bspo2\b/gi, "SpO₂");
  t = t.replace(/(^|[.!?]\s+)([a-zăâîșț])/gi, (m, lead, ch) => lead + ch.toUpperCase());
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}
function heardFor(key) {
  const rough = {
    dx: "infarct miocardic acut, evolutie favorabila",
    secondary: "hipertensiune arteriala esentiala",
    history: "s-a prezentat pentru durere toracica cu iradiere in brat",
    epic: "evolutie buna sub tratament, fara durere in repaus, dispnee in scadere",
    studies: "ekg cu modificari de repolarizare, troponina in scadere",
    treat: "aspirina, bisoprolol si enoxaparina pe durata internarii",
    state: "stabil hemodinamic, fara durere, apt de externare",
    recs: "control cardiologie peste 7 zile si tratament la domiciliu conform retetei"
  };
  return rough[key] || "text dictat";
}
function writeLetterField(key, text, note) {
  if (!ui.letterDraft) return;
  ui.letterDraft.cards[key] = text;
  const field = document.getElementById("let-" + key);
  const hint = document.getElementById("let-note-" + key);
  if (field) field.value = text;
  if (hint) hint.textContent = note || "";
}
function dischargeHtml(w, p) {
  const draft = ui.draft && ui.draft.patientId === p.id ? ui.draft : null;
  const dx = draft ? draft.dx : p.dx;
  const secondary = draft ? draft.secondary : "";
  const epic = draft ? draft.epicrisis : epicrisis(p, w);
  const rec = draft ? draft.recommendations : (RECS[w.focus] || RECS.general);
  const notes = (p.notes || []).slice().sort((a, b) => a.at.localeCompare(b.at));
  const last = notes[notes.length - 1];
  const open = p.studies.filter(s => s.status !== "finalizat").length;
  const done = p.studies.filter(s => s.status === "finalizat").length;
  return `<div class="card"><div class="card-head"><h2>Externare</h2><span class="sub">Scrisoarea se compune din foaie</span></div><div class="card-body">
    <p class="lead">Epicriza pornește din evoluția zilnică și din investigațiile deja trecute. O puteți corecta înainte de emitere. La emitere, patul se eliberează.</p>
    ${open ? `<div class="msg">${open} ${open === 1 ? "investigație este" : "investigații sunt"} încă în lucru. În scrisoare apar ca nefinalizate.</div>` : ""}
    <div class="msg info">${notes.length} evoluții${last ? ` · ultima ${esc(fmt(last.at))}` : ""} · ${done} investigații finalizate · ${p.supplies.length} materiale descărcate. Medicul de gardă: ${esc(dutyName(w, "medic"))}.</div>
    <div class="fields">
      <div class="span-2"><label class="lbl" for="dx-out">Diagnostic de externare <span class="req">*</span></label><input id="dx-out" type="text" value="${esc(dx)}"></div>
      <div class="span-2"><label class="lbl" for="dx-sec">Diagnostice secundare</label><input id="dx-sec" type="text" value="${esc(secondary)}" placeholder="Opțional"></div>
      <div class="span-2"><label class="lbl" for="epic">Epicriză <span class="req">*</span></label><textarea id="epic">${esc(epic)}</textarea></div>
      <div class="span-2"><label class="lbl" for="recs">Recomandări <span class="req">*</span></label><textarea id="recs">${esc(rec)}</textarea></div>
    </div>
    <div class="form-actions"><button class="btn" type="button" data-act="preview">Previzualizează scrisoarea</button><button class="btn btn-primary" type="button" data-act="emit">Emite și externează</button></div>
  </div></div>`;
}
function letterHtml(w, p, letter) {
  const L = letter || {};
  const lines = (p.studies || []).map(s => `<li>${esc(studyLine(s))}</li>`).join("");
  return `<article class="letter-sheet">
    <div class="muted">Cod unitate BH01</div>
    <h2>Scrisoare medicală</h2>
    <p class="muted" style="margin-top:4px">${esc(L.number || "Ciornă")} · ${esc(p.fileNo)} · ${esc(w.name)}</p>
    <dl class="kv" style="margin-top:16px">
      <dt>Pacient</dt><dd>${esc(p.last)} ${esc(p.first)}</dd>
      <dt>CNP</dt><dd class="mono">${esc(p.cnp)}</dd>
      <dt>Vârstă</dt><dd>${ageOf(p.birth)} ani · ${sexLabel(p.sex)}</dd>
      <dt>Internat</dt><dd>${esc(fmtDay(p.admitted))}</dd>
      <dt>Externat</dt><dd>${esc(fmtDay(L.issued || p.discharged || todayKey()))}</dd>
      <dt>Pat</dt><dd>${p.bed ? pad(p.bed) : "eliberat"}</dd>
      <dt>Diagnostic</dt><dd>${esc(L.dx || p.dx)}</dd>
      ${L.secondary ? `<dt>Secundare</dt><dd>${esc(L.secondary)}</dd>` : ""}
      <dt>Medic</dt><dd>${esc(p.physician)}</dd>
    </dl>
    ${L.history ? `<h3>Motivul internării</h3><p>${esc(L.history)}</p>` : ""}
    <h3>Epicriză</h3>
    <p>${esc(L.epicrisis || "")}</p>
    <h3>Investigații</h3>
    ${L.studies ? `<p>${esc(L.studies)}</p>` : `<ul>${lines || "<li>Nu au fost înregistrate investigații finalizate.</li>"}</ul>`}
    ${L.treatment ? `<h3>Tratament</h3><p>${esc(L.treatment)}</p>` : ""}
    ${L.state ? `<h3>Stare la externare</h3><p>${esc(L.state)}</p>` : ""}
    <h3>Recomandări</h3>
    <p>${esc(L.recommendations || "")}</p>
    <div class="sign"><div>${esc(p.physician)}<div class="line">Medic curant</div></div></div>
  </article>`;
}
function pageProtocol() {
  const w = ward(), p = patient();
  if (!w || !p) return topHtml("Protocol operator", "Secție", `<button class="btn" type="button" data-act="back-ward">Înapoi</button>`) + `<div class="content"><p class="lead">Protocolul nu este disponibil.</p></div>`;
  const plan = orPlan(w, p);
  const place = p.bed ? placeOf(p) : "Externat";
  const allergy = p.allergies && p.allergies !== "Nu se cunosc"
    ? `<span class="allergy">Alergie: ${esc(p.allergies)}</span>`
    : `Alergie: nu se cunosc`;
  const phaseCls = plan.phase === "Încheiată" ? "ok" : plan.phase === "În sală" ? "warn" : "";
  const back = `<button class="back" type="button" data-act="back-ward" title="Înapoi la secție">←</button>`;
  const actions = `<button class="btn" type="button" data-act="back-ward">Înapoi la secție</button><button class="btn btn-sheet" type="button" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}">Vezi foaia</button>`;
  const role = (label, name) => `<article class="op-role"><span>${label}</span><b>${esc(name)}</b></article>`;
  const step = (iso, title, lines) => `<section class="op-step"><time>${esc(fmtClock(iso))}</time><div><h3>${esc(title)}</h3><ul>${lines.map(line => `<li>${esc(line)}</li>`).join("")}</ul></div></section>`;
  return topHtml("Protocol operator", "Sala " + plan.room + " · " + plan.op, actions, back) + `<div class="content">
    <div class="banner">
      <div><h2>${esc(p.last)} ${esc(p.first)}</h2><p class="pid-meta">${ageOf(p.birth)} ani · ${esc(sexLabel(p.sex))} · ${esc(p.fileNo)} · ${esc(place)} · ${esc(p.dx)} · Grupa ${esc(p.blood || "—")} · ${allergy}</p></div>
      <div class="op-side"><span class="sala-pill">Sala ${plan.room}</span><span class="badge ${phaseCls}">${esc(plan.phase)}</span></div>
    </div>
    <div class="op-facts">
      <div><span>Operație</span><b>${esc(plan.op)}</b></div>
      <div><span>Data</span><b>${esc(fmtDay(plan.start))}</b></div>
      <div><span>Oră</span><b>${esc(fmtClock(plan.start))}–${esc(fmtClock(plan.end))}</b></div>
      <div><span>Durată</span><b>${plan.dur} min</b></div>
    </div>
    <div class="op-team">
      ${role("Operator", plan.operator)}
      ${role("Ajutor operator", plan.help)}
      ${role("Anestezist", plan.anest)}
      ${role("Asistentă anestezie", plan.anestNurse)}
      ${role("Instrumentar", plan.scrub)}
      ${role("Asistentă circulantă", plan.circ)}
    </div>
    <div class="op-flow">
      ${step(shiftMin(plan.start, -30), "Medicație administrată preoperator", plan.preLines)}
      ${step(plan.start, "Intrare în sală", ["Sala " + plan.room + ".", "Poziționare și pregătirea câmpului."])}
      ${step(shiftMin(plan.start, 5), "Anestezie", [plan.an, plan.induce, plan.keep, "ASA " + (ageOf(p.birth) >= 75 || p.status === "critic" ? "III" : "II") + "."])}
      ${step(shiftMin(plan.start, 15), "Intervenție", plan.opLines)}
      ${step(plan.end, "Instrumentar", [plan.kit, plan.count])}
      ${step(plan.wakeAt, "Trezire", [plan.wake])}
      ${step(plan.hand, "Predare pe secție", [plan.after])}
    </div>
    <p class="op-note">Protocol orientativ de demonstrație, pentru parcursul sălii. Foaia semnată rămâne documentul operator.</p>
  </div>`;
}
function pageLetter() {
  const w = ward(), p = patient();
  const draft = ui.draft && ui.draft.patientId === p.id ? ui.draft : null;
  const letter = draft ? { ...draft, number: "Ciornă", issued: todayKey() } : p.letter;
  const back = draft ? `<button class="btn" type="button" data-act="back-discharge">Înapoi la fișă</button>` : `<button class="btn" type="button" data-act="discharges">Externări</button>`;
  const emit = draft ? `<button class="btn btn-primary" type="button" data-act="emit">Emite și externează</button>` : `<button class="btn btn-primary" type="button" data-act="print">Tipărește</button>`;
  return topHtml("Scrisoare medicală", "ZenAIos · " + w.name + " · " + p.last + " " + p.first, back + emit) + `<div class="content">
    ${draft ? `<div class="msg info no-print">Ciornă. Pacientul este încă internat pe patul ${pad(p.bed)}.</div>` : ""}
    <div class="letter-wrap">${letterHtml(w, p, letter)}</div>
  </div>`;
}
function pageAdmit() {
  const w = ward();
  const free = freeBeds(w);
  if (!free.length) {
    const ready = w.patients.filter(p => p.status === "pregatit");
    return topHtml("Internare", "ZenAIos · " + w.name, `<button class="btn" type="button" data-act="back-ward">Înapoi</button>`) + `<div class="content">
      <div class="msg">Toate paturile deschise sunt ocupate. Externarea unui pacient eliberează patul.</div>
      <div class="card"><div class="card-head"><h2>Pregătiți de externare</h2></div><div class="card-body tight"><table><tbody>
        ${ready.map(p => `<tr class="click" data-act="patient" data-id="${esc(w.id)}" data-pid="${esc(p.id)}" data-tab="externare"><td class="mono">${pad(p.bed)}</td><td class="name">${esc(p.last)} ${esc(p.first)}</td><td>${esc(p.dx)}</td><td><span class="badge warn">Deschide externarea</span></td></tr>`).join("") || `<tr><td class="muted" style="padding:16px">Niciun pacient marcat pentru externare. Deschideți o fișă și folosiți fila Externare.</td></tr>`}
      </tbody></table></div></div>
    </div>`;
  }
  const bed = free.includes(ui.bed) ? ui.bed : free[0];
  return topHtml("Internare", "ZenAIos · " + w.name + " · pat liber", `<button class="btn" type="button" data-act="back-ward">Renunță</button><button class="btn btn-primary" type="button" data-act="save-admit">Salvează internarea</button>`) + `<div class="content">
    <div class="card"><div class="card-head"><h2>Pacient nou în ${esc(w.name)}</h2><span class="sub">${free.length} paturi libere</span><button class="btn btn-pink" type="button" data-act="load-system">Încarcă din sistem</button></div><div class="card-body"><div class="fields admit-fields">
      <div class="span-3 section-title">Identitate</div>
      <div><label class="lbl" for="adm-last">Nume <span class="req">*</span></label><input id="adm-last" type="text"></div>
      <div><label class="lbl" for="adm-first">Prenume <span class="req">*</span></label><input id="adm-first" type="text"></div>
      <div><label class="lbl" for="adm-cnp">CNP <span class="req">*</span></label><div class="inline"><input id="adm-cnp" type="text" maxlength="13" inputmode="numeric"><button class="btn" type="button" data-act="check-cnp">Verifică</button></div></div>
      <div><label class="lbl" for="adm-birth">Data nașterii</label><input id="adm-birth" type="date"></div>
      <div><label class="lbl" for="adm-sex">Sex</label><select id="adm-sex"><option value="F">Feminin</option><option value="M">Masculin</option></select></div>
      <div><label class="lbl" for="adm-phone">Telefon</label><input id="adm-phone" type="text"></div>
      <div class="span-2"><label class="lbl" for="adm-addr">Adresă</label><input id="adm-addr" type="text" placeholder="Stradă, număr, localitate"></div>
      <div><label class="check"><input id="adm-ins" type="checkbox" checked> Pacient asigurat</label></div>
      <div class="span-3 section-title">Internare</div>
      <div><label class="lbl" for="adm-bed">Pat <span class="req">*</span></label><select id="adm-bed">${free.map(b => `<option value="${b}"${b === bed ? " selected" : ""}>Salon ${Math.ceil(b / 4)} · Pat ${localPat(b)} · nr. ${pad(b)}</option>`).join("")}</select></div>
      <div><label class="lbl" for="adm-md">Medic curant</label><select id="adm-md">${medics(w).map(m => `<option>${esc(m)}</option>`).join("")}</select></div>
      <div><label class="lbl" for="adm-type">Tip</label><select id="adm-type"><option>Urgență</option><option>Programată</option></select></div>
      <div><label class="lbl" for="adm-casa">Casă</label><select id="adm-casa"><option>CJAS Bihor</option><option>CJAS Cluj</option><option>CNAS</option></select></div>
      <div><label class="lbl" for="adm-from">Trimis de</label><select id="adm-from"><option>Ambulanță</option><option>Medic de familie</option><option>Transfer</option><option>Prezentare directă</option></select></div>
      <div><label class="lbl" for="adm-alg">Alergii</label><input id="adm-alg" type="text" value="Nu se cunosc"></div>
      <div><label class="lbl" for="adm-blood">Grupa de sânge</label><select id="adm-blood"><option>0(I) Rh+</option><option>A(II) Rh+</option><option>B(III) Rh+</option><option>AB(IV) Rh+</option><option>0(I) Rh−</option><option>A(II) Rh−</option><option>B(III) Rh−</option><option>AB(IV) Rh−</option><option>Necunoscută</option></select></div>
      <div><label class="lbl" for="adm-kin">Aparținător</label><input id="adm-kin" type="text" placeholder="Nume"></div>
      <div><label class="lbl" for="adm-kin-phone">Telefon aparținător</label><input id="adm-kin-phone" type="text"></div>
      <div><label class="lbl" for="adm-kg">Greutate (kg)</label><input id="adm-kg" type="number" placeholder="70"></div>
      <div><label class="lbl" for="adm-cm">Înălțime (cm)</label><input id="adm-cm" type="number" placeholder="170"></div>
      <div class="span-3"><label class="lbl" for="adm-reason">Motivul internării</label><input id="adm-reason" type="text" placeholder="De ce este internat acum"></div>
      <div class="span-3"><label class="lbl" for="adm-ante">Antecedente</label><input id="adm-ante" type="text" placeholder="Boli cunoscute, operații, tratament la domiciliu"></div>
      <div class="span-3"><label class="lbl" for="adm-dx">Diagnostic de internare <span class="req">*</span></label><input id="adm-dx" type="text" placeholder="Cod ICD și denumire, ex. I21.4 Infarct"></div>
      <div class="span-3"><label class="lbl" for="adm-sec">Diagnostice secundare</label><input id="adm-sec" type="text" placeholder="Opțional, cu cod"></div>
      <div><label class="check"><input id="adm-ca" type="checkbox" checked> Acord pentru internare</label></div>
      <div><label class="check"><input id="adm-cp" type="checkbox"> Acord pentru procedură</label></div>
    </div></div></div>
  </div>`;
}
function pageDischarges() {
  const rows = [];
  state.wards.forEach(w => w.discharged.forEach(p => { if (inSheetRange(p.discharged)) rows.push({ w, p }); }));
  rows.sort((a, b) => (b.p.discharged || "").localeCompare(a.p.discharged || ""));
  const size = 10;
  const count = Math.max(1, Math.ceil(rows.length / size));
  if (ui.sheetPage >= count) ui.sheetPage = 0;
  const start = ui.sheetPage * size;
  const slice = rows.slice(start, start + size);
  const body = slice.map(({ w, p }) => `<tr><td class="name">${esc(p.last)} ${esc(p.first)}</td><td>${esc(w.name)}</td><td>${esc(fmtDay(p.discharged))}</td><td class="clip">${esc(p.letter?.dx || p.dx)}</td><td class="mono">${esc(p.letter?.number || "")}</td><td><button class="btn btn-sm" type="button" data-act="open-letter" data-id="${esc(w.id)}" data-pid="${esc(p.id)}">Scrisoare</button></td></tr>`).join("");
  const sub = rows.length ? `${start + 1}–${start + slice.length} din ${rows.length}` : "0";
  return topHtml("Externări", "ZenAIos · Scrisori medicale", "") + `<div class="content"><div class="card"><div class="card-head"><h2>Scrisori emise</h2><span class="sub">${sub}</span></div><div class="card-body tight"><table><thead><tr><th>Pacient</th><th>Secție</th><th>Externat</th><th>Diagnostic</th><th>Număr</th><th></th></tr></thead><tbody>${body || `<tr><td colspan="6" class="muted" style="padding:16px">Nicio externare.</td></tr>`}</tbody></table></div></div>${sheetPager(count)}</div>`;
}
function pageNewWard() {
  return topHtml("Secție nouă", "ZenAIos · Extindere", `<button class="btn" type="button" data-act="home">Renunță</button><button class="btn btn-primary" type="button" data-act="save-ward">Creează secția</button>`) + `<div class="content">
    <p class="lead">Secția primește 20 de paturi goale, gardă, gestiune de materiale și același flux: evoluție, investigații, descărcare pe pacient, externare și scrisoare.</p>
    <div class="card"><div class="card-body"><div class="fields">
      <div><label class="lbl" for="nw-name">Denumire <span class="req">*</span></label><input id="nw-name" type="text" placeholder="Neurologie"></div>
      <div><label class="lbl" for="nw-chief">Medic șef <span class="req">*</span></label><input id="nw-chief" type="text" placeholder="Dr. Popescu"></div>
      <div class="span-2"><label class="lbl" for="nw-nurse">Asistent șef</label><input id="nw-nurse" type="text" placeholder="Opțional"></div>
    </div></div></div>
  </div>`;
}

function adminWard() { return state.wards.find(w => w.id === ui.wardId) || state.wards[0]; }
function wardSwitch() {
  const current = adminWard();
  return `<div class="chips" style="margin-bottom:12px">${state.wards.map(w => `<button type="button" class="${current && current.id === w.id ? "on" : ""}" data-act="pick-ward" data-id="${esc(w.id)}">${esc(w.name)}</button>`).join("")}</div>`;
}
function pageGest() {
  const type = (state.gestTypes || []).find(t => t.id === ui.gest) || (state.gestTypes || [])[0];
  if (!type) return topHtml("Gestiune", "Administrare", "") + `<div class="content"><p class="lead">Nu există încă un tip de gestiune.</p></div>`;
  ui.gest = type.id;
  if (type.mode === "list") return listGest(type);
  const w = adminWard();
  return topHtml(type.name, "Gestiune · " + (w ? w.name : ""), "") + `<div class="content"><p class="lead">Stocul secției. Adăugarea și ștergerea se fac aici. Pe secție se doar consumă.</p>${wardSwitch()}${gestBody(w)}</div>`;
}
function listGest(type) {
  const rows = (type.items || []).map(item => `<tr><td class="name">${esc(item.name)}</td><td class="mono">${item.qty}</td><td>${esc(item.unit)}</td><td><button class="btn btn-sm" type="button" data-act="del-gest-item" data-gid="${esc(item.id)}">Șterge</button></td></tr>`).join("");
  return topHtml(type.name, "Gestiune de spital", "") + `<div class="content"><p class="lead">Registru de spital pentru acest tip de gestiune. Se adaugă și se șterge de aici.</p>
    <div class="card"><div class="card-head"><h2>${esc(type.name)}</h2></div><div class="card-body tight"><table><thead><tr><th>Denumire</th><th>Cantitate</th><th>UM</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="muted" style="padding:16px">Nicio poziție.</td></tr>`}</tbody></table></div>
    <div class="card-body"><div class="fields">
      <div><label class="lbl" for="gi-name">Denumire</label><input id="gi-name" type="text"></div>
      <div><label class="lbl" for="gi-qty">Cantitate</label><input id="gi-qty" type="number" min="1" value="10"></div>
      <div><label class="lbl" for="gi-unit">UM</label><input id="gi-unit" type="text" value="buc"></div>
    </div><div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-gest-item">Adaugă</button></div></div></div></div>`;
}
function pageGestNew() {
  return topHtml("Tip nou de gestiune", "Gestiune", `<button class="btn" type="button" data-act="home">Renunță</button><button class="btn btn-primary" type="button" data-act="save-gest-type">Creează</button>`) + `<div class="content"><div class="card"><div class="card-body"><div class="fields"><div class="span-2"><label class="lbl" for="gt-name">Denumire</label><input id="gt-name" type="text" placeholder="Alimentație, lenjerie, dispozitive"></div></div></div></div></div>`;
}
function pagePeople() {
  const spec = staffSpec()[ui.staffCat] || staffSpec().medici;
  const rows = (state.people || []).filter(p => p.cat === ui.staffCat);
  const head = spec.cols.map(([, label]) => `<th>${label}</th>`).join("");
  const body = rows.map(p => `<tr>${spec.cols.map(([key]) => `<td>${esc(p.fields[key] || "")}</td>`).join("")}<td><button class="btn btn-sm" type="button" data-act="del-person" data-pid="${esc(p.id)}">Șterge</button></td></tr>`).join("");
  const fields = spec.cols.map(([key, label]) => `<div><label class="lbl" for="pf-${key}">${label}</label><input id="pf-${key}" type="text"></div>`).join("");
  return topHtml(spec.label, "Registru de personal", "") + `<div class="content"><p class="lead">Fișele sunt ale spitalului. Se adaugă și se șterg cu datele proprii fiecărei categorii.</p>
    <div class="card"><div class="card-head"><h2>${esc(spec.label)}</h2><span class="sub">${rows.length} fișe</span></div><div class="card-body tight"><table><thead><tr>${head}<th></th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="card-body"><div class="fields">${fields}</div><div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-person">Adaugă fișa</button></div></div></div></div>`;
}
function pageDept() {
  const dept = (state.departments || []).find(d => d.id === ui.deptId);
  if (!dept) return pageDeptForm(null);
  return pageDeptForm(dept);
}
function pageDeptForm(dept) {
  const title = dept ? dept.name : "Departament nou";
  const del = dept ? `<button class="btn" type="button" data-act="del-dept">Șterge</button>` : `<button class="btn" type="button" data-act="home">Renunță</button>`;
  return topHtml(title, "Departamente", `${del}<button class="btn btn-primary" type="button" data-act="save-dept">Salvează</button>`) + `<div class="content"><p class="lead">Departamentele care nu sunt secții de paturi: IT, SPIAAM, calitate și celelalte structuri ale spitalului.</p>
    <div class="card"><div class="card-body"><div class="fields">
      <div><label class="lbl" for="dp-name">Denumire</label><input id="dp-name" type="text" value="${esc(dept ? dept.name : "")}"></div>
      <div><label class="lbl" for="dp-chief">Responsabil</label><input id="dp-chief" type="text" value="${esc(dept ? dept.chief : "")}"></div>
      <div><label class="lbl" for="dp-phone">Interior</label><input id="dp-phone" type="text" value="${esc(dept ? dept.phone : "")}"></div>
      <div class="span-2"><label class="lbl" for="dp-mission">Rol</label><input id="dp-mission" type="text" value="${esc(dept ? dept.mission : "")}"></div>
    </div></div></div></div>`;
}
function pageSetup() {
  const w = adminWard();
  const previous = ui.gest;
  ui.gest = "paturi";
  const beds = gestBody(w);
  ui.gest = previous;
  return topHtml("Configurare secție", "Secții", `<button class="btn btn-primary" type="button" data-act="save-ward">Creează secția</button>`) + `<div class="content">
    <p class="lead">O secție nouă primește paturi, magazie și același flux clinic. Mai jos se închid sau se adaugă paturi la o secție care există. Patul ocupat nu se închide.</p>
    <div class="card" style="margin-bottom:12px"><div class="card-head"><h2>Secție nouă</h2></div><div class="card-body"><div class="fields">
      <div><label class="lbl" for="nw-name">Denumire</label><input id="nw-name" type="text" placeholder="Neurologie"></div>
      <div><label class="lbl" for="nw-chief">Medic șef</label><input id="nw-chief" type="text" placeholder="Dr. Popescu"></div>
      <div class="span-2"><label class="lbl" for="nw-nurse">Asistent șef</label><input id="nw-nurse" type="text" placeholder="Opțional"></div>
    </div></div></div>
    <h2 style="font-size:14px">Paturile secției ${esc(w ? w.name : "")}</h2>
    ${wardSwitch()}${beds}
  </div>`;
}
function gestBody(w) {
  if (!w) return "";
  if (ui.gest === "medicamente") {
    const rows = (w.meds || []).map(m => `<tr class="${m.qty < m.min ? "low" : ""}"><td>${esc(m.group)}</td><td class="name">${esc(m.name)}</td><td>${esc(m.dose)}</td><td class="mono">${m.qty}</td><td>${esc(m.unit)}</td><td><button class="btn btn-sm" type="button" data-act="del-med" data-mid="${esc(m.id)}">Șterge</button></td></tr>`).join("");
    return `<div class="card"><div class="card-head"><h2>Nomenclator medicamente</h2></div><div class="card-body tight"><table><thead><tr><th>Grup</th><th>Medicament</th><th>Dozaj</th><th>Stoc</th><th>UM</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card-body"><div class="fields">
        <div><label class="lbl" for="med-group">Grup</label><select id="med-group"><option>Soluții perfuzabile</option><option>Cardiace</option><option>Antibiotice</option><option>Analgezice</option><option>Anticoagulante</option><option>Diuretice</option><option>Gastro</option><option>Respirator</option></select></div>
        <div><label class="lbl" for="med-name">Denumire</label><input id="med-name" type="text"></div>
        <div><label class="lbl" for="med-dose">Dozaj</label><input id="med-dose" type="text" placeholder="500 mg"></div>
        <div><label class="lbl" for="med-unit">UM</label><input id="med-unit" type="text" value="flacon"></div>
        <div><label class="lbl" for="med-add-qty">Stoc inițial</label><input id="med-add-qty" type="number" min="1" value="10"></div>
      </div><div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-med">Adaugă medicamentul</button></div></div></div>`;
  }
  if (ui.gest === "personal") {
    const rows = (w.staff || []).map(s => `<tr><td class="name">${esc(s.name)}</td><td>${esc(roleLabel(s.role))}</td><td><button class="btn btn-sm" type="button" data-act="del-staff" data-sid="${esc(s.id)}">Șterge</button></td></tr>`).join("");
    return `<div class="card"><div class="card-head"><h2>Personalul secției</h2></div><div class="card-body tight"><table><thead><tr><th>Nume</th><th>Rol</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card-body"><div class="fields">
        <div><label class="lbl" for="stf-name">Nume</label><input id="stf-name" type="text"></div>
        <div><label class="lbl" for="stf-role">Rol</label><select id="stf-role"><option value="medic">Medic</option><option value="asistenta">Asistentă</option><option value="infirmiera">Infirmieră</option><option value="brancardier">Brancardier</option></select></div>
      </div><div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-staff">Adaugă</button></div></div></div>`;
  }
  if (ui.gest === "paturi") {
    const rows = [];
    for (let b = 1; b <= bedCount(w); b++) {
      const p = onBed(w, b);
      const closed = isClosed(w, b);
      const action = closed ? `<button class="btn btn-sm" type="button" data-act="open-bed" data-bed="${b}">Redeschide</button>` : p ? `<span class="muted">Ocupat</span>` : `<button class="btn btn-sm" type="button" data-act="close-bed" data-bed="${b}">Închide</button>`;
      rows.push(`<tr><td class="mono">${pad(b)}</td><td>${p ? esc(p.last + " " + p.first) : closed ? "Închis" : "Liber"}</td><td>${action}</td></tr>`);
    }
    return `<div class="card"><div class="card-head"><h2>Paturi</h2><span class="sub">${bedCount(w)} în structură</span></div><div class="card-body tight"><table><thead><tr><th>Pat</th><th>Stare</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
      <div class="card-body"><button class="btn btn-primary" type="button" data-act="add-bed">Adaugă pat</button></div></div>`;
  }
  const rows = (w.stock || []).map(s => `<tr class="${s.qty < s.min ? "low" : ""}"><td class="name">${esc(s.name)}</td><td class="mono">${s.qty}</td><td>${esc(s.unit)}</td><td class="mono">${s.min}</td><td><button class="btn btn-sm" type="button" data-act="del-stock" data-name="${esc(s.name)}">Șterge</button></td></tr>`).join("");
  return `<div class="card"><div class="card-head"><h2>Materiale sanitare</h2></div><div class="card-body tight"><table><thead><tr><th>Material</th><th>Stoc</th><th>UM</th><th>Prag</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="card-body"><div class="fields">
      <div><label class="lbl" for="stk-name">Material</label><input id="stk-name" type="text" list="stk-list"><datalist id="stk-list">${SUPPLY.map(([name]) => `<option value="${esc(name)}"></option>`).join("")}</datalist></div>
      <div><label class="lbl" for="stk-qty">Cantitate</label><input id="stk-qty" type="number" min="1" value="10"></div>
    </div><div class="form-actions"><button class="btn btn-primary" type="button" data-act="add-stock">Adaugă sau completează</button></div></div></div>`;
}
function pageAdmin() {
  const h = state.hospital;
  const g = state.integrations;
  if (!ui.adminIn && !live) {
    return topHtml("Administrator", "Intrare în configurare", "") + `<div class="content"><div class="card" style="max-width:440px"><div class="card-head"><h2>Sesiune</h2></div><div class="card-body">
      <p class="muted">Contul de demonstrație este completat. Intrarea nu cere alt utilizator.</p>
      <div class="fields" style="margin-top:12px">
        <div class="span-2"><label class="lbl" for="gate-user">Utilizator</label><input id="gate-user" type="text" value="admin" autocomplete="username"></div>
        <div class="span-2"><label class="lbl" for="gate-pass">Parolă</label><input id="gate-pass" type="password" value="1234" autocomplete="current-password"></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" type="button" data-act="admin-login">Intră</button></div>
    </div></div></div>`;
  }
  ui.adminIn = true;
  const models = ["gpt-4o-mini", "gpt-4o", "gpt-4.1"];
  const scopeLabel = ui.hospitalWideAccess === false ? `${ui.wardScopeIds?.length || 0} secții în domeniu` : "tot spitalul";
  return topHtml("Administrator", "Configurare · sesiune deschisă ca admin", `<button class="btn" type="button" data-act="admin-logout">Ieșire</button><button class="btn btn-primary" type="button" data-act="save-admin">Salvează</button>`) + `<div class="content">
    <p class="lead">Sesiunea este deschisă automat. De aici se setează identitatea spitalului, legăturile clinice și operațiunile de scală (LIS, backup, domeniu pe secție).</p>
    <div class="card" style="margin-bottom:12px"><div class="card-head"><h2>Platformă spital</h2><span class="sub">${live ? "conectat la API" : "offline"}</span></div><div class="card-body">
      <p class="muted" style="margin:0 0 10px">Utilizator: <b>${esc(ui.accountName || "—")}</b> · Domeniu: <b>${esc(scopeLabel)}</b> · Secții pe panou: <b>${ui.apiBoardTotal || visibleWards().length}</b></p>
      <p class="muted" style="margin:0 0 12px">${esc(ui.platformNote || "Sincronizați structura ca să legați secțiile din foaie de baza clinică.")}</p>
      <div class="form-actions" style="justify-content:flex-start">
        <button class="btn btn-primary" type="button" data-act="ops-sync">Sincronizează structura</button>
        <button class="btn" type="button" data-act="ops-lis">Dispatch LIS</button>
        <button class="btn" type="button" data-act="ops-backup">Copie de rezervă</button>
      </div>
    </div></div>
    <div class="card" style="margin-bottom:12px"><div class="card-head"><h2>Spital</h2><span class="sub">identitate, nu date clinice</span></div><div class="card-body"><div class="fields">
      <div><label class="lbl" for="hosp-name">Denumire</label><input id="hosp-name" type="text" value="${esc(h.name)}"></div>
      <div><label class="lbl" for="hosp-code">Cod</label><input id="hosp-code" type="text" value="${esc(h.code)}"></div>
      <div><label class="lbl" for="hosp-country">Țară</label><input id="hosp-country" type="text" value="${esc(h.country)}"></div>
      <div><label class="lbl" for="hosp-locale">Limbă</label><input id="hosp-locale" type="text" value="${esc(h.locale)}"></div>
      <div class="span-2"><label class="lbl" for="hosp-tz">Fus orar</label><input id="hosp-tz" type="text" value="${esc(h.timezone)}"></div>
    </div></div></div>
    <div class="card" style="margin-bottom:12px"><div class="card-head"><h2>ChatGPT</h2><span class="sub">${g.openaiKey ? "cheie prezentă în această sesiune" : "fără cheie"}</span></div><div class="card-body"><div class="fields">
      <div class="span-2"><label class="lbl" for="ai-key">Cheie API</label><input id="ai-key" type="password" value="${esc(g.openaiKey || "")}" placeholder="sk-..." autocomplete="off"></div>
      <div><label class="lbl" for="ai-model">Model</label><select id="ai-model">${models.map(m => `<option${m === g.openaiModel ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
      <div><label class="lbl" for="ai-base">Adresă API</label><input id="ai-base" type="text" value="${esc(g.openaiBase || "")}"></div>
      <div class="span-2"><label class="check"><input id="ai-letter" type="checkbox"${g.aiLetter ? " checked" : ""}> Corectarea scrisorii de externare</label></div>
      <div class="span-2"><label class="check"><input id="ai-alerts" type="checkbox"${g.aiAlerts ? " checked" : ""}> Alertele de pe foaie</label></div>
    </div>
    <p class="muted" style="margin-top:10px">Cheia rămâne în browserul acesta, ca demonstrație. Într-un spital ea stă pe server și nu se scrie în pagină.</p>
    </div></div>
    <div class="card"><div class="card-head"><h2>Legături</h2><span class="sub">adrese, încă fără conector</span></div><div class="card-body"><div class="fields">
      <div><label class="lbl" for="link-fhir">FHIR</label><input id="link-fhir" type="text" value="${esc(g.fhir || "")}" placeholder="https://fhir.spital/r4"></div>
      <div><label class="lbl" for="link-adt">Internări / externări</label><input id="link-adt" type="text" value="${esc(g.adt || "")}" placeholder="https://adt.spital"></div>
      <div><label class="lbl" for="link-lis">Laborator</label><input id="link-lis" type="text" value="${esc(g.lis || "")}" placeholder="https://lis.spital"></div>
      <div><label class="lbl" for="link-pacs">Imagistică</label><input id="link-pacs" type="text" value="${esc(g.pacs || "")}" placeholder="https://pacs.spital"></div>
    </div></div></div>
  </div>`;
}
function saveAdmin() {
  const keyEl = document.getElementById("ai-key");
  state.hospital = {
    name: val("hosp-name") || state.hospital.name,
    code: val("hosp-code") || state.hospital.code,
    country: val("hosp-country") || state.hospital.country,
    timezone: val("hosp-tz") || state.hospital.timezone,
    locale: val("hosp-locale") || state.hospital.locale
  };
  state.integrations = {
    openaiKey: keyEl ? keyEl.value.trim() : (state.integrations.openaiKey || ""),
    openaiModel: val("ai-model") || "gpt-4o-mini",
    openaiBase: val("ai-base") || "https://api.openai.com/v1",
    aiLetter: !!document.getElementById("ai-letter")?.checked,
    aiAlerts: !!document.getElementById("ai-alerts")?.checked,
    fhir: val("link-fhir"),
    lis: val("link-lis"),
    pacs: val("link-pacs"),
    adt: val("link-adt")
  };
  persist();
  toast(state.integrations.openaiKey ? "Configurarea a fost salvată. Cheia este în sesiunea browserului." : "Configurarea a fost salvată.");
  go({ page: "admin" });
}
function pageAiZena() {
  const heard = ui.aiHeard ? `<div class="me">${esc(ui.aiHeard)}</div>` : "";
  const reply = `<div class="bot">${esc(ui.aiReply || "Scrieți sau alegeți o propoziție. Deschid secția, gestiunea, personalul sau departamentul.")}</div>`;
  const chips = ["Deschide chirurgia", "Arată medicii", "Gestiunea de medicamente", "Deschide departamentele", "Configurare paturi"].map(text => `<button type="button" data-act="ai-hint" data-q="${esc(text)}">${esc(text)}</button>`).join("");
  const area = (title, text) => `<article><span>${title}</span><b>${text}</b></article>`;
  return topHtml("AI Zena", "Configurare cu voce") + `<div class="content"><div class="ai-wrap">
    <p class="lead">Un chat simplu pentru secții, gestiune, personal și departamente.</p>
    <section class="ai-chat">
      <div class="ai-log"><div class="bot">Bună. Spuneți ce doriți să configurați.</div>${heard}${ui.aiHeard ? reply : ""}</div>
      <div class="ai-chips">${chips}</div>
      <div class="ai-bar">
        <button class="mic" type="button" data-act="ai-mic" aria-pressed="false" title="Comandă vocală, demonstrație">${icon("i-mic")}</button>
        <input id="ai-q" type="text" placeholder="Spuneți ce configurați" aria-label="Comandă pentru AI Zena">
        <button class="btn btn-primary" type="button" data-act="ai-send">Configurează</button>
      </div>
    </section>
    <div class="ai-areas">
      ${area("Secții", "Deschide o secție sau paturile")}
      ${area("Gestiune", "Materiale, medicamente, lenjerie")}
      ${area("Personal", "Medici și asistenți")}
      ${area("Departamente", "IT, laborator, bloc")}
    </div>
  </div></div>`;
}
function zenaWelcome() {
  const w = ward();
  const p = ui.page === "patient" || ui.page === "protocol" ? patient() : null;
  if (ui.page === "ai-zena") return "Configurarea cu voce este pe ecran. De aici pot doar să explic unde duce o comandă.";
  if (p) return `Foaia este a pacientului ${p.last} ${p.first}, ${p.dx}. Pot rezuma evoluția, investigațiile sau medicația.`;
  if (ui.page === "ward" && w && ui.view === "magazie") return `Magazia de pe ${w.name}. Clasele sunt meniul de sus. Întrebați ce este sub prag.`;
  if (ui.page === "ward" && w && ui.view === "saloane") return `Saloanele de pe ${w.name}. Fundalul pal este salonul, cardul alb este pacientul.`;
  if (ui.page === "ward" && w && ui.view === "statistica") return `Statistica secției ${w.name}. Cifrele de lună stau lângă activitatea deja înregistrată.`;
  if (ui.page === "ward" && w) return `Lista de pe ${w.name}. ${occupied(w).length} internați, ${freeBeds(w).length} paturi libere. Paginile de jos schimbă lista.`;
  if (ui.page === "home") return "Pot spune cum se face o internare, ce secții sunt deschise și unde se află spitalul în demonstrație.";
  if (ui.page === "gest") return "Sunteți în gestiune. Spuneți dacă vreți medicamente, materiale sau alt stoc.";
  if (ui.page === "people") return "Registrul de personal. Pot îndruma spre medici, asistenți sau celelalte categorii.";
  return "Sunt pe pagina deschisă. Întrebați despre pacienți, stoc, programare sau secții.";
}
function zenaHints() {
  const p = ui.page === "patient" || ui.page === "protocol" ? patient() : null;
  if (p) return ["Rezumatul foii", "Ce investigații are", "Medicația de pe foaie"];
  if (ui.page === "ward" && ui.view === "magazie") return ["Ce este sub prag", "Câte paturi libere sunt", "Cine este critic"];
  if (ui.page === "ward" && ui.view === "saloane") return ["Câte paturi libere sunt", "Cine este critic", "Deschide lista de pacienți"];
  if (ui.page === "ward") return ["Câte paturi libere sunt", "Cine este critic", "Ce este sub prag"];
  if (ui.page === "home") return ["Cum pot face o programare?", "Ce servicii oferă spitalul?", "Cum ajung la spital?"];
  return ["Ce servicii oferă spitalul?", "Cum pot face o programare?", "Câte paturi libere sunt"];
}
function zenaAnswer(q) {
  const s = (q || "").toLowerCase();
  const w = ward();
  const p = patient();
  if (/program/.test(s)) return "Internarea se deschide de pe secție, cu butonul Internare, la un pat liber. Se completează numele, CNP-ul și diagnosticul.";
  if (/servici|secți/.test(s)) return "Secțiile deschise sunt Cardiologie, Chirurgie generală și Medicină internă. Fiecare are paturi, saloane, magazie și foaie.";
  if (/ajung|adres|unde este spital/.test(s)) return "În demonstrație spitalul este în Oradea. Adresa de pe foaie este a pacientului.";
  if (/list/.test(s) && w) return "Lista de pacienți este primul ecran al secției. Paginile numerotate schimbă internații, externările și istoricul.";
  if (/sub prag/.test(s) && w) {
    const low = (w.meds || []).filter(m => m.qty < m.min).map(m => m.name).concat((w.stock || []).filter(m => m.qty < m.min).map(m => m.name));
    return low.length ? "Sub prag: " + low.join(", ") + "." : "Pe această secție nimic nu este sub prag.";
  }
  if (/liber/.test(s) && w) return `Pe ${w.name} sunt ${freeBeds(w).length} paturi libere din ${bedCount(w)}.`;
  if (/critic/.test(s) && w) {
    const rows = occupied(w).filter(x => x.status === "critic");
    return rows.length ? "Necesită supraveghere: " + rows.map(x => x.last + " " + x.first).join(", ") + "." : "Niciun pacient critic pe această secție.";
  }
  if (p && /rezum|evolu|foa/.test(s)) {
    const notes = (p.notes || []).slice().sort((a, b) => a.at.localeCompare(b.at));
    const last = notes[notes.length - 1];
    return last ? last.text : "Nu există încă o evoluție pe foaie.";
  }
  if (p && /invest|analiz|imag/.test(s)) {
    const list = (p.studies || []).map(st => st.title + (st.status === "finalizat" ? "" : " (în lucru)"));
    return list.length ? list.join(" · ") : "Nu sunt investigații pe foaie.";
  }
  if (p && /medic/.test(s)) {
    const meds = (p.meds || []).map(m => m.name);
    return meds.length ? "Pe foaie: " + meds.join(", ") + "." : "Nu este trecută medicație pe această foaie.";
  }
  if (w && ui.page === "ward") {
    const view = ui.view === "saloane" ? "saloane" : ui.view === "magazie" ? "magazie" : ui.view === "statistica" ? "statistică" : "lista de pacienți";
    return `Sunteți la ${w.name}, pe ${view}. ${occupied(w).length} internați și ${freeBeds(w).length} paturi libere.`;
  }
  return "Pot vorbi despre secții, paturi libere, pacienți critici, stoc și foaia deschisă.";
}
function zenaAsk(q) {
  const text = (q || "").trim();
  if (!text) return;
  ui.zenaThread.push({ who: "me", text });
  ui.zenaThread.push({ who: "bot", text: zenaAnswer(text) });
  if (ui.zenaThread.length > 12) ui.zenaThread = ui.zenaThread.slice(-12);
  ui.zenaDraft = "";
  go({ zenaOpen: true });
}
function paintZena() {
  const dock = document.getElementById("zena-dock");
  if (!dock) return;
  if (!ui.zenaOpen) {
    dock.innerHTML = `<button class="zena-tab" type="button" data-act="zena-toggle" aria-expanded="false"><span>Asistență</span><i></i></button>`;
    return;
  }
  const hints = zenaHints().map(text => `<button type="button" data-act="zena-hint" data-q="${esc(text)}">${esc(text)}</button>`).join("");
  const log = (ui.zenaThread || []).map(row => `<div class="${row.who === "me" ? "me" : "bot"}">${esc(row.text)}</div>`).join("");
  dock.innerHTML = `<section class="zena-panel" aria-label="Asistent Zena">
    <header class="zena-head"><div class="zena-ava" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M5.5 19.2c1.2-3 3.4-4.5 6.5-4.5s5.3 1.5 6.5 4.5"/></svg></div><b>Zena</b><button class="zena-x" type="button" data-act="zena-toggle" aria-label="Restrânge">×</button></header>
    <div class="zena-body">
      <div class="zena-bubble"><p>Bun venit.</p><p>${esc(zenaWelcome())}</p><p>Încă învăț, așa că uneori pot greși.</p><p>Cum vă pot ajuta pe pagina aceasta?</p></div>
      <div class="zena-who">Zena</div>
      ${log ? `<div class="zena-log">${log}</div>` : ""}
      <div class="zena-hints">${hints}</div>
    </div>
    <div class="zena-foot">
      <button class="mic" type="button" data-act="zena-mic" aria-pressed="false" title="Mesaj vocal, demonstrație">${icon("i-mic")}</button>
      <input id="zena-q" type="text" placeholder="Spuneți-mi cu ce vă pot ajuta..." value="${esc(ui.zenaDraft || "")}" aria-label="Mesaj către Zena">
      <button class="zena-send" type="button" data-act="zena-send" aria-label="Trimite">↑</button>
    </div>
  </section>`;
  const body = dock.querySelector(".zena-body");
  if (body) body.scrollTop = body.scrollHeight;
}
function aiConfigure(text) {
  const s = (text || "").trim();
  if (!s) return;
  ui.aiHeard = s;
  const low = s.toLowerCase();
  const openWard = (id, name) => { ui.aiReply = "Deschid " + name + "."; go({ page: "ward", wardId: id, view: "paturi", filter: "all", query: "", doctor: null, sheetPage: 0, calOpen: false }, true); };
  if (/chirurg/.test(low)) return openWard("chir", "Chirurgie generală");
  if (/cardio/.test(low)) return openWard("cardio", "Cardiologie");
  if (/intern/.test(low) && !/medicament/.test(low)) return openWard("med", "Medicină internă");
  if (/medicament/.test(low)) { ui.aiReply = "Deschid gestiunea de medicamente."; return go({ page: "gest", gest: "medicamente", wardId: ui.wardId || (state.wards[0] && state.wards[0].id) }, true); }
  if (/material|lenjer|dezinfect/.test(low)) {
    const id = /lenjer/.test(low) ? "lenjerie" : /dezinfect/.test(low) ? "dezinfectanti" : "materiale";
    ui.aiReply = "Deschid gestiunea cerută.";
    return go({ page: "gest", gest: id, wardId: ui.wardId || (state.wards[0] && state.wards[0].id) }, true);
  }
  if (/asist/.test(low)) { ui.aiReply = "Deschid registrul de asistenți."; return go({ page: "people", staffCat: "asistenti" }, true); }
  if (/medic/.test(low)) { ui.aiReply = "Deschid registrul de medici."; return go({ page: "people", staffCat: "medici" }, true); }
  if (/depart|laborator|bloc/.test(low)) {
    const dept = (state.departments || [])[0];
    ui.aiReply = "Deschid departamentele.";
    return go({ page: "dept", deptId: dept ? dept.id : null }, true);
  }
  if (/pat|secți|config/.test(low)) { ui.aiReply = "Deschid configurarea de paturi."; return go({ page: "setup", gest: "paturi" }, true); }
  ui.aiReply = "Spuneți secția, gestiunea, personalul sau departamentul. De exemplu: „deschide chirurgia”.";
  go({ page: "ai-zena" });
}
function fnv(s) {
  let n = 2166136261;
  for (const ch of String(s || "")) { n ^= ch.charCodeAt(0); n = Math.imul(n, 16777619); }
  return n >>> 0;
}
function samePerson(a, b) {
  return !!(a && b && a.cnp && a.cnp === b.cnp);
}
function kinOf(p) {
  if (p && p.kinName) return { who: p.kinWho || "aparținător", name: p.kinName, phone: p.kinPhone || "" };
  const n = fnv(p.cnp || p.id);
  const who = ["soția", "soțul", "fiica", "fiul", "sora", "fratele"][n % 6];
  const names = ["Popa Elena", "Pop Andrei", "Ionescu Ana", "Stan Mihai", "Luca Maria", "Horvat Radu"];
  const phone = "07" + pad(20 + (n % 70)) + " " + String(100 + (n % 800)) + " " + String(100 + ((n >> 8) % 800));
  return { who, name: names[n % names.length], phone };
}
function antecedentsOf(p) {
  if (p && p.antecedents) return String(p.antecedents).split(/\.\s+/).map(s => s.replace(/\.$/, "").trim()).filter(Boolean);
  const pool = [
    "Hipertensiune arterială esențială, din 2014",
    "Dislipidemie, statină la domiciliu",
    "Diabet zaharat tip 2, fără insulină",
    "Apendicectomie în 1998",
    "Fost fumător, oprit de 6 ani",
    "Boală cardiacă ischemică cunoscută",
    "Hernie inghinală operată în 2019",
    "Astm bronșic, salbutamol la nevoie"
  ];
  const n = fnv(p.cnp || p.id);
  const a = pool[n % pool.length];
  const b = pool[(n >>> 3) % pool.length];
  const list = a === b ? [a] : [a, b];
  if (p.allergies && p.allergies !== "Nu se cunosc") list.push("Alergie medicamentoasă: " + p.allergies);
  return list;
}
function priorEpisode(p, k) {
  const specs = [
    { ward: "Cardiologie", dx: "I20.0 Angină pectorală instabilă", meds: ["Bisoprolol 5 mg", "Atorvastatină 40 mg", "Aspirină 75 mg"] },
    { ward: "Medicină internă", dx: "J18.9 Pneumonie", meds: ["Ceftriaxonă 1 g", "Paracetamol 1 g"] },
    { ward: "Chirurgie generală", dx: "K80.0 Litiază biliară cu colecistită acută", meds: ["Metamizol 1 g", "Ceftriaxonă 1 g", "Enoxaparină 40 mg"] }
  ];
  const n = fnv((p.cnp || p.id) + ":" + k);
  const spec = specs[k % specs.length];
  const admitAgo = 420 + k * 340 + (n % 40);
  const stay = 4 + (n % 8);
  const admitted = stamp(admitAgo, 9);
  const discharged = stamp(admitAgo - stay, 12);
  const year = admitted.slice(0, 4);
  const verb = p.sex === "F" ? "internată" : "internat";
  const labs = baseRows().map(r => ({ ...r }));
  if (k === 0) labs.find(r => r.name === "CRP").value = "18";
  const studies = [
    { kind: "analize", title: "Buletin de analize", result: "", rows: labs },
    { kind: "rx", title: k === 1 ? "Radiografie abdominală" : "Radiografie toracică", result: k === 1 ? "Fără aer liber subdiafragmatic. Fără nivele hidroaerice." : "Cord în limite. Fără condensare. Sinusuri libere.", rows: [] }
  ];
  if (n % 2 === 0) studies.push({ kind: "ct", title: k === 2 ? "CT abdomen și pelvis" : "CT torace", result: k === 2 ? "Litiază veziculară. Fără colecție perihepatică." : "Fără embolie pulmonară. Fără revărsat.", rows: [] });
  else studies.push({ kind: "echo", title: "Ecografie abdominală", result: "Fără lichid liber. Vezica biliară cu calcul.", rows: [] });
  if (k === 2) studies.push({ kind: "rmn", title: "RMN coloană lombară", result: "Protruzie discală L4–L5, fără compresie severă.", rows: [] });
  return {
    id: "prior-" + (p.cnp || p.id) + "-" + k,
    current: false,
    ward: spec.ward,
    admitted: admitted,
    discharged: discharged,
    status: "externat",
    dx: spec.dx,
    physician: spec.ward === "Cardiologie" ? "Dr. Popescu Ion" : spec.ward === "Chirurgie generală" ? "Dr. Andrei Cosmin" : "Dr. Ionescu Ana",
    type: n % 2 ? "Urgență" : "Programată",
    fileNo: "FO-" + year + "-" + pad((n % 80) + 1),
    letterNo: "SM-" + year + "-" + pad((n % 80) + 1),
    epicrisis: p.last + " " + p.first + " a fost " + verb + " în " + spec.ward + " pentru " + spec.dx + ". Evoluție favorabilă. S-a externat în stare stabilă, cu recomandare de control.",
    studies, meds: spec.meds
  };
}
function episodeFromRecord(w, p, current) {
  return {
    id: p.id,
    current,
    ward: w.name,
    admitted: p.admitted,
    discharged: p.discharged,
    status: p.status,
    dx: (p.letter && p.letter.dx) || p.dx,
    physician: p.physician,
    type: p.type || "Urgență",
    fileNo: p.fileNo,
    letterNo: p.letter ? p.letter.number : "",
    epicrisis: p.letter ? p.letter.epicrisis : "",
    studies: (p.studies || []).map(s => ({ kind: s.kind, title: s.title, result: s.result || "", rows: s.rows || [], status: s.status })),
    meds: (p.meds || []).map(m => m.name + (m.dose ? " " + m.dose : ""))
  };
}
function patientEpisodes(p) {
  const live = [];
  (state.wards || []).forEach(w => {
    [...(w.patients || []), ...(w.discharged || [])].forEach(x => {
      if (samePerson(x, p)) live.push(episodeFromRecord(w, x, x.id === p.id && x.status !== "externat"));
    });
  });
  const priors = [0, 1, 2].map(k => priorEpisode(p, k)).filter(ep => !live.some(x => x.dx === ep.dx && x.ward === ep.ward));
  return live.concat(priors).sort((a, b) => (b.admitted || "").localeCompare(a.admitted || ""));
}
function histBlob(ep) {
  const rows = (ep.studies || []).flatMap(s => [kindLabel(s.kind), s.title, s.result, ...(s.rows || []).map(r => r.name + " " + r.value)]);
  return [ep.ward, ep.dx, ep.physician, ep.fileNo, ep.letterNo, ep.epicrisis, ep.type, ...(ep.meds || []), ...rows].join(" ").toLowerCase();
}
function dischargeLetters(p) {
  return patientEpisodes(p)
    .filter(ep => ep.status === "externat" && (ep.letterNo || ep.epicrisis))
    .sort((a, b) => (a.discharged || a.admitted || "").localeCompare(b.discharged || b.admitted || ""));
}
function historyScreen(w, p) {
  const q = (ui.histQuery || "").trim().toLowerCase();
  const kin = kinOf(p);
  const episodes = patientEpisodes(p).filter(ep => !q || histBlob(ep).includes(q));
  const open = ui.histDoc ? episodes.find(ep => ui.histDoc.startsWith(ep.id + "|")) : null;
  const docKey = open ? ui.histDoc.slice(open.id.length + 1) : "";
  const facts = `<aside class="hist-facts">
      <article class="hist-card"><h3>Date personale</h3>
        <dl class="kv"><dt>CNP</dt><dd class="mono">${esc(p.cnp)}</dd><dt>Naștere</dt><dd>${esc(fmtDay(p.birth))} · ${ageOf(p.birth)} ani</dd><dt>Sex</dt><dd>${esc(sexLabel(p.sex))}</dd><dt>Grupa</dt><dd>${esc(p.blood || "—")}</dd><dt>Adresă</dt><dd>${esc(p.address || "—")}</dd><dt>Telefon</dt><dd>${esc(p.phone || "—")}</dd><dt>Asigurare</dt><dd>${esc(p.casa || "—")}</dd></dl>
      </article>
      <article class="hist-card"><h3>Antecedente</h3><ul>${antecedentsOf(p).map(x => `<li>${esc(x)}</li>`).join("")}</ul></article>
      <article class="hist-card"><h3>Telefon familie</h3><p><b>${esc(kin.name)}</b> · ${esc(kin.who)}</p><p class="mono" style="margin-top:4px">${esc(kin.phone)}</p></article>
    </aside>`;
  const letterNo = {};
  dischargeLetters(p).forEach((ep, i) => { letterNo[ep.id] = i + 1; });
  const activeId = docKey === "letter" && open ? open.id : "";
  const cards = episodes.map(ep => {
    const docs = [];
    (ep.studies || []).forEach((s, i) => {
      docs.push(`<button class="btn btn-sm${docKey === String(i) && open && open.id === ep.id ? " on" : ""}" type="button" data-act="hist-doc" data-ep="${esc(ep.id)}" data-doc="${i}">${esc(kindLabel(s.kind))} · ${esc(s.title)}</button>`);
    });
    const stay = ep.discharged ? fmtDay(ep.admitted) + " – " + fmtDay(ep.discharged) : "din " + fmtDay(ep.admitted) + " · internat acum";
    const pdf = letterNo[ep.id]
      ? `<button class="pdf-let${activeId === ep.id ? " on" : ""}" type="button" data-act="pdf-letter" data-ep="${esc(ep.id)}" title="${esc(ep.ward)} · ${esc(fmtDay(ep.discharged))}"><b>PDF</b><span>Scrisoare medicală ${letterNo[ep.id]}</span></button>`
      : "";
    return `<article class="hist-ep">
      <div class="hist-ep-main">
        <h3>${esc(ep.ward)}${ep.current ? ` <span class="badge">Internare curentă</span>` : ""}</h3>
        <p class="when">${esc(stay)} · ${esc(ep.type || "")} · ${esc(ep.fileNo || "")} · ${esc(statusLabel(ep.status))}</p>
        <p><b>${esc(ep.dx)}</b></p>
        <p class="muted">${esc(ep.physician || "")}${ep.meds.length ? " · " + esc(ep.meds.join(", ")) : ""}</p>
        <div class="hist-docs">${docs.join("") || `<span class="muted">Fără documente arhivate.</span>`}</div>
      </div>
      ${pdf}
    </article>`;
  }).join("") || `<p class="muted">Nimic în istoric pentru „${esc(ui.histQuery)}”.</p>`;
  let reader = "";
  if (open) {
    if (docKey === "letter") {
      reader = `<article class="hist-reader"><h3>Scrisoare medicală</h3><p class="muted">${esc(open.letterNo)} · ${esc(open.ward)} · ${esc(fmtDay(open.discharged || open.admitted))}</p><p style="margin-top:10px"><b>${esc(open.dx)}</b></p><p style="margin-top:8px">${esc(open.epicrisis || "Scrisoarea nu este încă emisă pentru internarea curentă.")}</p></article>`;
    } else {
      const s = open.studies[Number(docKey)];
      if (s) {
        const table = (s.rows || []).length ? `<table><thead><tr><th>Analit</th><th>Rezultat</th><th>Unitate</th><th>Interval</th></tr></thead><tbody>${s.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.value)}</td><td>${esc(r.unit)}</td><td class="muted">${esc(r.ref)}</td></tr>`).join("")}</tbody></table>` : `<p style="margin-top:8px">${esc(s.result || "Fără text de rezultat.")}</p>`;
        reader = `<article class="hist-reader"><h3>${esc(kindLabel(s.kind))} · ${esc(s.title)}</h3><p class="muted">${esc(open.ward)} · ${esc(fmtDay(open.admitted))}</p>${table}</article>`;
      }
    }
  }
  return `<section class="hist-screen" id="hist-screen">
    <header class="hist-bar">
      <div><h2>Istoric · ${esc(p.last)} ${esc(p.first)}</h2><span class="sub">Internări, scrisori, analize, RX, CT, RMN, ecografii, tratamente</span></div>
      <div class="search"><input id="hist-q" type="text" placeholder="Caută secție, diagnostic, scrisoare, analiză, CT, RX" value="${esc(ui.histQuery || "")}" aria-label="Caută în istoric"></div>
    </header>
    <div class="hist-body${reader ? " with-doc" : ""}">${facts}<div class="hist-eps">${cards}</div>${reader}</div>
  </section>`;
}
function paintHistory() {
  let dock = document.getElementById("hist-dock");
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "hist-dock";
    document.body.appendChild(dock);
  }
  const onSheet = ["patient", "letter", "protocol"].includes(ui.page);
  const p = onSheet ? patient() : null;
  const w = onSheet ? ward() : null;
  if (!p || !w) { dock.innerHTML = ""; ui.histOpen = false; return; }
  const btn = `<button class="hist-toggle${ui.histOpen ? " open" : ""}" type="button" data-act="hist-toggle" aria-expanded="${ui.histOpen ? "true" : "false"}" aria-label="Istoric pacient" title="Istoricul pacientului"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  if (ui.histOpen) dock.innerHTML = historyScreen(w, p) + btn;
  else dock.innerHTML = ui.page === "patient" ? "" : btn;
}
function render() {
  document.body.classList.toggle("clinic", ["ward", "patient", "letter", "admit", "protocol"].includes(ui.page));
  document.getElementById("sidebar").innerHTML = navHtml();
  const main = document.getElementById("main");
  const pages = { home: pageHome, gest: pageGest, "gest-new": pageGestNew, setup: pageSetup, people: pagePeople, dept: pageDept, ward: pageWard, patient: pagePatient, protocol: pageProtocol, letter: pageLetter, admit: pageAdmit, discharges: pageDischarges, "new-ward": pageNewWard, "ai-zena": pageAiZena, admin: pageAdmin };
  main.innerHTML = (pages[ui.page] || pageHome)();
  document.title = "ZenAIos — " + (document.querySelector("h1")?.textContent || "Spital");
  paintZena();
  paintHistory();
}

function val(id) { return document.getElementById(id)?.value.trim() || ""; }
function dischargeFields(p, w) {
  if (ui.draft && ui.draft.patientId === p.id && ui.page === "letter") return ui.draft;
  const cards = ui.letterDraft && ui.letterDraft.patientId === p.id ? ui.letterDraft.cards : null;
  if (cards) return {
    patientId: p.id,
    dx: cards.dx || p.dx,
    secondary: cards.secondary || "",
    history: cards.history || "",
    epicrisis: cards.epic || epicrisis(p, w),
    studies: cards.studies || "",
    treatment: cards.treat || "",
    state: cards.state || "",
    recommendations: cards.recs || RECS[w.focus] || RECS.general
  };
  return {
    patientId: p.id,
    dx: val("dx-out") || p.dx,
    secondary: val("dx-sec"),
    epicrisis: val("epic") || epicrisis(p, w),
    recommendations: val("recs") || RECS[w.focus] || RECS.general
  };
}
function commitDischarge() {
  const w = ward(), p = patient();
  if (!w || !p || p.status === "externat") return;
  const fields = dischargeFields(p, w);
  if (!fields.dx || !fields.epicrisis || !fields.recommendations) { toast("Completați diagnosticul, epicriza și recomandările.", "err"); return; }
  p.letter = { number: "SM-" + todayKey().replace(/-/g, "") + "-" + p.fileNo.slice(-3), issued: nowStamp(), dx: fields.dx, secondary: fields.secondary, history: fields.history || "", epicrisis: fields.epicrisis, studies: fields.studies || "", treatment: fields.treatment || "", state: fields.state || "", recommendations: fields.recommendations };
  p.dxAdmit = p.dxAdmit || p.dx;
  p.dx = fields.dx;
  p.dxCode = icdCode(fields.dx) || p.dxCode;
  p.secondary = fields.secondary || p.secondary;
  p.status = "externat";
  p.discharged = p.letter.issued;
  const bed = p.bed;
  p.bed = null;
  w.patients = w.patients.filter(x => x.id !== p.id);
  w.discharged.unshift(p);
  ui.draft = null;
  ui.tab = "scrisoare";
  persist();
  toast("Scrisoarea a fost emisă. Patul " + pad(bed) + " este liber.");
  go({ page: "letter" }, true);
}
function systemRoster() {
  const seen = new Map();
  (state.wards || []).forEach(w => {
    [...(w.discharged || []), ...(w.patients || [])].forEach(p => {
      if (p.cnp && !seen.has(p.cnp)) seen.set(p.cnp, p);
    });
  });
  return [...seen.values()];
}
function loadFromSystem() {
  const roster = systemRoster();
  const typed = (document.getElementById("adm-cnp")?.value || "").trim();
  let person = /^\d{13}$/.test(typed) ? roster.find(p => p.cnp === typed) : null;
  if (!person) {
    const live = new Set();
    (state.wards || []).forEach(w => (w.patients || []).forEach(p => live.add(p.cnp)));
    const pool = roster.filter(p => p.cnp && !live.has(p.cnp));
    const list = pool.length ? pool : roster;
    if (!list.length) { toast("Sistemul nu are încă o persoană de încărcat.", "err"); return; }
    person = list[(ui.admitPick || 0) % list.length];
    ui.admitPick = (ui.admitPick || 0) + 1;
  }
  const set = (id, value) => { const el = document.getElementById(id); if (el && value != null && value !== "") el.value = value; };
  const parsed = parseCnp(person.cnp || "");
  set("adm-last", person.last);
  set("adm-first", person.first);
  set("adm-cnp", person.cnp);
  set("adm-birth", parsed.ok ? parsed.iso : String(person.birth || "").slice(0, 10));
  set("adm-sex", parsed.ok ? parsed.sex : person.sex);
  set("adm-phone", person.phone || "");
  set("adm-addr", person.address || "");
  set("adm-alg", person.allergies || "Nu se cunosc");
  set("adm-blood", person.blood || "Necunoscută");
  set("adm-casa", person.casa || "CJAS Bihor");
  set("adm-type", person.type || "Urgență");
  const w = ward();
  const dxList = (w && DX[w.focus]) || DX.general;
  const known = dxList.find(d => String(person.dx || "").startsWith(d[0]));
  set("adm-dx", known ? known[0] + " " + known[1] : (person.dx || dxList[0][0] + " " + dxList[0][1]));
  const md = document.getElementById("adm-md");
  if (md && person.physician && [...md.options].some(o => o.value === person.physician)) md.value = person.physician;
  const ins = document.getElementById("adm-ins");
  if (ins) ins.checked = person.insured !== false;
  document.getElementById("adm-cnp")?.classList.remove("invalid");
  toast("Date încărcate din sistem · " + person.last + " " + person.first + ".");
}
function nextFileNo(w) {
  const year = todayKey().slice(0, 4);
  const tag = String(w.tag || w.id || "SEC").slice(0, 3).toUpperCase();
  let max = 0;
  [...(w.patients || []), ...(w.discharged || [])].forEach(p => {
    const m = String(p.fileNo || "").match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return "FO-" + year + "-" + tag + "-" + String(max + 1).padStart(3, "0");
}
function saveChart() {
  const p = patient();
  if (!p) return;
  const dx = val("ch-dx");
  if (dx) { p.dx = dx; p.dxCode = icdCode(dx); }
  p.secondary = val("ch-sec");
  p.reason = val("ch-reason");
  p.antecedents = val("ch-ante");
  const kg = Number(val("ch-kg"));
  const cm = Number(val("ch-cm"));
  if (kg) p.bodyKg = kg;
  if (cm) p.heightCm = cm;
  p.consentAdmit = !!document.getElementById("ch-ca")?.checked;
  p.consentProc = !!document.getElementById("ch-cp")?.checked;
  persist();
  toast(p.dxCode ? "Foaia a fost actualizată." : "Foaia a fost actualizată. Diagnosticul de lucru nu începe cu un cod ICD.");
  go({ tab: "sumar" });
}
function saveAdmit() {
  const w = ward();
  const last = val("adm-last"), first = val("adm-first"), cnp = val("adm-cnp"), dx = val("adm-dx");
  ["adm-last","adm-first","adm-cnp","adm-dx"].forEach(id => document.getElementById(id)?.classList.remove("invalid"));
  const parsed = parseCnp(cnp);
  let bad = false;
  if (!last) { document.getElementById("adm-last").classList.add("invalid"); bad = true; }
  if (!first) { document.getElementById("adm-first").classList.add("invalid"); bad = true; }
  if (!parsed.ok) { document.getElementById("adm-cnp").classList.add("invalid"); bad = true; }
  if (!dx) { document.getElementById("adm-dx").classList.add("invalid"); bad = true; }
  if (bad) { toast(parsed.ok ? "Completați numele și diagnosticul." : parsed.reason, "err"); return; }
  const coded = !!icdCode(dx);
  const bed = Number(val("adm-bed"));
  if (!freeBeds(w).includes(bed)) { toast("Patul nu mai este liber.", "err"); return; }
  const sex = document.getElementById("adm-sex").value || parsed.sex;
  const birth = val("adm-birth") || parsed.iso;
  const physician = val("adm-md") || w.physicians[0] || w.chief;
  const p = {
    id: uid(), last, first, sex, birth, cnp, phone: val("adm-phone"),
    insured: document.getElementById("adm-ins").checked, casa: val("adm-casa"),
    admitted: nowStamp(), type: val("adm-type") || "Urgență", bed, physician,
    dxCode: icdCode(dx), dx, dxAdmit: dx, allergies: val("adm-alg") || "Nu se cunosc",
    blood: val("adm-blood") || "Necunoscută", address: val("adm-addr") || "—",
    referrer: val("adm-from") || "Prezentare directă",
    kinName: val("adm-kin"), kinWho: "", kinPhone: val("adm-kin-phone"),
    bodyKg: Number(val("adm-kg")) || null, heightCm: Number(val("adm-cm")) || null,
    reason: val("adm-reason"), antecedents: val("adm-ante"),
    consentAdmit: !!document.getElementById("adm-ca")?.checked,
    consentProc: !!document.getElementById("adm-cp")?.checked,
    status: "internat", fileNo: nextFileNo(w),
    vitals: [], studies: [], supplies: [], meds: [], secondary: val("adm-sec"), weight: 1.2, notes: [{ at: nowStamp(), author: physician, text: "Internare înregistrată." }],
    letter: null, discharged: null
  };
  w.patients.push(p);
  if (!w.physicians.includes(physician)) w.physicians.push(physician);
  if (!(w.staff || []).some(s => s.role === "medic" && s.name === physician)) {
    w.staff = w.staff || [];
    w.staff.push({ id: uid(), name: physician, role: "medic" });
  }
  persist();
  toast(last + " " + first + " a fost internat pe patul " + pad(bed) + "." + (coded ? "" : " Diagnosticul nu are cod ICD."));
  go({ page: "patient", patientId: p.id, tab: "sumar" }, true);
}
function addVital() {
  const p = patient();
  const ta = val("v-ta"), av = val("v-av"), temp = val("v-temp"), spo2 = val("v-spo"), rr = val("v-rr");
  if (!ta || !av || !temp || !spo2 || !rr) { toast("Completați tensiunea, alura, respirația, temperatura și SpO₂.", "err"); return; }
  p.vitals.push({ at: nowStamp(), ta, av, temp, spo2, rr, note: val("v-note") });
  persist();
  toast("Constantele au fost înregistrate.");
  go({ tab: "monitor" });
}
function orderStudy() {
  const p = patient();
  const kind = val("st-kind") || "analize";
  const preset = { analize: "Buletin de analize", rx: "Radiografie toracică", ct: "CT" }[kind];
  p.studies.unshift({ id: uid(), kind, title: val("st-title") || preset, at: nowStamp(), status: "in-lucru", result: "", rows: [] });
  persist();
  toast("Investigația a fost solicitată.");
  go({ tab: kind === "analize" ? "analize" : "imagistica", compose: true });
}
function finalizeStudy(id) {
  const p = patient();
  const s = p.studies.find(x => x.id === id);
  if (!s) return;
  s.status = "finalizat";
  if (s.kind === "analize" && s.set && (s.rows || []).length) s.rows.forEach(r => { if (!r.value) { r.value = "în limite"; r.flag = ""; } });
  else if (s.kind === "analize") s.rows = baseRows();
  if (s.kind === "rx") s.result = "Examinare efectuată. Fără modificări acute descrise în buletin.";
  if (s.kind === "ct") s.result = "Examinare CT efectuată. Fără leziune acută descrisă în buletin.";
  if (s.kind === "rmn") s.result = "Examinare RMN efectuată. Fără leziune acută descrisă în buletin.";
  if (s.kind === "echo") s.result = "Examinare ecografică efectuată. Fără colecție sau leziune focală descrisă.";
  persist();
  toast("Rezultatul a fost atașat la foaie.");
  go({ tab: s.kind === "analize" ? "analize" : "imagistica" });
}
function confirmMed() {
  const why = val("zena-why");
  if (!ui.holdMed) return;
  if (!why) { toast("Scrieți motivul. Fără motiv, prescrierea nu trece.", "err"); return; }
  const p = patient();
  p.overrides = p.overrides || [];
  p.overrides.push({ at: nowStamp(), why, title: ui.holdMed.title });
  const id = ui.holdMed.id;
  ui.holdMed = null;
  giveMed(id, true);
}
function orderSet() {
  const w = ward(), p = patient();
  if (!w || !p) return;
  const names = LAB_SETS.uzuale[w.focus] || LAB_SETS.uzuale.med;
  p.studies.unshift({ id: uid(), kind: "analize", title: "Set uzual " + w.name, at: nowStamp(), status: "in-lucru", result: "", set: true, rows: names.map(name => ({ name, value: "", unit: "", ref: "", flag: "" })) });
  persist();
  toast("Setul uzual al secției a fost cerut.");
  go({ tab: "analize", compose: true });
}
function addPerson() {
  const spec = staffSpec()[ui.staffCat] || staffSpec().medici;
  const fields = {};
  spec.cols.forEach(([key]) => { fields[key] = val("pf-" + key); });
  if (!fields.last || !fields.first) { toast("Completați numele și prenumele.", "err"); return; }
  state.people = state.people || [];
  state.people.push({ id: uid(), cat: ui.staffCat, fields });
  persist();
  toast("Fișa a fost adăugată în registru.");
  go({ page: "people", staffCat: ui.staffCat });
}
function deletePerson(id) {
  state.people = (state.people || []).filter(p => p.id !== id);
  persist();
  go({ page: "people", staffCat: ui.staffCat });
}
function saveGestType() {
  const name = val("gt-name");
  if (!name) { toast("Scrieți denumirea gestiunii.", "err"); return; }
  const id = uid();
  state.gestTypes = state.gestTypes || [];
  state.gestTypes.push({ id, name, mode: "list", items: [] });
  persist();
  toast(name + " a fost adăugată la gestiune.");
  go({ page: "gest", gest: id }, true);
}
function addGestItem() {
  const type = (state.gestTypes || []).find(t => t.id === ui.gest);
  const name = val("gi-name");
  if (!type || !name) { toast("Scrieți denumirea.", "err"); return; }
  type.items = type.items || [];
  type.items.push({ id: uid(), name, qty: Number(val("gi-qty")) || 0, unit: val("gi-unit") || "buc", min: 5 });
  persist();
  go({ page: "gest", gest: type.id });
}
function deleteGestItem(id) {
  const type = (state.gestTypes || []).find(t => t.id === ui.gest);
  if (!type) return;
  type.items = (type.items || []).filter(item => item.id !== id);
  persist();
  go({ page: "gest", gest: type.id });
}
function saveDept() {
  const name = val("dp-name");
  if (!name) { toast("Scrieți denumirea departamentului.", "err"); return; }
  const data = { name, chief: val("dp-chief"), phone: val("dp-phone"), mission: val("dp-mission") };
  if (ui.deptId) {
    const dept = state.departments.find(d => d.id === ui.deptId);
    if (dept) Object.assign(dept, data);
  } else {
    const dept = { id: uid(), ...data };
    state.departments.push(dept);
    ui.deptId = dept.id;
  }
  persist();
  toast("Departamentul a fost salvat.");
  go({ page: "dept", deptId: ui.deptId });
}
function deleteDept() {
  state.departments = (state.departments || []).filter(d => d.id !== ui.deptId);
  persist();
  go({ page: "home", deptId: null }, true);
}
function giveMed(id, forced) {
  const w = ward(), p = patient();
  const item = (w.meds || []).find(m => m.id === id);
  const qty = Math.max(1, Number(document.getElementById("med-qty")?.value) || 1);
  if (!item) return;
  const hit = !forced && zenaMed(p, item.name);
  if (hit) {
    ui.holdMed = { patientId: p.id, id, title: hit.title, text: hit.text, fix: hit.fix };
    go({ tab: "medicatie" });
    return;
  }
  if (item.qty < qty) { toast("Stoc insuficient în magazie: " + item.qty + " " + item.unit + ".", "err"); return; }
  item.qty -= qty;
  p.meds = p.meds || [];
  const nurse = (w.staff || []).find(s => s.role === "asistenta");
  p.meds.push({ id: uid(), name: item.name, dose: item.dose, group: item.group, qty, unit: item.unit, route: val("med-route") || routeFor(item.name, item.dose), schedule: val("med-rhythm") || rhythmFor(item.name), by: (nurse && nurse.name) || p.physician || "", at: nowStamp() });
  ui.holdMed = null;
  persist();
  toast(item.name + " a fost prescris și descărcat din magazie.");
  go({ tab: "medicatie" });
}
function addMed() {
  const w = adminWard();
  const name = val("med-name"), dose = val("med-dose");
  if (!name || !dose) { toast("Completați denumirea și dozajul.", "err"); return; }
  w.meds = w.meds || [];
  w.meds.push({ id: uid(), group: val("med-group") || "Soluții perfuzabile", name, dose, unit: val("med-unit") || "buc", qty: Number(val("med-add-qty")) || 0, min: 5 });
  persist();
  toast(name + " a fost adăugat în magazie.");
  go({ page: "gest", gest: "medicamente" });
}
function deleteMed(id) {
  const w = adminWard();
  w.meds = (w.meds || []).filter(m => m.id !== id);
  persist();
  go({ page: "gest", gest: "medicamente" });
}
function deleteStock(name) {
  const w = adminWard();
  w.stock = (w.stock || []).filter(s => s.name !== name);
  persist();
  go({ page: "gest", gest: "materiale" });
}
function addBed() {
  const w = adminWard();
  w.bedCount = bedCount(w) + 1;
  persist();
  toast("Patul " + pad(w.bedCount) + " a fost adăugat.");
  go(ui.page === "setup" ? { page: "setup", gest: "paturi" } : { page: "gest", gest: "paturi" });
}
function closeBed(n) {
  const w = adminWard();
  if (onBed(w, n)) { toast("Patul ocupat nu se poate închide.", "err"); return; }
  w.closed = w.closed || [];
  if (!w.closed.includes(n)) w.closed.push(n);
  persist();
  go(ui.page === "setup" ? { page: "setup", gest: "paturi" } : { page: "gest", gest: "paturi" });
}
function openBed(n) {
  const w = adminWard();
  w.closed = (w.closed || []).filter(b => b !== n);
  persist();
  go(ui.page === "setup" ? { page: "setup", gest: "paturi" } : { page: "gest", gest: "paturi" });
}
function addSupply(nameFromBtn) {
  const w = ward(), p = patient();
  const name = nameFromBtn || val("sup-name");
  const qty = Number(val("sup-qty")) || 1;
  const item = (w.stock || []).find(s => s.name === name);
  if (!item || !qty) { toast("Alegeți materialul și cantitatea.", "err"); return; }
  if (item.qty < qty) { toast("Stoc insuficient: " + item.qty + " " + item.unit + ".", "err"); return; }
  item.qty -= qty;
  p.supplies.push({ id: uid(), name, qty, unit: item.unit, group: item.group || supplyClass(name), at: nowStamp(), source: "manual" });
  persist();
  toast(name + " a fost descărcat din stocul secției.");
  go({ tab: "consum", compose: true });
}
function addNote() {
  const w = ward(), p = patient();
  const text = val("evo-text");
  if (!text) { toast("Scrieți evoluția.", "err"); return; }
  p.notes = p.notes || [];
  p.notes.push({ at: nowStamp(), author: val("evo-author") || dutyName(w, "medic"), text });
  persist();
  toast("Evoluția a fost adăugată în foaie.");
  go({ tab: "evolutie" });
}
function saveDuty() {
  const w = ward();
  const duty = { date: todayKey() };
  ["medic", "asistenta", "infirmiera", "brancardier"].forEach(role => { duty[role] = val("duty-" + role); });
  if (!duty.medic) { toast("Alegeți medicul de gardă.", "err"); return; }
  w.duty = duty;
  persist();
  toast("Garda de azi a fost salvată.");
  go({ view: "garda" });
}
function addStaff() {
  const w = ward();
  const name = val("stf-name");
  const role = val("stf-role") || "medic";
  if (!name) { toast("Scrieți numele.", "err"); return; }
  w.staff = w.staff || [];
  if (w.staff.some(s => s.name === name && s.role === role)) { toast("Persoana este deja în secție.", "err"); return; }
  w.staff.push({ id: uid(), name, role });
  if (role === "medic" && !w.physicians.includes(name)) w.physicians.push(name);
  persist();
  toast(name + " este acum în personalul secției.");
  go(ui.page === "gest" ? { page: "gest", gest: "personal" } : { view: "garda" });
}
function removeStaff(id) {
  const w = ward();
  const person = (w.staff || []).find(s => s.id === id);
  if (!person) return;
  const onDuty = ["medic", "asistenta", "infirmiera", "brancardier"].some(role => w.duty && w.duty[role] === person.name);
  if (onDuty) { toast("Persoana este pe garda de azi. Schimbați garda înainte.", "err"); return; }
  w.staff = w.staff.filter(s => s.id !== id);
  if (person.role === "medic") w.physicians = w.physicians.filter(n => n !== person.name);
  persist();
  go(ui.page === "gest" ? { page: "gest", gest: "personal" } : { view: "garda" });
}
function addStock() {
  const w = ward();
  const name = val("stk-name");
  const qty = Number(val("stk-qty"));
  if (!name || !qty || qty < 1) { toast("Scrieți materialul și cantitatea.", "err"); return; }
  w.stock = w.stock || [];
  let item = w.stock.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (!item) {
    const known = SUPPLY.find(s => s[0].toLowerCase() === name.toLowerCase());
    item = { name: known ? known[0] : name, unit: known ? known[1] : "buc", qty: 0, min: 10, group: known ? known[2] : "Alte materiale" };
    w.stock.push(item);
  }
  item.qty += qty;
  persist();
  toast("Intrare în gestiune: " + item.name + ".");
  go(ui.page === "gest" ? { page: "gest", gest: "materiale" } : { view: "materiale" });
}
function applyKit() {
  const w = ward();
  const pts = occupied(w);
  if (!pts.length) { toast("Nu există pacienți internați.", "err"); return; }
  const gaps = kitGap(w);
  if (gaps.length) { toast("Stoc insuficient. " + gaps[0] + ".", "err"); return; }
  pts.forEach(p => {
    KIT.forEach(([name, qty]) => {
      const item = w.stock.find(s => s.name === name);
      item.qty -= qty;
      p.supplies.push({ id: uid(), name, qty, unit: item.unit, at: nowStamp(), source: "tura" });
    });
  });
  persist();
  toast("Kitul de tură a fost descărcat pe " + pts.length + " pacienți.");
  go({ view: "materiale" });
}
function saveWard() {
  const name = val("nw-name"), chief = val("nw-chief");
  if (!name || !chief) { toast("Completați denumirea și medicul șef.", "err"); return; }
  if (state.wards.some(w => w.name.toLowerCase() === name.toLowerCase())) { toast("Există deja o secție cu acest nume.", "err"); return; }
  const nurse = val("nw-nurse");
  const spec = { chief, nurse, focus: "general" };
  const staff = defaultStaff(spec);
  const w = {
    id: "w" + Date.now().toString(36), name, chief, nurse: nurse || "—", physicians: [chief], focus: "general",
    staff, duty: defaultDuty(staff), stock: defaultStock(0), meds: defaultMeds(), bedCount: BEDS, closed: [], patients: [], discharged: []
  };
  state.wards.push(w);
  persist();
  toast(name + " a fost creată, cu 20 de paturi libere.");
  go({ page: "ward", wardId: w.id, view: "paturi", filter: "all", query: "" }, true);
}

document.body.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "home") go({ page: "home", wardId: null, view: "paturi", drill: null }, true);
  if (act === "admin") go({ page: "admin" }, true);
  if (act === "admin-login") {
    const user = val("gate-user");
    const pass = document.getElementById("gate-pass")?.value || "";
    if (user === "admin" && pass === "1234") { ui.adminIn = true; toast("Sesiune deschisă."); go({ page: "admin" }); }
    else toast("Utilizator sau parolă incorectă.", "err");
  }
  if (act === "admin-logout") { ui.adminIn = false; go({ page: "admin" }); }
  if (act === "save-admin") saveAdmin();
  if (act === "ward") go({ page: "ward", wardId: el.dataset.id, view: "paturi", filter: "all", query: "", doctor: null, sheetPage: 0, calOpen: false }, true);
  if (act === "doctor") go({ doctor: el.dataset.id || null, filter: "all" });
  if (act === "gest") go({ page: "gest", gest: el.dataset.id, wardId: ui.wardId || (state.wards[0] && state.wards[0].id) }, true);
  if (act === "setup") go({ page: "setup", gest: "paturi" }, true);
  if (act === "gest-new") go({ page: "gest-new" }, true);
  if (act === "people") go({ page: "people", staffCat: el.dataset.id || "medici" }, true);
  if (act === "dept") go({ page: "dept", deptId: el.dataset.id }, true);
  if (act === "dept-new") go({ page: "dept", deptId: null }, true);
  if (act === "drill") go({ page: "home", drill: ui.drill === el.dataset.id ? null : el.dataset.id });
  if (act === "period") go({ period: el.dataset.id });
  if (act === "lab-group") { ui.labGroup = el.dataset.id; ui.studyQuery = ""; go({ tab: "analize", compose: true }); }
  if (act === "order-set") orderSet();
  if (act === "cancel-med") { ui.holdMed = null; go({ tab: "medicatie" }); }
  if (act === "confirm-med") confirmMed();
  if (act === "pick-ward") go({ wardId: el.dataset.id });
  if (act === "patient") go({ page: "patient", wardId: el.dataset.id || ui.wardId, patientId: el.dataset.pid, tab: el.dataset.tab || "sumar", draft: null, compose: false }, true);
  if (act === "protocol") go({ page: "protocol", wardId: el.dataset.id || ui.wardId, patientId: el.dataset.pid }, true);
  if (act === "bed") go({ page: "admit", bed: Number(el.dataset.bed) }, true);
  if (act === "tab") go({ tab: el.dataset.tab, compose: false });
  if (act === "compose") {
    if (!ui.compose && ui.tab === "imagistica") ui.studyKind = ["echo","rx","ct","rmn"].includes(ui.imgKind) ? ui.imgKind : "rx";
    if (!ui.compose && ui.tab === "analize") ui.studyKind = "analize";
    go({ compose: !ui.compose }, true);
  }
  if (act === "filter") go({ filter: el.dataset.id });
  if (act === "view") go({ view: el.dataset.id === "saloane" && ui.view === "saloane" ? "paturi" : el.dataset.id });
  if (act === "mag-class") { ui.magClass = el.dataset.id; go({ view: "magazie" }); }
  if (act === "med-class") { ui.medClass = el.dataset.id; ui.medQuery = ""; go({ tab: "medicatie", compose: true }); }
  if (act === "sup-class") { ui.supClass = el.dataset.id; go({ tab: "consum", compose: !!ui.compose }); }
  if (act === "sheet-page") go({ sheetPage: Number(el.dataset.id), calOpen: false });
  if (act === "cal-toggle") go({ calOpen: !ui.calOpen });
  if (act === "cal-day") {
    const iso = el.dataset.id;
    if (!ui.rangeFrom || ui.rangeTo) { ui.rangeFrom = iso; ui.rangeTo = ""; }
    else if (iso < ui.rangeFrom) { ui.rangeTo = ui.rangeFrom; ui.rangeFrom = iso; }
    else ui.rangeTo = iso;
    go({ calOpen: true, sheetPage: 0 });
  }
  if (act === "cal-shift") {
    const now = new Date();
    const key = ui.calMonth || `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.id), 1);
    ui.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    go({ calOpen: true });
  }
  if (act === "cal-clear") { ui.rangeFrom = ""; ui.rangeTo = ""; go({ calOpen: true, sheetPage: 0 }); }
  if (act === "zena-toggle") go({ zenaOpen: !ui.zenaOpen });
  if (act === "zena-hint") zenaAsk(el.dataset.q);
  if (act === "zena-send") zenaAsk(document.getElementById("zena-q")?.value || ui.zenaDraft);
  if (act === "zena-mic") {
    el.classList.add("live");
    el.setAttribute("aria-pressed", "true");
    const q = zenaHints()[ui.zenaThread.length % zenaHints().length];
    clearTimeout(micTimer);
    micTimer = setTimeout(() => { if (el.isConnected) zenaAsk(q); }, 900);
  }
  if (act === "ai-zena") go({ page: "ai-zena" }, true);
  if (act === "ai-hint") aiConfigure(el.dataset.q);
  if (act === "ai-send") aiConfigure(val("ai-q"));
  if (act === "ai-mic") {
    const demos = ["Deschide chirurgia", "Arată medicii", "Gestiunea de medicamente", "Deschide departamentele", "Configurare paturi"];
    const phrase = demos[ui.aiDemo % demos.length];
    ui.aiDemo += 1;
    el.classList.add("live");
    el.setAttribute("aria-pressed", "true");
    clearTimeout(micTimer);
    micTimer = setTimeout(() => { if (el.isConnected) aiConfigure(phrase); }, 900);
  }
  if (act === "admit") go({ page: "admit", bed: null }, true);
  if (act === "back-ward") go({ page: "ward", view: "paturi", draft: null }, true);
  if (act === "back-discharge") go({ page: "patient", tab: "externare" }, true);
  if (act === "discharges") go({ page: "discharges", wardId: null, sheetPage: 0, calOpen: false }, true);
  if (act === "ward-letters") go({ page: "discharges", sheetPage: 0, calOpen: false }, true);
  if (act === "new-ward") go({ page: "new-ward" }, true);
  if (act === "load-system") loadFromSystem();
  if (act === "check-cnp") {
    const input = document.getElementById("adm-cnp");
    const parsed = parseCnp(input.value.trim());
    if (!parsed.ok) { input.classList.add("invalid"); toast(parsed.reason, "err"); return; }
    input.classList.remove("invalid");
    document.getElementById("adm-sex").value = parsed.sex;
    document.getElementById("adm-birth").value = parsed.iso;
    toast("CNP valid. Sexul și data nașterii au fost completate.");
  }
  if (act === "save-admit") saveAdmit();
  if (act === "save-chart") saveChart();
  if (act === "add-vital") addVital();
  if (act === "order-study") orderStudy();
  if (act === "order-catalog") {
    const p = patient();
    if (!p) return;
    p.studies.unshift({ id: uid(), kind: el.dataset.kind, title: el.dataset.title, at: nowStamp(), status: "in-lucru", result: "", rows: [] });
    persist();
    toast(el.dataset.title + " a fost solicitată.");
    go({ tab: el.dataset.kind === "analize" ? "analize" : "imagistica", compose: true });
  }
  if (act === "pdf-letter") go({ histOpen: true, histQuery: "", histDoc: el.dataset.ep + "|letter" });
  if (act === "alert-toggle") {
    const id = el.dataset.id;
    const list = ui.openAlerts || [];
    ui.openAlerts = list.includes(id) ? list.filter(x => x !== id) : list.concat(id);
    go({});
  }
  if (act === "hist-toggle") go({ histOpen: !ui.histOpen, histDoc: "" });
  if (act === "hist-doc") go({ histOpen: true, histDoc: el.dataset.ep + "|" + el.dataset.doc });
  if (act === "img-kind") { ui.imgKind = el.dataset.id; ui.studyKind = el.dataset.id; ui.studyQuery = ""; go({ tab: "imagistica", compose: !!ui.compose }); }
  if (act === "give-med") giveMed(el.dataset.mid);
  if (act === "add-person") addPerson();
  if (act === "del-person") deletePerson(el.dataset.pid);
  if (act === "save-gest-type") saveGestType();
  if (act === "add-gest-item") addGestItem();
  if (act === "del-gest-item") deleteGestItem(el.dataset.gid);
  if (act === "save-dept") saveDept();
  if (act === "del-dept") deleteDept();
  if (act === "add-med") addMed();
  if (act === "del-med") deleteMed(el.dataset.mid);
  if (act === "del-stock") deleteStock(el.dataset.name);
  if (act === "add-bed") addBed();
  if (act === "close-bed") closeBed(Number(el.dataset.bed));
  if (act === "open-bed") openBed(Number(el.dataset.bed));
  if (act === "finalize") finalizeStudy(el.dataset.sid);
  if (act === "add-supply") addSupply(el.dataset.name);
  if (act === "add-note") addNote();
  if (act === "save-duty") saveDuty();
  if (act === "add-staff") addStaff();
  if (act === "del-staff") removeStaff(el.dataset.sid);
  if (act === "add-stock") addStock();
  if (act === "apply-kit") applyKit();
  if (act === "mic") {
    el.classList.add("live");
    el.setAttribute("aria-pressed", "true");
    const hint = document.getElementById("mic-hint");
    if (hint) hint.textContent = "Se ascultă… demonstrație vizuală, fără dictare.";
    clearTimeout(micTimer);
    micTimer = setTimeout(() => {
      if (!el.isConnected) return;
      el.classList.remove("live");
      el.setAttribute("aria-pressed", "false");
      if (hint && hint.isConnected) hint.textContent = "Microfonul este ilustrativ. Dictarea nu este activă în acest MVP.";
    }, 2200);
  }
  if (act === "letter-mic") {
    const key = el.dataset.key;
    const w = ward(), p = patient();
    if (w && p) ensureLetter(p, w);
    el.classList.add("live");
    const hint = document.getElementById("let-note-" + key);
    if (hint) hint.textContent = "Zena ascultă…";
    const apply = (said, how) => {
      const cur = ((ui.letterDraft && ui.letterDraft.cards[key]) || "").trim();
      const bit = said.charAt(0).toUpperCase() + said.slice(1);
      const next = cur ? cur.replace(/[.\s]+$/, "") + ". " + bit : bit;
      writeLetterField(key, next, how);
      el.classList.remove("live");
    };
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      clearTimeout(micTimer);
      micTimer = setTimeout(() => { if (el.isConnected) apply(heardFor(key), "Dictare demonstrativă. Apăsați Corectează."); }, 700);
    } else {
      let settled = false;
      const finish = (said, how) => { if (settled) return; settled = true; apply(said, how); };
      const rec = new SR();
      rec.lang = "ro-RO";
      rec.interimResults = false;
      rec.onresult = ev => finish(ev.results[0][0].transcript, "Zena a transcris vocea. Puteți apăsa Corectează.");
      rec.onerror = () => finish(heardFor(key), "Microfonul nu a răspuns. Zena a pus o dictare demonstrativă.");
      try { rec.start(); } catch (err) { finish(heardFor(key), "Dictare demonstrativă. Apăsați Corectează."); }
      clearTimeout(micTimer);
      micTimer = setTimeout(() => { if (!settled && el.isConnected) { try { rec.stop(); } catch (err) {} finish(heardFor(key), "Nu s-a auzit voce. Zena a pus o dictare demonstrativă."); } }, 4000);
    }
  }
  if (act === "letter-fix") {
    const key = el.dataset.key;
    const before = (ui.letterDraft && ui.letterDraft.cards[key]) || "";
    const after = zenaPolish(before);
    writeLetterField(key, after, !before.trim() ? "Cardul este gol. Dictați sau reluați din foaie." : after === before ? "Zena a verificat. Textul era deja în regulă." : "Zena a corectat diacriticele și formularea.");
  }
  if (act === "letter-reset") { ui.letterDraft = null; go({ tab: "externare", compose: false }); }
  if (act === "preview") {
    const w = ward(), p = patient();
    ui.draft = dischargeFields(p, w);
    go({ page: "letter" }, true);
  }
  if (act === "emit") commitDischarge();
  if (act === "open-letter") go({ page: "letter", wardId: el.dataset.id, patientId: el.dataset.pid, draft: null }, true);
  if (act === "print") { document.body.classList.add("printing"); window.print(); document.body.classList.remove("printing"); }
  if (act === "save-ward") saveWard();
  if (act === "panou") location.href = "/?panou=1";
  if (act === "ops-sync") void runOpsSync();
  if (act === "ops-lis") void runOpsLis();
  if (act === "ops-backup") void runOpsBackup();
  if (act === "reset") {
    sessionStorage.removeItem(KEY);
    const done = () => location.reload();
    if (!live) { done(); return; }
    fetch("/api/collection", { method: "DELETE", credentials: "include" }).finally(done);
  }
});
document.body.addEventListener("input", e => {
  const id = e.target.id;
  if (e.target.classList && e.target.classList.contains("let-field") && ui.letterDraft) {
    ui.letterDraft.cards[e.target.dataset.key] = e.target.value;
    return;
  }
  if (id === "zena-q") { ui.zenaDraft = e.target.value; return; }
  if (id === "hist-q") {
    ui.histQuery = e.target.value;
    const top = document.querySelector(".hist-body")?.scrollTop || 0;
    render();
    const body = document.querySelector(".hist-body");
    if (body) body.scrollTop = top;
    const input = document.getElementById("hist-q");
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    return;
  }
  if (id !== "ward-q" && id !== "med-q" && id !== "mag-q" && id !== "cat-q") return;
  if (id === "ward-q") ui.query = e.target.value;
  if (id === "med-q") ui.medQuery = e.target.value;
  if (id === "mag-q") ui.magQuery = e.target.value;
  if (id === "cat-q") ui.studyQuery = e.target.value;
  const top = document.querySelector(".content")?.scrollTop || 0;
  render();
  const content = document.querySelector(".content");
  if (content) content.scrollTop = top;
  const input = document.getElementById(id);
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "zena-q") { e.preventDefault(); zenaAsk(e.target.value); return; }
  if (e.key === "Enter" && e.target.id === "ai-q") { e.preventDefault(); aiConfigure(e.target.value); return; }
  if (e.key !== "Escape") return;
  if (ui.histOpen) { go({ histOpen: false, histDoc: "" }); return; }
  if (ui.zenaOpen) { go({ zenaOpen: false }); return; }
  if (ui.page === "letter" && ui.draft) go({ page: "patient", tab: "externare" }, true);
  else if (ui.page === "letter" || ui.page === "discharges") go({ page: ui.wardId ? "ward" : "home" }, true);
  else if (ui.page === "patient" || ui.page === "admit" || ui.page === "new-ward" || ui.page === "protocol") go({ page: ui.wardId ? "ward" : "home" }, true);
});
async function apiJson(url, options) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options && options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.message || ("Eroare " + response.status));
  return body;
}

function applySession(me) {
  apiMe = me;
  live = true;
  ui.adminIn = true;
  ui.accountName = me.displayName || me.username || "Administrator";
  ui.accountRole = me.username || "administrator";
  ui.wardScopeIds = me.wardScopeIds == null ? null : me.wardScopeIds;
  ui.hospitalWideAccess = me.hospitalWideAccess !== false && me.wardScopeIds == null;
}

async function hydrateBoardOccupancy() {
  const board = await apiJson("/api/board/wards?limit=100&offset=0");
  ui.apiBoardTotal = board.total || 0;
  const byId = new Map((board.items || []).map(row => [row.id, row]));
  const byName = new Map((board.items || []).map(row => [String(row.name || "").toLowerCase(), row]));
  for (const w of state.wards) {
    const row = (w.apiId && byId.get(w.apiId)) || byName.get(String(w.name || "").toLowerCase());
    if (!row) continue;
    w.apiId = row.id;
    w.apiBedTotal = row.bed_total;
    w.apiOccupied = row.occupied;
    w.apiFree = row.free;
    if (row.bed_total > 0) w.bedCount = row.bed_total;
  }
}

async function syncStructureToApi() {
  const structure = await apiJson("/api/structure");
  const byName = new Map((structure.wards || []).map(w => [String(w.name || "").toLowerCase(), w]));
  let buildingId = structure.buildings && structure.buildings[0] && structure.buildings[0].id;
  let departmentId = structure.departments && structure.departments[0] && structure.departments[0].id;
  if (!buildingId) {
    buildingId = (await apiJson("/api/buildings", { method: "POST", body: JSON.stringify({ name: "Pavilion principal" }) })).id;
  }
  if (!departmentId) {
    departmentId = (await apiJson("/api/departments", {
      method: "POST",
      body: JSON.stringify({ buildingId, name: "Clinic", kind: "clinical" })
    })).id;
  }
  for (const w of state.wards) {
    let apiWard = byName.get(String(w.name || "").toLowerCase());
    if (!apiWard) {
      const created = await apiJson("/api/wards", {
        method: "POST",
        body: JSON.stringify({ departmentId, name: w.name, specialty: w.name })
      });
      apiWard = { id: created.id, name: w.name };
      byName.set(String(w.name || "").toLowerCase(), apiWard);
      const room = await apiJson("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ wardId: created.id, name: "Salon 1" })
      });
      const beds = bedCount(w);
      for (let i = 1; i <= beds; i++) {
        await apiJson("/api/beds", {
          method: "POST",
          body: JSON.stringify({ roomId: room.id, label: "Pat " + i })
        });
      }
    }
    w.apiId = apiWard.id;
  }
  await hydrateBoardOccupancy();
  persist();
  ui.platformNote = "Structura din foaie este legată de baza clinică. Ocuparea vine din /api/board.";
}

async function runOpsSync() {
  if (!live) { toast("Nu există sesiune API.", "err"); return; }
  try {
    showLiveBar("Se sincronizează structura cu baza clinică…");
    await syncStructureToApi();
    render();
    showLiveBar("Structură sincronizată. Dashboard-ul principal folosește acum panoul clinic.");
    toast("Structura a fost sincronizată.");
  } catch (err) {
    toast(err instanceof Error ? err.message : "Sincronizarea a eșuat.", "err");
  }
}

async function runOpsLis() {
  if (!live) { toast("Nu există sesiune API.", "err"); return; }
  try {
    const result = await apiJson("/api/integrations/lis/dispatch", { method: "POST", body: "{}" });
    ui.platformNote = "LIS: " + (result.dispatched || 0) + " mesaje trimise către simulator.";
    toast(ui.platformNote);
    if (ui.page === "admin") render();
  } catch (err) {
    toast(err instanceof Error ? err.message : "Dispatch LIS eșuat.", "err");
  }
}

async function runOpsBackup() {
  if (!live) { toast("Nu există sesiune API.", "err"); return; }
  try {
    const result = await apiJson("/api/ops/backup", { method: "POST", body: JSON.stringify({ kind: "logical" }) });
    ui.platformNote = "Backup creat: " + (result.path || result.id);
    toast("Copia de rezervă a fost creată.");
    if (ui.page === "admin") render();
  } catch (err) {
    toast(err instanceof Error ? err.message : "Backup eșuat.", "err");
  }
}

async function ensureSession() {
  try {
    return await apiJson("/api/auth/me");
  } catch (err) {
    return apiJson("/api/auth/open", { method: "POST", body: "{}" });
  }
}

async function bootCollection() {
  render();
  try {
    const me = await ensureSession();
    applySession(me);
    const saved = await apiJson("/api/collection");
    const document = typeof saved.document === "string" ? JSON.parse(saved.document) : saved.document;
    if (document && Array.isArray(document.wards)) applyCollection(document);
    else state.synthetic = true;
    try {
      await hydrateBoardOccupancy();
      const missing = state.wards.some(w => !w.apiId);
      if (missing) await syncStructureToApi();
      else persist();
    } catch (syncErr) {
      ui.platformNote = "Panoul clinic nu a putut fi citit încă. Foaia rămâne utilizabilă.";
    }
    render();
    showLiveBar("Dashboard principal conectat. Secțiile, LIS și backup rulează pe acest flow. Datele de demonstrație pe foaie rămân exercițiu până la migrarea foilor.");
  } catch (err) {
    live = false;
    showLiveBar("Fără legătură la baza spitalului. Modificările rămân doar în acest browser.");
  }
}
bootCollection();

