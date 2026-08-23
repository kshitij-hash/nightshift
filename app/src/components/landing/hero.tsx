// The hero: a tagline and one sentence, and nothing else.
//
// No numbers and no buttons, deliberately. The numbers are one section down in
// the live strip, where a reader meets them at the size of a readout with the
// basis printed under them, rather than at the size of a claim with nothing
// under them at all. The buttons are five sections down, after the machine has
// been drawn and the transactions have been handed over. The persona router
// between the two is where the page asks its only question.
//
// This is the page's h1, which is why the masthead's wordmark is a plain link
// on this route and a heading on every other one.

export function HeroCopy({ compact }: { compact: boolean }) {
  return (
    <div
      className={
        compact
          ? "flex flex-col gap-5 px-5 pt-11 pb-10"
          : "flex flex-col gap-6 px-5 pt-16 pb-12 lg:px-14"
      }
    >
      <h1
        className="max-w-[940px] font-semibold text-text-strong"
        style={{
          fontSize: compact ? 34 : 60,
          lineHeight: 1.02,
          letterSpacing: "-0.025em",
        }}
      >
        Charged on schedule.
        <br />
        Named never.
      </h1>
      <p
        className="text-text-prose"
        style={{
          fontSize: compact ? 14 : 17,
          lineHeight: 1.6,
          maxWidth: compact ? "100%" : 660,
        }}
      >
        Escrow is committed once through the privacy pool, then a vault charges it on a block
        schedule, for anyone who needs a recurring charge to keep running without a wallet on file.
      </p>
    </div>
  );
}
