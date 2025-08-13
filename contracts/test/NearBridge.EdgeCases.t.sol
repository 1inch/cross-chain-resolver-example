// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/NearBridge.sol";
import "../src/adapters/TokenAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// Mock ERC20 token for testing
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Malicious token that fails on transfer
contract MaliciousToken is ERC20 {
    bool public shouldFail = false;
    
    constructor() ERC20("Malicious", "MAL") {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
    
    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }
    
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (shouldFail) {
            return false;
        }
        return super.transfer(to, amount);
    }
    
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (shouldFail) {
            return false;
        }
        return super.transferFrom(from, to, amount);
    }
}

// Token with no return value (some ERC20s don't return bool)
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    string public name = "NoReturn";
    string public symbol = "NRT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    
    constructor() {
        totalSupply = 1000000 * 10 ** decimals;
        balanceOf[msg.sender] = totalSupply;
    }
    
    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
    
    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
    }
    
    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }
}

contract NearBridgeEdgeCasesTest is Test {
    using ECDSA for bytes32;
    
    NearBridge public bridge;
    TokenAdapter public adapter;
    MockToken public token;
    MaliciousToken public maliciousToken;
    NoReturnToken public noReturnToken;
    
    // Test accounts
    address public deployer;
    address public user;
    address public user2;
    address public relayer1;
    address public relayer2;
    address public relayer3;
    address public nonRelayer;
    
    // Private keys for signing
    uint256 _relayer1Key = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    uint256 _relayer2Key = 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890;
    uint256 _relayer3Key = 0x1111111111111111111111111111111111111111111111111111111111111111;
    
    // Test constants
    uint256 public constant INITIAL_BALANCE = 1000 * 10 ** 18;
    uint256 public constant DEPOSIT_AMOUNT = 100 * 10 ** 18;
    string public constant NEAR_ACCOUNT = "test.near";
    
    event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp);
    event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp);
    event DisputeInitiated(bytes32 indexed depositId, address indexed initiator, uint256 timestamp);
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);
    event BridgeStatusUpdated(NearBridge.BridgeStatus status);
    
    function setUp() public {
        // Set up accounts
        deployer = address(this);
        user = address(0x2);
        user2 = address(0x3);
        relayer1 = vm.addr(_relayer1Key);
        relayer2 = vm.addr(_relayer2Key);
        relayer3 = vm.addr(_relayer3Key);
        nonRelayer = address(0x999);
        
        // Deploy tokens
        token = new MockToken("Test Token", "TEST");
        maliciousToken = new MaliciousToken();
        noReturnToken = new NoReturnToken();
        
        // Deploy adapter
        adapter = new TokenAdapter(deployer);
        
        // Deploy bridge with correct constructor parameters
        bridge = new NearBridge(
            deployer,                    // _owner
            address(token),             // _feeToken  
            address(0),                 // _accessToken (optional)
            deployer,                   // _feeCollector
            1 * 10 ** 18,              // _minDeposit (1 token)
            1000 * 10 ** 18,           // _maxDeposit (1000 tokens)
            7 days,                     // _disputePeriod
            30,                         // _bridgeFeeBps (0.3%)
            NearBridge.BridgeStatus.ACTIVE // _initialStatus
        );
        
        // Set up supported tokens (they're added in constructor for feeToken)
        // Add additional tokens as supported
        bridge.setSupportedToken(address(maliciousToken), true);
        
        // Add relayers to bridge
        bridge.addRelayer(relayer1);
        bridge.addRelayer(relayer2);
        bridge.addRelayer(relayer3);
        
        // Fund test accounts
        token.transfer(user, INITIAL_BALANCE);
        token.transfer(user2, INITIAL_BALANCE);
        maliciousToken.transfer(user, INITIAL_BALANCE);
        
        // Give users some ETH for gas
        vm.deal(user, 10 ether);
        vm.deal(user2, 10 ether);
    }
    
    // ============ Deposit Edge Cases ============
    
    function test_DepositWithZeroAmount() public {
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.expectRevert("Amount below minimum");
        bridge.depositToken(
            address(token),
            0,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    function test_DepositWithInvalidToken() public {
        vm.startPrank(user);
        
        vm.expectRevert("Token not supported");
        bridge.depositToken(
            address(0x123), // unregistered token
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    function test_DepositWithEmptyNearAccount() public {
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.expectRevert("Invalid recipient");
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            "", // empty near account
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    function test_DepositWithPastTimelock() public {
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.expectRevert("Invalid timelock");
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp - 1 // past timelock
        );
        vm.stopPrank();
    }
    
    function test_DepositWithInsufficientAllowance() public {
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT - 1); // insufficient allowance
        
        vm.expectRevert();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    function test_DepositWithInsufficientBalance() public {
        vm.startPrank(user2);
        // user2 has balance but let's drain it first
        token.transfer(user, token.balanceOf(user2));
        
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.expectRevert();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    function test_DepositWhenBridgePaused() public {
        // Ensure token is supported first
        bridge.setSupportedToken(address(token), true);
        
        // Pause the bridge
        bridge.updateBridgeStatus(NearBridge.BridgeStatus.PAUSED);
        
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.expectRevert("Bridge is not active");
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    function test_DepositExceedsMaxAmount() public {
        vm.startPrank(user);
        uint256 excessiveAmount = 2000 * 10 ** 18; // Exceeds maxDepositAmount of 1000
        token.mint(user, excessiveAmount);
        token.approve(address(bridge), excessiveAmount);
        
        vm.expectRevert("Amount exceeds maximum");
        bridge.depositToken(
            address(token),
            excessiveAmount,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    // ============ ETH Deposit Edge Cases ============
    
    function test_DepositETHWithZeroValue() public {
        vm.startPrank(user);
        
        vm.expectRevert("Amount below minimum");
        bridge.depositEth{value: 0}(
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    function test_DepositETHExceedsMaxAmount() public {
        vm.startPrank(user);
        uint256 excessiveAmount = 2000 ether; // Exceeds maxDepositAmount
        vm.deal(user, excessiveAmount);
        
        vm.expectRevert("Amount exceeds maximum");
        bridge.depositEth{value: excessiveAmount}(
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    // ============ Withdrawal Edge Cases ============
    
    function test_WithdrawNonexistentDeposit() public {
        bytes32 fakeDepositId = keccak256("fake");
        
        vm.expectRevert("Deposit does not exist");
        bridge.completeWithdrawal(
            fakeDepositId,
            user,
            "secret",
            new bytes[](2)
        );
    }
    
    function test_WithdrawWithWrongSecret() public {
        // Create a deposit first
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("correct-secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1]; // DepositInitiated event
        vm.stopPrank();
        
        // Try to withdraw with wrong secret
        bytes[] memory signatures = _generateValidSignatures(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000));
        
        vm.expectRevert("Invalid secret");
        bridge.completeWithdrawal(
            depositId,
            user,
            "wrong-secret",
            signatures
        );
    }
    
    function test_WithdrawWithInsufficientSignatures() public {
        // Set required confirmations to 2 to test insufficient signatures
        bridge.setRequiredConfirmations(2);
        
        // Create a deposit first
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Generate only 1 signature when 2 are required
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = _generateSingleSignature(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000), _relayer1Key);
        
        vm.expectRevert("Insufficient confirmations");
        bridge.completeWithdrawal(
            depositId,
            user,
            "secret",
            signatures
        );
    }
    
    function test_WithdrawWithInvalidSignatures() public {
        // Create a deposit first
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Generate signatures from non-relayers
        uint256 nonRelayerKey1 = 0x9999999999999999999999999999999999999999999999999999999999999999;
        uint256 nonRelayerKey2 = 0x8888888888888888888888888888888888888888888888888888888888888888;
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _generateSingleSignature(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000), nonRelayerKey1);
        signatures[1] = _generateSingleSignature(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000), nonRelayerKey2);
        
        vm.expectRevert("Insufficient valid signatures");
        bridge.completeWithdrawal(
            depositId,
            user,
            "secret",
            signatures
        );
    }
    
    function test_WithdrawAlreadyClaimedDeposit() public {
        // Create and complete a withdrawal first
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Complete withdrawal once
        bytes[] memory signatures = _generateValidSignatures(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000));
        bridge.completeWithdrawal(depositId, user, "secret", signatures);
        
        // Try to withdraw again - need fresh signatures since nonce incremented
        bytes[] memory freshSignatures = _generateValidSignatures(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000));
        vm.expectRevert("Deposit already claimed");
        bridge.completeWithdrawal(depositId, user, "secret", freshSignatures);
    }
    
    function test_WithdrawDisputedDeposit() public {
        // Create a deposit
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        
        // Initiate dispute
        bridge.initiateDispute(depositId);
        vm.stopPrank();
        
        // Try to withdraw disputed deposit
        bytes[] memory signatures = _generateValidSignatures(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000));
        
        vm.expectRevert("Deposit is in dispute");
        bridge.completeWithdrawal(depositId, user, "secret", signatures);
    }
    
    // ============ Admin Function Edge Cases ============
    
    function test_NonOwnerCannotSetSupportedToken() public {
        vm.prank(user);
        vm.expectRevert();
        bridge.setSupportedToken(address(0x123), true);
    }
    
    function test_SetZeroAddressToken() public {
        vm.expectRevert("Invalid token");
        bridge.setSupportedToken(address(0), true);
    }
    
    function test_NonOwnerCannotUpdateBridgeStatus() public {
        vm.prank(user);
        vm.expectRevert();
        bridge.setSupportedToken(address(token), false);
    }
    
    // ============ Dispute Edge Cases ============
    
    function test_NonDepositorCannotInitiateDispute() public {
        // Create a deposit as user
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Try to initiate dispute as different user
        vm.prank(user2);
        vm.expectRevert("Not the depositor");
        bridge.initiateDispute(depositId);
    }
    
    function test_DisputeAlreadyClaimedDeposit() public {
        // Create and complete a withdrawal
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Complete withdrawal
        bytes[] memory signatures = _generateValidSignatures(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000));
        bridge.completeWithdrawal(depositId, user, "secret", signatures);
        
        // Try to dispute already claimed deposit
        vm.prank(user);
        vm.expectRevert("Already claimed");
        bridge.initiateDispute(depositId);
    }
    
    function test_DisputeAlreadyDisputedDeposit() public {
        // Create a deposit and dispute it
        vm.startPrank(user);
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        
        bridge.initiateDispute(depositId);
        
        // Try to dispute again
        vm.expectRevert("Already in dispute");
        bridge.initiateDispute(depositId);
        vm.stopPrank();
    }
    
    // ============ Token Adapter Integration Edge Cases ============
    
    function test_DepositWithMaliciousToken() public {
        vm.startPrank(user);
        maliciousToken.approve(address(bridge), DEPOSIT_AMOUNT);
        
        // Set token to fail on transfer
        maliciousToken.setShouldFail(true);
        
        vm.expectRevert();
        bridge.depositToken(
            address(maliciousToken),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("secret")),
            block.timestamp + 1 days
        );
        vm.stopPrank();
    }
    
    // ============ Helper Functions ============
    
    function _generateValidSignatures(bytes32 depositId, address recipient, uint256 amount) internal view returns (bytes[] memory) {
        uint256 currentNonce = bridge.nonces(recipient);
        uint256 deadline = block.timestamp + bridge.MESSAGE_EXPIRY();
        
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Withdraw(bytes32 depositId,address recipient,uint256 amount,uint256 nonce,uint256 deadline)"),
                depositId,
                recipient,
                amount,
                currentNonce,
                deadline
            )
        );
        
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("NearBridge"),
                keccak256("1.0.0"),
                block.chainid,
                address(bridge)
            )
        );
        
        bytes32 messageHash = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        );
        
        bytes[] memory signatures = new bytes[](2);
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(_relayer1Key, messageHash);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(_relayer2Key, messageHash);
        signatures[1] = abi.encodePacked(r2, s2, v2);
        
        return signatures;
    }
    
    function _generateSingleSignature(bytes32 depositId, address recipient, uint256 amount, uint256 privateKey) internal view returns (bytes memory) {
        uint256 currentNonce = bridge.nonces(recipient);
        uint256 deadline = block.timestamp + bridge.MESSAGE_EXPIRY();
        
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Withdraw(bytes32 depositId,address recipient,uint256 amount,uint256 nonce,uint256 deadline)"),
                depositId,
                recipient,
                amount,
                currentNonce,
                deadline
            )
        );
        
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("NearBridge"),
                keccak256("1.0.0"),
                block.chainid,
                address(bridge)
            )
        );
        
        bytes32 messageHash = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, messageHash);
        return abi.encodePacked(r, s, v);
    }
}
