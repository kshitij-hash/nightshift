// A text reveal that types the string in behind a short scrambled frontier,
// like a terminal settling on an answer. Adapted from fancycomponents.dev's
// ScrambleIn (MIT, Daniel Petho), hand-carried here with no dependencies and
// two changes: a startDelay so a column of values can stagger, and a
// prefers-reduced-motion gate that renders the text plainly.
//
// The characters default to hex because that is what this product reveals:
// hashes, commitments, calldata. Screen readers always get the full text.

import { useEffect, useState } from "react";

import { usePrefersReducedMotion } from "../dashboard/use-media";

const HEX = "0123456789abcdef";

export function ScrambleIn({
  text,
  speed = 12,
  scrambleCount = 4,
  startDelay = 0,
  characters = HEX,
  className,
  scrambledClassName,
}: {
  text: string;
  /** Milliseconds per revealed character. */
  speed?: number;
  /** How many scrambled characters run ahead of the revealed prefix. */
  scrambleCount?: number;
  /** Milliseconds before the reveal begins; the slot holds a scrambled
   *  placeholder of the right length so nothing shifts. */
  startDelay?: number;
  characters?: string;
  className?: string;
  scrambledClassName?: string;
}) {
  const still = usePrefersReducedMotion();
  const [visible, setVisible] = useState(0);
  const [frontier, setFrontier] = useState("");
  const [started, setStarted] = useState(startDelay === 0);

  useEffect(() => {
    if (still || startDelay === 0) return;
    const t = window.setTimeout(() => setStarted(true), startDelay);
    return () => window.clearTimeout(t);
  }, [still, startDelay]);

  useEffect(() => {
    if (still || !started || visible >= text.length) return;
    const interval = window.setInterval(() => {
      setVisible((n) => Math.min(text.length, n + 1));
      const ahead = Math.min(scrambleCount, Math.max(0, text.length - visible - 1));
      setFrontier(
        Array.from({ length: ahead }, () =>
          characters.charAt(Math.floor(Math.random() * characters.length)),
        ).join(""),
      );
    }, speed);
    return () => window.clearInterval(interval);
  }, [still, started, visible, text, speed, scrambleCount, characters]);

  if (still) return <span className={className}>{text}</span>;

  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="whitespace-pre-wrap">
        <span className={className}>{text.slice(0, visible)}</span>
        <span className={scrambledClassName ?? "opacity-60"}>
          {visible >= text.length ? "" : frontier}
        </span>
      </span>
    </>
  );
}
