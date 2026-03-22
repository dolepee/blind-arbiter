# BlindArbiter

BlindArbiter is a confidential milestone escrow arbiter for humans and agents.

## Live Proof

BlindArbiter already has real onchain proof on two networks.

### Ethereum Sepolia

- escrow contract: `0x89cf6d586902b8750e6d6e5158c51e838cae7aa0`
- deploy tx: `0x9fc631c9e5a5a5cf21c2f41920b8ab78531b37eb1c001a6c86ba0a89003c92eb`
- deployer and operator wallet: `0x8942F989343e4Ce8e4c8c0D7C648a6953ff3A5A2`

Canonical live lifecycle: `caseId 3`
- create case: `0xb1ed8b1c711da9ed4bccd02c7e47fa50ffff49abdfddc678274d20a7162cbb4a`
- accept case: `0xea8d436faf954bf7e30ec87a7f8b92eadc2416f8185bf97cff87ba093946473e`
- submit deliverable: `0x70f561eda4fda0c1150132847ea6c8f009b479928e632fa552eb832015f7f322`
- post verdict: `0x2904cb0d4aca0f89dce9cbae37e9c727093af9570e97583fcf2210ac13e691e8`
- release escrow: `0xebacea493b071482cd9d5859cec7c07bc765c0b4ea3561554597b17c96fce729`

Canonical runtime artifacts generated locally:
- `runtime/sepolia-escrow-deployment.json`
- `runtime/sepolia-escrow-smoke.json`

### Status Sepolia

- receipt registry: `0x6d67cf8ba5857425bed0d2b214e0ce2814f7db07`
- registry deploy tx: `0x05d0a1d988998aef1dcde8c704c47fe98a7c34b1d02ebd2d6e74f427375f20cc`

Anchored receipts already recorded:
- verdict receipt: `0x7bd8607df39090a914fcb0b08fdd0af691bafbf5d556d788b1ae05a4ad41f306`
- release receipt: `0x99fd4eeeecfbfe23e585a9547f475418e32da9f3cd8631cdffa7fa7b9fa15974`
- dispute receipt: `0xde939dd769c3e74cc944567afcca2c6d938881e82ac9c54230037c2203a2fa8a`

### Arkhai / Alkahest Sepolia

BlindArbiter now has a full live NLA lifecycle on Ethereum Sepolia using the official Alkahest `TrustedOracleArbiter` flow:

- token deploy: `0x6a17e3da4b45767dbd6a87f1791f47a046f1de0057286d4e336ec5b3b3076d86`
- escrow create: `0x459cccec9cc5272687f02a0ece1d09f476f95f5dc8a7fcbe48c648846903a98f`
- direct string fulfillment: `0x7561971466203c32f75eaadab0bafc9b783a019338bd51c1f2170b715e7ff851`
- arbitration request: `0x4aca0e8e80945514a18fc5492f60ac797fe8772d58311fcc157058c20b869db8`
- oracle decision: `0x2719b496bed7b77e8cd3131c127d28c47a1c799f9be61c0491bd9e712b79fc46`
- escrow collect: `0xc6d0a5bae417cb2d694d75c82ad2e28ffd308a3577f6734c610f576f0352f937`

Canonical Arkhai artifact generated locally:
- `runtime/arkhai-live-sepolia.json`

### Real vs local

Real now:
- Ethereum Sepolia escrow deployment
- full onchain escrow lifecycle for the canonical live case
- Status Sepolia receipt registry deployment
- anchored Status receipts
- full live Arkhai Sepolia `create -> fulfill -> arbitrate -> collect` lifecycle
- persisted Arkhai agreement artifacts

Local for now:
- confidential review worker is live locally over HTTP and Docker
- EigenCloud image layering and onchain deploy were completed from a billed account, but Sepolia provisioning still fails before an instance is assigned
- the provisioning failure is not BlindArbiter-specific: a stock `ttl.sh/nginx-probe-1774124283:12h` probe app also fails after provisioning starts
- Self Agent ID is not wired because operator identity registration is blocked

## Current MVP

- create a funded case with a milestone rubric
- accept the case with a seller identity
- submit a sealed deliverable
- run a Dockerized EigenCompute-style review worker over HTTP, with deterministic fallback
- produce a redacted verdict with a report hash
- anchor Status receipts when a registry and wallet are configured, otherwise fall back to draft receipts
- mark escrow as released or disputed

## Why this exists

Private deliverables often cannot be posted onchain or exposed to the buyer before settlement. BlindArbiter keeps the artifact sealed while still producing a public settlement trail.

## Sponsor mapping

- `EigenCompute`: intended home for the confidential review worker, with live deployment attempts isolated to a Sepolia provisioning blocker
- `Arkhai / Alkahest`: escrow and arbiter primitive extension
- `Self`: identity gating for buyer, seller, and operator
- `Status`: gasless receipt publication

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

The workbench now exposes the live proof panel directly in the UI, sourced from local runtime artifacts that are gitignored:
- `runtime/status-deployment.json`
- `runtime/sepolia-escrow-deployment.json`
- `runtime/sepolia-escrow-smoke.json`
- `runtime/arkhai-live-sepolia.json`

## Run The Review Worker

BlindArbiter can delegate reviews to the local worker surface intended for EigenCompute:

```bash
npm run worker:eigencompute
EIGENCOMPUTE_REVIEW_URL=http://127.0.0.1:3000/review npm run dev
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Docker image build:

```bash
docker build -f worker/Dockerfile -t blindarbiter/arbiter-worker:eigencompute-dev .
```

## Prepare The EigenCompute Worker

BlindArbiter now includes a reproducible publish/deploy path for the confidential worker:

```bash
cp .env.ecloud.example .env.ecloud
npm run worker:publish:image
ECLOUD_PRIVATE_KEY=0x... npm run worker:deploy:ecloud -- <image_ref>
```

Notes:
- the worker Dockerfile now targets `linux/amd64` and runs as `root`, matching the documented EigenCompute requirements
- the publish script defaults to `ttl.sh` for an ephemeral public image ref
- the deploy script uses the supported `ecloud compute app deploy --image-ref ...` path
- Sepolia billing must be active before deployment succeeds
- on March 21, 2026, live Sepolia provisioning remained blocked even after successful image layering, registry propagation, and onchain deployment
- the same provisioning failure also occurred for a stock nginx probe image, so the remaining blocker is platform/runtime behavior, not BlindArbiter's worker code
- latest probe evidence:
  - app ID: `0x2669e74140868C9e0CcAA7517212B470012F7dEe`
  - deploy tx: `0xfab6d71a7ccd2c1f59eec17f72d3d032456695f9e32c5ea49a3e25f82020bc92`

## Arkhai Agreement Export

BlindArbiter now emits Arkhai-compatible Natural Language Agreement packets using the official `nla` demand shape:

```bash
curl http://localhost:3000/api/cases/<case_id>/arkhai
```

Each packet includes:
- `llmDemand` with `arbitrationProvider`, `arbitrationModel`, `arbitrationPrompt`, and `demand`
- ABI-encoded demand bytes compatible with the NLA oracle format
- ready-to-run `nla escrow:create` and `nla escrow:fulfill` command previews
- persisted JSON and Markdown artifacts in `runtime/agreements/` after review

Defaults target the public demo oracle from the official Arkhai repo on Ethereum Sepolia. Override these if needed:

```bash
NLA_NETWORK=sepolia
NLA_ORACLE_ADDRESS=0xc5c132B69f57dAAAb75d9ebA86cab504b272Ccbc
NLA_TOKEN_ADDRESS=<your_erc20_token>
NLA_ARBITRATION_PROVIDER=OpenAI
NLA_ARBITRATION_MODEL=gpt-4o-mini
```

## Ethereum Sepolia Escrow

BlindArbiter now includes reproducible Sepolia scripts for live escrow deployment and a self-contained smoke test:

```bash
npm run deploy:sepolia:escrow
npm run smoke:sepolia:escrow
```

The scripts load `.env.local` automatically and use `SEPOLIA_PRIVATE_KEY` when present, otherwise they fall back to `STATUS_PRIVATE_KEY`.

Relevant variables:

```bash
SEPOLIA_PRIVATE_KEY=
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
SEPOLIA_CHAIN_ID=11155111
SEPOLIA_EXPLORER_BASE_URL=https://sepolia.etherscan.io
SEPOLIA_ESCROW_ADDRESS=
SEPOLIA_SMOKE_TEST_VALUE_ETH=0.001
```

Runtime artifacts generated locally:
- `runtime/sepolia-escrow-deployment.json`
- `runtime/sepolia-escrow-smoke.json`

Note: an earlier public-RPC retry created prior Sepolia test cases. `caseId 3` is the clean canonical lifecycle to use in the demo and submission.

## Status Configuration

BlindArbiter now supports real Status Sepolia receipt anchoring.

Create `.env.local` from `.env.example` and set:

```bash
STATUS_PRIVATE_KEY=0xyour_status_wallet_private_key
STATUS_RPC_URL=https://public.sepolia.rpc.status.network
STATUS_CHAIN_ID=1660990954
STATUS_EXPLORER_BASE_URL=https://sepoliascan.status.network
STATUS_RECEIPT_REGISTRY_ADDRESS=
EIGENCOMPUTE_REVIEW_URL=http://127.0.0.1:3000/review
NLA_NETWORK=sepolia
NLA_ORACLE_ADDRESS=0xc5c132B69f57dAAAb75d9ebA86cab504b272Ccbc
NLA_TOKEN_ADDRESS=
NLA_ARBITRATION_PROVIDER=OpenAI
NLA_ARBITRATION_MODEL=gpt-4o-mini
```

If `STATUS_PRIVATE_KEY` is set but `STATUS_RECEIPT_REGISTRY_ADDRESS` is empty, deploy the receipt registry first:

```bash
curl -X POST http://localhost:3000/api/status/deploy
```

The deployment metadata will be written to `runtime/status-deployment.json`, and later receipt flows will use that address automatically. The entire `runtime/` directory is local-only and excluded from the public repo.

## Files

- `src/app/page.tsx`: main workbench page
- `src/components/workbench.tsx`: milestone and review UI
- `src/lib/live-proof.ts`: runtime proof loader for live Sepolia and Status evidence
- `src/lib/store.ts`: file-backed local state machine
- `src/lib/integrations/eigencompute.ts`: local arbiter stub and hash generation
- `src/lib/integrations/arkhai.ts`: Natural Language Agreement packet builder and artifact export
- `src/lib/integrations/status.ts`: Status deployment and receipt anchoring
- `contracts/BlindArbiterEscrow.sol`: escrow primitive
- `contracts/BlindArbiterReceiptRegistry.sol`: onchain receipt registry for verdicts and settlements
- `worker/server.mjs`: Dockerized HTTP review worker for EigenCompute-style execution
- `worker/Dockerfile`: worker container image entrypoint
- `scripts/publish-worker-image.sh`: reproducible `linux/amd64` image build and push helper
- `scripts/deploy-ecloud-worker.sh`: supported `ecloud compute app deploy --image-ref` wrapper

## Highest Value Remaining Work

1. recover live EigenCloud provisioning on Sepolia or keep the submission scoped to the local confidential worker path
2. execute one live Arkhai `nla` lifecycle using the exported agreement packet
3. tighten the agent manifest and submission assets around the canonical Sepolia case and Status receipts
