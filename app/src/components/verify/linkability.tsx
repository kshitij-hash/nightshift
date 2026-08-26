// The linkability disclosure.
//
// It is rendered at the moment it matters (the step where a subscriber decides
// to sign) and again beside every verdict, and it cannot be dismissed. It is
// not a tooltip and it is not behind a link.
//
// The wording is the Present row of PRIVACY.md, unchanged in substance: a
// presentation is a signature over a challenge, and the commitment inside it
// is a stable pseudonym. This surface never describes the tier gate as a proof
// that reveals nothing else, because it is not one.

import { truncate } from "../../config";
import { CaveatDisclosure, HashCopy } from "../board/primitives";
import { Badge } from "../ui/badge";

export function LinkabilityNote({
  commitment,
  heading = "BEFORE YOU SIGN",
}: {
  /** The commitment in play, when one is known. */
  commitment?: string | null;
  heading?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border border-ns-accent bg-surface-sunken px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="border-ns-accent text-ns-accent">
          {heading}
        </Badge>
        <span className="text-[11px] text-text-caption">
          linkability disclosure, shown where it applies
        </span>
      </div>
      <p className="text-[13px] leading-[1.65] text-text-default">
        Presenting reveals the commitment
        {commitment ? (
          <>
            {" "}
            <HashCopy value={commitment} display={truncate(commitment)} tone="strong" />{" "}
          </>
        ) : (
          " "
        )}
        to the verifier. The commitment is a stable pseudonym: every presentation of one
        subscription carries the same one, so a single gate recognizes a returning subscriber and
        two gates comparing notes can tell they saw the same subscription.
      </p>
      <CaveatDisclosure
        label="what the verifier does not see"
        openLabel="what the verifier does not see, shown"
      >
        <span className="block max-w-[70ch] leading-[1.55]">
          Not a wallet. The check runs against the STARK owner key the vault recorded at subscribe
          time, a bare public key and never an account address. The escrow remaining and the period
          history stay out of the presentation too. A subscriber who wants presentations to
          different creators kept apart derives one owner key and one commitment per creator,
          which is exactly what this product does for every subscription.
        </span>
      </CaveatDisclosure>
    </div>
  );
}
