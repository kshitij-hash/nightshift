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
import { Masthead } from "../masthead";
import { Badge } from "../ui/badge";
import { FailureVocabulary } from "./failure-vocabulary";
import { LinkabilityNote } from "./linkability";
import { StepShell } from "./step";
import { ChallengeStep, ChallengeSummary, SignStep, VerdictStep } from "./steps";
import { useVerify } from "./use-verify";
import { FailureVerdict, SuccessVerdict } from "./verdict";

const SENTENCE =
  "Check a tier presentation against vault state. Two read-only calls: it moves nothing and it signs nothing.";

function Chip({ block }: { block: number | null }) {
  return (
    <span className="inline-flex items-center gap-2 border border-border-panel px-2.5 py-1.5 text-[11px] tracking-[0.1em] whitespace-nowrap text-text-label">
      <StatusDot state={block === null ? "pending" : "settled"} size={6} />
      {block === null ? "MAINNET · NOT READ YET" : `MAINNET · BLOCK ${fmtBlock(block)}`}
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
      <p className="text-[12.5px] leading-[1.6] text-text-prose">
        A verdict is one of two things. Either the creator id and tier the vault holds for that
        commitment, with the filled badge, or the first check that refused, printed in the exact
        string the check returned. The whole vocabulary of refusals is at the bottom of this page,
        so a refusal can be read before it is caused.
      </p>
    </div>
  );
}

export function VerifySurface() {
  const { state, goToStep, submitChallenge, generateChallenge, check, retry, reset } = useVerify();
  const { challenge, verdict } = state;

  const parsedPresentation = parsePresentation(state.presentationText);
  const commitment =
    typeof parsedPresentation.value?.commitment === "string"
      ? parsedPresentation.value.commitment
      : null;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col">
      <Masthead
        active="verify"
        sentence={SENTENCE}
        right="the same check the published nightshift-verify package runs"
        chip={<Chip block={state.checkedAtBlock} />}
      />

      <main className="flex flex-1 flex-col gap-8 px-5 py-8 lg:px-10">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <SectionHead note="three steps, one column, no tabs">
              // VERIFY A TIER PRESENTATION
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
                summary="Signing happens in the ops console, panel 7, with the subscription owner key. This page never sees it."
              >
                {challenge ? (
                  <SignStep
                    challenge={challenge}
                    source={state.challengeSource}
                    onSigned={() => goToStep(3)}
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
            <SectionHead note="both verdicts are designed; neither is an afterthought">
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
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SectionHead note="every string the check can return">
            // FAILURE VOCABULARY · RENDERED VERBATIM
          </SectionHead>
          <FailureVocabulary />
        </div>
      </main>
    </div>
  );
}
