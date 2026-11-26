import type { WardBoardRow } from "./types";

export function WardBoard({
  wards,
  total,
  selectedId,
  onSelect,
  onMore
}: {
  wards: WardBoardRow[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMore?: () => void;
}) {
  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1>Secții</h1>
          <p className="muted" style={{ margin: 0 }}>Ocupație din baza clinică · {total} secții în domeniu</p>
        </div>
      </div>
      <div className="ward-grid">
        {wards.map((ward) => {
          const pct = ward.bed_open ? Math.round((ward.occupied / ward.bed_open) * 100) : 0;
          return (
            <button
              key={ward.id}
              type="button"
              className={`ward-card ${selectedId === ward.id ? "on" : ""}`}
              onClick={() => onSelect(ward.id)}
            >
              <b>{ward.name}</b>
              <span className="muted">{ward.specialty || "—"}</span>
              <div className="ward-metrics">
                <span><strong>{ward.occupied}</strong> ocupați</span>
                <span><strong>{ward.free}</strong> libere</span>
                <span><strong>{ward.bed_total}</strong> paturi</span>
              </div>
              <div className="bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
            </button>
          );
        })}
      </div>
      {onMore && wards.length < total && (
        <button className="btn" type="button" style={{ marginTop: 12 }} onClick={onMore}>Încarcă mai multe</button>
      )}
      {!wards.length && <p className="card">Nicio secție în domeniul tău. Cere administratorului atribuirea pe secție.</p>}
    </section>
  );
}
