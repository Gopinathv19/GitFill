import type { Database } from "@/lib/db";
import { getSessionUser, UnauthorizedError } from "./current";
import type { SessionUser } from "./session";
import { authenticateApiToken } from "./tokens";

/** Accepts either the browser session cookie or a personal API token (extension). */
export async function requireRequestUser(db: Database, req: Request): Promise<SessionUser> {
  const viaToken = await authenticateApiToken(db, req.headers.get("authorization"));
  if (viaToken) return viaToken;
  const viaCookie = await getSessionUser();
  if (viaCookie) return viaCookie;
  throw new UnauthorizedError("Sign in or provide a valid API token.");
}
