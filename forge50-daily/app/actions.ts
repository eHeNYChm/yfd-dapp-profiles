"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function dismissRecommendation(id: number) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("recommendations")
    .update({ acknowledged: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
