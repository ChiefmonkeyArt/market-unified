# ADR-0020: Unify the SDK port (PR #1412) with the market-retrofit module rules

## Status

Accepted for `ChiefmonkeyArt/market-unified` (private, experimental). Not yet proposed upstream.

## Date

2026-10-13

## Related

- ADR-0021: Three-part SDK, UI and Platform architecture (PR #1412, still Proposed upstream)
- ADR-0002: Nostr I/O migration (NDK → Applesauce)
- market-retrofit `platform-core/platform-core.md` and `market-modularization/market-modularization.md`
  (gitworkshop.dev, npub163qj95…/market-retrofit, `main` @ `398d1fd`)

## Context

Two strategies existed for making the marketplace modular:

1. **PR #1412** ("feat: sdk port") moved code into `sdk/`, `ui/` and `platform/` inside the live repository,
   leaving `@deprecated` re-exports behind. It kept the app working, but it shipped with a crashing seller
   product form, deploy packages that left out the new folders, a checkout dead end, about 5.3k lines of
   auction and Cashu code duplicated between `src/lib` and `sdk/commerce`, and no type check in CI.
2. **market-retrofit** is a separate rebuild. It gives a precise diagnosis (one 36-file import cycle around
   `src/lib/stores/ndk.ts`) and strict module rules: core modules never import the app, and relays, signers,
   mints and storage are passed in. However, it shares no git history with upstream, its pinned upstream copy
   is 130+ commits behind, and its auction ranking ignores validator verdicts.

The owner allowed a blank slate: backwards compatibility for internal imports is not required.

## Decision

Use **PR #1412's tree and history as the vehicle**, and apply **the retrofit's rules as the constraints**.
Do not import retrofit code. Where upstream logic is stronger (validator-verdict bid ranking, settlement
evidence, the existing Cashu lock ordering), keep upstream's logic.

Concretely, starting from `auctions@6be7496c` + PR #1412 (`33bc7888`):

| Change                                                                                                     | Why                                             | Proof                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Seller product form uses SDK tab order and adjacency                                                       | it crashed on create/edit                       | tsc clean in that file; unit tests                                                                                                 |
| One deploy package list, `scripts/package/files.txt`, used by every deploy script                          | `sdk/` `ui/` `platform/` were not shipped       | `scripts/package/smoke.sh` boots the packaged server and fetches its bundles; it fails if a folder is missing (verified both ways) |
| Resumable partial multi-seller checkout                                                                    | "Do not retry" with no way forward              | 4 workflow tests: resume skips confirmed phases and reuses order IDs, so no duplicate orders are sent                              |
| One copy of auction and Cashu protocol code in `sdk/commerce`                                              | 17 byte-identical duplicates                    | codemod `scripts/codemods/collapse-duplicates.py`; 310 imports rewritten                                                           |
| Pure single-target `@deprecated` shims deleted                                                             | blank slate                                     | same codemod                                                                                                                       |
| The `ndk.ts` cycle broken                                                                                  | retrofit diagnosis                              | `scripts/check-cycles.sh`: `ndk.ts`, `auth.ts`, `utils.ts`, `io.ts` and `wallet/storage.ts` must not be in any runtime cycle       |
| Session onboarding moved to `src/lib/session/signerOnboarding.ts`                                          | `ndk.ts` imported queries and wallet stores     | —                                                                                                                                  |
| `wallet/storage` gets its user scope by injection                                                          | it imported `auth`                              | unconfigured scope fails closed for strict bidder-record saves                                                                     |
| Signatures verified at the applesauce relay seam                                                           | applesauce-relay does not verify                | io tests with real signed and forged events                                                                                        |
| `secureRandomHex`/`secureRandomUUID`, with no `Math.random` fallback                                       | bid nonce and NIP-46 pairing secret             | unit tests, including the throw when WebCrypto is missing                                                                          |
| `sdk/` may not import NDK or applesauce; `ui/` may not import the app, SDK, platform or protocol libraries | retrofit module rules                           | `sdk/boundary.test.ts`, `ui/boundary.test.ts`                                                                                      |
| CI: tsc ratchet (zero errors allowed in `sdk/` `ui/` `platform/`), cycle guard, package smoke              | the crash got through because CI never ran tsc  | `.github/workflows/ci-typecheck-package.yml`                                                                                       |
| Whole-repo type check at 0 errors (was 179)                                                                | blank slate                                     | `bunx tsc --noEmit -p .`                                                                                                           |
| All runtime import cycles removed (36 files → 0)                                                           | retrofit diagnosis                              | `scripts/check-cycles.sh`, baseline 0                                                                                              |
| shadcn kit moved to `ui/primitives/`, one `cn` in `ui/utils/cn`                                            | retrofit G4: `ui/` holds the design system      | codemod `scripts/codemods/move-ui-primitives.py`; `ui/boundary.test.ts`                                                            |
| Checkout and product-form defects fixed (listed in `docs/UNIFIED-STATUS.md`)                               | present on upstream `auctions@6be7496c`         | 10 previously skipped checkout/order e2e tests un-skipped and passing; unit tests                                                  |
| Full e2e suite runs locally with `scripts/e2e/run-local.sh`, no `--grep` filter                            | upstream CI ran a subset; ~20 tests had drifted | drifted tests realigned with the current UI; app-list resets fixed (they were silent no-ops and caused order-dependent failures)   |

## What did NOT change

- Auction money semantics, the bid lock order (lock → read back proofs → sign → publish), validator quorum,
  settlement evidence rules, NIP-17/44/59 checks. ADR-0017's monetary-activation gate still applies.
- The NIP-46 client session key is still kept in `localStorage`, as it is upstream. It is the bunker
  session key, not the user's nsec, which stays NIP-49 encrypted behind a password.
- Runtime import cycles: none remain (`scripts/cycles-baseline.txt` is 0).
- The NIP-60 wallet library (`@nostr-dev-kit/wallet`) and the NIP-57 zapper are unchanged. Replacing a
  money library needs owner approval (ADR-0010, ADR-0017).

## Checks run locally, not on GitHub Actions

Decided 2026-10-13 by the owner: GitHub only stores the code. Actions is disabled in the repository
settings; the workflow files stay in `.github/workflows/` as a record but do not run. Every gate runs locally
before a push to `main` (commands in `docs/UNIFIED-STATUS.md`). The repository is to be published to ngit
as well, under an npub the owner confirms first.

## Owner findings recorded, not changed

- Security (medium): zap receipts are accepted on a matching `bolt11` tag alone; the signer is not checked
  against the recipient's LNURL `nostrPubkey` (NIP-57 Appendix F). The seller's manual payment confirmation
  limits the damage.
- Privacy: `@getalby/lightning-tools` routes lightning-address lookups through `api.getalby.com` by default.
- `src/frontend.tsx` silences console output outside development.

## Consequences

- Every change sits on upstream history, so it can be offered back as small PRs.
- Upstream deploy and release workflows are removed in this private repository, so it can never deploy to
  Plebeian infrastructure.
- Not done (see `docs/UNIFIED-STATUS.md`): G1, moving the app layer off NDK (128 files still import it; the
  footprint guard stops growth); G3, stores still import queries; G5, the wallet port (owner call); G6, the
  router (waits on the CMS decision).
- Next steps, in the retrofit's order: put `nostr-io` behind its port everywhere and lower the NDK baseline,
  move the signer seat to applesauce-signers (ADR-0002 A3), then `event-store`, then `cashu-wrapper`, then the router.
