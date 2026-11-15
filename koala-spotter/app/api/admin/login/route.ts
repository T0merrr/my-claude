import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminConfigured, passwordMatches, sessionToken } from "@/lib/admin";

// Slows password guessing. Per server instance only, so the real defence
// is a long ADMIN_PASSWORD.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60_000;

export async function POST(request: Request) {
  if (!adminConfigured()) {
    return Response.json({ error: "Admin is not set up. Set ADMIN_PASSWORD and SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!passwordMatches(password)) {
    attempts.set(ip, {
      count: entry && entry.resetAt > now ? entry.count + 1 : 1,
      resetAt: entry && entry.resetAt > now ? entry.resetAt : now + WINDOW_MS,
    });
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }

  attempts.delete(ip);
  (await cookies()).set(ADMIN_COOKIE, sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return Response.json({ ok: true });
}
