/**
 * The Supabase project URL with anything after the host removed. The
 * dashboard shows the address in a few forms (for example ending in
 * /rest/v1/), and only the bare https://xxxx.supabase.co form works.
 */
export function supabaseUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}
