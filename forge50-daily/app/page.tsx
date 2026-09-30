import { Suspense } from "react";
import { env } from "@/lib/env";
import { formatDayHeading, localDate } from "@/lib/dates";
import { programPosition } from "@/lib/program";
import { signOut } from "@/app/actions";
import {
  CalendarCard,
  CardSkeleton,
  RecommendationCard,
  TasksCard,
  WorkoutCard,
} from "@/components/cards";
import { RefreshButton } from "@/components/refresh-button";
import { RefreshOnFocus } from "@/components/refresh-on-focus";

export default async function TodayPage() {
  const timeZone = env.timeZone;
  const today = localDate(timeZone);
  const start = env.programStartDate;
  const position = start ? programPosition(today, start) : null;

  return (
    <main className="shell">
      <RefreshOnFocus />
      <header className="top">
        <div>
          <p className="eyebrow">Today</p>
          <h1>{formatDayHeading(today)}</h1>
        </div>
        <div className="top-actions">
          <RefreshButton />
          <form action={signOut}>
            <button type="submit" className="button ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <Suspense fallback={null}>
        <RecommendationCard today={today} />
      </Suspense>
      <Suspense fallback={<CardSkeleton title="Workout" />}>
        <WorkoutCard today={today} position={position} configured={Boolean(start)} />
      </Suspense>
      <Suspense fallback={<CardSkeleton title="Calendar" />}>
        <CalendarCard today={today} timeZone={timeZone} />
      </Suspense>
      <Suspense fallback={<CardSkeleton title="Tasks" />}>
        <TasksCard today={today} />
      </Suspense>
    </main>
  );
}
