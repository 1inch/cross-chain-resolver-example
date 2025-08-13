// SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IOrderMixin} from "../lib/limit-order-protocol/contracts/interfaces/IOrderMixin.sol";
import {TakerTraits} from "../lib/limit-order-protocol/contracts/libraries/TakerTraitsLib.sol";

import {IResolverExample} from "../lib/cross-chain-swap/contracts/interfaces/IResolverExample.sol";
import {RevertReasonForwarder} from "../lib/cross-chain-swap/lib/solidity-utils/contracts/libraries/RevertReasonForwarder.sol";
import {IEscrowFactory} from "../lib/cross-chain-swap/contracts/interfaces/IEscrowFactory.sol";
import {IBaseEscrow} from "../lib/cross-chain-swap/contracts/interfaces/IBaseEscrow.sol";
import {TimelocksLib, Timelocks} from "../lib/cross-chain-swap/contracts/libraries/TimelocksLib.sol";
import {Address, AddressLib} from "../lib/solidity-utils/contracts/libraries/AddressLib.sol";
import {IEscrow} from "../lib/cross-chain-swap/contracts/interfaces/IEscrow.sol";
import {ImmutablesLib} from "../lib/cross-chain-swap/contracts/libraries/ImmutablesLib.sol";

import "./interfaces/IPartialFillHandler.sol";

// NEAR-specific interfaces
interface INearBridge {
    function deposit() external payable;
    function withdraw(bytes calldata proofData, bytes calldata blockHeaderLite, bytes calldata blockProof) external;
}

interface INearToken {
    function ft_transfer_call(
        string memory receiver_id,
        uint128 amount,
        string memory memo,
        bytes memory msg
    ) external returns (bool);
}

/**
 * @title Cross-chain Resolver for 1inch Fusion+ and NEAR Protocol
 * @dev This contract handles cross-chain swaps between Ethereum and NEAR Protocol.
 * It extends the base Resolver functionality to support NEAR-specific operations.
 *
 * @custom:security-contact security@1inch.io
 */
contract Resolver is IResolverExample, IPartialFillHandler, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // Events for NEAR integration
    event NearDepositInitiated(
        address indexed sender,
        string nearRecipient,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );
    
    // Constants for NEAR integration
    uint256 public constant NEAR_CHAIN_ID = 397;
    uint256 public constant MIN_NEAR_DEPOSIT = 0.1 ether; // Minimum deposit amount
    
    // Partial fills state
    mapping(bytes32 => OrderState) private _orderStates;
    mapping(bytes32 => FillDetails[]) private _fillHistory;
    mapping(bytes32 => bytes32[]) private _childOrders; // parentOrderHash => childOrderHashes
    mapping(bytes32 => bytes32) private _parentOrders; // childOrderHash => parentOrderHash
    
    // Default values for partial fills
    uint256 public constant DEFAULT_MIN_FILL_PERCENT = 10; // 10% minimum fill
    uint256 public constant DEFAULT_MAX_FILLS = 10; // Maximum 10 partial fills per order
    
    // Struct to track NEAR deposits
    struct NearDeposit {
        address sender;
        string nearRecipient;
        uint256 amount;
        bytes32 secretHash;
        uint256 timelock;
        bool withdrawn;
    }
    
    // Mapping to track NEAR deposits by secret hash
    mapping(bytes32 => NearDeposit) public nearDeposits;
    
    event NearWithdrawalCompleted(
        bytes32 indexed secretHash,
        string nearRecipient,
        uint256 amount
    );
    
    event NearRefunded(
        bytes32 indexed secretHash,
        string nearRecipient,
        uint256 amount
    );
    
    /**
     * @dev Internal function to handle NEAR deposits
     * @param immutables The immutables from the escrow
     * @param secret The secret used for the hashlock
     */
    /**
     * @notice Process a partial fill of an order
     * @param orderHash The hash of the order being filled
     * @param fillAmount The amount being filled in this partial fill
     * @param secretHash The secret hash for cross-chain coordination
     */
    function processPartialFill(
        bytes32 orderHash,
        uint256 fillAmount,
        bytes32 secretHash
    ) external override nonReentrant returns (bool) {
        require(fillAmount > 0, "Invalid fill amount");
        
        OrderState storage orderState = _orderStates[orderHash];
        require(!orderState.isFullyFilled, "Order already fully filled");
        require(!orderState.isCancelled, "Order is cancelled");
        require(orderState.fillCount < DEFAULT_MAX_FILLS, "Maximum fills reached");
        
        // Calculate minimum fill amount (10% of remaining or specified minimum)
        uint256 minFillAmount = (orderState.remainingAmount * DEFAULT_MIN_FILL_PERCENT) / 100;
        require(fillAmount >= minFillAmount, "Fill amount below minimum");
        
        // Update order state
        orderState.filledAmount += fillAmount;
        orderState.remainingAmount -= fillAmount;
        orderState.fillCount++;
        orderState.lastFillTimestamp = block.timestamp;
        
        // Record fill in history
        bytes32 fillId = keccak256(abi.encodePacked(orderHash, block.timestamp, fillAmount));
        _fillHistory[orderHash].push(FillDetails({
            timestamp: block.timestamp,
            amount: fillAmount,
            fillId: fillId
        }));
        
        // Check if order is now fully filled
        if (orderState.remainingAmount == 0) {
            orderState.isFullyFilled = true;
        }
        
        emit OrderPartiallyFilled(
            orderHash,
            orderState.filledAmount,
            orderState.remainingAmount,
            orderState.fillCount,
            secretHash
        );
        
        return true;
    }
    
    /**
     * @notice Split an order into multiple child orders
     * @param orderHash The hash of the order to split
     * @param amounts Array of amounts for each child order
     * @param secretHash The secret hash for cross-chain coordination
     */
    function splitOrder(
        bytes32 orderHash,
        uint256[] calldata amounts,
        bytes32 secretHash
    ) external override onlyOwner nonReentrant returns (bytes32[] memory) {
        require(amounts.length > 1, "At least 2 amounts required");
        
        OrderState storage parentState = _orderStates[orderHash];
        require(!parentState.isFullyFilled, "Order already fully filled");
        require(!parentState.isCancelled, "Order is cancelled");
        
        uint256 totalAmount = 0;
        bytes32[] memory childHashes = new bytes32[](amounts.length);
        
        // Create child orders
        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] > 0, "Invalid amount");
            
            // Create a new order hash for the child
            bytes32 childHash = keccak256(abi.encodePacked(
                orderHash,
                block.timestamp,
                i,
                amounts[i]
            ));
            
            // Initialize child order state
            _orderStates[childHash] = OrderState({
                filledAmount: 0,
                remainingAmount: amounts[i],
                fillCount: 0,
                isFullyFilled: false,
                isCancelled: false,
                lastFillTimestamp: 0,
                fillHistory: new bytes32[](0),
                childOrders: new bytes32[](0)
            });
            
            // Track parent-child relationship
            _parentOrders[childHash] = orderHash;
            childHashes[i] = childHash;
            totalAmount += amounts[i];
        }
        
        // Verify total amount matches parent's remaining amount
        require(totalAmount == parentState.remainingAmount, "Invalid split amounts");
        
        // Update parent order with child references
        for (uint256 i = 0; i < childHashes.length; i++) {
            parentState.childOrders.push(childHashes[i]);
        }
        
        emit OrderSplit(orderHash, childHashes, amounts, secretHash);
        return childHashes;
    }
    
    /**
     * @notice Process refund for an unfilled order portion
     * @param orderHash The hash of the order to refund
     * @param refundRecipient The address to receive the refund
     * @param secretHash The secret hash for cross-chain coordination
     */
    function processRefund(
        bytes32 orderHash,
        address refundRecipient,
        bytes32 secretHash
    ) external override onlyOwner nonReentrant returns (bool) {
        OrderState storage orderState = _orderStates[orderHash];
        require(!orderState.isFullyFilled, "Order is fully filled");
        require(!orderState.isCancelled, "Order already cancelled");
        require(orderState.remainingAmount > 0, "No amount to refund");
        
        // Mark order as cancelled to prevent further fills
        orderState.isCancelled = true;
        
        // In a real implementation, this would transfer the tokens back to the refundRecipient
        // For now, we'll just emit an event
        emit RefundIssued(
            refundRecipient,
            address(0), // token address (0 for native token)
            orderState.remainingAmount,
            orderHash,
            secretHash
        );
        
        return true;
    }
    
    /**
     * @notice Get the current state of an order
     * @param orderHash The hash of the order
     */
    function getOrderState(
        bytes32 orderHash
    ) external view override returns (OrderState memory) {
        return _orderStates[orderHash];
    }
    
    /**
     * @notice Get fill history for an order
     * @param orderHash The hash of the order
     */
    function getFillHistory(
        bytes32 orderHash
    ) external view override returns (FillDetails[] memory) {
        return _fillHistory[orderHash];
    }
    
    /**
     * @notice Get child orders for a parent order
     * @param orderHash The hash of the parent order
     */
    function getChildOrders(
        bytes32 orderHash
    ) external view override returns (bytes32[] memory) {
        return _childOrders[orderHash];
    }
    
    function _handleNearDeposit(
        IBaseEscrow.Immutables memory immutables,
        bytes32 secret
    ) internal {
        // Get the actual values from the immutables
        address taker = AddressLib.get(immutables.taker);
        uint256 amount = immutables.amount;
        
        // Verify the deposit amount meets minimum requirements
        require(amount >= MIN_NEAR_DEPOSIT, "Deposit amount too low");
        
        // Generate a unique key for this deposit
        bytes32 secretHash = keccak256(abi.encodePacked(secret));
        
        // Store the NEAR deposit details
        NearDeposit memory newDeposit = NearDeposit({
            sender: taker,
            nearRecipient: string(abi.encodePacked(taker)),
            amount: amount,
            secretHash: secretHash,
            timelock: block.timestamp + 24 hours, // 24-hour timelock
            withdrawn: false
        });
        nearDeposits[secretHash] = newDeposit;
        
        // Emit event for off-chain services to pick up
        emit NearDepositInitiated(
            taker,
            string(abi.encodePacked(taker)), // Using taker as recipient for NEAR
            amount,
            secretHash,
            block.timestamp + 24 hours
        );
    }
    
    /**
     * @dev Function to complete a NEAR withdrawal
     * @param secret The secret that was used to create the hashlock
     * @param nearRecipient The NEAR account that will receive the funds
     */
    function completeNearWithdrawal(
        bytes32 secret,
        string calldata nearRecipient
    ) external {
        bytes32 secretHash = keccak256(abi.encodePacked(secret));
        NearDeposit storage deposit = nearDeposits[secretHash];
        
        // Verify the deposit exists and hasn't been withdrawn
        require(deposit.amount > 0, "Deposit not found");
        require(!deposit.withdrawn, "Already withdrawn");
        require(block.timestamp <= deposit.timelock, "Timelock expired");
        
        // Mark as withdrawn to prevent reentrancy
        deposit.withdrawn = true;
        
        // Transfer the funds to the NEAR bridge contract
        // In a real implementation, this would interact with the NEAR bridge
        // For now, we'll just emit an event
        emit NearWithdrawalCompleted(
            secretHash,
            nearRecipient,
            deposit.amount
        );
    }
    
    /**
     * @dev Function to refund a NEAR deposit after the timelock expires
     * @param secretHash The hash of the secret used for the deposit
     */
    function refundNearDeposit(bytes32 secretHash) external {
        NearDeposit storage deposit = nearDeposits[secretHash];
        
        // Verify the deposit exists and hasn't been withdrawn
        require(deposit.amount > 0, "Deposit not found");
        require(!deposit.withdrawn, "Already withdrawn");
        require(block.timestamp > deposit.timelock, "Timelock not expired");
        
        // Mark as withdrawn to prevent reentrancy
        deposit.withdrawn = true;
        
        // In a real implementation, transfer the funds back to the original sender
        // For now, we'll just emit an event
        emit NearRefunded(
            secretHash,
            deposit.nearRecipient,
            deposit.amount
        );
    }
    
    // Constants for NEAR integration
    address public constant NEAR_BRIDGE = 0x3fEFc5a022BF1f57d3d1FDd5Cc20C42e467e4bEe; // Fixed checksum address
    string public constant NEAR_TOKEN_CONTRACT = "wrap.near"; // NEAR token contract on NEAR
    using ImmutablesLib for IBaseEscrow.Immutables;
    using TimelocksLib for Timelocks;


    IEscrowFactory private immutable _FACTORY;
    IOrderMixin private immutable _LOP;

    constructor(IEscrowFactory factory, IOrderMixin lop, address initialOwner) Ownable(initialOwner) {
        _FACTORY = factory;
        _LOP = lop;
    }

    receive() external payable {} // solhint-disable-line no-empty-blocks

    /**
     * @notice Initiate a deposit to NEAR bridge
     * @param nearRecipient NEAR account ID of the recipient
     * @param secretHash Hash of the secret for atomic swap
     * @param timelock Timestamp until which the deposit is locked
     */
    function depositToNear(
        string calldata nearRecipient,
        bytes32 secretHash,
        uint256 timelock
    ) external payable {
        require(msg.value > 0, "Resolver: amount must be greater than 0");
        require(timelock > block.timestamp, "Resolver: invalid timelock");
        
        // Store the deposit information
        bytes32 depositKey = keccak256(abi.encodePacked(block.chainid, nearRecipient));
        // Create a new NearDeposit struct
        NearDeposit memory newDeposit = NearDeposit({
            sender: msg.sender,  // The caller is the taker
            nearRecipient: nearRecipient,  // The NEAR recipient address
            amount: msg.value,  // The amount being deposited
            secretHash: bytes32(0),  // Will be set when the secret is revealed
            timelock: block.timestamp + 24 hours,  // 24-hour timelock
            withdrawn: false
        });
        nearDeposits[depositKey] = newDeposit;
        
        // Convert NEAR amount (1e24 yoctoNEAR = 1 NEAR)
        uint128 nearAmount = uint128(msg.value / 1e10); // Convert wei to yoctoNEAR (1e24)
        
        // Emit event for the relayer to pick up
        emit NearDepositInitiated(
            msg.sender,
            nearRecipient,
            msg.value,
            secretHash,
            timelock
        );
        
        // In a real implementation, this would interact with the NEAR bridge contract
        // For now, we'll just emit an event and the relayer will handle the actual bridge interaction
    }
    
    /**
     * @notice Complete a withdrawal from NEAR bridge
     * @param proofData Proof data from NEAR bridge
     * @param blockHeaderLite NEAR block header lite
     * @param blockProof Proof of block header
     * @param recipient Ethereum address to receive the funds
     * @param amount Amount to withdraw
     */
    function completeNearWithdrawal(
        bytes calldata proofData,
        bytes calldata blockHeaderLite,
        bytes calldata blockProof,
        address payable recipient,
        uint256 amount
    ) external onlyOwner {
        // In a real implementation, this would verify the proof and withdraw from the bridge
        // For now, we'll just transfer the funds to the recipient
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Resolver: transfer failed");
    }
    
    /**
     * @notice Refund a NEAR deposit
     * @param nearRecipient Original NEAR recipient
     * @param secretHash Hash of the secret used for the deposit
     */
    function refundNearDeposit(
        string calldata nearRecipient,
        bytes32 secretHash
    ) external onlyOwner {
        bytes32 depositKey = keccak256(abi.encodePacked(block.chainid, nearRecipient));
        require(nearDeposits[depositKey].sender != address(0), "Resolver: no active deposit");
        
        // Emit refund event
        emit NearRefunded(
            secretHash,
            nearRecipient,
            address(this).balance // In a real implementation, this would be the actual deposit amount
        );
        
        // Clean up
        delete nearDeposits[depositKey];
    }

    /**
     * @notice See {IResolverExample-deploySrc}.
     */
    function deploySrc(
        IBaseEscrow.Immutables calldata immutables,
        IOrderMixin.Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        TakerTraits takerTraits,
        bytes calldata args
    ) external override onlyOwner {
        // For NEAR integration, we need to handle deposits differently
        // Since chainId is not directly available in immutables, we'll use a different approach
        // to identify NEAR chain transactions. For now, we'll use a flag in the args parameter.
        if (args.length > 0 && args[0] == 0x01) {  // First byte of args is 0x01 for NEAR
            // Generate a new secret using keccak256 of the current block timestamp and the sender's address
            bytes32 newSecret = keccak256(abi.encodePacked(block.timestamp, msg.sender));
            _handleNearDeposit(immutables, newSecret);
            return;
        }

        IBaseEscrow.Immutables memory immutablesMem = immutables;
        immutablesMem.timelocks = TimelocksLib.setDeployedAt(immutables.timelocks, block.timestamp);
        address computed = _FACTORY.addressOfEscrowSrc(immutablesMem);

        (bool success,) = address(computed).call{value: immutablesMem.safetyDeposit}("");
        if (!success) revert IBaseEscrow.NativeTokenSendingFailure();

        // _ARGS_HAS_TARGET = 1 << 251
        takerTraits = TakerTraits.wrap(TakerTraits.unwrap(takerTraits) | uint256(1 << 251));
        bytes memory argsMem = abi.encodePacked(computed, args);
        _LOP.fillOrderArgs(order, r, vs, amount, takerTraits, argsMem);
    }

    /**
     * @notice See {IResolverExample-deployDst}.
     */
    function deployDst(
        IBaseEscrow.Immutables calldata dstImmutables, 
        uint256 srcCancellationTimestamp
    ) external payable override onlyOwner {
        _FACTORY.createDstEscrow{value: msg.value}(dstImmutables, srcCancellationTimestamp);
    }

    /**
     * @notice Withdraw funds from escrow using the secret
     * @param escrow The escrow contract address
     * @param secret The secret to unlock the funds
     * @param immutables Immutable parameters for the escrow
     */
    function withdraw(IEscrow escrow, bytes32 secret, IBaseEscrow.Immutables calldata immutables) external {
        escrow.withdraw(secret, immutables);
        
        // If this is a NEAR-related withdrawal, emit an event
        address taker = AddressLib.get(immutables.taker);
        address token = AddressLib.get(immutables.token);
        bytes32 depositKey = keccak256(abi.encodePacked(taker, token));
            
        NearDeposit storage deposit = nearDeposits[depositKey];
        if (deposit.sender != address(0)) {
            emit NearWithdrawalCompleted(
                keccak256(abi.encodePacked(secret)),
                deposit.nearRecipient,
                deposit.amount
            );
            
            // Clean up
            delete nearDeposits[depositKey];
        }
    }


    /**
     * @notice Cancel an escrow and handle NEAR-specific cleanup if needed
     * @param escrow The escrow contract address
     * @param immutables Immutable parameters for the escrow
     */
    function cancel(IEscrow escrow, IBaseEscrow.Immutables calldata immutables) external {
        escrow.cancel(immutables);
        
        // If this is a NEAR-related escrow, emit refund event
        // Create a deposit key using the taker and token addresses
        address taker = AddressLib.get(immutables.taker);
        address token = AddressLib.get(immutables.token);
        bytes32 depositKey = keccak256(abi.encodePacked(taker, token));
            
        // Check if deposit exists
        if (nearDeposits[depositKey].sender != address(0)) {
            // Get the deposit details from storage
            NearDeposit storage deposit = nearDeposits[depositKey];
            emit NearRefunded(
                depositKey,
                deposit.nearRecipient,
                deposit.amount
            );
            
            // Clean up
            delete nearDeposits[depositKey];
        }
    }

    /**
     * @notice See {IResolverExample-arbitraryCalls}.
     */
    function arbitraryCalls(address[] calldata targets, bytes[] calldata arguments) external override onlyOwner {
        uint256 length = targets.length;
        if (targets.length != arguments.length) revert LengthMismatch();
        for (uint256 i = 0; i < length; ++i) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = targets[i].call(arguments[i]);
            if (!success) RevertReasonForwarder.reRevert();
        }
    }
}
