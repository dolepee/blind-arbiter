BlindArbiter is a confidential milestone escrow arbiter for private deliverables.

A buyer escrows funds against a natural-language acceptance rubric. A seller submits sealed evidence that does not need to be revealed publicly or handed over to the counterparty in advance. BlindArbiter reviews the sealed submission, emits a redacted verdict, and then releases the escrow or opens a dispute with verifiable onchain receipts.

The current demo is backed by real proof, not mocks:
- a live Ethereum Sepolia escrow contract and full settlement lifecycle
- a live Arkhai / Alkahest natural-language agreement lifecycle on Sepolia
- anchored receipt publication on Status Sepolia
- a public proof site at `https://blind-arbiter.vercel.app`
