import type { VolumeState } from "@/lib/manual";

const names: Record<VolumeState, string> = { reviewed: "Reviewed", draft: "In review", planned: "Planned" };

/** Whether a volume is reviewed, still being reviewed, or yet to be written. */
export function StateChip({ state }: { state: VolumeState }) {
  const tone = state === "reviewed" ? " chip-on" : state === "draft" ? " chip-amber" : "";
  return <span className={`chip${tone}`}>{names[state]}</span>;
}
