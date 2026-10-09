/**
 * A drawn symbol for each kind of unit, in the same line as the site's icons.
 * A unit is shown with its kind's symbol unless an admin has given it a picture.
 * Decorative: the unit's name and kind are always written beside it.
 */

const symbols = {
  /** Three ships in formation. */
  fleet: <path d="M12 2.5l3 7-3-1.5-3 1.5zM5.5 12l3 7-3-1.5-3 1.5zM18.5 12l3 7-3-1.5-3 1.5z" />,
  /** Two ships, one ahead of the other. */
  group: <path d="M8.5 4l3.5 8.5-3.5-1.8L5 12.5zM15.5 11l3.5 8.5-3.5-1.8-3.5 1.8z" />,
  /** One ship, the site's own mark for one. */
  ship: <path d="M12 3l8 18-8-4-8 4 8-18z" />,
  /** A fighter, from above. */
  flight: <path d="M12 3l3 9 6 5-6-1-3 5-3-5-6 1 6-5z" />,
  /** One part of a whole. */
  department: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 12h8V4" />
    </>
  ),
  command: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7l1.5 3.2 3.5.4-2.6 2.4.7 3.5-3.1-1.7-3.1 1.7.7-3.5L7 10.6l3.5-.4z" />
    </>
  ),
  staff: (
    <>
      <rect x="6" y="4.5" width="12" height="16.5" rx="1.5" />
      <path d="M9.5 4.5V3h5v1.5M9.5 10.5h5M9.5 14.5h5" />
    </>
  ),
  /** The map symbol for troops on foot. */
  ground: (
    <>
      <rect x="3" y="6" width="18" height="12" />
      <path d="M3 6l18 12M21 6L3 18" />
    </>
  ),
  other: <path d="M12 3l9 9-9 9-9-9z" />,
} as const;

const byKind: Record<string, keyof typeof symbols> = {
  fleet: "fleet",
  "battle group": "group",
  "task force": "group",
  flotilla: "group",
  squadron: "flight",
  wing: "flight",
  flight: "flight",
  ship: "ship",
  department: "department",
  command: "command",
  staff: "staff",
  battalion: "ground",
  company: "ground",
  platoon: "ground",
  section: "ground",
  team: "ground",
};

export function UnitSymbol({ kind, size = 28 }: { kind: string; size?: number }) {
  return (
    <svg className="icon unit-symbol" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {symbols[byKind[kind] ?? "other"]}
    </svg>
  );
}
