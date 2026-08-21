# telegram-gate

A Telegram gate for a NIGHTSHIFT tier, built on `nightshift-verify`. `/start`
issues a challenge, a subscriber pastes back a signed presentation, and a
match on creator and tier gets a one-time invite link to that tier's chat.
Everything else is a rejection with a reason.

This is a demo, not a template to run unmodified in production: all state is
in memory, one process, no database, no persistence across a restart.

## Setup

1. **Create the bot.** Message [@BotFather](https://t.me/BotFather) on
   Telegram, send `/newbot`, follow the prompts. Copy the token it gives you.

2. **Create a private group per tier.** Make a Telegram group (or channel)
   for each tier this gate should unlock, set it to private, and add the bot
   as an admin with the "invite users via link" right. The bot needs that
   right to call `createChatInviteLink`; without it, verification will
   succeed but the invite link will fail to create.

3. **Get each chat's id.** With the bot already added to the group, send any
   message in the group, then fetch, from a terminal rather than a browser
   (a browser address bar puts the bot token in the browser's own history):

   ```
   curl "https://api.telegram.org/bot<BOT_TOKEN>/getUpdates"
   ```

   and read `result[].message.chat.id` for that group. It is a negative
   number for a group or supergroup. Do this once per tier chat.

4. **Fill in `.env`.** Copy `.env.example` to `.env` and set:
   - `BOT_TOKEN` from step 1.
   - `STARKNET_RPC`, left at the default or pointed at your own node.
   - `NIGHTSHIFT_VAULT`, the vault this gate checks against.
   - `VERIFIER_ID`, this gate's own stable id (any short string works; see
     the comment in `.env.example`).
   - `CREATOR_ID`, read from the NIGHTSHIFT ops console's log panel (see the
     comment in `.env.example` for exactly where).
   - `TIER_CHATS`, mapping each tier number to the chat id from step 3 and a
     label to show subscribers.

5. **Install and run.**

   ```
   npm ci --ignore-scripts
   npm start
   ```

## The end-to-end flow

1. A subscriber sends `/start` to the bot.
2. The bot calls `makeChallenge`, stores the result against that Telegram
   user id for 5 minutes, and replies with the challenge as one fenced line
   of JSON, then a separate message with the instruction to sign it in the
   NIGHTSHIFT ops console, panel 7, "sign for an external verifier
   (off-chain, no transaction)" - two messages, so a select-all copy of
   either one is still something the console can parse on its own.
3. The subscriber signs the challenge in the console with their subscription
   owner key and pastes the resulting presentation back into the chat, JSON
   fences and all; the bot strips code fences and accepts either the
   presentation on its own or the `{presentation, challenge}` wrapper shape
   the `nightshift-verify` CLI also accepts.
4. The bot deletes the pending challenge before checking anything, so the
   same presentation cannot be replayed against a second check even if
   the message is sent twice.
5. The bot calls `verifyPresentation` against the stored challenge's nonce,
   never the nonce in whatever text arrived; that nonce is the only thing
   that makes replay expensive rather than free.
6. If the check passes and the presentation's creator matches this gate's
   configured `CREATOR_ID`, the bot looks up the returned tier in
   `TIER_CHATS`, mints a `createChatInviteLink` good for one join and ten
   minutes, and sends it back with the tier's label.
7. On any other outcome, the bot replies with a one-line reason: which of
   `nightshift-verify`'s checks failed, that the JSON did not parse, or that
   the subscription is real but belongs to a different creator.

Rate limits, both in memory and both per Telegram user id: one challenge
every 30 seconds, and a 10-minute lockout after 5 failed verification
attempts in a row (a success clears the count).

## What this demonstrates

This gate never holds a key and never sees a wallet. The subscriber signs
with the subscription's own owner key inside the NIGHTSHIFT console; the bot
only ever receives the resulting signature and checks it against the owner
key the vault recorded at subscribe time. Per verification attempt the gate
makes three read-only RPC calls: one to read the current block height when
building the challenge, and two inside `verifyPresentation` to read
`schedule_of` and `owner_key_of` from the vault. It writes nothing to any
chain, submits no transaction, and spends no gas. The chain has no record
that this check happened, who ran it, or what it decided; the only trace of
the whole exchange lives in this process's memory until the challenge
expires or the process restarts.

What the gate does learn is the commitment itself, a stable pseudonym for
the subscription rather than a wallet: every presentation from the same
subscriber carries that same commitment, so this bot can recognize a
returning subscriber, and any other gate shown the same commitment can tell
it saw the same one too (see the Present row in `PRIVACY.md`).
