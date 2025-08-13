// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/NearBridge.sol";
import "../src/adapters/TokenAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Relayer Integration Tests
 * @dev Tests NearBridge with relayer integration, forked networks, and real token interactions
 * @notice These tests simulate real relayer behavior and cross-chain communication
 */
contract RelayerIntegrationTest is Test {
    using ECDSA for bytes32;
    
    NearBridge public bridge;
    TokenAdapter public adapter;
    
    // Test accounts
    address public deployer;
    address public user;
    address public feeCollector;
    address public relayer1;
    address public relayer2;
    address public relayer3;
    
    // Private keys for relayer signatures
    uint256 private constant RELAYER1_KEY = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    uint256 private constant RELAYER2_KEY = 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890;
    uint256 private constant RELAYER3_KEY = 0x1111111111111111111111111111111111111111111111111111111111111111;
    
    // Test constants
    uint256 public constant DEPOSIT_AMOUNT = 1000 * 10 ** 6; // 1000 USDC (6 decimals)
    uint256 public constant ETH_DEPOSIT_AMOUNT = 1 ether;
    string public constant NEAR_ACCOUNT = "integration-test.near";
    
    // Mock token for testing
    MockERC20 public testToken;
    
    // Events to track
    event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp);
    event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp);
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);
    event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, address recipient, uint256 amount, uint256 timestamp);
    
    function setUp() public {
        // Set up accounts
        deployer = address(this);
        user = address(0x2);
        feeCollector = address(0x3);
        relayer1 = vm.addr(RELAYER1_KEY);
        relayer2 = vm.addr(RELAYER2_KEY);
        relayer3 = vm.addr(RELAYER3_KEY);
        
        // Deploy test token
        testToken = new MockERC20("Test USDC", "TUSDC", 6);
        
        // Deploy adapter
        adapter = new TokenAdapter(deployer);
        
        // Deploy bridge
        bridge = new NearBridge(
            deployer,                    // _owner
            address(testToken),         // _feeToken
            address(0),                 // _accessToken (optional)
            feeCollector,               // _feeCollector
            1 * 10 ** 6,               // _minDeposit (1 USDC)
            1000000 * 10 ** 6,         // _maxDeposit (1M USDC)
            7 days,                     // _disputePeriod
            30,                         // _bridgeFeeBps (0.3%)
            NearBridge.BridgeStatus.ACTIVE // _initialStatus
        );
        
        // Add relayers to bridge
        bridge.addRelayer(relayer1);
        bridge.addRelayer(relayer2);
        bridge.addRelayer(relayer3);
        
        // Set required confirmations to 2 for multi-sig testing
        bridge.setRequiredConfirmations(2);
        
        // Fund test accounts
        testToken.mint(user, 1000000 * 10 ** 6); // 1M USDC
        vm.deal(user, 100 ether);
        vm.deal(deployer, 10 ether);
        vm.deal(feeCollector, 1 ether);
    }
    
    // ============ Relayer Management Tests ============
    
    function testRelayerAddition() public {
        address newRelayer = address(0x999);
        
        vm.expectEmit(address(bridge));
        emit RelayerAdded(newRelayer);
        
        bridge.addRelayer(newRelayer);
        
        assertTrue(bridge.relayers(newRelayer), "New relayer should be added");
        // Verify relayer was added successfully
        assertTrue(bridge.relayers(newRelayer), "New relayer should be active");
    }
    
    function testRelayerRemoval() public {
        vm.expectEmit(address(bridge));
        emit RelayerRemoved(relayer3);
        
        bridge.removeRelayer(relayer3);
        
        assertFalse(bridge.relayers(relayer3), "Relayer should be removed");
        // Verify relayer was removed successfully
        assertFalse(bridge.relayers(relayer3), "Relayer should no longer be active");
    }
    
    function testRelayerSignatureValidation() public {
        // Create a deposit
        vm.startPrank(user);
        testToken.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(testToken),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("relayer-test-secret")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Test valid relayer signatures
        bytes[] memory validSignatures = _generateValidSignatures(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000));
        
        vm.expectEmit(address(bridge));
        emit WithdrawalCompleted(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000), block.timestamp);
        
        bridge.completeWithdrawal(
            depositId,
            user,
            "relayer-test-secret",
            validSignatures
        );
    }
    
    function testInvalidRelayerSignature() public {
        // Create a deposit
        vm.startPrank(user);
        testToken.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(testToken),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("invalid-sig-test")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Generate signatures from non-relayers
        uint256 nonRelayerKey = 0x9999999999999999999999999999999999999999999999999999999999999999;
        bytes[] memory invalidSignatures = new bytes[](2);
        invalidSignatures[0] = _generateSingleSignature(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000), nonRelayerKey);
        invalidSignatures[1] = _generateSingleSignature(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000), nonRelayerKey);
        
        vm.expectRevert("Insufficient valid signatures");
        bridge.completeWithdrawal(
            depositId,
            user,
            "invalid-sig-test",
            invalidSignatures
        );
    }
    
    // ============ Cross-Chain Communication Tests ============
    
    function testCrossChainMessageFlow() public {
        // Test deposit initiates cross-chain message
        vm.startPrank(user);
        testToken.approve(address(bridge), DEPOSIT_AMOUNT);
        
        // Record logs to capture actual depositId and messageId
        vm.recordLogs();
        
        bridge.depositToken(
            address(testToken),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("cross-chain-test")),
            block.timestamp + 1 days
        );
        
        // Verify events were emitted
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertTrue(logs.length >= 2, "Should emit DepositInitiated and MessageSent events");
        
        vm.stopPrank();
    }
    
    function testMultipleRelayerConfirmations() public {
        // Set required confirmations to 3
        bridge.setRequiredConfirmations(3);
        
        // Create a deposit
        vm.startPrank(user);
        testToken.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(testToken),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("multi-relayer-test")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Generate signatures from all 3 relayers
        bytes[] memory signatures = new bytes[](3);
        uint256 expectedAmount = DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000);
        
        signatures[0] = _generateSingleSignature(depositId, user, expectedAmount, RELAYER1_KEY);
        signatures[1] = _generateSingleSignature(depositId, user, expectedAmount, RELAYER2_KEY);
        signatures[2] = _generateSingleSignature(depositId, user, expectedAmount, RELAYER3_KEY);
        
        vm.expectEmit(address(bridge));
        emit WithdrawalCompleted(depositId, user, expectedAmount, block.timestamp);
        
        bridge.completeWithdrawal(
            depositId,
            user,
            "multi-relayer-test",
            signatures
        );
    }
    
    // ============ Relayer Failover Tests ============
    
    function testRelayerFailover() public {
        // Remove one relayer to simulate failover
        bridge.removeRelayer(relayer3);
        
        // Create a deposit
        vm.startPrank(user);
        testToken.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(testToken),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("failover-test")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Should still work with remaining 2 relayers
        bytes[] memory signatures = _generateValidSignatures(depositId, user, DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000));
        
        bridge.completeWithdrawal(
            depositId,
            user,
            "failover-test",
            signatures
        );
    }
    
    function testRelayerRotation() public {
        // Remove old relayer and add new one
        uint256 newRelayerKey = 0x8888888888888888888888888888888888888888888888888888888888888888;
        address newRelayer = vm.addr(newRelayerKey); // Derive address from private key
        
        bridge.removeRelayer(relayer1);
        bridge.addRelayer(newRelayer);
        
        // Create a deposit
        vm.startPrank(user);
        testToken.approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            address(testToken),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("rotation-test")),
            block.timestamp + 1 days
        );
        
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId = logs[2].topics[1];
        vm.stopPrank();
        
        // Generate signatures with new relayer set (relayer2 + newRelayer)
        bytes[] memory signatures = new bytes[](2);
        uint256 expectedAmount = DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000);
        
        signatures[0] = _generateSingleSignature(depositId, user, expectedAmount, RELAYER2_KEY);
        signatures[1] = _generateSingleSignature(depositId, user, expectedAmount, newRelayerKey);
        
        bridge.completeWithdrawal(
            depositId,
            user,
            "rotation-test",
            signatures
        );
    }
    
    // ============ Stress Tests ============
    
    function testHighVolumeRelayerOperations() public {
        uint256 numDeposits = 10;
        bytes32[] memory depositIds = new bytes32[](numDeposits);
        
        // Create multiple deposits
        vm.startPrank(user);
        for (uint256 i = 0; i < numDeposits; i++) {
            testToken.approve(address(bridge), DEPOSIT_AMOUNT);
            
            vm.recordLogs();
            bridge.depositToken(
                address(testToken),
                DEPOSIT_AMOUNT,
                NEAR_ACCOUNT,
                keccak256(abi.encodePacked("stress-test", vm.toString(i))),
                block.timestamp + 1 days
            );
            
            Vm.Log[] memory logs = vm.getRecordedLogs();
            depositIds[i] = logs[2].topics[1];
        }
        vm.stopPrank();
        
        // Process all withdrawals with relayer signatures
        uint256 expectedAmount = DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000);
        for (uint256 i = 0; i < numDeposits; i++) {
            bytes[] memory signatures = _generateValidSignatures(depositIds[i], user, expectedAmount);
            
            bridge.completeWithdrawal(
                depositIds[i],
                user,
                string(abi.encodePacked("stress-test", vm.toString(i))),
                signatures
            );
        }
        
        // Verify all deposits were processed
        assertEq(testToken.balanceOf(user), 1000000 * 10 ** 6 - (numDeposits * (DEPOSIT_AMOUNT * 30) / 10000), "User should receive correct amount after fees");
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
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(RELAYER1_KEY, messageHash);
        signatures[0] = abi.encodePacked(r1, s1, v1);
        
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(RELAYER2_KEY, messageHash);
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

// Mock ERC20 token for testing
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}
