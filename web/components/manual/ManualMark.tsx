import { Roundel } from "@/components/Crest";

/** The manual's mark: the fleet roundel, a rule, and the words. */
export function ManualMark({ heading = false }: { heading?: boolean }) {
  const Tag = heading ? "h1" : "p";
  return (
    <Tag className="mark">
      <Roundel size={68} />
      <span className="mark-rule" aria-hidden="true" />
      <span className="mark-words">Fleet manual</span>
    </Tag>
  );
}
