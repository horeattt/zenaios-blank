import type { BedBoardRow, WardBoardRow } from "./types";

export function WardDetail({
  ward,
  beds,
  total,
  onBack,
  onMore
}: {
  ward: WardBoardRow;
  beds: BedBoardRow[];
  total: number;
  onBack: () => void;
  onMore?: () => void;
}) {
  const byRoom = new Map<string, BedBoardRow[]>();
  for (const bed of beds) {
    const list = byRoom.get(bed.room_name) ?? [];
    list.push(bed);
    byRoom.set(bed.room_name, list);
  }
  return (
    <section>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" type="button" onClick={onBack}>← Secții</button>
        <div>
          <h1 style={{ margin: 0 }}>{ward.name}</h1>
          <p className="muted" style={{ margin: 0 }}>{ward.occupied}/{ward.bed_open} ocupație · {total} paturi listate</p>
        </div>
      </div>
      {[...byRoom.entries()].map(([room, roomBeds]) => (
        <div key={room} className="salon">
          <h2>{room}</h2>
          <div className="bed-grid">
            {roomBeds.map((bed) => (
              <article key={bed.bed_id} className={`bed ${bed.patient_id ? "occ" : ""} ${bed.status === "closed" ? "closed" : ""}`}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b>{bed.label}</b>
                  <span className="muted">{bed.status === "closed" ? "închis" : bed.patient_id ? "ocupat" : "liber"}</span>
                </div>
                {bed.patient_id ? (
                  <>
                    <div className="name">{bed.last_name} {bed.first_name}</div>
                    <div className="muted mono">{bed.patient_id.slice(0, 8)}…</div>
                  </>
                ) : (
                  <div className="muted">Pat liber</div>
                )}
              </article>
            ))}
          </div>
        </div>
      ))}
      {onMore && beds.length < total && (
        <button className="btn" type="button" onClick={onMore}>Mai multe paturi</button>
      )}
    </section>
  );
}
