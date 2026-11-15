import { isAdmin, PHOTO_BUCKET, serviceClient } from "@/lib/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hide or unhide a post. Either way it counts as reviewed. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/sightings/[id]">) {
  if (!(await isAdmin())) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { hidden?: unknown } | null;
  if (!UUID.test(id) || typeof body?.hidden !== "boolean") {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const { error } = await serviceClient()
    .from("sightings")
    .update({
      hidden: body.hidden,
      hidden_reason: body.hidden ? "admin" : null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

/** Permanently delete a post and its photos. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/sightings/[id]">) {
  if (!(await isAdmin())) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Bad request." }, { status: 400 });
  const supabase = serviceClient();
  const { data: row, error } = await supabase
    .from("sightings")
    .delete()
    .eq("id", id)
    .select("photo_path, thumbnail_path")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (row) await supabase.storage.from(PHOTO_BUCKET).remove([row.photo_path, row.thumbnail_path]);
  return Response.json({ ok: true });
}
