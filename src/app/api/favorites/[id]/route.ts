import { deleteFavorite } from "@/lib/saved/store";
import { idParamSchema } from "@/lib/validation/saved-schema";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const parsed = idParamSchema.safeParse(id);
  if (!parsed.success) {
    return Response.json({ error: "Invalid favorite id." }, { status: 400 });
  }
  const deleted = await deleteFavorite(parsed.data);
  if (!deleted) {
    return Response.json({ error: "Favorite not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
