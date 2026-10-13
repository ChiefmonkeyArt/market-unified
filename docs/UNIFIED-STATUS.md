# market-unified: status

Last updated: 2026-10-13. Repository: `ChiefmonkeyArt/market-unified` (private). Decisions: ADR-0020.

## What this repository is

PR #1412 (the SDK port) and the market-retrofit module rules, merged onto upstream `auctions@6be7496c`
(tags `base/auctions-6be7496c`, `base/pr1412-33bc7888`). Upstream history is kept, so every change can be offered
back as a small PR. Nothing here has been pushed to `PlebeianApp/market`.

## How it is checked

GitHub Actions is **switched off** for this repository (repository setting, 2026-10-13). GitHub only stores the code.
Every gate runs locally before each push to `main`:

```bash
export PATH=~/.npm-g/bin:$PATH
bunx tsc --noEmit -p .                         # 0 errors
bun run test:unit                              # all pass
bash scripts/check-cycles.sh                   # 0 files in runtime cycles
bash scripts/check-ndk-footprint.sh            # must not grow
bunx prettier --check .
NAK=/path/to/nak bash scripts/package/smoke.sh # packaged server boots and serves its bundles
NAK=/path/to/nak CASHU_PYTHON_BIN=/path/to/cashu-venv/bin bash scripts/e2e/run-local.sh   # full e2e
```

`scripts/e2e/run-local.sh` starts the same stack CI used (local relay, local Cashu mint, seeded data, dev server)
and passes any extra arguments to Playwright.

## Gates

| Gate                                                | Status         | Evidence                                                                                                                                                           |
| --------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type check                                          | done           | 0 errors (was 179)                                                                                                                                                 |
| Runtime import cycles                               | done           | 0 files (was 36 around `ndk.ts`)                                                                                                                                   |
| Unit tests                                          | done           | all pass                                                                                                                                                           |
| Deploy package                                      | done           | one file list, `scripts/package/files.txt`; smoke test boots the packaged server                                                                                   |
| End-to-end                                          | done           | full suite, no filter, all tests pass locally, including 10 checkout/order tests upstream had skipped                                                              |
| `sdk/` imports no NDK/applesauce; `ui/` no app code | done           | `sdk/boundary.test.ts`, `ui/boundary.test.ts`                                                                                                                      |
| G4: shadcn kit lives in `ui/`                       | done           | `ui/primitives/` (37 files), one `cn`; app-aware widgets moved to `src/components/`                                                                                |
| G1: NDK → applesauce in the app layer               | **not done**   | 128 app files still import NDK (≈550 `NDKEvent` uses, 182 `getNDK()` calls). The guard stops it growing. See "Remaining work".                                     |
| G3: stores do not import queries                    | **not done**   | `stores/cart.ts`, `stores/product.ts`, `stores/auth.ts` still import `@/queries/*`. No cycles result (cycle gate is 0), so this is layering hygiene, not a defect. |
| G5: wallet behind an SDK port                       | **owner call** | The NIP-60 wallet is `@nostr-dev-kit/wallet` (`NDKCashuWallet`). Replacing a money library needs owner approval under ADR-0010 / ADR-0017.                         |
| G6: router                                          | **owner call** | Depends on the CMS decision (ADR-0006, CMS and page building). Not started.                                                                                        |

## Product defects fixed here (all present on upstream `auctions@6be7496c`)

1. Multi-seller checkout could hang forever at "Waiting for order IDs": totals waited on the price oracle even for
   sats-only carts, and the order workflow reported "published" with zero orders for a seller with no totals.
2. Every generated invoice looked expired: `expiresAt` stored a 3600 s duration instead of a timestamp.
3. With external zap relays disabled (staging, CI) zap receipts were never watched, so paid invoices never confirmed.
4. Seller product form: typing a sats price before exchange rates loaded left the fiat price empty, so "Next" stayed
   disabled ("Valid product price is required") while the form showed a USD price.
5. Resumable partial multi-seller checkout (PR #1412 left a "Do not retry" dead end).
6. Seller product form crash on create/edit (PR #1412 tab order).
7. "Add to cart" on the product detail page stored the product under its event id instead of its d-tag, so orders
   placed that way referenced `30402:<seller>:<event id>` (no such listing) and the same product added from its card
   and its page became two cart lines. Covered by `shipping-special.spec.ts`, which now adds from the product page
   and checks the order's `item` reference.
8. Admin list edits (blacklist, featured products/collections/auctions/users) made within the same second could be
   lost: each version was stamped "now", and NIP-01 keeps the lower id on a same-second tie, so "add then remove"
   could leave the user blacklisted. Each edit is now strictly newer than the version it was computed from
   (`src/lib/nostr/replaceable.ts`, unit-tested). Reorders still stamp "now" (they do not read the current list).

## Findings for the owner (not changed)

- **Security, medium:** zap receipts are accepted on a matching `bolt11` tag alone
  (`createZapReceiptSubscription` / `monitorZapPayment` in `src/lib/stores/ndk.ts`). The receipt's signer is not
  checked against the recipient's LNURL `nostrPubkey`, so anyone can publish a receipt that marks an invoice paid
  in the buyer's checkout. The seller's manual "Confirm Payment Received" step limits the damage. Fix: pass the
  LNURL `nostrPubkey` into the monitor and reject receipts signed by anyone else (NIP-57 Appendix F).
- **Privacy:** `new LightningAddress(addr)` from `@getalby/lightning-tools` (`src/queries/payment.tsx`) routes
  lightning-address lookups and invoice requests through `api.getalby.com` by default. `{ proxy: false }` fetches
  directly but depends on each provider's CORS headers.
- **Observability:** `src/frontend.tsx` silences `console.log/error/info/debug` outside development, which hides
  errors in staging and tests.
- **Test design:** upstream CI ran only a filtered subset of e2e specs (`--grep` list in the old `e2e.yml`); about
  20 tests outside that list had drifted from the UI and were failing unnoticed.

## Remaining work

- **G1, NDK → applesauce (largest item).** ADR-0002 plans this in waves; the relay I/O seam (`src/lib/nostr/io.ts`,
  signature-verified) exists. What is left is mostly mechanical but wide: query hooks return `NDKEvent`, components
  read `event.tagValue()`, and publishers build `new NDKEvent(...)`. The wallet (`NDKCashuWallet`), the NIP-57 zapper
  (`NDKZapper`) and NIP-46 signer are the load-bearing parts. Wallet and zapper are owner-gated (money paths).
  Suggested order: read paths (queries) → publishers → signers (ADR-0002 A3) → event store → wallet (owner).
- **G3:** move cart/product price and shipping lookups behind injected functions, as `wallet/storage` already does.
- **Publish to ngit:** pending owner confirmation of the publishing npub.
