"use client";

import { useEffect } from "react";

/**
 * Sets the browser tab title to "<title> · GitFill" for client pages, which cannot export
 * metadata. Without a title (still loading) the tab shows "GitFill".
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · GitFill` : "GitFill";
  }, [title]);
}
