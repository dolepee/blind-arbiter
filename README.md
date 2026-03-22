# BlindArbiter

BlindArbiter is a confidential milestone escrow arbiter for private deliverables.

It lets a buyer escrow against a natural-language acceptance rubric, a seller submit sealed evidence, and an agent emit a redacted verdict that releases or disputes settlement without exposing the underlying work.

## Why It Exists

Private work is hard to settle fairly onchain.

Security audits, private patches, diligence memos, unreleased designs, and sensitive datasets often cannot be revealed before payment. Existing escrow flows force a bad choice:

- reveal the work before getting paid
- trust a human arbiter with weak transparency
- fall back to chat-based coordination with no verifiable audit trail

BlindArbiter turns that into a machine-verifiable settlement flow.

## Public Surface

- Proof site: `https://blind-arbiter.vercel.app`
- Repository: `https://github.com/dolepee/blind-arbiter`

The Vercel deployment is intentionally read-only. It exists to show the live proof trail, not to expose private deliverables or the operator environment.

## What The Product Does

1. A buyer funds a milestone escrow against a natural-language rubric.
2. A seller submits sealed evidence for review.
3. BlindArbiter emits a redacted verdict plus a report hash.
4. The system releases the escrow or opens a dispute and anchors public receipts.

## Live Proof

BlindArbiter already has real proof on multiple surfaces.

### Ethereum Sepolia

- Escrow contract: `0x89cf6d586902b8750e6d6e5158c51e838cae7aa0`
- Deploy tx: `0x9fc631c9e5a5a5cf21c2f41920b8ab78531b37eb1c001a6c86ba0a89003c92eb`
- Operator wallet: `0x8942F989343e4Ce8e4c8c0D7C648a6953ff3A5A2`

Canonical live lifecycle: `caseId 3`

- Create case: `0xb1ed8b1c711da9ed4bccd02c7e47fa50ffff49abdfddc678274d20a7162cbb4a`
- Accept case: `0xea8d436faf954bf7e30ec87a7f8b92eadc2416f8185bf97cff87ba093946473e`
- Submit deliverable: `0x70f561eda4fda0c1150132847ea6c8f009b479928e632fa552eb832015f7f322`
- Post verdict: `0x2904cb0d4aca0f89dce9cbae37e9c727093af9570e97583fcf2210ac13e691e8`
- Release escrow: `0xebacea493b071482cd9d5859cec7c07bc765c0b4ea3561554597b17c96fce729`

### Status Sepolia

- Receipt registry: `0x6d67cf8ba5857425bed0d2b214e0ce2814f7db07`
- Registry deploy tx: `0x05d0a1d988998aef1dcde8c704c47fe98a7c34b1d02ebd2d6e74f427375f20cc`

Anchored receipts:

- Verdict receipt: `0x7bd8607df39090a914fcb0b08fdd0af691bafbf5d556d788b1ae05a4ad41f306`
- Release receipt: `0x99fd4eeeecfbfe23e585a9547f475418e32da9f3cd8631cdffa7fa7b9fa15974`
- Dispute receipt: `0xde939dd769c3e74cc944567afcca2c6d938881e82ac9c54230037c2203a2fa8a`

### Arkhai / Alkahest Sepolia

BlindArbiter also completed a live natural-language agreement lifecycle using the official trusted-oracle arbiter flow:

- Token deploy: `0x6a17e3da4b45767dbd6a87f1791f47a046f1de0057286d4e336ec5b3b3076d86`
- Escrow create: `0x459cccec9cc5272687f02a0ece1d09f476f95f5dc8a7fcbe48c648846903a98f`
- String fulfillment: `0x7561971466203c32f75eaadab0bafc9b783a019338bd51c1f2170b715e7ff851`
- Arbitration request: `0x4aca0e8e80945514a18fc5492f60ac797fe8772d58311fcc157058c20b869db8`
- Oracle decision: `0x2719b496bed7b77e8cd3131c127d28c47a1c799f9be61c0491bd9e712b79fc46`
- Escrow collect: `0xc6d0a5bae417cb2d694d75c82ad2e28ffd308a3577f6734c610f576f0352f937`

## Current Scope

### Real Now

- Ethereum Sepolia escrow deployment
- canonical onchain escrow lifecycle
- Status receipt registry deployment
- anchored Status receipts
- full live Arkhai lifecycle on Sepolia
- public proof site on Vercel

### Local For Now

- the confidential review worker runs locally over HTTP and Docker

### Not Claimed

- live EigenCloud runtime
- Self Agent ID integration
- ERC-8004 identity integration

## Repository Structure

```text
src/
  app/                         Next.js app and API routes
  components/                  public proof UI
  lib/                         state, proof loading, and integrations
contracts/
  BlindArbiterEscrow.sol
  BlindArbiterReceiptRegistry.sol
worker/
  server.mjs                   local confidential review worker
  Dockerfile                   worker image definition
scripts/
  deploy-sepolia-escrow.mjs
  smoke-sepolia-escrow.mjs
  run-sepolia-arkhai-live.mjs
  run-sepolia-arkhai-oracle.mjs
submission/
  draft payload, proof inventory, demo script, and generated assets
```

## Run Locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

To run the review worker:

```bash
npm run worker:eigencompute
EIGENCOMPUTE_REVIEW_URL=http://127.0.0.1:3000/review npm run dev
```

## Key Environment Variables

```bash
STATUS_PRIVATE_KEY=
STATUS_RPC_URL=https://public.sepolia.rpc.status.network
STATUS_CHAIN_ID=1660990954
STATUS_EXPLORER_BASE_URL=https://sepoliascan.status.network
STATUS_RECEIPT_REGISTRY_ADDRESS=

SEPOLIA_PRIVATE_KEY=
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
SEPOLIA_CHAIN_ID=11155111
SEPOLIA_EXPLORER_BASE_URL=https://sepolia.etherscan.io
SEPOLIA_ESCROW_ADDRESS=

EIGENCOMPUTE_REVIEW_URL=http://127.0.0.1:3000/review

NLA_NETWORK=sepolia
NLA_ORACLE_ADDRESS=0xc5c132B69f57dAAAb75d9ebA86cab504b272Ccbc
NLA_TOKEN_ADDRESS=
NLA_ARBITRATION_PROVIDER=OpenAI
NLA_ARBITRATION_MODEL=gpt-4o-mini
```

## Submission Assets

Generated assets for the hackathon submission live in `submission/assets/`:

- `blind-arbiter-cover.png`
- `blind-arbiter-screens.png`
- `blind-arbiter-demo.mp4`

Supporting submission files live in `submission/`:

- draft payload
- track map
- proof inventory
- demo script
- collaboration log

## Submission Positioning

BlindArbiter is packaged around the tracks it can defend honestly:

- Synthesis Open Track
- Status Network
- Arkhai Applications
- Arkhai Escrow Ecosystem Extensions

The project is not being positioned around hosted confidential compute until that path is actually live.
