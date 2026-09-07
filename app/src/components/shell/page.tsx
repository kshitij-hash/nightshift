// The page frame and the few type roles every screen shares.

import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { AppFooter } from "./footer";
import { AppHeader } from "./header";

/** The gutter every screen uses: 20px on a phone, 64px on a desktop. */
export const GUTTER = "px-5 lg:px-16";

export function Page({
  children,
  cta,
  className,
}: {
  children: ReactNode;
  /** A header action for this screen, next to the wallet chip. */
  cta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-screen flex-col bg-ground text-ink", className)}>
      <AppHeader cta={cta} />
      {children}
      <AppFooter />
    </div>
  );
}

/** A centred column, the width every screen's content sits in. */
export function Column({
  children,
  className,
  narrow = false,
}: {
  children: ReactNode;
  className?: string;
  /** The single-column screens (join, nights) read at phone width on a desktop. */
  narrow?: boolean;
}) {
  return (
    <div className={cn("mx-auto w-full", narrow ? "max-w-[520px]" : "max-w-[1440px]", GUTTER, className)}>
      {children}
    </div>
  );
}

export function Kicker({ children, dim = false, className }: { children: ReactNode; dim?: boolean; className?: string }) {
  return <div className={cn("ad-kicker", dim ? "ad-kicker-dim" : "", className)}>{children}</div>;
}

export function Display({
  children,
  as: Tag = "h1",
  size = "lg",
  className,
}: {
  children: ReactNode;
  as?: "h1" | "h2" | "h3" | "div";
  size?: "xl" | "lg" | "md" | "sm";
  className?: string;
}) {
  const sizes = {
    xl: "text-[44px] sm:text-[64px] lg:text-[92px] leading-[0.98]",
    lg: "text-[34px] sm:text-[44px] lg:text-[56px]",
    md: "text-[28px] lg:text-[34px]",
    sm: "text-[22px] lg:text-[24px]",
  };
  return <Tag className={cn("ad-display text-ink", sizes[size], className)}>{children}</Tag>;
}

/** The three-fact reassurance strip: NO NAME · NO CARD · NO TRACE. */
export function Facts({ items, className }: { items: string[]; className?: string }) {
  return (
    <div className={cn("ad-mono flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] tracking-[0.1em] text-faint uppercase", className)}>
      {items.map((it, i) => (
        <span key={it} className="inline-flex items-center gap-3">
          {i > 0 ? <span className="text-rose">·</span> : null}
          {it}
        </span>
      ))}
    </div>
  );
}

/** A quiet line of state under a heading: "Two running. Only you can see this page exists." */
export function Lede({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[16px] leading-[1.6] text-dim", className)}>{children}</p>;
}
