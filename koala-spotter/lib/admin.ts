import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const ADMIN_COOKIE = "maggie_admin";
export const PHOTO_BUCKET = "sighting-photos";

export function adminConfigured(): boolean {
  return Boolean(
    process.env.ADMIN_PASSWORD &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

function safeEqual(a: string, b: string): boolean {
  const x = createHmac("sha256", "cmp").update(a).digest();
  const y = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(x, y);
}

export function passwordMatches(candidate: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  return Boolean(real) && safeEqual(candidate, real!);
}

/**
 * The cookie value is derived from the password and the service key, so it
 * can't be forged without them and changing the password signs everyone out.
 */
export function sessionToken(): string {
  return createHmac("sha256", `${process.env.ADMIN_PASSWORD}:${process.env.SUPABASE_SERVICE_ROLE_KEY}`)
    .update("maggie-admin-session-v1")
    .digest("hex");
}

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  return Boolean(value) && safeEqual(value!, sessionToken());
}

/** Full-access client. Server only: never import this from a client file. */
export function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
