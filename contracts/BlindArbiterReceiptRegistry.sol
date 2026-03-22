// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BlindArbiterReceiptRegistry {
    struct ReceiptRecord {
        string caseId;
        string action;
        string summary;
        uint256 anchoredAt;
    }

    mapping(bytes32 => ReceiptRecord) private records;

    event ReceiptAnchored(
        bytes32 indexed receiptHash,
        string caseId,
        string action,
        string summary,
        uint256 anchoredAt
    );

    function anchorReceipt(
        bytes32 receiptHash,
        string calldata caseId,
        string calldata action,
        string calldata summary
    ) external {
        require(records[receiptHash].anchoredAt == 0, "receipt already anchored");

        ReceiptRecord memory record = ReceiptRecord({
            caseId: caseId,
            action: action,
            summary: summary,
            anchoredAt: block.timestamp
        });

        records[receiptHash] = record;

        emit ReceiptAnchored(
            receiptHash,
            caseId,
            action,
            summary,
            block.timestamp
        );
    }

    function getReceipt(bytes32 receiptHash) external view returns (ReceiptRecord memory) {
        require(records[receiptHash].anchoredAt != 0, "receipt not found");
        return records[receiptHash];
    }
}
