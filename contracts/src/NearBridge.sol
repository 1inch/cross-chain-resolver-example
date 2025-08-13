// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title NearBridge - Bridge contract for Ethereum to NEAR cross-chain transfers
 * @dev Handles asset custody, message verification, and dispute resolution for cross-chain swaps
 */
/// @custom:security-contact security@example.com
contract NearBridge is Ownable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;
    
    // EIP-712 type hashes for structured data signing
    bytes32 private constant _WITHDRAW_TYPEHASH = 
        keccak256("Withdraw(bytes32 depositId,address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
    
    // Domain separator for EIP-712
    string private constant _NAME = "NearBridge";
    string private constant _VERSION = "1.0.0";
    
    // Message status enum
    enum MessageStatus { PENDING, PROCESSED, FAILED }
    
    // Message structure for cross-chain communication
    struct Message {
        bytes32 id;
        address sender;
        address recipient;
        uint256 amount;
        bytes32 depositId;
        uint256 timestamp;
        MessageStatus status;
        uint256 retryCount;
        uint256 lastProcessed;
    }
    using SafeERC20 for IERC20;

    // NEAR chain ID (following EIP-155)
    uint256 public constant NEAR_CHAIN_ID = 397;
    
    // Bridge status enum
    enum BridgeStatus { ACTIVE, PAUSED, DISPUTE }
    
    // Bridge status state variable
    BridgeStatus public status;
    
    // Modifier to check if bridge is active
    modifier whenActive() {
        require(status == BridgeStatus.ACTIVE, "Bridge is not active");
        _;
    }
    
    // Bridge configuration
    struct BridgeConfig {
        address feeCollector;          // Address to collect bridge fees
        uint256 minDeposit;            // Minimum deposit amount
        uint256 maxDeposit;            // Maximum deposit amount
        uint256 disputePeriod;         // Time period for dispute resolution (in seconds)
        uint256 bridgeFeeBps;          // Bridge fee in basis points (1/10000)
        BridgeStatus status;           // Current bridge status
    }
    
    // Deposit data structure
    struct Deposit {
        address token;                 // Token address (address(0) for native ETH)
        address depositor;             // Address that made the deposit
        string nearRecipient;          // NEAR account ID of the recipient
        uint256 amount;                // Deposit amount
        uint256 timestamp;             // Deposit timestamp
        bool claimed;                  // Whether the deposit has been claimed
        bool disputed;                 // Whether the deposit is in dispute
        uint256 disputeEndTime;        // Timestamp when dispute period ends
        bytes32 secretHash;            // Hash of the secret for claim verification
        uint256 timelock;              // Timestamp when the deposit can be withdrawn
    }
    
    // State variables
    BridgeConfig public config;
    mapping(bytes32 => Deposit) public deposits;  // depositId => Deposit
    mapping(address => bool) public relayers;     // Trusted relayers
    mapping(address => bool) public supportedTokens;  // Supported ERC20 tokens
    mapping(bytes32 => Message) public messages;  // messageId => Message
    mapping(address => uint256) public nonces;    // Nonces for replay protection
    mapping(bytes32 => bool) public processedMessages; // Track processed message hashes
    
    // Message processing parameters
    uint256 public constant MAX_RETRIES = 3;
    uint256 public constant MESSAGE_EXPIRY = 1 weeks;
    uint256 public constant MIN_RELAYERS = 1; // Minimum number of relayers required for critical operations
    
    // Relayer set management
    address[] public relayerList;
    uint256 public requiredRelayerConfirmations = 1; // Number of relayers required to confirm a message
    
    // Events
    event DepositInitiated(
        bytes32 indexed depositId,
        address indexed sender,
        string nearRecipient,
        address token,
        uint256 amount,
        uint256 fee,
        uint256 timestamp
    );
    
    event WithdrawalCompleted(
        bytes32 indexed depositId,
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );
    
    event Claimed(
        bytes32 indexed depositId,
        address indexed claimer,
        uint256 amount
    );
    
    event DisputeInitiated(
        bytes32 indexed depositId,
        address indexed initiator,
        uint256 timestamp
    );
    
    event DisputeResolved(
        bytes32 indexed depositId,
        bool resolvedInFavorOfClaimant,
        uint256 timestamp
    );
    
    event MessageSent(
        bytes32 indexed messageId,
        bytes32 indexed depositId,
        address indexed sender,
        address recipient,
        uint256 amount,
        uint256 timestamp
    );
    
    event MessageProcessed(
        bytes32 indexed messageId,
        MessageStatus status,
        uint256 timestamp
    );
    
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);
    event RequiredConfirmationsUpdated(uint256 requiredConfirmations);
    event BridgeStatusUpdated(BridgeStatus newStatus);
    
    event BridgeConfigUpdated(BridgeConfig newConfig);
    event RelayerUpdated(address indexed relayer, bool isActive);
    event TokenSupportUpdated(address indexed token, bool isSupported);
    
    /**
     * @dev Constructor
     * @param _owner Initial owner of the contract
     * @param _feeToken Address of the token used for fees
     * @param _accessToken Address of the access token (optional)
     * @param _feeCollector Address to collect bridge fees
     * @param _minDeposit Minimum deposit amount
     * @param _maxDeposit Maximum deposit amount
     * @param _disputePeriod Dispute period in seconds
     * @param _bridgeFeeBps Bridge fee in basis points (1/10000)
     * @param _initialStatus Initial bridge status
     */
    constructor(
        address _owner,
        address _feeToken,
        address _accessToken,
        address _feeCollector,
        uint256 _minDeposit,
        uint256 _maxDeposit,
        uint256 _disputePeriod,
        uint256 _bridgeFeeBps,
        BridgeStatus _initialStatus
    ) Ownable(_owner) EIP712(_NAME, _VERSION) {
        require(_feeToken != address(0), "Invalid fee token");
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_minDeposit <= _maxDeposit, "Invalid deposit limits");
        require(_bridgeFeeBps <= 10000, "Invalid fee basis points");
        
        status = _initialStatus;
        config = BridgeConfig({
            feeCollector: _feeCollector,
            minDeposit: _minDeposit,
            maxDeposit: _maxDeposit,
            disputePeriod: _disputePeriod,
            bridgeFeeBps: _bridgeFeeBps,
            status: _initialStatus
        });
        
        // Set initial supported tokens
        supportedTokens[_feeToken] = true;
        if (_accessToken != address(0)) {
            supportedTokens[_accessToken] = true;
        }
        
        // Add deployer as initial relayer
        _addRelayer(_owner);
    }
    
    // ============ User Functions ============
    
    /**
     * @dev Deposit native ETH to bridge to NEAR
     * @param nearRecipient NEAR account ID of the recipient
     * @param secretHash Hash of the secret for the hashlock
     * @param timelock Timestamp when the deposit can be refunded
     */
    function depositEth(
        string calldata nearRecipient,
        bytes32 secretHash,
        uint256 timelock
    ) external payable nonReentrant whenActive {
        require(msg.value >= config.minDeposit, "Amount below minimum");
        require(msg.value <= config.maxDeposit, "Amount exceeds maximum");
        
        _processDeposit(address(0), msg.value, nearRecipient, secretHash, timelock);
    }
    
    /**
     * @dev Deposit ERC20 tokens to bridge to NEAR
     * @param token ERC20 token address
     * @param amount Amount to deposit
     * @param nearRecipient NEAR account ID of the recipient
     * @param secretHash Hash of the secret for the hashlock
     * @param timelock Timestamp when the deposit can be refunded
     */
    function depositToken(
        address token,
        uint256 amount,
        string calldata nearRecipient,
        bytes32 secretHash,
        uint256 timelock
    ) external nonReentrant whenActive {
        require(supportedTokens[token], "Token not supported");
        require(amount >= config.minDeposit, "Amount below minimum");
        require(amount <= config.maxDeposit, "Amount exceeds maximum");
        
        // Transfer tokens from user to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        _processDeposit(token, amount, nearRecipient, secretHash, timelock);
    }
    
    /**
     * @dev Claim tokens after they've been bridged back from NEAR
     * @param depositId Unique deposit ID
     * @param secret Secret for the hashlock
     */
    function claim(bytes32 depositId, bytes32 secret) external nonReentrant whenActive {
        Deposit storage depositInfo = deposits[depositId];
        require(depositInfo.depositor != address(0), "Deposit does not exist");
        require(!depositInfo.claimed, "Already claimed");
        require(!depositInfo.disputed, "Deposit is in dispute");
        
        // Verify the secret matches the stored hash
        require(keccak256(abi.encodePacked(secret)) == depositInfo.secretHash, "Invalid secret");
        
        // Mark as claimed
        depositInfo.claimed = true;
        
        // Transfer tokens to the claimer
        if (depositInfo.token == address(0)) {
            (bool sent, ) = msg.sender.call{value: depositInfo.amount}("");
            require(sent, "Failed to send ETH");
        } else {
            IERC20(depositInfo.token).safeTransfer(msg.sender, depositInfo.amount);
        }
        
        emit Claimed(depositId, msg.sender, depositInfo.amount);
    }
    
    /**
     * @dev Complete withdrawal from NEAR to Ethereum
     * @param depositId ID of the deposit to withdraw
     * @param recipient Address to receive the withdrawn tokens
     * @param secret The secret that hashes to the secretHash
     * @param signatures Array of relayer signatures for this withdrawal
     */
    function completeWithdrawal(
        bytes32 depositId,
        address recipient,
        string calldata secret,
        bytes[] calldata signatures
    ) external nonReentrant whenActive {
        Deposit storage depositInfo = deposits[depositId];
        require(depositInfo.depositor != address(0), "Deposit does not exist");
        require(!depositInfo.claimed, "Deposit already claimed");
        require(!depositInfo.disputed, "Deposit is in dispute");
        require(recipient != address(0), "Invalid recipient");
        require(signatures.length >= requiredRelayerConfirmations, "Insufficient confirmations");
        
        // Verify secret
        require(
            keccak256(abi.encodePacked(secret)) == depositInfo.secretHash,
            "Invalid secret"
        );
        
        // Verify signatures
        bytes32 messageHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _WITHDRAW_TYPEHASH,
                    depositId,
                    recipient,
                    depositInfo.amount,
                    nonces[recipient]++,
                    block.timestamp + MESSAGE_EXPIRY
                )
            )
        );
        
        address[] memory confirmedRelayers = new address[](signatures.length);
        uint256 validSignatures = 0;
        
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(messageHash, signatures[i]);
            if (relayers[signer] && !_isConfirmed(signer, confirmedRelayers, validSignatures)) {
                confirmedRelayers[validSignatures] = signer;
                validSignatures++;
            }
        }
        
        require(validSignatures >= requiredRelayerConfirmations, "Insufficient valid signatures");
        
        // Mark as claimed
        depositInfo.claimed = true;
        
        // Transfer tokens to recipient
        if (depositInfo.token == address(0)) {
            (bool sent, ) = recipient.call{value: depositInfo.amount}("");
            require(sent, "Failed to send ETH");
        } else {
            IERC20(depositInfo.token).safeTransfer(recipient, depositInfo.amount);
        }
        
        emit WithdrawalCompleted(
            depositId,
            recipient,
            depositInfo.amount,
            block.timestamp
        );
    }
    
    /**
     * @dev Initiate a dispute for a deposit
     * @param depositId Unique deposit ID
     */
    function initiateDispute(bytes32 depositId) external {
        Deposit storage deposit = deposits[depositId];
        require(deposit.depositor == msg.sender, "Not the depositor");
        require(!deposit.claimed, "Already claimed");
        require(!deposit.disputed, "Already in dispute");
        
        deposit.disputed = true;
        deposit.disputeEndTime = block.timestamp + config.disputePeriod;
        
        emit DisputeInitiated(depositId, msg.sender, block.timestamp);
    }
    
    // ============ Admin Functions ============
    
    /**
     * @dev Update bridge status (owner only)
     * @param newStatus New bridge status
     */
    function updateBridgeStatus(BridgeStatus newStatus) external onlyOwner {
        require(uint256(newStatus) < 3, "Invalid status");
        
        // Additional checks for specific status changes
        if (newStatus == BridgeStatus.PAUSED) {
            require(config.status != BridgeStatus.DISPUTE, "Cannot pause while in dispute");
        } else if (newStatus == BridgeStatus.ACTIVE) {
            require(relayerList.length >= requiredRelayerConfirmations, "Not enough relayers");
        }
        
        status = newStatus;
        config.status = newStatus;
        emit BridgeStatusUpdated(newStatus);
    }
    
    /**
     * @dev Update bridge configuration (owner only)
     * @param newConfig New bridge configuration
     */
    function updateConfig(BridgeConfig calldata newConfig) external onlyOwner {
        require(newConfig.feeCollector != address(0), "Invalid fee collector");
        require(newConfig.minDeposit < newConfig.maxDeposit, "Invalid deposit limits");
        require(newConfig.bridgeFeeBps < 10000, "Invalid fee");
        
        config = newConfig;
        emit BridgeConfigUpdated(newConfig);
    }
    
    /**
     * @dev Add a new relayer (owner only)
     * @param relayer Address of the relayer to add
     */
    function addRelayer(address relayer) external onlyOwner {
        require(relayer != address(0), "Invalid relayer address");
        require(!relayers[relayer], "Relayer already exists");
        
        _addRelayer(relayer);
    }
    
    /**
     * @dev Remove a relayer (owner only)
     * @param relayer Address of the relayer to remove
     */
    function removeRelayer(address relayer) external onlyOwner {
        require(relayers[relayer], "Relayer does not exist");
        require(relayerList.length > 1, "Cannot remove the last relayer");
        
        // Remove from mapping
        delete relayers[relayer];
        
        // Remove from array
        for (uint256 i = 0; i < relayerList.length; i++) {
            if (relayerList[i] == relayer) {
                relayerList[i] = relayerList[relayerList.length - 1];
                relayerList.pop();
                break;
            }
        }
        
        emit RelayerRemoved(relayer);
    }
    
    /**
     * @dev Set the number of required relayer confirmations (owner only)
     * @param _requiredConfirmations Number of required confirmations
     */
    function setRequiredConfirmations(uint256 _requiredConfirmations) external onlyOwner {
        require(_requiredConfirmations > 0, "At least one confirmation required");
        require(_requiredConfirmations <= relayerList.length, "Not enough relayers");
        
        requiredRelayerConfirmations = _requiredConfirmations;
        emit RequiredConfirmationsUpdated(_requiredConfirmations);
    }
    
    /**
     * @dev Add or remove a supported token (owner only)
     * @param token Token address
     * @param isSupported Whether the token is supported
     */
    function setSupportedToken(address token, bool isSupported) external onlyOwner {
        require(token != address(0), "Invalid token");
        supportedTokens[token] = isSupported;
        emit TokenSupportUpdated(token, isSupported);
    }
    
    // ============ Internal Functions ============
    
    /**
     * @dev Process a deposit and generate a deposit ID
     * @param token Token address (address(0) for native ETH)
     * @param amount Deposit amount
     * @param nearRecipient NEAR account ID of the recipient
     * @param secretHash Hash of the secret for the hashlock
     * @param timelock Timestamp when the deposit can be refunded
     * @return depositId Unique deposit ID
     */
    function _processDeposit(
        address token,
        uint256 amount,
        string calldata nearRecipient,
        bytes32 secretHash,
        uint256 timelock
    ) internal returns (bytes32 depositId) {
        require(bytes(nearRecipient).length > 0, "Invalid recipient");
        require(timelock > block.timestamp, "Invalid timelock");
        
        // Calculate bridge fee
        uint256 fee = (amount * config.bridgeFeeBps) / 10000;
        uint256 amountAfterFee = amount - fee;
        
        // Transfer fee to fee collector if non-zero
        if (fee > 0 && config.feeCollector != address(0)) {
            if (token == address(0)) {
                (bool success, ) = config.feeCollector.call{value: fee}("");
                require(success, "Fee transfer failed");
            } else {
                IERC20(token).safeTransfer(config.feeCollector, fee);
            }
        }
        
        // Generate a unique deposit ID
        depositId = keccak256(
            abi.encodePacked(
                msg.sender,
                nearRecipient,
                token,
                amount,
                secretHash,
                timelock,
                block.timestamp,
                block.chainid
            )
        );
        
        require(deposits[depositId].depositor == address(0), "Deposit already exists");
        
        // Store deposit data - use amountAfterFee since that's what the bridge actually holds
        deposits[depositId] = Deposit({
            token: token,
            depositor: msg.sender,
            nearRecipient: nearRecipient,
            amount: amountAfterFee,  // Store the amount after fees, which is what we can actually withdraw
            timestamp: block.timestamp,
            claimed: false,
            disputed: false,
            disputeEndTime: 0,
            secretHash: secretHash,
            timelock: timelock
        });
        
        emit DepositInitiated(
            depositId,
            msg.sender,
            nearRecipient,
            token,
            amountAfterFee,
            fee,
            block.timestamp
        );
        
        // Create cross-chain message
        bytes32 messageId = _createMessage(
            depositId,
            msg.sender,
            nearRecipient,
            amountAfterFee,
            secretHash
        );
        
        emit MessageSent(
            messageId,
            depositId,
            msg.sender,
            address(0), // Will be set by the relayer
            amountAfterFee,
            block.timestamp
        );
        
        return depositId;
    }
    
    /**
     * @dev Verify a claim using a merkle proof (stub implementation)
     * @param depositId Unique deposit ID
     * @param amount Amount to claim
     * @param proof Merkle proof for verification
     */
    function _verifyClaim(
        bytes32 depositId,
        uint256 amount,
        bytes32[] calldata proof
    ) internal pure {
        // In a real implementation, this would verify the proof against a merkle root
        // stored in the contract and signed by relayers
        // This is a simplified version that always passes
        require(amount > 0, "Invalid amount");
        require(proof.length > 0, "Proof required");
        
        // Verify the proof (simplified)
        bool isValid = false;
        for (uint256 i = 0; i < proof.length; i++) {
            if (proof[i] != bytes32(0)) {
                isValid = true;
                break;
            }
        }
        require(isValid, "Invalid proof");
    }
    
    /**
     * @dev Internal function to add a relayer
     * @param relayer Address of the relayer to add
     */
    function _addRelayer(address relayer) internal {
        require(relayer != address(0), "Invalid relayer address");
        require(!relayers[relayer], "Relayer already exists");
        
        relayers[relayer] = true;
        relayerList.push(relayer);
        
        emit RelayerAdded(relayer);
    }
    
    /**
     * @dev Internal function to create a new cross-chain message
     * @param depositId ID of the related deposit
     * @param sender Address of the message sender
     * @param recipient Recipient address or identifier
     * @param amount Amount of tokens in the message
     * @param data Additional message data
     * @return messageId ID of the created message
     */
    function _createMessage(
        bytes32 depositId,
        address sender,
        string memory recipient,
        uint256 amount,
        bytes32 data
    ) internal returns (bytes32 messageId) {
        messageId = keccak256(
            abi.encodePacked(
                depositId,
                sender,
                recipient,
                amount,
                data,
                block.timestamp,
                block.chainid
            )
        );
        
        messages[messageId] = Message({
            id: messageId,
            sender: sender,
            recipient: address(0), // Will be set by the relayer
            amount: amount,
            depositId: depositId,
            timestamp: block.timestamp,
            status: MessageStatus.PENDING,
            retryCount: 0,
            lastProcessed: 0
        });
        
        return messageId;
    }
    
    /**
     * @dev Internal function to check if an address has already confirmed a message
     * @param relayer Address to check
     * @param confirmedRelayers Array of addresses that have already confirmed
     * @param count Number of valid confirmations
     * @return bool Whether the address has already confirmed
     */
    function _isConfirmed(
        address relayer,
        address[] memory confirmedRelayers,
        uint256 count
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < count; i++) {
            if (confirmedRelayers[i] == relayer) {
                return true;
            }
        }
        return false;
    }
    
    // Allow receiving ETH
    receive() external payable {}
    
    // Fallback function for receiving ETH with data
    fallback() external payable {}
}
