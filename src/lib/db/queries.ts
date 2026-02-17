import { createServerClient } from "./supabase";
import type { Profile } from "./types";

export async function getUserById(id: string): Promise<Profile | null> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", id).single();
  return data as Profile | null;
}
