import { isAdmin, serviceClient } from "@/lib/admin";

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { data, error } = await serviceClient().rpc("admin_list_sightings");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ sightings: data }, { headers: { "Cache-Control": "no-store" } });
}
