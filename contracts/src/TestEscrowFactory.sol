// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
import "@1inch/solidity-utils/contracts/libraries/AddressLib.sol";
import "../lib/cross-chain-swap/contracts/EscrowFactory.sol";
import "../lib/cross-chain-swap/contracts/libraries/ImmutablesLib.sol";
import "../lib/cross-chain-swap/contracts/libraries/TimelocksLib.sol";
import "../lib/cross-chain-swap/contracts/interfaces/IBaseEscrow.sol";

/**
 * @title TestEscrowFactory with NEAR Protocol Support
 * @dev Extends the base EscrowFactory to support NEAR Protocol integration
 */
contract TestEscrowFactory is EscrowFactory, Ownable {
    // NEAR-specific events
    event NearEscrowCreated(
        address indexed escrowAddress,
        string nearRecipient,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );
    
    // NEAR chain ID (following EIP-155)
    uint256 public constant NEAR_CHAIN_ID = 397;
    
    // Mapping to track NEAR escrows
    mapping(address => bool) public nearEscrows;
    
    // NEAR account ID validation constants
    uint8 public constant MIN_NEAR_ACCOUNT_LENGTH = 2;
    uint8 public constant MAX_NEAR_ACCOUNT_LENGTH = 64;
    bytes1 public constant NEAR_ACCOUNT_SEPARATOR = bytes1('.');

    constructor(
        address limitOrderProtocol,
        IERC20 feeToken,
        IERC20 accessToken,
        address owner,
        uint32 rescueDelaySrc,
        uint32 rescueDelayDst
    ) Ownable(owner) EscrowFactory(limitOrderProtocol, feeToken, accessToken, owner, rescueDelaySrc, rescueDelayDst) {
        // Ownership is already set by Ownable(owner)
    }
    
    /**
     * @notice Creates a destination escrow and adds NEAR-specific logic
     * @param dstImmutables The immutable parameters for the destination escrow
     * @param srcCancellationTimestamp The timestamp when the source escrow can be cancelled
     */
    function createDstEscrow(
        IBaseEscrow.Immutables calldata dstImmutables,
        uint256 srcCancellationTimestamp
    ) external payable override {
        // Call the parent contract's createDstEscrow function
        // We need to use a low-level call to avoid the external visibility issue with super
        (bool success, ) = address(this).delegatecall(
            abi.encodeWithSelector(
                BaseEscrowFactory.createDstEscrow.selector,
                dstImmutables,
                srcCancellationTimestamp
            )
        );
        require(success, "Failed to create destination escrow");
        
        // Get the escrow address using the same logic as the parent
        bytes32 salt = ImmutablesLib.hash(dstImmutables);
        bytes32 creationCode = _PROXY_DST_BYTECODE_HASH;
        address escrow = Create2.computeAddress(salt, creationCode);
        
        // Check if this is a NEAR-related escrow by validating the taker address as a NEAR account ID
        string memory takerAddress = string(abi.encodePacked(AddressLib.get(dstImmutables.taker)));
        
        if (isValidNearAccount(takerAddress)) {
            nearEscrows[escrow] = true;
            
            // Emit event for NEAR escrow creation
            emit NearEscrowCreated(
                escrow,
                takerAddress,
                dstImmutables.amount,
                dstImmutables.hashlock,
                block.timestamp + TimelocksLib.get(dstImmutables.timelocks, TimelocksLib.Stage.DstWithdrawal)
            );
        }
    }
    
    /**
     * @notice Check if an escrow is for NEAR Protocol
     * @param escrow The escrow contract address to check
     * @return bool True if the escrow is for NEAR Protocol
     */
    function isNearEscrow(address escrow) external view returns (bool) {
        return nearEscrows[escrow];
    }
    
    /**
     * @notice Validate if a string is a valid NEAR account ID
     * @dev NEAR account IDs must be 2-64 characters long, can contain lowercase alphanumeric characters,
     *      separated by dots (.), and cannot start or end with a dot or have consecutive dots.
     * @param accountId The account ID to validate
     * @return bool True if the account ID is valid
     */
    function isValidNearAccount(string memory accountId) public pure returns (bool) {
        bytes memory accountBytes = bytes(accountId);
        uint256 length = accountBytes.length;
        
        // Check length constraints
        if (length < MIN_NEAR_ACCOUNT_LENGTH || length > MAX_NEAR_ACCOUNT_LENGTH) {
            return false;
        }
        
        // Check if the first or last character is a dot
        if (accountBytes[0] == NEAR_ACCOUNT_SEPARATOR || accountBytes[length - 1] == NEAR_ACCOUNT_SEPARATOR) {
            return false;
        }
        
        bool hasDot = false;
        
        // Iterate through each character in the account ID
        for (uint256 i = 0; i < length; i++) {
            bytes1 char = accountBytes[i];
            
            // Check for valid characters (lowercase alphanumeric or dot)
            if (
                !(char >= 0x30 && char <= 0x39) && // 0-9
                !(char >= 0x61 && char <= 0x7A) &&  // a-z
                char != 0x5F &&                     // _
                char != NEAR_ACCOUNT_SEPARATOR      // .
            ) {
                return false;
            }
            
            // Check for consecutive dots
            if (char == NEAR_ACCOUNT_SEPARATOR) {
                if (hasDot) {
                    return false; // Consecutive dots
                }
                hasDot = true;
            } else {
                hasDot = false;
            }
        }
        
        return true;
    }
    
    /**
     * @dev Function to handle NEAR-specific deposit logic
     * @param escrow The address of the NEAR escrow
     * @param nearRecipient The NEAR account that will receive the funds
     * @param amount The amount of tokens to deposit
     * @param secretHash The hash of the secret used for the hashlock
     * @param timelock The timestamp when the deposit can be refunded
     */
    function handleNearDeposit(
        address escrow,
        string calldata nearRecipient,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    ) external onlyOwner {
        require(nearEscrows[escrow], "Not a NEAR escrow");
        
        // Additional validation can be added here
        require(amount > 0, "Invalid amount");
        require(timelock > block.timestamp, "Invalid timelock");
        
        // Emit event for off-chain services to pick up
        emit NearEscrowCreated(
            escrow,
            nearRecipient,
            amount,
            secretHash,
            timelock
        );
    }
}
