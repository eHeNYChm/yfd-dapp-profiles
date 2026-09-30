"use client";

import { useTransition } from "react";
import { dismissRecommendation } from "@/app/actions";

export function DismissButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="button ghost"
      disabled={pending}
      onClick={() => start(() => dismissRecommendation(id))}
    >
      {pending ? "…" : "Dismiss"}
    </button>
  );
}
