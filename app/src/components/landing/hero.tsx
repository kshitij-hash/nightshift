// The hero: a tagline and one short paragraph, and nothing else. The paragraph
// names the product in plain words and ends on the card-authorization analogy,
// which used to sit at the bottom of the mechanism section where a reader who
// needed it most never reached it.
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
        Private subscriptions,
        <br />
        charged on schedule.
      </h1>
      <p
        className="text-text-prose"
        style={{
          fontSize: compact ? 14 : 17,
          lineHeight: 1.6,
          maxWidth: compact ? "100%" : 660,
        }}
      >
        Fund a subscription once through Starknet's STRK20 privacy pool. A vault contract then
        charges it each period and pays the creator, with no wallet on file. Like a card
        authorization, except there is no card, no processor, and no name.
      </p>
    </div>
  );
}
