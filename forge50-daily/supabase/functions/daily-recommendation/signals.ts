// Pure signal computation for the nightly recommendation. No I/O here so it
// can be unit tested without Supabase or the Claude API.

export type MetricRow = {
  recorded_on: string; // YYYY-MM-DD
  metric: string;
  value: number | string;
  unit: string | null;
  source: string;
};

export type SessionRow = {
  performed_on: string;
  session_type: string;
  perceived_effort: number | null;
  detail: unknown;
  notes: string | null;
};

type Canonical = "sleep_hours" | "resting_hr" | "hrv_ms" | "body_mass_kg" | "lean_mass_kg";

// Apple Health / Shortcut names vary; normalise to one key per signal.
const ALIASES: Record<string, Canonical> = {
  sleep: "sleep_hours",
  sleep_duration: "sleep_hours",
  sleep_hours: "sleep_hours",
  sleep_analysis: "sleep_hours",
  time_asleep: "sleep_hours",
  asleep: "sleep_hours",
  resting_heart_rate: "resting_hr",
  resting_hr: "resting_hr",
  rhr: "resting_hr",
  heart_rate_variability: "hrv_ms",
  heart_rate_variability_sdnn: "hrv_ms",
  hrv: "hrv_ms",
  hrv_sdnn: "hrv_ms",
  body_mass: "body_mass_kg",
  weight: "body_mass_kg",
  body_weight: "body_mass_kg",
  lean_body_mass: "lean_mass_kg",
  lean_mass: "lean_mass_kg",
};

export function canonicalMetric(name: string): Canonical | null {
  const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return ALIASES[key] ?? null;
}

const LB_PER_KG = 2.2046226218;

// Convert to the canonical unit for the signal. Unknown units are assumed to
// already be canonical (hours, bpm, ms, kg).
function toCanonical(kind: Canonical, value: number, unit: string | null): number {
  const u = (unit ?? "").trim().toLowerCase();
  if (kind === "sleep_hours") {
    if (u === "min" || u === "mins" || u === "minutes") return value / 60;
    if (u === "s" || u === "sec" || u === "seconds") return value / 3600;
    return value;
  }
  if (kind === "body_mass_kg" || kind === "lean_mass_kg") {
    if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") return value / LB_PER_KG;
    return value;
  }
  return value;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// One value per (signal, date): the mean across sources for that day.
export function dailySeries(rows: MetricRow[]): Map<Canonical, Map<string, number>> {
  const acc = new Map<Canonical, Map<string, number[]>>();
  for (const r of rows) {
    const kind = canonicalMetric(r.metric);
    const v = typeof r.value === "number" ? r.value : Number(r.value);
    if (!kind || !Number.isFinite(v)) continue;
    const byDay = acc.get(kind) ?? new Map<string, number[]>();
    const list = byDay.get(r.recorded_on) ?? [];
    list.push(toCanonical(kind, v, r.unit));
    byDay.set(r.recorded_on, list);
    acc.set(kind, byDay);
  }
  const out = new Map<Canonical, Map<string, number>>();
  for (const [kind, byDay] of acc) {
    out.set(kind, new Map([...byDay].map(([d, vs]) => [d, mean(vs)])));
  }
  return out;
}

export type DailySignal = {
  latest: number;
  latest_on: string;
  baseline: number | null; // mean of the other days in the window
  baseline_days: number;
  delta: number | null;
  delta_pct: number | null;
  flag: "low" | "high" | "normal" | "insufficient_baseline";
};

// Thresholds for calling a day-to-day reading out of line with baseline.
// Direction matters: short sleep, raised RHR and suppressed HRV are the
// recovery-relevant moves.
function flagDaily(kind: Canonical, latest: number, baseline: number): DailySignal["flag"] {
  if (kind === "sleep_hours") {
    if (latest < 6 || latest < baseline - 1) return "low";
    if (latest > baseline + 1.5) return "high";
    return "normal";
  }
  if (kind === "resting_hr") {
    if (latest >= baseline + 5 || latest >= baseline * 1.08) return "high";
    if (latest <= baseline - 5) return "low";
    return "normal";
  }
  // hrv_ms
  if (latest <= baseline * 0.85) return "low";
  if (latest >= baseline * 1.2) return "high";
  return "normal";
}

// Day-to-day signal: the most recent reading on or before `asOf`, and no older
// than two days (stale data is worse than none), compared to the mean of the
// remaining days in the window.
export function dailySignal(
  kind: Canonical,
  series: Map<string, number> | undefined,
  asOf: string,
): DailySignal | null {
  if (!series || series.size === 0) return null;
  const days = [...series.keys()].filter((d) => d <= asOf).sort();
  if (days.length === 0) return null;
  const latestOn = days[days.length - 1];
  if (latestOn < addDays(asOf, -2)) return null;
  const latest = series.get(latestOn)!;
  const prior = days.slice(0, -1).map((d) => series.get(d)!);
  if (prior.length < 3) {
    return {
      latest: round(latest, 2),
      latest_on: latestOn,
      baseline: null,
      baseline_days: prior.length,
      delta: null,
      delta_pct: null,
      flag: "insufficient_baseline",
    };
  }
  const baseline = mean(prior);
  return {
    latest: round(latest, 2),
    latest_on: latestOn,
    baseline: round(baseline, 2),
    baseline_days: prior.length,
    delta: round(latest - baseline, 2),
    delta_pct: round(((latest - baseline) / baseline) * 100, 1),
    flag: flagDaily(kind, latest, baseline),
  };
}

export type TrendSignal = {
  current_avg_kg: number;
  prior_avg_kg: number;
  current_days: number;
  prior_days: number;
  change_kg: number;
  change_pct: number;
  direction: "up" | "down" | "flat";
  moved: boolean;
};

// Minimum readings per 7-day window before a weekly average means anything.
const MIN_TREND_READINGS = 3;

// Trend signal: 7-day rolling average ending the day before `forDate`,
// compared with the 7 days before that. `moved` is true only when the change
// clears both an absolute and a relative threshold, so normal scale noise
// (water, food, time of day) does not count as a trend.
export function trendSignal(
  series: Map<string, number> | undefined,
  forDate: string,
  thresholdKg = 0.3,
  thresholdPct = 0.5,
): TrendSignal | null {
  if (!series) return null;
  const inRange = (from: string, to: string) =>
    [...series.entries()].filter(([d]) => d >= from && d <= to).map(([, v]) => v);
  const current = inRange(addDays(forDate, -7), addDays(forDate, -1));
  const prior = inRange(addDays(forDate, -14), addDays(forDate, -8));
  if (current.length < MIN_TREND_READINGS || prior.length < MIN_TREND_READINGS) return null;
  const cur = mean(current);
  const pri = mean(prior);
  const change = cur - pri;
  const pct = (change / pri) * 100;
  const moved = Math.abs(change) >= thresholdKg && Math.abs(pct) >= thresholdPct;
  return {
    current_avg_kg: round(cur, 2),
    prior_avg_kg: round(pri, 2),
    current_days: current.length,
    prior_days: prior.length,
    change_kg: round(change, 2),
    change_pct: round(pct, 2),
    direction: moved ? (change > 0 ? "up" : "down") : "flat",
    moved,
  };
}

// Weight unit the owner actually logs in, so the model reports in that unit.
export function preferredMassUnit(rows: MetricRow[]): "kg" | "lb" {
  let lb = 0;
  let kg = 0;
  for (const r of rows) {
    const kind = canonicalMetric(r.metric);
    if (kind !== "body_mass_kg" && kind !== "lean_mass_kg") continue;
    const u = (r.unit ?? "").toLowerCase();
    if (u.startsWith("lb") || u.startsWith("pound")) lb++;
    else kg++;
  }
  return lb > kg ? "lb" : "kg";
}

export type Signals = {
  for_date: string;
  daily: {
    sleep_hours: DailySignal | null;
    resting_hr: DailySignal | null;
    hrv_ms: DailySignal | null;
  };
  trend: {
    body_mass: TrendSignal | null;
    lean_mass: TrendSignal | null;
  };
  mass_unit: "kg" | "lb";
  training: {
    sessions_last_7d: number;
    sessions_last_14d: number;
    avg_effort_last_7d: number | null;
    last_session_on: string | null;
  };
};

export function computeSignals(
  forDate: string,
  metrics: MetricRow[],
  sessions: SessionRow[],
): Signals {
  const series = dailySeries(metrics);
  // Day-to-day readings may be stamped on the target date itself (e.g. last
  // night's sleep recorded this morning), so allow up to forDate.
  const asOf = forDate;
  const weekAgo = addDays(forDate, -7);
  const recent = sessions.filter((s) => s.performed_on >= weekAgo && s.performed_on < forDate);
  const efforts = recent.map((s) => s.perceived_effort).filter((e): e is number => e != null);
  const lastSession = sessions
    .filter((s) => s.performed_on < forDate)
    .map((s) => s.performed_on)
    .sort()
    .at(-1) ?? null;

  return {
    for_date: forDate,
    daily: {
      sleep_hours: dailySignal("sleep_hours", series.get("sleep_hours"), asOf),
      resting_hr: dailySignal("resting_hr", series.get("resting_hr"), asOf),
      hrv_ms: dailySignal("hrv_ms", series.get("hrv_ms"), asOf),
    },
    trend: {
      body_mass: trendSignal(series.get("body_mass_kg"), forDate),
      lean_mass: trendSignal(series.get("lean_mass_kg"), forDate),
    },
    mass_unit: preferredMassUnit(metrics),
    training: {
      sessions_last_7d: recent.length,
      sessions_last_14d: sessions.filter((s) => s.performed_on < forDate).length,
      avg_effort_last_7d: efforts.length ? round(mean(efforts), 1) : null,
      last_session_on: lastSession,
    },
  };
}

export { LB_PER_KG };
