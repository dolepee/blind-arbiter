// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BlindArbiterEscrow
/// @notice Escrow primitive for private-deliverable settlement.
/// @dev The contract intentionally keeps only hashes onchain. Private material stays offchain.
contract BlindArbiterEscrow {
    enum CaseStatus {
        None,
        Funded,
        Accepted,
        Submitted,
        Passed,
        Failed,
        NeedsDispute,
        Released,
        Disputed,
        Refunded
    }

    struct CaseFile {
        address buyer;
        address seller;
        address arbiter;
        uint256 amount;
        bytes32 specHash;
        bytes32 deliverableHash;
        bytes32 verdictHash;
        CaseStatus status;
    }

    error CaseNotFound();
    error NotBuyer();
    error NotSeller();
    error NotArbiter();
    error InvalidStatus();
    error ZeroValue();

    event CaseCreated(
        uint256 indexed caseId,
        address indexed buyer,
        address indexed arbiter,
        address seller,
        uint256 amount,
        bytes32 specHash
    );

    event CaseAccepted(uint256 indexed caseId, address indexed seller);
    event DeliverableSubmitted(uint256 indexed caseId, bytes32 indexed deliverableHash);
    event VerdictPosted(uint256 indexed caseId, bytes32 indexed verdictHash, CaseStatus nextStatus);
    event Released(uint256 indexed caseId, address indexed seller, uint256 amount);
    event Disputed(uint256 indexed caseId, bytes32 indexed disputeHash);
    event Refunded(uint256 indexed caseId, address indexed buyer, uint256 amount);

    uint256 public nextCaseId = 1;
    mapping(uint256 => CaseFile) public cases;

    function createCase(address seller, address arbiter, bytes32 specHash) external payable returns (uint256 caseId) {
        if (msg.value == 0) revert ZeroValue();
        caseId = nextCaseId++;
        cases[caseId] = CaseFile({
            buyer: msg.sender,
            seller: seller,
            arbiter: arbiter,
            amount: msg.value,
            specHash: specHash,
            deliverableHash: bytes32(0),
            verdictHash: bytes32(0),
            status: CaseStatus.Funded
        });

        emit CaseCreated(caseId, msg.sender, arbiter, seller, msg.value, specHash);
    }

    function acceptCase(uint256 caseId) external {
        CaseFile storage caseFile = _getCase(caseId);
        if (caseFile.status != CaseStatus.Funded) revert InvalidStatus();
        if (caseFile.seller != address(0) && caseFile.seller != msg.sender) revert NotSeller();
        caseFile.seller = msg.sender;
        caseFile.status = CaseStatus.Accepted;
        emit CaseAccepted(caseId, msg.sender);
    }

    function submitDeliverable(uint256 caseId, bytes32 deliverableHash) external {
        CaseFile storage caseFile = _getCase(caseId);
        if (caseFile.status != CaseStatus.Accepted && caseFile.status != CaseStatus.Disputed) revert InvalidStatus();
        if (msg.sender != caseFile.seller) revert NotSeller();
        caseFile.deliverableHash = deliverableHash;
        caseFile.status = CaseStatus.Submitted;
        emit DeliverableSubmitted(caseId, deliverableHash);
    }

    function postVerdict(uint256 caseId, bytes32 verdictHash, CaseStatus nextStatus) external {
        CaseFile storage caseFile = _getCase(caseId);
        if (caseFile.status != CaseStatus.Submitted) revert InvalidStatus();
        if (msg.sender != caseFile.arbiter) revert NotArbiter();
        if (
            nextStatus != CaseStatus.Passed &&
            nextStatus != CaseStatus.Failed &&
            nextStatus != CaseStatus.NeedsDispute
        ) revert InvalidStatus();

        caseFile.verdictHash = verdictHash;
        caseFile.status = nextStatus;
        emit VerdictPosted(caseId, verdictHash, nextStatus);
    }

    function release(uint256 caseId) external {
        CaseFile storage caseFile = _getCase(caseId);
        if (caseFile.status != CaseStatus.Passed) revert InvalidStatus();
        if (msg.sender != caseFile.buyer && msg.sender != caseFile.arbiter) revert NotBuyer();

        uint256 amount = caseFile.amount;
        caseFile.amount = 0;
        caseFile.status = CaseStatus.Released;
        (bool ok, ) = caseFile.seller.call{value: amount}("");
        require(ok, "transfer failed");
        emit Released(caseId, caseFile.seller, amount);
    }

    function openDispute(uint256 caseId, bytes32 disputeHash) external {
        CaseFile storage caseFile = _getCase(caseId);
        if (
            caseFile.status != CaseStatus.Submitted &&
            caseFile.status != CaseStatus.Failed &&
            caseFile.status != CaseStatus.NeedsDispute
        ) revert InvalidStatus();
        if (msg.sender != caseFile.buyer && msg.sender != caseFile.seller && msg.sender != caseFile.arbiter) {
            revert NotBuyer();
        }

        caseFile.status = CaseStatus.Disputed;
        emit Disputed(caseId, disputeHash);
    }

    function refund(uint256 caseId) external {
        CaseFile storage caseFile = _getCase(caseId);
        if (caseFile.status != CaseStatus.Disputed && caseFile.status != CaseStatus.Failed) revert InvalidStatus();
        if (msg.sender != caseFile.buyer && msg.sender != caseFile.arbiter) revert NotBuyer();

        uint256 amount = caseFile.amount;
        caseFile.amount = 0;
        caseFile.status = CaseStatus.Refunded;
        (bool ok, ) = caseFile.buyer.call{value: amount}("");
        require(ok, "refund failed");
        emit Refunded(caseId, caseFile.buyer, amount);
    }

    function _getCase(uint256 caseId) internal view returns (CaseFile storage caseFile) {
        caseFile = cases[caseId];
        if (caseFile.buyer == address(0)) revert CaseNotFound();
    }
}
