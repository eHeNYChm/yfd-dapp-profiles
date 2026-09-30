import { addDays, startOfLocalDay } from "@/lib/dates";

// Read-only Google Calendar access for a single account, using a long-lived
// OAuth refresh token (see scripts/google-refresh-token.mjs). Nothing is
// stored; events are fetched on each page load.

export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // ISO datetime, or YYYY-MM-DD for all-day events
  end: string;
  allDay: boolean;
  location: string | null;
  calendar: string;
};

export type CalendarResult =
  | { status: "ok"; events: CalendarEvent[] }
  | { status: "not_configured" }
  | { status: "error"; message: string };

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`token refresh failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

export async function getEventsForDay(isoDate: string, timeZone: string): Promise<CalendarResult> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    return { status: "not_configured" };
  }
  const calendarIds = (process.env.GOOGLE_CALENDAR_IDS || "primary")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const token = await accessToken();
    const timeMin = startOfLocalDay(isoDate, timeZone).toISOString();
    const timeMax = startOfLocalDay(addDays(isoDate, 1), timeZone).toISOString();

    const perCalendar = await Promise.all(
      calendarIds.map(async (calendarId) => {
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          timeZone,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "50",
        });
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        if (!res.ok) throw new Error(`calendar ${calendarId} returned ${res.status}`);
        const body = (await res.json()) as { items?: GoogleEvent[] };
        return (body.items ?? [])
          .filter((e) => e.status !== "cancelled")
          .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === "declined"))
          .map<CalendarEvent>((e) => ({
            id: `${calendarId}:${e.id}`,
            title: e.summary || "(no title)",
            start: e.start?.dateTime ?? e.start?.date ?? "",
            end: e.end?.dateTime ?? e.end?.date ?? "",
            allDay: !e.start?.dateTime,
            location: e.location ?? null,
            calendar: calendarId,
          }));
      }),
    );

    const events = perCalendar.flat().sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return Date.parse(a.start) - Date.parse(b.start);
    });
    return { status: "ok", events };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "unknown error" };
  }
}
