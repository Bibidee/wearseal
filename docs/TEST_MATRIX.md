# Test matrix

Coverage below is limited to tests that are actually present and run in CI. The manual smoke JSON is a repeatable operator script, not live-chain evidence.

| File | Cases | Result |
| --- | --- | --- |
| `tests/contract/test_direct_mode.py` | 20 Agreement Direct Mode cases: semantic mappings, contradictions, invalid model output, unavailable evidence, constructor bounds, hash immutability, authorization and settlement guards | passed locally |
| `tests/contract/test_consensus_and_expiry.py` | Independent validator equivalence, payout-sensitive disagreement rejection, malicious structured results, all expiry transitions, deadline enforcement, zero-address and settled-state guards | included in the green local suite |
| `tests/contract/test_vault_direct_mode.py` | Vault Direct Mode cases for constructor, deposit, sync recovery, allocation conservation, authorization, duplicate claims/refunds and settlement guards | included in the green local suite; the current gltest Direct Mode loader cannot load two contract classes in one process, so cross-contract calls use deterministic interface doubles and are covered end-to-end on Studionet |
| `tests/frontend/hash.test.ts` | safe HTTPS URL policy, private/link-local/credential/port/fragment rejection, SHA-256 validity, local/remote match and mismatch, fetch/empty response failure, execution-result classification, deadline bounds | passed in Vitest |
| `.github/workflows/ci.yml` | npm lockfile install, lint, typecheck, frontend tests, Next build, Direct Mode, Python compile, GenVM lint | required on every push/PR |

Live Studionet deployment and lifecycle evidence are recorded only in `artifacts/final-deployment.json` when backed by finalized receipts. A missing or stale artifact is not evidence of readiness.
