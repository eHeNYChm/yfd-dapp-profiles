import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { addDays, computeSignals, LB_PER_KG, type Signals } from "./signals.ts";
import { localDate, localHour, programPosition } from "./program.ts";

// Nightly advisory recommendation for the coming day.
//
// Invoked by pg_cron (see the schedule_daily_recommendation migration) with an
// x-cron-key header whose value lives in Vault; the key is checked through the
// service-role-only public.verify_cron_key() RPC, so there is no second copy of
// it to keep in sync. The function reads health_metrics, sessions and
// program_days and writes exactly one row to recommendations. It never writes
// to program_days.
//
// Secrets: ANTHROPIC_API_KEY (required), PROGRAM_START_DATE (YYYY-MM-DD,
// required to include the day's prescription), APP_TIMEZONE (default
// America/Los_Angeles).
//
// Body (all optional): { "for_date": "YYYY-MM-DD", "force": true }
// Without for_date, the target is today if run before noon local time and
// tomorrow otherwise, so the job can be scheduled either late evening or
// early morning. An existing row is left alone unless force is true.

const MODEL = "claude-opus-5-5";
const WINDOW_DAYS = 14;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const SYSTEM_PROMPT = `You write the one daily recommendation shown on a personal training dashboard for someone following Forge 50, a 52-week strength program with a running block overlaid.

You receive the day's prescribed session, recovery signals computed from Apple Health, and recent training history. Write a short, specific note that helps them decide how to approach the day.

Rules:
- Advisory only. The program is fixed; never say it has been changed. Frame adjustments as options ("consider capping the top set at RPE 7", "keep the run conversational"), and default to "train as prescribed" when the signals support it.
- Sleep, resting heart rate and HRV are day-to-day readiness signals. Each comes with a flag computed against the person's own recent baseline; trust the flag and cite the actual numbers when a signal is off.
- Body mass and lean mass are trend signals. They appear in the input only when the 7-day average has meaningfully moved against the prior week. If they are absent, do not mention weight, body composition, or their absence.
- If a signal is missing or has an insufficient baseline, do not speculate about it.
- Headline: at most 70 characters, plain text, no trailing period.
- Body: 2 to 4 sentences, plain text, no lists or markdown, under 90 words. Lead with what to do today.
- This is not medical advice; if signals look alarming (for example, a very large resting heart rate spike alongside suppressed HRV), suggest rest and checking in with how they feel rather than diagnosing.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    body: { type: "string" },
  },
  required: ["headline", "body"],
  additionalProperties: false,
};

function kgTo(unit: "kg" | "lb", kg: number) {
  return unit === "lb" ? Math.round(kg * LB_PER_KG * 10) / 10 : Math.round(kg * 10) / 10;
}

// What the model sees. Trend signals that did not move are dropped entirely
// so they cannot be mentioned.
function promptPayload(
  signals: Signals,
  prescription: Record<string, unknown> | null,
  sessions: { performed_on: string; session_type: string; perceived_effort: number | null; notes: string | null }[],
) {
  const unit = signals.mass_unit;
  const trends: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(signals.trend)) {
    if (!t?.moved) continue;
    trends[name] = {
      direction: t.direction,
      this_week_avg: kgTo(unit, t.current_avg_kg),
      prior_week_avg: kgTo(unit, t.prior_avg_kg),
      change: kgTo(unit, t.change_kg),
      change_pct: t.change_pct,
      unit,
    };
  }
  return {
    date: signals.for_date,
    prescribed_session: prescription ?? "unknown (program position not configured or outside the 52 weeks)",
    readiness: {
      sleep_hours: signals.daily.sleep_hours,
      resting_heart_rate_bpm: signals.daily.resting_hr,
      hrv_ms: signals.daily.hrv_ms,
    },
    ...(Object.keys(trends).length ? { body_composition_trends: trends } : {}),
    training_load: signals.training,
    recent_sessions: sessions.map((s) => ({
      date: s.performed_on,
      type: s.session_type,
      effort: s.perceived_effort,
      ...(s.notes ? { notes: s.notes } : {}),
    })),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const key = req.headers.get("x-cron-key");
  if (!key) return json({ error: "unauthorized" }, 401);
  const { data: keyOk, error: keyErr } = await supabase.rpc("verify_cron_key", { key });
  if (keyErr) return json({ error: `key check failed: ${keyErr.message}` }, 500);
  if (keyOk !== true) return json({ error: "unauthorized" }, 401);

  let body: { for_date?: string; force?: boolean } = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const tz = Deno.env.get("APP_TIMEZONE") || "America/Los_Angeles";
  const today = localDate(tz);
  const forDate = body.for_date ?? (localHour(tz) >= 12 ? addDays(today, 1) : today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(forDate)) return json({ error: "for_date must be YYYY-MM-DD" }, 400);

  if (!body.force) {
    const { data: existing, error } = await supabase
      .from("recommendations")
      .select("id")
      .eq("for_date", forDate)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (existing) return json({ ok: true, skipped: "exists", for_date: forDate });
  }

  const windowStart = addDays(forDate, -WINDOW_DAYS);
  const startDate = Deno.env.get("PROGRAM_START_DATE");
  const position = startDate ? programPosition(forDate, startDate) : null;

  const [metricsRes, sessionsRes, programRes] = await Promise.all([
    supabase
      .from("health_metrics")
      .select("recorded_on, metric, value, unit, source")
      .gte("recorded_on", windowStart)
      .lte("recorded_on", forDate),
    supabase
      .from("sessions")
      .select("performed_on, session_type, perceived_effort, detail, notes")
      .gte("performed_on", windowStart)
      .lt("performed_on", forDate)
      .order("performed_on"),
    position
      ? supabase
        .from("program_days")
        .select("week, day_of_week, session_type, title, prescription, notes")
        .eq("week", position.week)
        .eq("day_of_week", position.day_of_week)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [metricsRes, sessionsRes, programRes]) {
    if (r.error) return json({ error: r.error.message }, 500);
  }

  const metrics = metricsRes.data ?? [];
  const sessions = sessionsRes.data ?? [];
  const programDay = programRes.data;
  const signals = computeSignals(forDate, metrics, sessions);

  const hasReadiness = Object.values(signals.daily).some((s) => s !== null);
  const hasTrend = Object.values(signals.trend).some((t) => t?.moved);
  if (!hasReadiness && !hasTrend && sessions.length === 0) {
    return json({ ok: true, skipped: "no recent health or training data", for_date: forDate });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
  const anthropic = new Anthropic({ apiKey });

  const payload = promptPayload(signals, programDay, sessions);

  let response;
  try {
    response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      // Re-run on a fallback model if a safety classifier declines.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write the recommendation for ${forDate} from this data:\n\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
      return json({ error: `claude api unavailable: ${err.message}` }, 503);
    }
    if (err instanceof Anthropic.APIError) {
      return json({ error: `claude api error ${err.status}: ${err.message}` }, 502);
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    return json({ error: "model declined to produce a recommendation" }, 502);
  }
  if (response.stop_reason === "max_tokens") {
    return json({ error: "model output truncated" }, 502);
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  let out: { headline: string; body: string };
  try {
    out = JSON.parse(text);
  } catch {
    return json({ error: "model returned invalid json" }, 502);
  }

  const row = {
    for_date: forDate,
    headline: out.headline.trim(),
    body: out.body.trim(),
    signals: {
      ...signals,
      program_day: programDay
        ? { week: programDay.week, day_of_week: programDay.day_of_week, title: programDay.title }
        : null,
      model: response.model,
    },
    acknowledged: false,
  };

  const { error: writeErr } = await supabase
    .from("recommendations")
    .upsert(row, { onConflict: "for_date" });
  if (writeErr) return json({ error: writeErr.message }, 500);

  return json({ ok: true, for_date: forDate, headline: row.headline });
});
