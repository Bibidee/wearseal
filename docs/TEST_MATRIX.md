# Test matrix

Coverage below is limited to tests that are actually present and run in CI. The manual smoke JSON is a repeatable operator script, not live-chain evidence.

| File | Cases | Result |
| --- | --- | --- |
| `tests/contract/test_direct_mode.py` | 20 Agreement Direct Mode cases: semantic mappings, contradictions, invalid model output, unavailable evidence, constructor bounds, hash immutability, authorization and settlement guards | passed locally |
| `tests/contract/test_consensus_and_expiry.py` | Independent validator equivalence, payout-sensitive disagreement rejection, malicious structured results, all expiry transitions, deadline enforcement, zero-address and settled-state guards | included in the green local suite |
| `tests/contract/test_vault_direct_mode.py` | Vault Direct Mode cases for zero guards, exact external funding reference, authorization, duplicate funding, sync recovery, all allocation boundaries, conservation, claim acknowledgements, cancellation and replay guards | included in the green local suite |
| `tests/contract/test_vault_glsim_pair.py` | Genuine Agreement↔Vault pair tests using glsim: deploy/bind, baseline/external funding synchronization, all six verdict allocations, conservation, cancellation, invalid verdict, repeat settlement and acknowledgement authorization/replay guards | included in the green local suite; Base EVM delivery is verified by the escrow contract and live receipt evidence |
| `contracts/base/WearSealEscrow.sol` | Base Sepolia native-ETH escrow: one-time relayer allocation, recipient pull claims, reentrancy protection, revert-preserving retry semantics and unallocated withdrawal | compiled and deployed; EVM integration tests remain in the live lifecycle evidence |
| `tests/frontend/hash.test.ts` | safe HTTPS URL policy, private/link-local/credential/port/fragment rejection, SHA-256 validity, local/remote match and mismatch, fetch/empty response failure, execution-result classification, deadline bounds | passed in Vitest |
| `.github/workflows/ci.yml` | npm lockfile install, lint, typecheck, frontend tests, Next build, Direct Mode, Python compile, GenVM lint | required on every push/PR |

Live Studionet deployment and lifecycle evidence are recorded only in `artifacts/final-deployment.json` when backed by finalized receipts. A missing or stale artifact is not evidence of readiness.
