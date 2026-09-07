// Unlock: a room asked for proof. One tap signs it, right here. The key
// never leaves this browser, and the door learns a tier and nothing else.

import { useMemo, useState } from "react";

import { creatorHandle, tierName } from "../../lib/format";
import { subscriptionState } from "../../lib/subscriptions";
import { hex, parseChallenge, type ParsedChallenge } from "../../lib/verify";
import { commitmentsFor, signPresentationFor, storedKeyState } from "../../lib/wallet/keys";
import { useSubscriptions, useVaultCreators } from "../../query/useSubscriptions";
import { LockedAvatar } from "../shell/avatar";
import { Column, Kicker, Page } from "../shell/page";
import { CopyState } from "../shell/sheet";

const BOT = "https://t.me/nightshift_gate_bot";

export function UnlockSurface({ initialChallenge }: { initialChallenge?: string }) {
  const [text, setText] = useState(initialChallenge ? safeDecode(initialChallenge) : "");
  const parsed = useMemo(() => (text.trim() === "" ? null : parseChallenge(text)), [text]);
  const challenge: ParsedChallenge | null = parsed?.value ?? null;

  const [hasKey] = useState(() => storedKeyState().secret);
  const creators = useVaultCreators(hasKey);
  const candidates = useMemo(
    () => (hasKey && creators.data ? commitmentsFor(creators.data.creatorIds) : null),
    [hasKey, creators.data],
  );
  const subs = useSubscriptions(candidates).data?.subscriptions ?? [];
  const nights = subs.filter((s) => subscriptionState(s) === "active");
  const [pick, setPick] = useState<string | null>(null);
  const chosen = nights.find((n) => n.creatorId === pick) ?? nights[0] ?? null;

  const [proof, setProof] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const unlock = () => {
    if (!challenge || !chosen) return;
    setTrouble(null);
    try {
      const verifierId = hex(challenge.verifierId);
      const nonce = hex(challenge.nonce);
      const expiryBlock = Number(challenge.expiryBlock);
      const { commitment, sig } = signPresentationFor(chosen.creatorId, {
        verifierId,
        expiryBlock: String(expiryBlock),
        nonce,
      });
      const presentation = JSON.stringify({
        commitment,
        verifier_id: verifierId,
        expiry_block: expiryBlock,
        nonce,
        sig_r: sig.r,
        sig_s: sig.s,
      });
      setProof(presentation);
      void navigator.clipboard?.writeText(presentation);
    } catch (e) {
      setTrouble(e instanceof Error ? e.message : "Signing failed.");
    }
  };

  const doorName = (() => {
    if (!challenge) return "A room";
    const raw = challenge.raw.verifier_id ?? challenge.raw.gate;
    if (typeof raw !== "string" || /^(0x|[0-9])/.test(raw)) return "The room";
    return /^TG/i.test(raw) ? "The Telegram door" : "The room";
  })();

  return (
    <Page>
      <main className="flex flex-1 flex-col py-8 lg:py-10">
        <Column narrow className="flex flex-col gap-6">
          <div className="ad-enter flex justify-center">
            <span className="ad-tag">{initialChallenge ? "Sent here by a door" : "For a Telegram or Discord door"}</span>
          </div>

          <div className="ad-enter flex flex-col items-center gap-4 pt-2 text-center">
            <LockedAvatar size={104} />
            <div className="flex flex-col items-center gap-2">
              <h1 className="ad-display text-[30px]">
                {doorName}
                <br />
                asked for proof.
              </h1>
              <p className="max-w-[30ch] text-[14px] leading-[1.55] text-dim">
                One tap signs it, right here. Your key never leaves this browser.
              </p>
            </div>
          </div>

          {!initialChallenge ? (
            <div className="ad-card-rose ad-enter ad-enter-2 flex flex-col gap-4 p-5">
              <Kicker>Try the live door</Kicker>
              <ol className="flex flex-col gap-2.5 text-[14px] leading-[1.5] text-ink-2">
                <li className="flex gap-3">
                  <span className="ad-mono w-6 shrink-0 text-[12px] text-rose">01</span>
                  Open the door in Telegram and send it <span className="ad-mono text-ink">/start</span>.
                </li>
                <li className="flex gap-3">
                  <span className="ad-mono w-6 shrink-0 text-[12px] text-rose">02</span>
                  Tap the link it sends. It lands back here with the door's message filled in.
                </li>
                <li className="flex gap-3">
                  <span className="ad-mono w-6 shrink-0 text-[12px] text-rose">03</span>
                  One tap signs the proof. Paste it back and the invite arrives.
                </li>
              </ol>
              <a href={BOT} target="_blank" rel="noreferrer" className="ad-pill ad-pill-primary ad-pill-block">
                Open the door in Telegram ↗
              </a>
              <p className="text-[12px] leading-[1.5] text-faint">
                The live door guards the demo creator's room, so a night with that creator gets you in.
              </p>
            </div>
          ) : null}

          {!initialChallenge || parsed?.error ? (
            <div className="flex flex-col gap-2">
              <Kicker dim>Or paste what a door sent</Kicker>
              <textarea
                className="ad-input min-h-[120px] text-[13px]"
                value={text}
                placeholder={'{ "verifier_id": "DOOR_1", "nonce": "0x…", "expiry_block": 13659458 }'}
                aria-label="challenge"
                onChange={(e) => {
                  setText(e.target.value);
                  setProof(null);
                }}
              />
              {parsed?.error ? <p className="text-[12px] text-danger">{parsed.error}</p> : null}
            </div>
          ) : null}

          <div className="ad-card ad-enter ad-enter-2 flex flex-col gap-3.5 p-5">
            <Kicker dim>What the door learns</Kicker>
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-ink-2">Your tier</span>
              <span className="ad-tag ad-tag-rose">
                {chosen ? `${tierName(chosen.schedule.tier)} · paid up` : "Member · paid up"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-ink-2">Your name</span>
              <span className="ad-redact text-[13px]" style={{ background: "var(--ad-silhouette-2)", color: "var(--ad-silhouette-2)" }}>
                redacted
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-ink-2">Your wallet</span>
              <span className="ad-redact text-[13px]" style={{ background: "var(--ad-silhouette-2)", color: "var(--ad-silhouette-2)" }}>
                redacted
              </span>
            </div>
          </div>

          {nights.length > 1 ? (
            <div className="flex flex-col gap-2">
              <Kicker dim>Which night</Kicker>
              <div className="flex flex-wrap gap-2">
                {nights.map((n) => (
                  <button
                    key={n.commitment}
                    type="button"
                    className={`ad-chip ${chosen && chosen.commitment === n.commitment ? "ad-chip-rose" : ""}`}
                    onClick={() => setPick(n.creatorId)}
                  >
                    {creatorHandle(n.creatorId)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {trouble ? <p className="text-[13px] text-dim">{trouble}</p> : null}

          <div key={proof === null ? "ask" : "proof"} className="ad-swap flex flex-col gap-3.5 pt-2">
            {!hasKey ? (
              <>
                <p className="text-center text-[14px] leading-[1.6] text-dim">
                  This browser holds no nights. Open this page in the browser you joined from, and
                  it signs in one tap.
                </p>
                <a href={BOT} target="_blank" rel="noreferrer" className="ad-pill ad-pill-ghost ad-pill-block">
                  Back to the door
                </a>
              </>
            ) : proof ? (
              <>
                <CopyState value={proof}>
                  {(copied, copy) => (
                    <button type="button" className="ad-pill ad-pill-primary ad-pill-lg ad-pill-block" onClick={copy}>
                      {copied ? "Copied" : "Copy your proof"}
                    </button>
                  )}
                </CopyState>
                <p className="text-center text-[12px] leading-[1.6] text-faint">
                  Already on your clipboard. Paste it back where the door asked.
                  <br />
                  It works once and expires on its own.
                </p>
                <details className="text-center">
                  <summary className="cursor-pointer text-[12px] text-faint">Show the proof</summary>
                  <pre className="ad-mono mt-2 overflow-x-auto text-left text-[11px] leading-[1.6] text-dim">{proof}</pre>
                </details>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="ad-pill ad-pill-primary ad-pill-lg ad-pill-block"
                  disabled={!challenge || !chosen}
                  onClick={unlock}
                >
                  {!challenge ? "Paste the door's message first" : !chosen ? "No running night to prove" : "Unlock the room"}
                </button>
                <p className="text-center text-[12px] leading-[1.6] text-faint">
                  Copies your proof automatically. Paste it back to the door.
                  <br />
                  It works once and expires in about ten minutes.
                </p>
              </>
            )}
          </div>
        </Column>
      </main>
    </Page>
  );
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
