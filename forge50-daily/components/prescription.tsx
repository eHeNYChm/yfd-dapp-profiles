// Renders a program_days.prescription value, as produced by
// scripts/seed-program-days.mjs from Forge50_Training_App.html:
//
//   { phase, phase_name, session_key, text, format, items: [{ text, name?, sets?, reps?, load?, note? }] }
//
// Items that parsed as "<name> <sets>×<reps> (<load>)" get a structured
// line; everything else (rowing splits, MetCon rounds, rest-day notes) is
// shown as written.

type Item = {
  text: string;
  name?: string;
  sets?: number;
  reps?: string;
  load?: string;
  note?: string;
};

export type ProgramPrescription = {
  phase?: number;
  phase_name?: string;
  session_key?: string;
  text?: string;
  format?: string | null;
  items?: Item[];
};

function ItemRow({ item }: { item: Item }) {
  if (!item.name || item.sets == null || !item.reps) {
    return <li className="rx-item rx-text">{item.text}</li>;
  }
  return (
    <li className="rx-item">
      <div className="rx-line">
        <span className="rx-name">{item.name}</span>
        <span className="rx-scheme">
          {item.sets} × {item.reps}
          {item.load && <span className="rx-load"> @ {item.load}</span>}
        </span>
      </div>
      {item.note && <div className="rx-extras">{item.note}</div>}
    </li>
  );
}

export function Prescription({ value }: { value: ProgramPrescription | null }) {
  const items = value?.items ?? [];
  if (items.length === 0) {
    return value?.text ? <p>{value.text}</p> : <p className="muted">No details for this session.</p>;
  }
  return (
    <div className="rx">
      {value?.format && <p className="rx-format">{value.format}</p>}
      <ul>
        {items.map((item, i) => (
          <ItemRow key={i} item={item} />
        ))}
      </ul>
    </div>
  );
}
