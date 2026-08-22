// Static stub. The real verify surface (challenge paste, sign guidance,
// verdict, the honest linkability line) is a later phase; this just proves
// the route exists and renders.
export function VerifyRoute() {
  return (
    <div className="max-w-[1120px] mx-auto px-4 py-8 space-y-4">
      <div className="text-[13px] uppercase tracking-[0.2em] text-text-label">
        // VERIFY - TIER-GATE PRESENTATION CHECK
      </div>
      <p className="text-[14px] text-text-prose">
        This surface is not built yet. It will accept a challenge, walk
        through the sign step, and show a verdict against the exact REASONS
        vocabulary the gate returns.
      </p>
      <p className="text-[12px] text-text-caption">
        A presentation reveals the commitment to the verifier and to every
        reader of the chain. Repeat presentations of one subscription are
        linkable across gates.
      </p>
    </div>
  );
}
