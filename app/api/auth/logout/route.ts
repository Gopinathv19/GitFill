import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/** POST /api/auth/logout — clears the session cookie. */
export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
