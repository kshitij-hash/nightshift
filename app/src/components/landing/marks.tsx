// Hairline marks for the persona steps. Not an icon set: the same line
// vocabulary FIG. 1 is drawn in, at the size of a numeral, sitting inline with
// the step text. Two strokes only, the hairline and the accent, so a mark can
// never introduce a colour the rest of the page does not use.

export type MarkKind =
  | "deposit"
  | "wheel"
  | "gate"
  | "tray"
  | "outlets"
  | "claim"
  | "doc"
  | "sign"
  | "check";

const HAIR = { stroke: "var(--ink-4)", fill: "none", strokeWidth: 1 } as const;
const ACC = { stroke: "var(--accent)", fill: "none", strokeWidth: 1.2 } as const;

const PATHS: Record<MarkKind, React.ReactNode> = {
  deposit: (
    <>
      <rect x="3" y="13" width="16" height="6" {...HAIR} />
      <path d="M11 2 v8" {...ACC} />
      <path d="M8 7.5 11 10.5 14 7.5" {...ACC} />
    </>
  ),
  wheel: (
    <>
      <circle cx="11" cy="11" r="7.5" {...HAIR} />
      <path d="M11 3.5 v3M18.5 11 h-3M11 18.5 v-3" {...HAIR} />
      <path d="M11 11 11 5.5" {...ACC} />
    </>
  ),
  gate: (
    <>
      <rect x="3" y="4" width="16" height="14" {...HAIR} />
      <path d="M3 11 h16" {...ACC} />
      <path d="M13 8 16 11 13 14" {...ACC} />
    </>
  ),
  tray: (
    <>
      <rect x="3" y="12" width="16" height="7" {...HAIR} />
      <rect x="6" y="6" width="4" height="4" {...HAIR} />
      <rect x="12" y="6" width="4" height="4" {...ACC} />
    </>
  ),
  outlets: (
    <>
      <path d="M3 6 h16M3 11 h16M3 16 h16" {...HAIR} />
      <path d="M14 16 h5" {...ACC} />
    </>
  ),
  claim: (
    <>
      <rect x="3" y="5" width="16" height="12" {...HAIR} />
      <path d="M7 11 h8" {...ACC} />
      <path d="M12 8 15 11 12 14" {...ACC} />
    </>
  ),
  doc: (
    <>
      <rect x="4" y="3" width="14" height="16" {...HAIR} />
      <path d="M7 8 h8M7 11 h8M7 14 h5" {...HAIR} />
    </>
  ),
  sign: (
    <>
      <path d="M3 15 c4-9 6 3 9-3 s4 2 7-1" {...ACC} />
      <path d="M3 19 h16" {...HAIR} />
    </>
  ),
  check: (
    <>
      <rect x="3" y="3" width="16" height="16" {...HAIR} />
      <path d="M6.5 11.5 9.5 14.5 15.5 7.5" {...ACC} />
    </>
  ),
};

export function Mark({ kind, size = 22 }: { kind: MarkKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      {PATHS[kind]}
    </svg>
  );
}
