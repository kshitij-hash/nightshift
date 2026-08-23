// The creator id control, in two sizes: the whole entry surface while nothing
// has been pasted, and one bar row once an id is in the URL and the figures
// under it are what the page is for.
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
import { CaveatDisclosure, HashCopy } from "../board/primitives";
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
        className="text-[11px] font-medium tracking-[0.18em] text-text-label"
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

/** The bar form of one id: index, hash, what it summed to, how many charges,
 *  on one line. A dashboard keyed by a pasted id spends its top on the figures,
 *  not on the field that was already used. */
function IdBarRow({
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
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] tabular-nums">
      <span className="text-[11px] text-text-caption">{String(index + 1).padStart(2, "0")}</span>
      <HashCopy value={id} display={truncate(id)} tone="default" className="text-[13px]" />
      {summary === undefined ? (
        <span className="text-[12px] text-text-caption">· reading</span>
      ) : summary.seen ? (
        <>
          <span className="text-text-caption">·</span>
          <span className="text-text-strong">
            {fmtStrk(summary.grossWei)}
            <span className="text-text-label"> STRK</span>
          </span>
          <span className="text-text-caption">·</span>
          <span className="text-[12px] text-text-caption">
            {summary.charges} charge{summary.charges === 1 ? "" : "s"}
          </span>
        </>
      ) : (
        <span className="text-[12px] text-text-caption">· no events</span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="min-h-11 md:min-h-6"
        onClick={onRemove}
        aria-label={`remove creator id ${truncate(id)}`}
      >
        REMOVE
      </Button>
    </span>
  );
}

const SUM_NOTE =
  "Only the creator can sum their own ids. Any sum across ids is computed in this browser from events that were already public, and the list stays in this page and its URL. Each id's topline is derivable by anyone on its own. That two ids belong to one person is not on chain, and pasting them here does not put it there.";

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
  const [adding, setAdding] = useState(false);
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

  // --- an id is already in the URL: one bar row, and the field on request ---
  if (variant === "bar") {
    return (
      <div className="flex flex-col gap-3 border border-border-panel bg-surface-panel px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {ids.map((id, i) => (
            <IdBarRow
              key={id}
              index={i}
              id={id}
              summary={byId.get(BigInt(id).toString())}
              onRemove={() => removeAt(i)}
            />
          ))}
          {ids.length > 1 ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">
                LOCAL SUM
              </span>
              <span className="text-[14px] font-semibold tabular-nums text-text-strong">
                {summaries === undefined ? (
                  <span className="text-[12px] font-normal text-text-caption">reading</span>
                ) : (
                  <>
                    <LiveNumber value={Number(fmtStrk(totalWei))} decimals={2} />
                    <span className="text-[12px] font-normal text-text-label"> STRK</span>
                  </>
                )}
              </span>
            </span>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 md:min-h-6"
              aria-expanded={adding}
              onClick={() => setAdding((v) => !v)}
            >
              {adding ? "ADD ID, OPEN" : "ADD ID"}
            </Button>
            <CaveatDisclosure caveat={SUM_NOTE} />
          </span>
        </div>
        {adding ? <IdField onAdd={add} onBackspaceEmpty={removeLast} compact /> : null}
      </div>
    );
  }

  // --- nothing pasted yet: the full form, which is the whole page ----------
  return (
    <div className="flex flex-col gap-5 border border-border-panel bg-surface-panel px-6 py-7">
      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium tracking-[0.2em] text-text-label">
          // PASTE A CREATOR ID
        </h2>
        <p className="max-w-[70ch] text-[14px] leading-[1.7] text-text-prose">
          This dashboard reads one creator's ledger out of the vault's public event log. Nothing is
          stored, nothing is sent anywhere, and no wallet is connected. Paste an id to start.
        </p>
      </div>

      <IdField onAdd={add} onBackspaceEmpty={removeLast} compact={false} />

      <div className="flex flex-wrap items-start gap-3">
        <p className="max-w-[70ch] text-[11px] leading-[1.5] text-text-caption">{SUM_NOTE}</p>
      </div>
    </div>
  );
}
