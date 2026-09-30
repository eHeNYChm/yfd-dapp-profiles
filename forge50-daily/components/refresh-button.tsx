"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="button ghost"
      aria-label="Refresh"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? "…" : "↻"}
    </button>
  );
}
