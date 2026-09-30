// Renders a program_days.prescription JSON value. The shape comes from the
// seed (scripts/seed-program-days.mjs); anything unexpected falls back to a
// readable key/value list rather than failing.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const LABELS: Record<string, string> = {
  sets: "Sets",
  reps: "Reps",
  load: "Load",
  weight: "Load",
  intensity: "Intensity",
  rpe: "RPE",
  rest: "Rest",
  tempo: "Tempo",
  duration: "Duration",
  distance: "Distance",
  pace: "Pace",
  zone: "Zone",
  notes: "Notes",
};

function label(key: string) {
  return LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function scalar(v: Json): string {
  if (v === null) return "–";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function isRecord(v: Json): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// A movement line: "Back squat — 3 × 5 @ 75%".
function Item({ item }: { item: Json }) {
  if (!isRecord(item)) return <li>{scalar(item)}</li>;
  const name = item.name ?? item.exercise ?? item.movement ?? item.title;
  const sets = item.sets;
  const reps = item.reps;
  const load = item.load ?? item.weight ?? item.intensity ?? item.percent;
  const scheme = [
    sets != null && reps != null ? `${scalar(sets)} × ${scalar(reps)}` : sets != null ? `${scalar(sets)} sets` : reps != null ? `${scalar(reps)} reps` : null,
    load != null ? `@ ${scalar(load)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const shown = new Set(["name", "exercise", "movement", "title", "sets", "reps", "load", "weight", "intensity", "percent"]);
  const extras = Object.entries(item).filter(([k, v]) => !shown.has(k) && v !== null && v !== "");
  return (
    <li className="rx-item">
      <div className="rx-line">
        <span className="rx-name">{name != null ? scalar(name) : "Item"}</span>
        {scheme && <span className="rx-scheme">{scheme}</span>}
      </div>
      {extras.length > 0 && (
        <div className="rx-extras">
          {extras.map(([k, v]) => (
            <span key={k}>
              {label(k)}: {Array.isArray(v) ? v.map(scalar).join(", ") : scalar(v)}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export function Prescription({ value }: { value: Json }) {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return <p className="muted">No details for this session.</p>;
  }
  return (
    <div className="rx">
      {Object.entries(value).map(([key, v]) => {
        if (Array.isArray(v)) {
          return (
            <section key={key} className="rx-block">
              <h3>{label(key)}</h3>
              <ul>
                {v.map((item, i) => (
                  <Item key={i} item={item} />
                ))}
              </ul>
            </section>
          );
        }
        if (isRecord(v)) {
          return (
            <section key={key} className="rx-block">
              <h3>{label(key)}</h3>
              <dl className="rx-kv">
                {Object.entries(v).map(([k, inner]) => (
                  <div key={k}>
                    <dt>{label(k)}</dt>
                    <dd>{Array.isArray(inner) ? inner.map(scalar).join(", ") : scalar(inner)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        }
        return (
          <dl key={key} className="rx-kv">
            <div>
              <dt>{label(key)}</dt>
              <dd>{scalar(v)}</dd>
            </div>
          </dl>
        );
      })}
    </div>
  );
}
