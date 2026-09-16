# Test matrix

Coverage below is limited to tests that are actually present and run in CI.

| File | Cases | Result |
| --- | --- | --- |
| `tests/contract/test_direct_mode.py` | 20 Direct Mode cases: semantic mappings, contradictions, invalid model output, unavailable evidence, constructor bounds, hash immutability, authorization and settlement guards | 20 passed locally |
| `tests/frontend/hash.test.ts` | safe HTTPS URL policy, private/link-local/credential/port/fragment rejection, SHA-256 validity, local/remote match and mismatch, fetch/empty response failure, execution-result classification, deadline bounds | passed in Vitest |
| `.github/workflows/ci.yml` | npm lockfile install, lint, typecheck, frontend tests, Next build, Direct Mode, Python compile, GenVM lint | required on every push/PR |

Live Studionet deployment and lifecycle evidence are opt-in and recorded only in `artifacts/final-deployment.json` when backed by finalized receipts.
