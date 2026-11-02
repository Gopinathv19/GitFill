import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";

/**
 * The app's starting point: a new session in the most recently active workspace (the same
 * workspace the sidebar's "New session" picks). With no workspace yet, the workspace list,
 * where the first one is created.
 */
export default async function NewSession() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const latest = (await getDb().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, user.id)).orderBy(desc(workspaces.updatedAt)).limit(1))[0];
  redirect(latest ? `/workspaces/${latest.id}` : "/workspaces");
}
