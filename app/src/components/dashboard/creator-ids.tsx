// The creator id control, in two sizes.
//
// One id or several: a creator running more than one registration (one per
// token, one per product) reads their own total by pasting each id. The sum
// happens in this browser over events that were already public, so the ids
// are never linked anywhere that a reader of the chain could see. Each id's
// own topline is public on its own account; what is not on chain is that
// these ids belong to one person, and pasting them here does not put it
// there.
//
// Validation runs on submit, never per keystroke, so a half-typed hex string
// is never marked wrong while it is still being typed.

import { useRef, useState } from "react";

import { fmtStrk, truncate } from "../../config";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { HashCopy } from "../board/primitives";
import type { IdSummary } from "./derive";
import { LiveNumber } from "./tile";

const FELT_HEX = /^0x[0-9a-fA-F]{1,64}$/;

const HINT =
  "Paste the id the vault was registered with. It is a public address: pasting it proves nothing and reveals nothing.";

function IdField({
  onAdd,
  onBackspaceEmpty,
  compact,
}: {
  onAdd: (id: string) => void;
  onBackspaceEmpty: () => void;
  compact: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const submit = () => {
    const value = draft.trim();
    if (value.length === 0) return;
    if (!FELT_HEX.test(value)) {
      setError("A creator id is 0x followed by 1 to 64 hex digits. Fix it and add it again.");
      return;
    }
    setError(null);
    setDraft("");
    onAdd(value);
    input.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="creator-id"
        className="text-[10px] font-medium tracking-[0.18em] text-text-label"
      >
        CREATOR ID (HEX)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="creator-id"
          ref={input}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Backspace" && draft.length === 0) onBackspaceEmpty();
          }}
          placeholder="0x…"
          aria-invalid={error !== null}
          aria-describedby="creator-id-hint"
          className={cn(
            "h-11 min-w-0 flex-1 rounded-md border bg-surface-field px-3 font-mono text-[13px] md:h-8",
            "text-text-default placeholder:text-text-caption",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]",
            error === null ? "border-border-field" : "border-ns-accent",
            compact ? "sm:max-w-[420px]" : "sm:max-w-[560px]",
          )}
        />
        <Button size="md" className="min-h-11 md:min-h-8" onClick={submit}>
          ADD ID
        </Button>
      </div>
      <p
        id="creator-id-hint"
        className={cn(
          "max-w-[70ch] text-[11px] leading-[1.5]",
          error === null ? "text-text-caption" : "text-ns-accent",
        )}
      >
        {error ?? HINT}
      </p>
    </div>
  );
}

function IdRow({
  index,
  id,
  summary,
  onRemove,
}: {
  index: number;
  id: string;
  summary: IdSummary | undefined;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border-row px-3 py-2 first:border-t-0">
      <span className="text-[10px] tabular-nums text-text-caption">
        {String(index + 1).padStart(2, "0")}
      </span>
      <HashCopy value={id} display={truncate(id)} tone="default" className="text-[13px]" />
      {/* An id that matched nothing gets no figure at all. A 0.00 next to it
          would read as a measured total rather than as an absence. */}
      <span className="ml-auto text-[12px] tabular-nums text-text-default">
        {summary === undefined ? (
          "reading"
        ) : summary.seen ? (
          <>
            {fmtStrk(summary.grossWei)}
            <span className="text-text-label"> STRK</span>
          </>
        ) : (
          ""
        )}
      </span>
      <span className="w-[104px] text-right text-[10px] text-text-caption">
        {summary === undefined
          ? "not read yet"
          : summary.seen
            ? `${summary.charges} charge${summary.charges === 1 ? "" : "s"}`
            : "no events"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="min-h-11 md:min-h-6"
        onClick={onRemove}
        aria-label={`remove creator id ${truncate(id)}`}
      >
        REMOVE
      </Button>
    </div>
  );
}

export function CreatorIds({
  ids,
  summaries,
  onChange,
  variant,
}: {
  ids: string[];
  /** undefined until a read lands; a row then says so rather than showing 0. */
  summaries: IdSummary[] | undefined;
  onChange: (ids: string[]) => void;
  variant: "entry" | "bar";
}) {
  const add = (id: string) => {
    const exists = ids.some((existing) => BigInt(existing) === BigInt(id));
    if (exists) return;
    onChange([...ids, id]);
  };
  const removeAt = (i: number) => onChange(ids.filter((_, n) => n !== i));
  const removeLast = () => {
    if (ids.length > 0) removeAt(ids.length - 1);
  };
  const totalWei = (summaries ?? []).reduce((a, s) => a + s.grossWei, 0n);
  const byId = new Map((summaries ?? []).map((s) => [BigInt(s.id).toString(), s]));

  return (
    <div
      className={cn(
        "flex flex-col gap-5",
        variant === "entry"
          ? "border border-border-panel bg-surface-panel px-6 py-7"
          : "border border-border-panel bg-surface-panel px-5 py-5",
      )}
    >
      {variant === "entry" ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-[13px] font-medium tracking-[0.2em] text-text-label">
            // PASTE A CREATOR ID
          </h2>
          <p className="max-w-[70ch] text-[14px] leading-[1.7] text-text-prose">
            This dashboard reads one creator's ledger out of the vault's public event log. Nothing
            is stored, nothing is sent anywhere, and no wallet is connected. Paste an id to start.
          </p>
        </div>
      ) : null}

      <IdField onAdd={add} onBackspaceEmpty={removeLast} compact={variant === "bar"} />

      {ids.length > 0 ? (
        <div className="flex flex-col border border-border-row bg-surface-sunken">
          {ids.map((id, i) => (
            <IdRow
              key={id}
              index={i}
              id={id}
              summary={byId.get(BigInt(id).toString())}
              onRemove={() => removeAt(i)}
            />
          ))}
          {ids.length > 1 ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-border-panel px-3 py-2.5">
              <span className="text-[10px] font-medium tracking-[0.18em] text-text-label">
                LOCAL SUM
              </span>
              <span className="ml-auto text-[16px] font-semibold tabular-nums text-text-strong">
                {summaries === undefined ? (
                  <span className="text-[12px] font-normal text-text-caption">
                    reading the event log
                  </span>
                ) : (
                  <>
                    <LiveNumber value={Number(fmtStrk(totalWei))} decimals={2} />
                    <span className="text-[12px] font-normal text-text-label"> STRK</span>
                  </>
                )}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-3">
        {ids.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-6"
            onClick={() => onChange([])}
          >
            CLEAR ALL
          </Button>
        ) : null}
        <p className="max-w-[70ch] text-[11px] leading-[1.5] text-text-caption">
          Only the creator can sum their own ids. Any sum across ids is computed in this browser
          from events that were already public, and the list stays in this page and its URL. Each
          id's topline is derivable by anyone on its own. That two ids belong to one person is not
          on chain, and pasting them here does not put it there.
        </p>
      </div>
    </div>
  );
}
