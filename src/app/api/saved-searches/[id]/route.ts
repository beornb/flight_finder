import { deleteSavedSearch } from "@/lib/saved/store";
import { idParamSchema } from "@/lib/validation/saved-schema";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const parsed = idParamSchema.safeParse(id);
  if (!parsed.success) {
    return Response.json({ error: "Invalid saved search id." }, { status: 400 });
  }
  const deleted = await deleteSavedSearch(parsed.data);
  if (!deleted) {
    return Response.json({ error: "Saved search not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
