// The receipts. Everything above this section is a claim; this is the part a
// reader can check without the page.
//
// The charge table that used to open this section is gone. The live strip
// above already carries the charge evidence, with the count, the gross and
// the last one's block and hash, and a second table of the same three rows
// was the landing turning into the board. What is left is what the strip
// cannot hold: the addresses, the two published packages, and the one link to
// the board, where every charge is a row.

import { GATE, truncate, VAULT, VOYAGER_CONTRACT } from "../../config";
import { cn } from "../../lib/utils";
import { Link } from "@tanstack/react-router";

import { HashCopy, SectionHead } from "../board/primitives";

type ReceiptRow = { key: string; value: string; href: string | null; hash: boolean };

function receiptRows(creatorId: string | null): ReceiptRow[] {
  const rows: ReceiptRow[] = [
    { key: "vault v4", value: VAULT, href: VOYAGER_CONTRACT(VAULT), hash: true },
    { key: "tier gate", value: GATE, href: VOYAGER_CONTRACT(GATE), hash: true },
  ];
  // Only when a schedule was read. A creator id is not derivable from a charge
  // event, so an unread one gets no row rather than a placeholder.
  if (creatorId !== null) {
    rows.push({ key: "creator", value: creatorId, href: null, hash: true });
  }
  rows.push(
    {
      key: "npm nightshift-verify",
      value: "checks a signed presentation against vault state",
      href: "https://www.npmjs.com/package/nightshift-verify",
      hash: false,
    },
    {
      key: "npm strk20-preflight",
      value: "checks a pool action before you sign it",
      href: "https://www.npmjs.com/package/strk20-preflight",
      hash: false,
    },
  );
  return rows;
}

export function ProofSection({
  creatorId,
  snapshot,
}: {
  creatorId: string | null;
  snapshot: boolean;
}) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHead note="read over JSON-RPC, snapshot fallback labelled">
        {snapshot ? "// THE RECEIPTS · MAINNET, SNAPSHOT" : "// THE RECEIPTS · MAINNET, LIVE"}
      </SectionHead>

      {/* Two columns on a wide screen: five label-and-value rows at full width
          would be five near-empty lines on a page that is already long. The
          dividers are the 1px gaps, which land a hairline on every internal
          edge of either layout without counting children. */}
      <dl className="grid gap-px border border-border-hairline bg-border-row lg:grid-cols-2">
        {receiptRows(creatorId).map((r, i, rows) => (
          <div
            key={r.key}
            className={cn(
              "flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-surface-page px-4 py-2.5",
              // An odd row count would leave the last grid cell empty, and an
              // empty cell here is a solid block of divider colour.
              i === rows.length - 1 && rows.length % 2 === 1 && "lg:col-span-2",
            )}
          >
            <dt className="w-[130px] shrink-0 text-[11px] leading-[1.45] text-text-caption lg:w-[150px]">
              {r.key}
            </dt>
            <dd className="min-w-0 flex-1 text-[12px] lg:text-right">
              {r.hash ? (
                <HashCopy value={r.value} display={truncate(r.value)} className="text-[12px]" />
              ) : (
                <a href={r.href ?? undefined} target="_blank" rel="noreferrer">
                  {r.value} <span aria-hidden="true">↗</span>
                </a>
              )}
              {r.hash && r.href ? (
                <>
                  {" "}
                  <a href={r.href} target="_blank" rel="noreferrer" className="text-[12px]">
                    <span aria-hidden="true">↗</span>
                    <span className="sr-only">{`open ${r.key} on voyager`}</span>
                  </a>
                </>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-1 border border-border-panel bg-surface-sunken px-5 py-4">
        <Link to="/board" className="text-[15px] font-medium">
          the full board <span aria-hidden="true">→</span> /board
        </Link>
        <span className="text-[11px] leading-[1.45] text-text-caption">
          every charge in one table, read live from mainnet
        </span>
      </div>
    </section>
  );
}
