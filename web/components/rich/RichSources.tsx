"use client";

import { createContext, useContext, type ReactNode } from "react";
import { noSources, type RichSources } from "@/lib/rich/sources";

const Sources = createContext<RichSources>(noSources);

/** Gives every editor inside it what the page can offer: who can be named, and what can be dropped in. */
export function RichSourcesProvider({ value, children }: { value: RichSources | null; children: ReactNode }) {
  return <Sources.Provider value={value ?? noSources}>{children}</Sources.Provider>;
}

export const useRichSources = () => useContext(Sources);
