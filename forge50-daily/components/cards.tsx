import { createClient } from "@/lib/supabase/server";
import { getEventsForDay } from "@/lib/google-calendar";
import { getOpenTasks } from "@/lib/todoist";
import { formatTime } from "@/lib/dates";
import type { ProgramPosition } from "@/lib/program";
import { Prescription } from "@/components/prescription";
import { DismissButton } from "@/components/dismiss-button";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function WorkoutCard({
  today,
  position,
  configured,
}: {
  today: string;
  position: ProgramPosition;
  configured: boolean;
}) {
  if (!configured) {
    return (
      <section className="card">
        <h2 className="card-title">Workout</h2>
        <p className="muted">Set PROGRAM_START_DATE to line the program up with the calendar.</p>
      </section>
    );
  }
  if (!position) {
    return (
      <section className="card">
        <h2 className="card-title">Workout</h2>
        <p className="muted">Today is outside the 52-week program.</p>
      </section>
    );
  }

  const supabase = await createClient();
  const [dayRes, loggedRes] = await Promise.all([
    supabase
      .from("program_days")
      .select("id, week, day_of_week, session_type, title, prescription, notes")
      .eq("week", position.week)
      .eq("day_of_week", position.day_of_week)
      .maybeSingle(),
    supabase.from("sessions").select("id, perceived_effort").eq("performed_on", today).limit(1),
  ]);

  const day = dayRes.data;
  const logged = loggedRes.data?.[0];

  return (
    <section className="card workout">
      <div className="card-head">
        <h2 className="card-title">
          Week {position.week} · {DAY_NAMES[position.day_of_week]}
        </h2>
        {logged && (
          <span className="pill done">
            Logged{logged.perceived_effort ? ` · RPE ${logged.perceived_effort}` : ""}
          </span>
        )}
      </div>
      {dayRes.error ? (
        <p className="error">Couldn’t load the program: {dayRes.error.message}</p>
      ) : !day ? (
        <p className="muted">Nothing is prescribed for today.</p>
      ) : (
        <>
          <p className="workout-title">
            {day.title}
            {day.session_type && <span className="pill">{day.session_type}</span>}
          </p>
          <Prescription value={day.prescription} />
          {day.notes && <p className="notes">{day.notes}</p>}
        </>
      )}
    </section>
  );
}

export async function RecommendationCard({ today }: { today: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("recommendations")
    .select("id, headline, body, acknowledged")
    .eq("for_date", today)
    .eq("acknowledged", false)
    .maybeSingle();
  if (!data) return null;
  return (
    <section className="card recommendation" aria-label="Today’s recommendation">
      <div className="card-head">
        <h2 className="rec-headline">{data.headline}</h2>
        <DismissButton id={data.id} />
      </div>
      <p className="rec-body">{data.body}</p>
    </section>
  );
}

export async function CalendarCard({ today, timeZone }: { today: string; timeZone: string }) {
  const result = await getEventsForDay(today, timeZone);
  return (
    <section className="card">
      <h2 className="card-title">Calendar</h2>
      {result.status === "not_configured" ? (
        <p className="muted">Google Calendar isn’t connected.</p>
      ) : result.status === "error" ? (
        <p className="error">Couldn’t load events ({result.message}).</p>
      ) : result.events.length === 0 ? (
        <p className="muted">Nothing scheduled.</p>
      ) : (
        <ul className="list">
          {result.events.map((e) => (
            <li key={e.id} className="event">
              <span className="event-time">
                {e.allDay ? "All day" : `${formatTime(e.start, timeZone)}–${formatTime(e.end, timeZone)}`}
              </span>
              <span className="event-title">
                {e.title}
                {e.location && <span className="event-location">{e.location}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export async function TasksCard({ today }: { today: string }) {
  const result = await getOpenTasks(today);
  return (
    <section className="card">
      <h2 className="card-title">Tasks</h2>
      {result.status === "not_configured" ? (
        <p className="muted">Todoist isn’t connected.</p>
      ) : result.status === "error" ? (
        <p className="error">Couldn’t load tasks ({result.message}).</p>
      ) : result.tasks.length === 0 ? (
        <p className="muted">All clear.</p>
      ) : (
        <ul className="list">
          {result.tasks.map((t) => (
            <li key={t.id} className="task">
              <span className={`prio p${5 - t.priority}`} aria-label={`Priority ${5 - t.priority}`} />
              <a href={t.url} className="task-title">
                {t.content}
              </a>
              {t.overdue && <span className="pill overdue">Overdue</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CardSkeleton({ title }: { title: string }) {
  return (
    <section className="card" aria-busy="true">
      <h2 className="card-title">{title}</h2>
      <div className="skeleton" />
      <div className="skeleton short" />
    </section>
  );
}
