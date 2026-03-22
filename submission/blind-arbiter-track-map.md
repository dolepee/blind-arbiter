# BlindArbiter Track Map

## Submit To

### Synthesis Open Track
- UUID: `fdb76d08812b43f6a5f454744b66f590`
- Why it fits:
  BlindArbiter is a complete product with a real public deployment, live onchain proof, and a clear agentic settlement use case.

### Go Gasless: Deploy & Transact on Status Network with Your AI Agent
- UUID: `877cd61516a14ad9a199bf48defec1c1`
- Why it fits:
  BlindArbiter deployed a receipt registry on Status Sepolia and anchored live verdict and settlement receipts.

### Escrow Ecosystem Extensions
- UUID: `88e91d848daf4d1bb0d40dec0074f59e`
- Why it fits:
  The core primitive is a new escrow verification model: sealed deliverables plus redacted verdicts plus public settlement receipts.

### Applications
- UUID: `d6c88674390b4150a9ead015443a1375`
- Why it fits:
  BlindArbiter uses Arkhai / Alkahest as a load-bearing dependency, and the demo includes a full live NLA lifecycle on Sepolia.

## Do Not Submit To

### Best Use of EigenCompute
- Why not:
  The Docker image build and onchain deploy path worked, but EigenCloud Sepolia provisioning still failed before an instance was assigned. That is not enough for an honest live-track claim.

### Agents With Receipts — ERC-8004
- Why not:
  BlindArbiter does not currently have a real ERC-8004 identity flow wired into the product.

### Let the Agent Cook — No Humans Required
- Why not:
  BlindArbiter has real automation and logs, but the strict ERC-8004 identity requirement is still unmet.

### Private Agents, Trusted Actions
- Why not:
  The current private review worker runs locally. BlindArbiter does not yet use Venice inference, so this would overclaim the implementation.
