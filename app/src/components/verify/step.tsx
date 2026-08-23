// The three-step frame and the field primitives the steps share.
//
// Focus moves by border color only: the active step's hairline crosses to the
// accent over 150ms and its ground lifts one step. Steps never collapse or
// slide, and a step that is already answered keeps a one-line summary on
// screen, so the whole flow stays readable while you work inside one part of
// it. A step header is a button, because it is one.

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";

export function StepShell({
  n,
  title,
  active,
  done,
  onOpen,
  summary,
  children,
}: {
  n: string;
  title: string;
  active: boolean;
  done: boolean;
  onOpen: () => void;
  /** One line stating what this step settled, shown when it is closed. */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 border px-5 py-5 transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]",
        "border-t-0 first:border-t",
        active
          ? "border-ns-accent bg-surface-panel"
          : "border-border-panel bg-transparent",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 w-full flex-wrap items-center gap-3 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-6"
      >
        <span
          className={cn(
            "inline-flex h-6 w-7 shrink-0 items-center justify-center border text-[11px] tabular-nums",
            active
              ? "border-ns-accent text-ns-accent"
              : "border-border-field text-text-caption",
          )}
        >
          {n}
        </span>
        <span
          className={cn(
            "text-[13px] font-medium tracking-[0.14em]",
            active ? "text-text-strong" : "text-text-label",
          )}
        >
          {title}
        </span>
        {done ? <Badge variant="outline">DONE</Badge> : null}
      </button>
      {active ? (
        <div className="flex flex-col gap-3">{children}</div>
      ) : summary ? (
        <div className="text-[12px] leading-[1.55] text-text-caption">{summary}</div>
      ) : null}
    </section>
  );
}

/** A labelled field: the control, then the sentence that says what goes in it,
 *  then the inline error when there is one. Errors say how to fix. */
export function Field({
  hint,
  error,
  children,
}: {
  hint: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {children}
      <p className="text-[12px] leading-[1.5] text-text-caption">{hint}</p>
      {error ? (
        <p
          role="alert"
          className="border-l-2 border-destructive pl-3 text-[12px] leading-[1.55] text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextArea({
  rows = 7,
  invalid = false,
  ...props
}: React.ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      rows={rows}
      className={cn(
        "w-full resize-y rounded-sm border bg-surface-field px-3 py-2.5 font-mono text-[12px] leading-[1.6] text-text-default",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        invalid ? "border-destructive" : "border-border-field",
      )}
      {...props}
    />
  );
}

export function TextInput({
  invalid = false,
  ...props
}: React.ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      className={cn(
        "min-h-11 w-full rounded-sm border bg-surface-field px-3 py-2 font-mono text-[13px] text-text-default md:min-h-8",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        invalid ? "border-destructive" : "border-border-field",
      )}
      {...props}
    />
  );
}

/** A key/value readout in the data register: label left, value right. */
export function KeyValue({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-text-label">{k}</dt>
          <dd className="min-w-0 break-words text-text-default tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
