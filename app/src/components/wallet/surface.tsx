// /manage: the subscriber's home.
//
// This page used to be a connect panel with three signing forms behind it,
// which meant a reader who already had a subscription had no way to see it. It
// is now about the reader's own objects, and the forms are the action layer
// underneath them.
//
// THE DERIVATION. A commitment is poseidon(subscriber secret, creator_id), so a
// browser holding the secret can recompute every commitment it could have made
// once it knows the creator ids, and the vault publishes those in
// CreatorRegistered. src/lib/subscriptions.ts does the reading; nothing here
// touches key material, and the one function that reads the stored secret
// (commitmentsFor) returns commitments and never the secret itself. No list is
// uploaded, no server is asked, and a subscription with no card is a
// subscription this browser cannot prove it owns.
//
// THE ORDER. Connected, the reader's subscriptions come first and the global
// vault figures are demoted to one caption: the board and the landing are where
// vault-wide numbers belong, and here they are context, not the subject.
// Connected with nothing to show, the subscribe flow becomes the page. Not
// connected, the connect panel is the page, with one line naming what appears
// after it.

import { useMemo, useState } from "react";

import { GATE, VAULT, VOYAGER_CONTRACT, fmtBlock, fmtStrk, truncate } from "../../config";
import { commitmentsFor } from "../../lib/wallet/keys";
import { useBoard } from "../../query/useBoard";
import { useSubscriptions, useVaultCreators } from "../../query/useSubscriptions";
import { useChainClock } from "../board/use-clock";
import { ChainChip } from "../board/provenance";
import type { BoardMode } from "../board/provenance";
import { Masthead } from "../masthead";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { CancelPanel } from "./cancel-panel";
import { ClaimPanel } from "./claim-panel";
import { ConnectPanel } from "./connect-panel";
import { SectionHead, StatusDot } from "./primitives";
import { SubscribePanel } from "./subscribe-panel";
import { SubscriptionCard } from "./subscription-card";
import { useConnection } from "./use-connection";

export type ManageTab = "subscribe" | "cancel" | "claim";

const AFTER_CONNECT =
  "This page lists the subscriptions this browser's key can derive, each with its escrow left, " +
  "its next charge and a one-press cancel. Nothing is uploaded and no list is kept.";

const NOTHING_YET =
  "nothing here yet: subscriptions this browser creates will appear with their next charge and " +
  "a one-press cancel.";

/** The provenance line every app page carries under its chip. Connected or
 *  not, the head block stays in the chip above it; this line says which key
 *  the objects below came from. */
function ProvenanceLine({ address }: { address: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-hairline px-5 py-3 lg:px-14">
      <div className="flex items-center gap-3">
        <StatusDot state={address ? "live" : "pending"} beat={address !== null} size={7} />
        <p className="text-[13px] leading-[1.7] text-text-default">
          {address
            ? `connected · ${truncate(address)} · derived in this browser from the key it holds`
            : "not connected · reading the chain needs no wallet, and signing is the only thing this page adds"}
        </p>
      </div>
      <span className="text-[11px] leading-[1.45] text-text-caption">
        no server saw this page · nothing about these objects was sent anywhere
      </span>
    </div>
  );
}

/** Vault-wide figures, demoted to one line. They are the landing's and the
 *  board's subject; here they are only context for the cards. */
function VaultContext() {
  const { data } = useBoard();
  if (!data) return null;
  const last = data.charges[0];
  return (
    <span className="text-[11px] leading-[1.45] text-text-caption">
      vault-wide, for context: {data.charges.length} charges · {fmtStrk(data.escrowWei)} STRK in
      custody
      {last ? ` · last charge block ${fmtBlock(last.block)}` : ""}
    </span>
  );
}

/** What the page can still do with no wallet, said once and plainly rather
 *  than as an apology under every disabled button. */
function AfterConnectNote() {
  return (
    <div className="flex flex-col gap-3 border border-border-panel px-5 py-5">
      <span className="text-[11px] font-medium tracking-[0.18em] text-text-label">
        AFTER CONNECT
      </span>
      <p className="text-[13px] leading-[1.6] text-text-prose">{AFTER_CONNECT}</p>
      <p className="text-[11px] leading-[1.5] text-text-caption">
        vault{" "}
        <a href={VOYAGER_CONTRACT(VAULT)} target="_blank" rel="noreferrer">
          {truncate(VAULT)}
        </a>{" "}
        · gate{" "}
        <a href={VOYAGER_CONTRACT(GATE)} target="_blank" rel="noreferrer">
          {truncate(GATE)}
        </a>
      </p>
    </div>
  );
}

export function ManageSurface({
  tab,
  onTabChange,
}: {
  /** Present when a flow was linked to or left open. The list, not a form, is
   *  what a bare /manage opens on. */
  tab: ManageTab | undefined;
  onTabChange: (t: ManageTab) => void;
}) {
  const { state, start, disconnect } = useConnection();
  // Bound as consts so the narrowing survives into the callbacks below: the
  // cards are rendered from a map, and a property read off `state` inside one
  // is no longer known to be non-null.
  const connection = state.status === "connected" ? state.connection : null;
  const identity = state.status === "connected" ? state.identity : null;
  const ready = connection !== null && identity !== null;

  const board = useBoard().data;
  const mode: BoardMode = board?.provenance.source === "snapshot" ? "snapshot" : "live";

  // The creator scan and the derivation both wait for a deliberate connect:
  // commitmentsFor reads the stored secret, and this page must not read one
  // before a reader has asked it to.
  const creators = useVaultCreators(ready);
  const candidates = useMemo(
    () => (ready && creators.data ? commitmentsFor(creators.data.creatorIds) : null),
    [ready, creators.data],
  );
  const subs = useSubscriptions(candidates);

  const now = useChainClock(board ? board.headTimestamp : null, mode !== "snapshot");
  // Which card has its flow panel open. One at a time: two open cancel forms
  // on one page is two signatures a reader could confuse.
  const [acting, setActing] = useState<string | null>(null);
  const [allTools, setAllTools] = useState(false);

  const subscriptions = subs.data?.subscriptions ?? [];
  const reading = ready && (creators.isPending || subs.isPending);
  const toolsOpen = allTools || tab !== undefined;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col">
      {/* The chip is never simply absent on an app page: while the head block
          is still being read it says so, rather than leaving a gap that reads
          as "this page is not on a chain". */}
      <Masthead
        active="manage"
        chip={
          board ? (
            <ChainChip mode={mode} headBlock={board.headBlock} />
          ) : (
            <span className="inline-flex items-center gap-2 border border-border-panel px-2 py-1.5 text-[11px] tracking-[0.1em] whitespace-nowrap text-text-label md:px-2.5">
              <StatusDot state="pending" size={6} />
              <span className="hidden md:inline">MAINNET&nbsp;·&nbsp;</span>
              <span className="sr-only md:hidden">MAINNET · </span>
              READING THE HEAD BLOCK
            </span>
          )
        }
      />
      <ProvenanceLine address={connection ? connection.address : null} />

      <main className="flex flex-1 flex-col gap-8 px-5 py-8 lg:px-14">
        {connection && identity ? (
          <>
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-5">
                <SectionHead note="derived in this browser, from the key that created them">
                  // YOUR SUBSCRIPTIONS
                </SectionHead>
              </div>
              <VaultContext />

              {reading ? (
                <p className="border border-border-panel px-5 py-4 text-[13px] leading-[1.7] text-text-prose">
                  Reading the vault's creator list, then asking it which of the commitments this
                  browser derives it has heard of. Two event scans, and no card until both answer.
                </p>
              ) : subscriptions.length === 0 ? (
                // No frame around this: the subscribe flow inside it draws its
                // own three panels, and a border around a border is the nested
                // card soup the system forbids.
                <div className="flex flex-col gap-5">
                  <p className="max-w-[70ch] text-[14px] leading-[1.7] text-text-prose">
                    {NOTHING_YET}
                  </p>
                  <p className="max-w-[70ch] text-[11px] leading-[1.5] text-text-caption">
                    {creators.data
                      ? `${creators.data.creatorIds.length} creator${creators.data.creatorIds.length === 1 ? " registered at this vault was" : "s registered at this vault were"} checked against the commitments this browser derives, and none of them matched.`
                      : "the vault's creator list could not be read, so nothing was checked."}
                  </p>
                  {/* The subscribe flow is the page when there is nothing to
                      manage, because there is nothing else to do here. */}
                  <SubscribePanel connection={connection} identity={identity} />
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {subscriptions.map((s) => (
                    <SubscriptionCard
                      key={s.commitment}
                      subscription={s}
                      headBlock={board?.headBlock ?? s.schedule.startBlock}
                      now={now}
                      headTimestamp={board?.headTimestamp ?? now}
                      acting={acting === s.commitment}
                      onAct={() =>
                        setActing((open) => (open === s.commitment ? null : s.commitment))
                      }
                    >
                      {/* The existing cancel and reclaim flow, unchanged, opened
                          at the object it acts on. */}
                      <CancelPanel connection={connection} identity={identity} />
                    </SubscriptionCard>
                  ))}
                </div>
              )}

              {subs.data && subs.data.partial.length > 0 ? (
                <p className="text-[11px] leading-[1.5] text-text-caption">
                  Partial read. Some of this list is incomplete: {subs.data.partial.join("; ")}.
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <SectionHead note="every action this page can sign, in one place">
                  // ALL TOOLS
                </SectionHead>
                <Button
                  variant="ghost"
                  size="md"
                  aria-expanded={toolsOpen}
                  onClick={() => setAllTools((v) => !v)}
                >
                  {toolsOpen ? "hide the tools" : "all tools"}
                </Button>
              </div>
              {toolsOpen ? (
                <Tabs
                  value={tab ?? "subscribe"}
                  onValueChange={(v) => onTabChange(v as ManageTab)}
                >
                  <TabsList>
                    <TabsTrigger value="subscribe">subscribe</TabsTrigger>
                    <TabsTrigger value="cancel">cancel and reclaim</TabsTrigger>
                    <TabsTrigger value="claim">claim</TabsTrigger>
                  </TabsList>
                  <TabsContent value="subscribe" className="pt-6">
                    <SubscribePanel connection={connection} identity={identity} />
                  </TabsContent>
                  <TabsContent value="cancel" className="pt-6">
                    <CancelPanel connection={connection} identity={identity} />
                  </TabsContent>
                  <TabsContent value="claim" className="pt-6">
                    <ClaimPanel connection={connection} identity={identity} />
                  </TabsContent>
                </Tabs>
              ) : (
                <p className="max-w-[70ch] text-[13px] leading-[1.7] text-text-prose">
                  Subscribe, cancel and reclaim, and claim, as the three forms they were. The cards
                  above open the same cancel flow at the subscription it belongs to.
                </p>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-4">
              <Button variant="ghost" size="md" onClick={disconnect}>
                disconnect
              </Button>
              <span className="text-[11px] leading-[1.45] text-text-caption">
                disconnecting drops the connection, not the keys: the secret stays in this browser
                and the same subscriptions reappear on the next connect
              </span>
            </div>
          </>
        ) : (
          <section className="flex flex-col gap-4">
            <SectionHead note="connect is a state machine, not a button">
              // WALLET · WHAT EACH STATE PROMISES
            </SectionHead>
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
              <ConnectPanel state={state} onConnect={() => void start()} onDisconnect={disconnect} />
              <AfterConnectNote />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
