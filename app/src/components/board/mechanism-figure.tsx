// FIG. 1: the vault drawn as an engineering section rather than an
// illustration. Axonometric projection, hairline wireframe, one orange path
// for value, mono annotations, and a dimension line for the period.
//
// It is a schematic and says so on the sheet. The four numbers it carries
// (escrow in, escrow now, creator claimable, blocks per period) are passed in
// from the same reads the board above runs on, so the drawing cannot drift
// away from the instrument.

type P = [number, number];

/* +x right-down, +z left-down, +y up */
const SCL = 4;
const OXX = 172;
const OYY = 300;
const PJ = (x: number, y: number, z: number): P => [
  OXX + (x * 0.96 - z * 0.52) * SCL,
  OYY + (x * 0.13 + z * 0.4) * SCL - y * 0.86 * SCL,
];
const str = (pts: P[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

const HAIR = "var(--line-panel)";
const GHOST = "var(--line-ghost)";
const ACC = "var(--accent)";
const INK = "var(--ink-5)";
const LAB = "var(--ink-4)";

function Ln({
  a,
  b,
  s = HAIR,
  d,
  w = 1,
}: {
  a: P;
  b: P;
  s?: string;
  d?: string;
  w?: number;
}) {
  return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={s} strokeWidth={w} strokeDasharray={d} />;
}

function Box({
  x,
  y,
  z,
  w,
  h,
  d,
  s = HAIR,
  fill = "var(--bg-1)",
  fillOpacity = 1,
  frontDash,
}: {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  s?: string;
  fill?: string;
  fillOpacity?: number;
  frontDash?: string;
}) {
  const top: P[] = [PJ(x, y + h, z), PJ(x + w, y + h, z), PJ(x + w, y + h, z + d), PJ(x, y + h, z + d)];
  const right: P[] = [PJ(x + w, y + h, z), PJ(x + w, y + h, z + d), PJ(x + w, y, z + d), PJ(x + w, y, z)];
  const front: P[] = [PJ(x, y + h, z + d), PJ(x + w, y + h, z + d), PJ(x + w, y, z + d), PJ(x, y, z + d)];
  return (
    <g>
      <polygon points={str(front)} fill={fill} fillOpacity={fillOpacity} stroke={s} strokeDasharray={frontDash} />
      <polygon points={str(right)} fill={fill} fillOpacity={fillOpacity} stroke={s} />
      <polygon points={str(top)} fill={fill} fillOpacity={fillOpacity} stroke={s} />
    </g>
  );
}

function Arrow({ a, b, s = ACC, w = 1.5, d }: { a: P; b: P; s?: string; w?: number; d?: string }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const k = 7;
  const p1: P = [b[0] - ux * k - uy * k * 0.42, b[1] - uy * k + ux * k * 0.42];
  const p2: P = [b[0] - ux * k + uy * k * 0.42, b[1] - uy * k - ux * k * 0.42];
  return (
    <g>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={s} strokeWidth={w} strokeDasharray={d} />
      <polygon points={str([b, p1, p2])} fill={s} />
    </g>
  );
}

function Ring({
  cx,
  cy,
  r,
  z,
  s = HAIR,
  n = 44,
  fill = "var(--bg-1)",
}: {
  cx: number;
  cy: number;
  r: number;
  z: number;
  s?: string;
  n?: number;
  fill?: string;
}) {
  const p = Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return PJ(cx + r * Math.cos(t), cy + r * Math.sin(t), z);
  });
  return <polygon points={str(p)} fill={fill} stroke={s} />;
}

function Tx({
  at,
  t,
  anchor = "start",
  size = 9,
  fill = INK,
  track = ".1em",
  dy = 0,
}: {
  at: P;
  t: string;
  anchor?: "start" | "middle" | "end";
  size?: number;
  fill?: string;
  track?: string;
  dy?: number;
}) {
  return (
    <text
      x={at[0]}
      y={at[1] + dy}
      textAnchor={anchor}
      fontSize={size}
      fill={fill}
      letterSpacing={track}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {t}
    </text>
  );
}

/** A dimension line with extension ticks, drawn the way a drawing sheet does. */
function Dim({ a, b, label, drop = 26 }: { a: P; b: P; label: string; drop?: number }) {
  const a2: P = [a[0], a[1] + drop];
  const b2: P = [b[0], b[1] + drop];
  return (
    <g>
      <Ln a={a} b={[a[0], a[1] + drop + 6]} s={INK} />
      <Ln a={b} b={[b[0], b[1] + drop + 6]} s={INK} />
      <Arrow a={[a2[0] + 1, a2[1]]} b={b2} s={INK} w={1} />
      <Arrow a={[b2[0] - 1, b2[1]]} b={a2} s={INK} w={1} />
      <Tx at={[(a2[0] + b2[0]) / 2, a2[1] + 20]} anchor="middle" t={label} />
    </g>
  );
}

function Callout({ n, from, to }: { n: string; from: P; to: P }) {
  return (
    <g>
      <Ln a={from} b={to} s={INK} />
      <circle cx={to[0]} cy={to[1]} r={9.5} fill="var(--bg-1)" stroke={INK} />
      <text
        x={to[0]}
        y={to[1] + 3.5}
        textAnchor="middle"
        fontSize="10"
        fill={LAB}
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {n}
      </text>
    </g>
  );
}

export type MechanismLabels = {
  /** "ESCROW 3.00 STRK" */
  escrowIn: string;
  /** "0.00 NOW" */
  escrowNow: string;
  /** "CREATOR CLAIMABLE 3.00 STRK" */
  claimable: string;
  /** "2100 BLOCKS ~ 60 MIN" */
  periodDim: string;
  /** "PERIOD WHEEL · 3 DETENTS" */
  wheel: string;
  /** "commit(0x0743b3…da4f45)" */
  commit: string;
  /** "0x171e8e0b…417f8e · SECTION" */
  vault: string;
  /** Cumulative escrow gradations, bottom to top. Empty when unknown. */
  levels: string[];
};

export function Mechanism({ labels }: { labels: MechanismLabels }) {
  const wheel = { cx: 142, cy: 30, r: 19 };
  const det = [-90, 30, 150];
  /* the drum's silhouette angles in this projection (tangent parallel to +z) */
  const SIL = [-44.7, 135.3].map((deg) => {
    const t = (deg * Math.PI) / 180;
    return (z: number) => PJ(wheel.cx + wheel.r * Math.cos(t), wheel.cy + wheel.r * Math.sin(t), z);
  });
  const notes: Array<[number, string]> = [
    [3, GHOST],
    [17, GHOST],
    [31, ACC],
  ];
  const outlets: Array<[number, string, string]> = [
    [6, GHOST, "00"],
    [22, GHOST, "01"],
    [38, ACC, "02"],
  ];
  const levelRows: Array<[number, string]> = [16, 28, 40].map((yy, i) => [yy, labels.levels[i] ?? ""]);

  return (
    <svg
      viewBox="0 0 1210 566"
      width={1210}
      height={566}
      role="img"
      aria-label="Axonometric section of the vault: escrow enters from the privacy pool, is held and accounted, the period wheel is block gated, the nullifier gate is write once, each charge exits to the creator's claimable balance."
      style={{ display: "block", overflow: "visible" }}
    >
      {/* sheet header */}
      <Tx at={[4, 22]} size={11} fill={LAB} track=".18em" t="FIG. 1 · VAULT v4 · SECTION THROUGH THE PERIOD MECHANISM" />
      <Tx at={[4, 38]} t="AXONOMETRIC · SCHEMATIC, NOT TO SCALE · ORANGE PATH = VALUE · DASHED FACE = CUT AWAY" />
      <Ln a={[4, 48]} b={[560, 48]} s="var(--line-soft)" />

      {/* floor */}
      <polygon
        points={str([PJ(-6, 0, 2), PJ(268, 0, 2), PJ(268, 0, 52), PJ(-6, 0, 52)])}
        fill="none"
        stroke="var(--line-soft)"
        strokeDasharray="2 5"
      />

      {/* 1 · the pool and its notes */}
      <Box x={0} y={0} z={6} w={46} h={6} d={44} />
      {notes.map(([z, s]) => (
        <Box key={z} x={z} y={6} z={14} w={11} h={7} d={28} s={s} />
      ))}
      <Tx at={PJ(0, 0, 50)} dy={17} size={10} fill={LAB} track=".14em" t="STRK20 PRIVACY POOL" />
      <Tx at={PJ(0, 0, 50)} dy={30} t="THREE NOTES · ONE IS SPENT INTO THE VAULT" />

      {/* escrow inflow */}
      <Arrow a={PJ(36, 54, 28)} b={PJ(36, 15, 28)} />
      <Tx at={PJ(36, 56, 28)} dy={-8} size={10} fill={LAB} track=".14em" t={labels.escrowIn} />
      <Tx at={PJ(36, 56, 28)} dy={4} t="ONE PRIVATE POOL ACTION, ONCE" />

      {/* duct pool to vault */}
      <Box x={46} y={4} z={20} w={28} h={7} d={14} s={GHOST} />
      <Arrow a={PJ(47, 7.5, 27)} b={PJ(76, 7.5, 27)} />
      <Tx at={PJ(52, 0, 50)} dy={30} t={labels.commit} />

      {/* 2 · the vault, sectioned */}
      <Box x={74} y={0} z={0} w={112} h={64} d={56} frontDash="4 5" fill="var(--bg-2)" fillOpacity={0.55} />
      <Tx at={PJ(74, 66, 0)} dy={-6} size={11} fill="var(--ink-2)" track=".16em" t="VAULT v4" />
      <Tx at={PJ(74, 66, 0)} dy={7} t={labels.vault} />

      {/* escrow reservoir */}
      <Box x={82} y={3} z={8} w={30} h={44} d={40} s={GHOST} fill="none" />
      {levelRows.map(([yy, lab]) => (
        <g key={yy}>
          <Ln a={PJ(82, yy, 48)} b={PJ(112, yy, 48)} s={GHOST} d="2 4" />
          {lab ? <Tx at={PJ(79, yy, 48)} dy={2} anchor="end" size={8.5} t={`${lab} `} /> : null}
        </g>
      ))}
      <Ln a={PJ(82, 4.5, 48)} b={PJ(112, 4.5, 48)} s={ACC} w={1.8} />
      <Tx at={PJ(112, 4.5, 48)} dy={4} size={9} fill={ACC} t={` ${labels.escrowNow}`} />
      <Tx at={PJ(97, 48, 48)} dy={-7} size={9} fill={LAB} track=".14em" anchor="middle" t="ESCROW, ACCOUNTED" />

      {/* 3 · the period wheel: a closed drum, back ring, silhouette body, front ring */}
      <Ln a={PJ(wheel.cx, wheel.cy, 4)} b={PJ(wheel.cx, wheel.cy, 52)} s={GHOST} />
      <Ring cx={wheel.cx} cy={wheel.cy} r={wheel.r} z={12} s={GHOST} />
      <polygon points={str([SIL[0]!(12), SIL[1]!(12), SIL[1]!(46), SIL[0]!(46)])} fill="var(--bg-1)" stroke="none" />
      {[0, 1].map((i) => (
        <Ln key={i} a={SIL[i]!(12)} b={SIL[i]!(46)} s={GHOST} />
      ))}
      <Ring cx={wheel.cx} cy={wheel.cy} r={wheel.r} z={46} s={HAIR} />
      <Ring cx={wheel.cx} cy={wheel.cy} r={5.5} z={46} s={GHOST} fill="none" />
      {det.map((d, i) => {
        const t = (d * Math.PI) / 180;
        return (
          <Ln
            key={d}
            a={PJ(wheel.cx + wheel.r * Math.cos(t), wheel.cy + wheel.r * Math.sin(t), 46)}
            b={PJ(wheel.cx + 7 * Math.cos(t), wheel.cy + 7 * Math.sin(t), 46)}
            s={i === 0 ? ACC : GHOST}
            w={i === 0 ? 2.2 : 1.2}
          />
        );
      })}
      <Tx at={PJ(wheel.cx - 20, 54, 46)} size={10} fill={LAB} track=".14em" t={labels.wheel} />

      {/* pawl */}
      <Ln a={PJ(166, 56, 46)} b={PJ(154, 44, 46)} s={HAIR} w={1.5} />
      <Ln a={PJ(154, 44, 46)} b={PJ(146, 49, 46)} s={HAIR} w={1.5} />
      <Tx at={PJ(168, 57, 46)} dy={-2} t="PAWL · ADVANCES ONE WAY ONLY" />

      {/* dimension: one detent = one period */}
      <Dim a={PJ(123, 4, 56)} b={PJ(161, 4, 56)} label={labels.periodDim} drop={34} />

      {/* 4 · the nullifier gate in the right wall */}
      <Box x={182} y={12} z={20} w={5} h={18} d={18} s={ACC} fill="none" />
      <polygon
        points={str([PJ(187, 30, 20), PJ(197, 35, 20), PJ(197, 35, 38), PJ(187, 30, 38)])}
        fill="var(--bg-1)"
        stroke={HAIR}
      />
      <Arrow a={PJ(174, 21, 29)} b={PJ(206, 21, 29)} />
      <Arrow a={PJ(222, 36, 29)} b={PJ(203, 36, 29)} s={INK} w={1} d="3 3" />
      <Ln a={PJ(214, 41, 29)} b={PJ(208, 31, 29)} s="var(--destructive)" w={1.5} />
      <Ln a={PJ(208, 41, 29)} b={PJ(214, 31, 29)} s="var(--destructive)" w={1.5} />
      <Tx at={PJ(190, 40, 18)} dy={-4} size={10} fill={LAB} track=".14em" t="PERIOD NULLIFIER" />
      <Tx at={PJ(190, 40, 18)} dy={8} t="WRITE-ONCE · ONE WAY · NEVER TWICE" />

      {/* 5 · charge outlets */}
      {outlets.map(([z, s, lab]) => (
        <g key={lab}>
          <Box x={186} y={6} z={z} w={22} h={8} d={10} s={s} />
          <Tx at={PJ(189, 14, z)} dy={-3} size={8.5} fill={s === ACC ? ACC : INK} t={lab} />
        </g>
      ))}
      <Arrow a={PJ(190, 10, 43)} b={PJ(220, 10, 43)} />

      {/* 6 · creator claimable */}
      <Box x={222} y={0} z={4} w={42} h={5} d={44} />
      {[8, 22, 36].map((z) => (
        <Box key={z} x={226} y={5} z={z} w={32} h={10} d={10} s={ACC} />
      ))}
      <Tx at={PJ(222, 0, 48)} dy={18} size={10} fill={LAB} track=".14em" t={labels.claimable} />
      <Tx at={PJ(222, 0, 48)} dy={31} t="SETTLED LATER, BY A CLAIM THE CREATOR SIGNS" />

      {/* 7 · the keeper drives the wheel, not the tank */}
      <Ln a={PJ(wheel.cx, 64, 30)} b={PJ(wheel.cx, 92, 30)} s={HAIR} />
      <Box x={wheel.cx - 6} y={92} z={24} w={12} h={5} d={12} s={HAIR} />
      <Arrow a={PJ(wheel.cx, 88, 30)} b={PJ(wheel.cx, 67, 30)} s={INK} w={1} d="3 3" />
      <Tx at={PJ(wheel.cx + 8, 96, 30)} size={10} fill={LAB} track=".14em" t="A KEEPER CALLS charge()" />
      <Tx at={PJ(wheel.cx + 8, 96, 30)} dy={13} t="PERMISSIONLESS · ANYONE MAY, NOBODY MUST" />

      {/* callouts */}
      <Callout n="1" from={PJ(31, 13, 28)} to={[128, 262]} />
      <Callout n="2" from={PJ(97, 24, 48)} to={[372, 470]} />
      <Callout n="3" from={PJ(152, 12, 46)} to={[706, 520]} />
      <Callout n="4" from={PJ(190, 21, 29)} to={[884, 236]} />
      <Callout n="5" from={PJ(204, 10, 43)} to={[826, 512]} />
      <Callout n="6" from={PJ(242, 12, 22)} to={[1092, 330]} />
    </svg>
  );
}
