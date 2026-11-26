import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { BedBoardRow, Me, WardBoardRow } from "./types";
import { WardBoard } from "./WardBoard";
import { WardDetail } from "./WardDetail";

type Page = "board" | "ops" | "tech";

export function CollectionApp({ me, onOut }: { me: Me; onOut: () => void }) {
  const [page, setPage] = useState<Page>("board");
  const [wards, setWards] = useState<WardBoardRow[]>([]);
  const [wardTotal, setWardTotal] = useState(0);
  const [wardOffset, setWardOffset] = useState(0);
  const [selected, setSelected] = useState<WardBoardRow | null>(null);
  const [beds, setBeds] = useState<BedBoardRow[]>([]);
  const [bedTotal, setBedTotal] = useState(0);
  const [bedOffset, setBedOffset] = useState(0);
  const [error, setError] = useState("");
  const [opsText, setOpsText] = useState("");

  const loadWards = useCallback(async (offset = 0, append = false) => {
    const data = await api<{ total: number; items: WardBoardRow[]; limit: number }>("/api/board/wards?limit=40&offset=" + offset);
    setWardTotal(data.total);
    setWardOffset(offset + data.items.length);
    setWards((prev) => append ? [...prev, ...data.items] : data.items);
  }, []);

  useEffect(() => {
    void loadWards(0, false).catch((reason) => setError(String(reason)));
  }, [loadWards]);

  async function openWard(id: string) {
    setError("");
    const ward = wards.find((item) => item.id === id) ?? null;
    setSelected(ward);
    const data = await api<{ total: number; items: BedBoardRow[] }>(`/api/board/wards/${id}/beds?limit=100&offset=0`);
    setBeds(data.items);
    setBedTotal(data.total);
    setBedOffset(data.items.length);
  }

  return (
    <div className="app collection">
      <aside className="side">
        <div className="brand">
          <div className="mark">Z</div>
          <div>
            <b>ZenAIOS</b>
            <div className="muted">{me.displayName}</div>
          </div>
        </div>
        <nav>
          <button className={page === "board" ? "on" : ""} type="button" onClick={() => { setPage("board"); setSelected(null); }}>Panou secții</button>
          <button className={page === "ops" ? "on" : ""} type="button" onClick={() => setPage("ops")}>Operațiuni</button>
          <button className={page === "tech" ? "on" : ""} type="button" onClick={() => { window.location.href = "/?panou=1"; }}>Panou tehnic</button>
          <a className="btn" href="/colectare-demo">Demo HTML vechi</a>
        </nav>
        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
          {me.hospitalWideAccess ? "Acces pe tot spitalul" : `Domeniu: ${me.wardScopeIds?.length ?? 0} secții`}
        </p>
        <button className="btn" type="button" style={{ marginTop: 8 }} onClick={onOut}>Ieșire</button>
      </aside>
      <main>
        {error && <p className="error">{error}</p>}
        {page === "board" && !selected && (
          <WardBoard
            wards={wards}
            total={wardTotal}
            selectedId={null}
            onSelect={(id) => void openWard(id).catch((reason) => setError(String(reason)))}
            onMore={wardOffset < wardTotal ? () => void loadWards(wardOffset, true).catch((reason) => setError(String(reason))) : undefined}
          />
        )}
        {page === "board" && selected && (
          <WardDetail
            ward={selected}
            beds={beds}
            total={bedTotal}
            onBack={() => setSelected(null)}
            onMore={bedOffset < bedTotal ? () => void api<{ items: BedBoardRow[] }>(`/api/board/wards/${selected.id}/beds?limit=100&offset=${bedOffset}`).then((data) => {
              setBeds((prev) => [...prev, ...data.items]);
              setBedOffset((prev) => prev + data.items.length);
            }).catch((reason) => setError(String(reason))) : undefined}
          />
        )}
        {page === "ops" && (
          <section>
            <h1>Operațiuni spital</h1>
            <p>Backup logic criptat și expediere LIS către simulatorul local.</p>
            <div className="row">
              <button className="btn primary" type="button" onClick={() => void api("/api/ops/backup", { method: "POST", body: JSON.stringify({ kind: "logical" }) }).then((value) => setOpsText(JSON.stringify(value, null, 2))).catch((reason) => setOpsText(String(reason)))}>Copie de rezervă</button>
              <button className="btn ok" type="button" onClick={() => void api("/api/integrations/lis/dispatch", { method: "POST", body: "{}" }).then((value) => setOpsText(JSON.stringify(value, null, 2))).catch((reason) => setOpsText(String(reason)))}>Dispatch LIS</button>
            </div>
            {opsText && <pre className="card">{opsText}</pre>}
          </section>
        )}
      </main>
    </div>
  );
}
