/**
 * The kinds of hull, in the order the register lists them. Nothing here reads
 * the database, so a form in the browser may read it.
 */

export const shipKinds: { key: string; name: string; many: string }[] = [
  { key: "capital", name: "Capital ship", many: "Capital ships" },
  { key: "frigate", name: "Frigate", many: "Frigates" },
  { key: "corvette", name: "Corvette", many: "Corvettes" },
  { key: "gunship", name: "Gunship", many: "Gunships" },
  { key: "dropship", name: "Dropship", many: "Dropships" },
  { key: "fighter", name: "Fighter", many: "Fighters" },
  { key: "bomber", name: "Bomber", many: "Bombers" },
  { key: "transport", name: "Transport", many: "Transports" },
  { key: "medical", name: "Medical ship", many: "Medical ships" },
  { key: "support", name: "Support ship", many: "Support ships" },
  { key: "exploration", name: "Exploration ship", many: "Exploration ships" },
  { key: "salvage", name: "Salvage ship", many: "Salvage ships" },
  { key: "mining", name: "Mining ship", many: "Mining ships" },
  { key: "runabout", name: "Runabout", many: "Runabouts" },
];
export const shipKindOf = (key: string) => shipKinds.find((kind) => kind.key === key) ?? { key, name: key, many: key };
