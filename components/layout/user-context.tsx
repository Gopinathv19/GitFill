"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/client/types";

const UserContext = createContext<SessionUser | null>(null);
export const UserProvider = UserContext.Provider;

export function useUser(): SessionUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useUser must be used inside the app shell");
  return user;
}
