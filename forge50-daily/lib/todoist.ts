// Read-only Todoist access via the unified API v1 with a personal API token.
// Nothing is stored; tasks are fetched on each page load.

export type Task = {
  id: string;
  content: string;
  priority: 1 | 2 | 3 | 4; // API scale: 4 is the app's "P1"
  due: string | null; // YYYY-MM-DD or datetime
  overdue: boolean;
  url: string;
};

export type TasksResult =
  | { status: "ok"; tasks: Task[] }
  | { status: "not_configured" }
  | { status: "error"; message: string };

type ApiTask = {
  id: string;
  content: string;
  priority: number;
  checked?: boolean;
  due?: { date: string; datetime?: string | null } | null;
};

export async function getOpenTasks(today: string): Promise<TasksResult> {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) return { status: "not_configured" };

  const filter = process.env.TODOIST_FILTER || "today | overdue";
  const limit = Number(process.env.TODOIST_LIMIT || 8);

  try {
    const params = new URLSearchParams({ query: filter, limit: "50" });
    const res = await fetch(`https://api.todoist.com/api/v1/tasks/filter?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`todoist returned ${res.status}`);
    const body = (await res.json()) as { results?: ApiTask[] } | ApiTask[];
    const raw = Array.isArray(body) ? body : (body.results ?? []);

    const tasks = raw
      .filter((t) => !t.checked)
      .map<Task>((t) => {
        const dueDate = t.due?.date?.slice(0, 10) ?? null;
        return {
          id: t.id,
          content: t.content,
          priority: Math.min(4, Math.max(1, t.priority)) as Task["priority"],
          due: t.due?.datetime ?? t.due?.date ?? null,
          overdue: dueDate !== null && dueDate < today,
          url: `https://app.todoist.com/app/task/${t.id}`,
        };
      })
      // Overdue first, then highest priority, then earliest due.
      .sort(
        (a, b) =>
          Number(b.overdue) - Number(a.overdue) ||
          b.priority - a.priority ||
          (a.due ?? "9999").localeCompare(b.due ?? "9999"),
      )
      .slice(0, limit);

    return { status: "ok", tasks };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "unknown error" };
  }
}
