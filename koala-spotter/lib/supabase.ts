"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./supabase-url";

export const PHOTO_BUCKET = "sighting-photos";

const url = supabaseUrl();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "maggie-koala-device",
      },
    });
  }
  return client;
}

/**
 * The per-device identity: an anonymous Supabase user, created the first
 * time this phone writes something and kept in localStorage after that.
 * Browsing the map does not need it.
 */
export async function ensureDeviceId(): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const { data: created, error } = await supabase.auth.signInAnonymously();
  if (error || !created.user) throw error ?? new Error("Could not sign in");
  return created.user.id;
}

export function photoUrl(path: string): string {
  return `${url}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}
