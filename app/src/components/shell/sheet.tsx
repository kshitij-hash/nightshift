// A bottom sheet for a decision: cancel a night, confirm a refund. Same
// sheet the connect flow uses, so every "are you sure" looks like every other.

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { Swap } from "./motion";

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ad-sheet-backdrop" />
        <DialogPrimitive.Content className="ad-sheet" aria-describedby={description ? undefined : undefined}>
          <div className="ad-sheet-handle" />
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <DialogPrimitive.Title className="ad-display text-[24px]">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-[14px] leading-[1.55] text-dim">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A value the reader takes with them. Whole value copied, short form shown. */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  return (
    <CopyState value={value}>
      {(copied, copy) => (
        <button type="button" className={`ad-pill ad-pill-ghost ad-pill-sm ${className ?? ""}`} onClick={copy}>
          <Swap>{copied ? "Copied" : label}</Swap>
        </button>
      )}
    </CopyState>
  );
}

import { useCallback, useEffect, useState } from "react";

export function CopyState({
  value,
  children,
}: {
  value: string;
  children: (copied: boolean, copy: () => void) => ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  // The confirmation reverts on its own; a second copy restarts the clock.
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
  }, [value]);
  return <>{children(copied, copy)}</>;
}

/** Wall-clock seconds, ticking once a second while mounted. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
