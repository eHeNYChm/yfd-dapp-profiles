import { assert, assertEquals } from "jsr:@std/assert@1";
import { addDays, computeSignals, type MetricRow, trendSignal } from "./signals.ts";
import { programPosition } from "./program.ts";

const FOR = "2026-10-15";

function days(n: number, metric: string, f: (i: number) => number, unit: string | null = null): MetricRow[] {
  // i = 1 is the day before FOR, i = n is n days before.
  return Array.from({ length: n }, (_, k) => ({
    recorded_on: addDays(FOR, -(k + 1)),
    metric,
    value: f(k + 1),
    unit,
    source: "apple_health",
  }));
}

Deno.test("flat body mass does not count as a trend", () => {
  const rows = days(14, "body_mass", (i) => 80 + (i % 2 ? 0.2 : -0.2), "kg");
  const s = computeSignals(FOR, rows, []);
  assertEquals(s.trend.body_mass?.moved, false);
  assertEquals(s.trend.body_mass?.direction, "flat");
});

Deno.test("a real week-over-week drop is a trend", () => {
  // Prior week ~81 kg, this week ~80 kg.
  const rows = days(14, "Body Mass", (i) => (i <= 7 ? 80 : 81), "kg");
  const s = computeSignals(FOR, rows, []);
  assertEquals(s.trend.body_mass?.moved, true);
  assertEquals(s.trend.body_mass?.direction, "down");
  assertEquals(s.trend.body_mass?.change_kg, -1);
});

Deno.test("pounds are converted before trend math", () => {
  const rows = days(14, "weight", (i) => (i <= 7 ? 176 : 178.2), "lb");
  const s = computeSignals(FOR, rows, []);
  assertEquals(s.mass_unit, "lb");
  assert(s.trend.body_mass!.moved);
  assert(Math.abs(s.trend.body_mass!.change_kg + 1) < 0.01);
});

Deno.test("trend needs at least three readings per week", () => {
  const series = new Map([
    [addDays(FOR, -1), 80],
    [addDays(FOR, -2), 80],
    [addDays(FOR, -9), 82],
    [addDays(FOR, -10), 82],
    [addDays(FOR, -11), 82],
  ]);
  assertEquals(trendSignal(series, FOR), null);
});

Deno.test("short sleep is flagged low against baseline", () => {
  const rows = [
    ...days(10, "sleep_duration", () => 7.5, "hr").slice(1),
    { recorded_on: FOR, metric: "sleep_duration", value: 5.5, unit: "hr", source: "apple_health" },
  ];
  const s = computeSignals(FOR, rows, []);
  assertEquals(s.daily.sleep_hours?.flag, "low");
  assertEquals(s.daily.sleep_hours?.latest_on, FOR);
});

Deno.test("sleep in minutes is converted to hours", () => {
  const rows = days(8, "sleep", () => 450, "min");
  const s = computeSignals(FOR, rows, []);
  assertEquals(s.daily.sleep_hours?.latest, 7.5);
});

Deno.test("raised RHR and suppressed HRV are flagged", () => {
  const rows = [
    ...days(8, "resting_heart_rate", (i) => (i === 1 ? 62 : 55), "bpm"),
    ...days(8, "heart_rate_variability", (i) => (i === 1 ? 40 : 60), "ms"),
  ];
  const s = computeSignals(FOR, rows, []);
  assertEquals(s.daily.resting_hr?.flag, "high");
  assertEquals(s.daily.hrv_ms?.flag, "low");
});

Deno.test("stale readings are ignored", () => {
  const rows = days(10, "resting_heart_rate", () => 55, "bpm").filter((r) => r.recorded_on < addDays(FOR, -3));
  const s = computeSignals(FOR, rows, []);
  assertEquals(s.daily.resting_hr, null);
});

Deno.test("multiple sources on the same day are averaged", () => {
  const rows: MetricRow[] = [
    ...days(6, "hrv", () => 50, "ms"),
    { recorded_on: addDays(FOR, -1), metric: "hrv", value: 70, unit: "ms", source: "other" },
  ];
  const s = computeSignals(FOR, rows, []);
  assertEquals(s.daily.hrv_ms?.latest, 60);
});

Deno.test("program position", () => {
  // 2026-10-05 is a Monday.
  assertEquals(programPosition("2026-10-05", "2026-10-05"), { week: 1, day_of_week: 1 });
  assertEquals(programPosition("2026-10-11", "2026-10-05"), { week: 1, day_of_week: 0 });
  assertEquals(programPosition("2026-10-12", "2026-10-05"), { week: 2, day_of_week: 1 });
  assertEquals(programPosition("2026-10-04", "2026-10-05"), null);
  assertEquals(programPosition(addDays("2026-10-05", 52 * 7), "2026-10-05"), null);
  assertEquals(programPosition(addDays("2026-10-05", 52 * 7 - 1), "2026-10-05")?.week, 52);
});
