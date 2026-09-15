# WearSeal

WearSeal is a browser-to-GenLayer Studionet (61999) equipment-condition escrow. The Agreement contract seals the two-party rubric and image commitments; the Vault holds the exact renter deposit and settles only from Agreement state. No backend, upload service, relayer, or centralized adjudicator exists.

Run with `npm ci && npm run dev`. Configure public contract addresses in `.env.local` after a real Studionet deployment. The `/verify` tool fetches and hashes public evidence; it never treats a local `blob:` URL as adjudication evidence.

Known limits: this is a Studionet demo protocol. It does not prove hidden damage, item identity beyond the visual comparison, legal enforceability, or insurance-grade inspection.
