// The few motion helpers the screens share. Everything here is CSS-driven;
// React only decides when a class applies. The rules live in globals.css.

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";

/** A section that rises into place once, as it scrolls into view. */
export function Reveal({
  children,
  className,
  as: Tag = "div",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
  /** Milliseconds, for a second element revealing with the first. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // A browser with no observer shows everything at once rather than never.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    // Two ways to be seen: intersect the viewport, or be above its bottom
    // edge at all. The second catches a section a person jumped past with an
    // anchor or a flick, which never intersects and must not stay hidden.
    const above = () => el.getBoundingClientRect().top < window.innerHeight;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) || above()) setSeen(true);
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    io.observe(el);
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (above()) setSeen(true);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [seen]);
  return (
    <Tag
      ref={ref}
      className={cn("ad-rise", className)}
      data-inview={seen ? "true" : "false"}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/** Text that crossfades when it changes: a button label moving through the
 *  phases of a flow, a chip going from Connect to Ready. Keyed on the text
 *  itself, so an unchanged label never re-animates. */
export function Swap({ children, className, k }: { children: ReactNode; className?: string; k?: string }) {
  const key = k ?? (typeof children === "string" ? children : String(children));
  return (
    <span key={key} className={cn("ad-swap", className)}>
      {children}
    </span>
  );
}

/** A display heading whose lines rise out of a mask, one after the other.
 *  For the door only: a heading a person reads thirty times a day does not
 *  perform its own arrival. */
export function CutLines({ lines, className }: { lines: ReactNode[]; className?: string }) {
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className={cn("ad-cut", className)}>
          <span>{line}</span>
        </span>
      ))}
    </>
  );
}

/** The spinner ring the flows share: bounded by the request that started it. */
export function Ring({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden="true" className={cn("ad-spin shrink-0", className)}>
      <circle cx="36" cy="36" r="30" stroke="currentColor" strokeOpacity="0.25" strokeWidth="8" />
      <path d="M36 6a30 30 0 0 1 30 30" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}
