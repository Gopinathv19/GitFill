import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { parsePreferences, preferencesSchema, type Preferences } from "./schema";

export async function getPreferences(db: Database, userId: string): Promise<Preferences> {
  const row = (await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId)))[0];
  return parsePreferences(row?.preferences);
}

/** Replaces the whole configuration (validated; unknown fields dropped). */
export async function savePreferences(db: Database, userId: string, input: unknown): Promise<Preferences> {
  const prefs = preferencesSchema.parse(input);
  await db.update(users).set({ preferences: prefs }).where(eq(users.id, userId));
  return prefs;
}

/** Adds a memory note from chat; identical notes are not added twice and the oldest drop past the cap. */
export async function rememberNote(db: Database, userId: string, text: string): Promise<{ saved: boolean; reason?: string }> {
  const prefs = await getPreferences(db, userId);
  if (!prefs.memory.enabled) return { saved: false, reason: "Memory is turned off on the Configuration page." };
  const clean = text.trim().slice(0, 300);
  if (prefs.memory.notes.some((n) => n.text.toLowerCase() === clean.toLowerCase())) return { saved: false, reason: "Already remembered." };
  const notes = [...prefs.memory.notes, { id: randomBytes(6).toString("hex"), text: clean, createdAt: new Date().toISOString() }].slice(-50);
  await savePreferences(db, userId, { ...prefs, memory: { ...prefs.memory, notes } });
  return { saved: true };
}
