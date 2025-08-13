// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Partial Fill Handler Interface
 * @notice Handles partial fill operations for cross-chain swaps
 */
interface IPartialFillHandler {
    // Events
    event OrderPartiallyFilled(
        bytes32 indexed orderHash,
        uint256 filledAmount,
        uint256 remainingAmount,
        uint256 fillCount,
        bytes32 secretHash // For cross-chain coordination
    );
    
    event OrderSplit(
        bytes32 indexed parentOrderHash,
        bytes32[] childOrderHashes,
        uint256[] amounts,
        bytes32 secretHash // For cross-chain coordination
    );
    
    event RefundIssued(
        address indexed recipient,
        address token,
        uint256 amount,
        bytes32 orderHash,
        bytes32 secretHash // For cross-chain coordination
    );
    
    // Errors
    error InvalidFillAmount();
    error OrderFullyFilled();
    error OrderExpired();
    error MaximumFillsReached();
    error InvalidChildOrder();
    error RefundFailed();
    
    // Structs
    struct FillDetails {
        uint256 timestamp;
        uint256 amount;
        bytes32 fillId;
    }
    
    struct OrderState {
        uint256 filledAmount;
        uint256 remainingAmount;
        uint256 fillCount;
        bool isFullyFilled;
        bool isCancelled;
        uint256 lastFillTimestamp;
        bytes32[] fillHistory;
        bytes32[] childOrders;
    }
    
    // Functions
    function processPartialFill(
        bytes32 orderHash,
        uint256 fillAmount,
        bytes32 secretHash
    ) external returns (bool);
    
    function splitOrder(
        bytes32 orderHash,
        uint256[] calldata amounts,
        bytes32 secretHash
    ) external returns (bytes32[] memory);
    
    function processRefund(
        bytes32 orderHash,
        address refundRecipient,
        bytes32 secretHash
    ) external returns (bool);
    
    function getOrderState(
        bytes32 orderHash
    ) external view returns (OrderState memory);
    
    function getFillHistory(
        bytes32 orderHash
    ) external view returns (FillDetails[] memory);
    
    function getChildOrders(
        bytes32 orderHash
    ) external view returns (bytes32[] memory);
}
