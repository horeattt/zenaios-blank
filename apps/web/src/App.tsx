import { useEffect, useState } from "react";
import { api } from "./api";

type Me = {
  displayName: string;
  hospitalId: string;
  passwordChangeRequired: boolean;
  permissions: string[];
};

type Patient = { id: string; first_name: string; last_name: string; identified: boolean };

/** Panou tehnic — secundar. Dashboard-ul principal este index.html (hospital). */
export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        setMe(await api<Me>("/api/auth/me"));
      } catch {
        try {
          setMe(await api<Me>("/api/auth/open", { method: "POST", body: "{}" }));
        } catch {
          setMe(null);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);
  if (!ready) return <main><p>Se încarcă panoul tehnic…</p></main>;
  if (!me) return <Gate onIn={setMe} />;
  return <Shell me={me} onOut={() => { void api("/api/auth/logout", { method: "POST" }).then(() => setMe(null)); }} />;
}

function Gate({ onIn }: { onIn: (me: Me) => void }) {
  const [error, setError] = useState("");
  return (
    <main className="login">
      <form className="card" onSubmit={async (event) => {
        event.preventDefault();
        try {
          onIn(await api<Me>("/api/auth/open", { method: "POST", body: "{}" }));
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Eroare.");
        }
      }}>
        <h1>Panou tehnic</h1>
        <p className="muted">Dashboard-ul principal este la <a href="/">/</a>.</p>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" type="submit">Intră fără parolă</button>
      </form>
    </main>
  );
}

function Shell({ me, onOut }: { me: Me; onOut: () => void }) {
  const [page, setPage] = useState("pacienti");
  return (
    <div className="app" style={{ gridTemplateColumns: "240px 1fr" }}>
      <aside className="side">
        <div className="brand"><div className="mark">Z</div><div><b>ZenAIOS</b><div className="muted">{me.displayName}</div></div></div>
        <nav>
          <a className="btn" href="/">Dashboard spital</a>
          {[["pacienti", "Pacienți"], ["structura", "Structură"], ["raport", "Rapoarte"], ["ai", "AI"]].map(([id, label]) => (
            <button key={id} className={page === id ? "on" : ""} type="button" onClick={() => setPage(id)}>{label}</button>
          ))}
        </nav>
        <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onOut}>Ieșire</button>
      </aside>
      <main>
        {page === "pacienti" && <Patients />}
        {page === "structura" && <Structure />}
        {page === "raport" && <Report />}
        {page === "ai" && <AiAdmin />}
      </main>
    </div>
  );
}

function Patients() {
  const [rows, setRows] = useState<Patient[]>([]);
  useEffect(() => { void api<Patient[]>("/api/patients").then(setRows).catch(() => setRows([])); }, []);
  return (
    <section>
      <h1>Pacienți (API)</h1>
      <div className="card">
        {rows.map((patient) => <div key={patient.id} className="row"><b>{patient.last_name} {patient.first_name}</b><span className="muted">{patient.id}</span></div>)}
        {!rows.length && <p>Niciun pacient clinic încă.</p>}
      </div>
    </section>
  );
}

function Structure() {
  const [text, setText] = useState("…");
  useEffect(() => { void api("/api/structure").then((v) => setText(JSON.stringify(v, null, 2))).catch((e) => setText(String(e))); }, []);
  return <section><h1>Structură</h1><pre className="card">{text}</pre></section>;
}

function Report() {
  const [text, setText] = useState("");
  return (
    <section>
      <h1>Raport internări</h1>
      <button className="btn primary" type="button" onClick={() => void api("/api/reports/admissions").then((v) => setText(JSON.stringify(v, null, 2))).catch((e) => setText(String(e)))}>Calculează</button>
      {text && <pre className="card">{text}</pre>}
    </section>
  );
}

function AiAdmin() {
  return (
    <section>
      <h1>AI</h1>
      <p className="muted">Configurarea furnizorilor rămâne pe server. Dashboard-ul principal: <a href="/">/</a></p>
    </section>
  );
}
