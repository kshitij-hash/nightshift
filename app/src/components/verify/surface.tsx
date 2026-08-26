// The verify surface.
//
// Three steps down one column: take a challenge, sign it somewhere that holds
// a key, check the answer. The check is the real one. src/lib/verify.ts is a
// port of the published nightshift-verify package and runs here in the page
// against mainnet: same message layout, same check order, same reason strings.
//
// Two things this page will not do. It will not ask for a private key, and it
// will not describe the tier gate as a proof that hides everything else. A
// presentation reveals the commitment, and the disclosure that says so is on
// screen at the step where a subscriber decides to sign and again beside every
// verdict.

import { fmtBlock } from "../../config";
import { parsePresentation, REASONS } from "../../lib/verify";
import { SectionHead, StatusDot } from "../board/primitives";
import { HiddenAndVisible } from "../board/story-band";
import { Masthead } from "../masthead";
import { SiteFooter } from "../site-footer";
import { Badge } from "../ui/badge";
import { FailureVocabulary } from "./failure-vocabulary";
import { LinkabilityNote } from "./linkability";
import { StepShell } from "./step";
import { ChallengeStep, ChallengeSummary, SignStep, VerdictStep } from "./steps";
import { useVerify } from "./use-verify";
import { FailureVerdict, SuccessVerdict } from "./verdict";

function Chip({ block }: { block: number | null }) {
  return (
    // The "MAINNET ·" qualifier hides below md so the chip fits the phone
    // chrome's one row; it stays in the DOM for a screen reader.
    <span className="inline-flex items-center gap-2 border border-border-panel px-2 py-1.5 text-[11px] tracking-[0.1em] whitespace-nowrap text-text-label md:px-2.5">
      <StatusDot state={block === null ? "pending" : "settled"} size={6} />
      <span className="hidden md:inline">MAINNET&nbsp;·&nbsp;</span>
      <span className="sr-only md:hidden">MAINNET · </span>
      {block === null ? "NOT READ YET" : `BLOCK ${fmtBlock(block)}`}
    </span>
  );
}

/** The empty state, designed rather than left blank: it says what a verdict
 *  will contain before there is one to show. */
function NoVerdictYet() {
  return (
    <div className="flex flex-col gap-3 border border-border-panel bg-transparent px-5 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">NO VERDICT YET</Badge>
        <span className="text-[11px] text-text-caption">nothing has been checked</span>
      </div>
      <p className="text-[13px] leading-[1.6] text-text-prose">
        A verdict is either the creator and tier this subscription holds, or the exact reason the
        check refused.
      </p>
    </div>
  );
}

export function VerifySurface() {
  const { state, goToStep, submitChallenge, generateChallenge, check, usePresentation, retry, reset } =
    useVerify();
  const { challenge, verdict } = state;

  const parsedPresentation = parsePresentation(state.presentationText);
  const commitment =
    typeof parsedPresentation.value?.commitment === "string"
      ? parsedPresentation.value.commitment
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <Masthead active="verify" chip={<Chip block={state.checkedAtBlock} />} />

      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3.5 border-b-2 border-divider px-5 py-4 lg:px-10">
          <span className="text-[11px] tracking-[0.14em] uppercase text-ns-accent">
            ▸ The gate
          </span>
          {challenge ? (
            <span className="font-mono text-[12px] text-text-caption">
              verifier_id {challenge.verifierId}
            </span>
          ) : null}
          <span className="ml-auto text-[11px] tracking-[0.14em] uppercase text-text-caption">
            Off-chain · no transaction, no gas, no trace
          </span>
        </div>

      <main className="flex flex-1 flex-col gap-8 px-5 py-8 lg:px-10">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            {/* The note carries what the masthead rule used to: this is not a
                demonstration of a check, it is the check the published package
                runs. Step 03's hint says what it costs to run. */}
            <SectionHead note="the same check a real gate runs, against mainnet">
              // PROVE A PAID TIER, GET IN
            </SectionHead>
            <div className="flex flex-col">
              <StepShell
                n="01"
                title="TAKE THE CHALLENGE"
                active={state.step === 1}
                done={challenge !== null && state.step !== 1}
                onOpen={() => goToStep(1)}
                summary={
                  challenge ? (
                    <ChallengeSummary challenge={challenge} source={state.challengeSource} />
                  ) : null
                }
              >
                <ChallengeStep
                  error={state.challengeError}
                  busy={state.phase === "validating"}
                  onParse={submitChallenge}
                  onGenerate={(id) => void generateChallenge(id)}
                />
              </StepShell>

              <StepShell
                n="02"
                title="SIGN IT WHERE THE KEY LIVES"
                active={state.step === 2}
                done={state.step === 3}
                onOpen={() => goToStep(2)}
                summary="Signed in your browser with the subscription's own key, derived for this one signature and discarded. This page never sees a private key."
              >
                {challenge ? (
                  <SignStep
                    challenge={challenge}
                    source={state.challengeSource}
                    onSigned={() => goToStep(3)}
                    onUsePresentation={usePresentation}
                  />
                ) : null}
              </StepShell>

              <StepShell
                n="03"
                title="CHECK THE PRESENTATION"
                active={state.step === 3}
                done={verdict !== null && verdict.ok}
                onOpen={() => goToStep(3)}
                summary="Paste the signed presentation and the check runs against mainnet."
              >
                <VerdictStep
                  error={state.presentationError}
                  phase={state.phase}
                  verdict={verdict}
                  text={state.presentationText}
                  onCheck={(text) => void check(text)}
                />
              </StepShell>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <SectionHead note="the creator id and tier, or the first check that refused">
              // THE VERDICT
            </SectionHead>
            {verdict === null ? (
              <NoVerdictYet />
            ) : verdict.ok ? (
              <SuccessVerdict
                verdict={verdict}
                commitment={commitment ?? "0x0"}
                headBlock={state.checkedAtBlock}
                onAgain={reset}
              />
            ) : (
              <FailureVerdict
                reason={verdict.reason ?? REASONS.MALFORMED_PRESENTATION}
                headBlock={state.checkedAtBlock}
                onAgain={reset}
                onRetry={retry}
              />
            )}
            <LinkabilityNote commitment={commitment} heading="WHAT THE VERIFIER LEARNS" />
            {/* The right rail runs to the foot of the step column, and the
                question it was leaving unanswered is the one the board answers
                with this table. It is the same table, in the place a reader is
                already asking it. */}
            <div className="flex flex-col gap-3">
              <SectionHead note="what the chain records, next to what it never learns">
                // HIDDEN AND VISIBLE
              </SectionHead>
              <HiddenAndVisible />
            </div>
          </div>
        </div>

        <div className="grid border-2 border-divider lg:grid-cols-[7fr_5fr]">
          <div className="p-6 lg:p-7">
            <div className="mb-2.5 text-[11px] tracking-[0.14em] uppercase text-ns-accent">
              ▸ Drop it into a bot
            </div>
            <h3 className="mb-3 text-[22px] tracking-[-0.02em]">
              This is what a Telegram gate runs.
            </h3>
            <p className="mb-4 max-w-[62ch] text-[13.5px] leading-[1.6] text-text-prose">
              A live Telegram bot runs this exact check: it issues a challenge
              in chat, you sign it here, and a match on creator and tier mints
              a one-use invite link. A Discord bot or a licence server drops
              in the same way — a few read-only calls, no key held anywhere.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="https://t.me/nightshift_gate_bot"
                target="_blank"
                rel="noreferrer"
                className="m-btn m-btn-primary"
              >
                Try it in Telegram ↗
              </a>
              <a
                href="https://www.npmjs.com/package/nightshift-verify"
                target="_blank"
                rel="noreferrer"
                className="m-btn m-btn-secondary"
              >
                npm nightshift-verify ↗
              </a>
            </div>
          </div>
          <div className="border-t-2 border-divider bg-panel p-6 font-mono text-[12px] leading-[1.9] lg:border-t-0 lg:border-l-2 lg:p-7">
            <div className="mb-2 text-[11px] tracking-[0.1em] uppercase text-text-caption">
              The whole integration
            </div>
            npm install nightshift-verify
            <br />
            <br />
            const {"{ ok, tier }"} = await
            <br />
            &nbsp;&nbsp;verifyPresentation({"{"}
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;presentation, expectedVerifierId,
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;expectedNonce, rpcUrl, vaultAddress,
            <br />
            &nbsp;&nbsp;{"}"});
            <br />
            <br />
            ok → admit tier
          </div>
        </div>

        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-[12.5px] text-text-label">
            Every reason a check can refuse, spelled out
          </summary>
          <div className="pt-3">
            <FailureVocabulary />
          </div>
        </details>
      </main>

      <SiteFooter
        links={[
          { label: "npm nightshift-verify", href: "https://www.npmjs.com/package/nightshift-verify" },
          { label: "the board", to: "/board" },
          { label: "source on github", href: "https://github.com/kshitij-hash/nightshift" },
        ]}
      />
      </div>
    </div>
  );
}
