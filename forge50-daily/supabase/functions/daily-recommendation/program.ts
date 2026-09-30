// Maps a calendar date onto the 52-week program. Kept in sync with
// lib/program.ts in the Next.js app.
//
// PROGRAM_START_DATE is day 1 of week 1. day_of_week follows the JavaScript /
// Postgres convention: 0 = Sunday ... 6 = Saturday.

export const PROGRAM_WEEKS = 52;

export type ProgramPosition = { week: number; day_of_week: number } | null;

export function programPosition(isoDate: string, startDate: string): ProgramPosition {
  const day = Date.parse(`${isoDate}T00:00:00Z`);
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(day) || Number.isNaN(start)) return null;
  const offset = Math.round((day - start) / 86_400_000);
  if (offset < 0) return null;
  const week = Math.floor(offset / 7) + 1;
  if (week > PROGRAM_WEEKS) return null;
  return { week, day_of_week: new Date(day).getUTCDay() };
}

// Today's date in the owner's timezone, as YYYY-MM-DD.
export function localDate(timeZone: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function localHour(timeZone: string, at = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(at),
  );
}
