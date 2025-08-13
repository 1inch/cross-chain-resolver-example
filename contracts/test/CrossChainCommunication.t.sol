// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/NearBridge.sol";
import "../src/TestEscrowFactory.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// Mock ERC20 token for testing
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
}

// Helper contract to test EIP-712 signatures
contract SignatureHelper {
    using ECDSA for bytes32;
    
    function getWithdrawHash(
        address bridgeAddress,
        bytes32 depositId,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        uint256 chainId
    ) external pure returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Withdraw(bytes32 depositId,address recipient,uint256 amount,uint256 nonce,uint256 deadline)"),
                depositId,
                recipient,
                amount,
                nonce,
                deadline
            )
        );
        
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("NearBridge"),
                keccak256("1.0.0"),
                chainId,
                bridgeAddress
            )
        );
        
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
    
    function safeTransfer(
        address tokenAddr,
        address from,
        address to,
        uint256 amount
    ) external {}
}

contract CrossChainCommunicationTest is Test {
    // Contracts
    NearBridge public bridge;
    TestEscrowFactory public escrowFactory;
    MockToken public token;
    
    // Track nonces for deposit ID generation
    mapping(address => uint256) public nonces;
    
    // Test accounts and keys
    address public deployer;
    address public user;
    address public relayer1;
    address public relayer2;
    address public relayer3;
    
    uint256 _relayer1Key = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    uint256 _relayer2Key = 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890;
    uint256 _relayer3Key = 0x1111111111111111111111111111111111111111111111111111111111111111;
    
    // Test parameters
    uint256 public constant INITIAL_BALANCE = 1000 * 10 ** 18;
    uint256 public constant DEPOSIT_AMOUNT = 100 * 10 ** 18;
    string public constant NEAR_ACCOUNT = "test.near";
    
    function setUp() public {
        // Deploy mock token first
        token = new MockToken("Test Token", "TEST");
        
        // Set up test accounts - derive relayer addresses from private keys
        deployer = address(this);
        user = address(0x2);
        relayer1 = vm.addr(_relayer1Key);
        relayer2 = vm.addr(_relayer2Key);
        relayer3 = vm.addr(_relayer3Key);
        
        // Set up test environment
        vm.startPrank(deployer);
        
        // Deploy bridge with initial configuration
        bridge = new NearBridge(
            deployer,       // owner
            address(token), // fee token
            address(0),     // access token (none)
            deployer,       // fee collector
            0.1 ether,      // min deposit
            10000 * 10**18, // max deposit
            1 days,         // dispute period
            30,             // bridge fee bps (0.3%)
            NearBridge.BridgeStatus.ACTIVE
        );
        
        // Deploy escrow factory
        escrowFactory = new TestEscrowFactory(
            address(0), // limit order protocol (mock)
            IERC20(address(token)),
            IERC20(address(0)), // access token (none)
            deployer,   // owner
            1 hours,    // rescue delay src
            1 hours     // rescue delay dst
        );
        
        // Add relayers
        bridge.addRelayer(relayer1);
        bridge.addRelayer(relayer2);
        bridge.addRelayer(relayer3);
        
        // Set required confirmations to 2/3
        bridge.setRequiredConfirmations(2);
        
        // Add token to supported tokens
        bridge.setSupportedToken(address(token), true);
        
        // Fund user with tokens
        token.transfer(user, INITIAL_BALANCE);
        
        vm.stopPrank();
    }
    
    function test_DepositToNear() public returns (bytes32 depositId) {
        // Start with user context
        vm.startPrank(user);
        
        // Approve token transfer
        token.approve(address(bridge), DEPOSIT_AMOUNT);
        
        // Generate a secret and its hash
        string memory secret = "my-secret-123";
        bytes32 secretHash = keccak256(abi.encodePacked(secret));
        uint256 timelock = block.timestamp + 1 days;
        
        // Calculate expected fee and amount after fee
        uint256 bridgeFee = (DEPOSIT_AMOUNT * 30) / 10000; // 0.3% fee
        uint256 amountAfterFee = DEPOSIT_AMOUNT - bridgeFee;
        
        // Record initial balances
        uint256 userBalanceBefore = token.balanceOf(user);
        uint256 bridgeBalanceBefore = token.balanceOf(address(bridge));
        
        // Execute the deposit - let the contract generate the depositId
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            secretHash,
            timelock
        );
        
        // Get the logs to extract the actual depositId
        Vm.Log[] memory logs = vm.getRecordedLogs();
        
        // Find the DepositInitiated event to get the actual depositId
        bytes32 actualDepositId;
        bool foundDepositEvent = false;
        
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("DepositInitiated(bytes32,address,string,address,uint256,uint256,uint256)")) {
                actualDepositId = logs[i].topics[1]; // depositId is the first indexed parameter
                foundDepositEvent = true;
                break;
            }
        }
        
        require(foundDepositEvent, "DepositInitiated event not found");
        depositId = actualDepositId;
        
        // Verify deposit was created using the actual depositId
        (address depositor, uint256 amount, bool claimed, bool disputed) = _getDepositInfo(depositId);
        assertEq(depositor, user, "Incorrect depositor");
        // Contract now stores amount after fees (what bridge actually holds)
        uint256 expectedStoredAmount = DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000); // Amount after 0.3% fee
        assertEq(amount, expectedStoredAmount, "Incorrect deposit amount");
        assertFalse(claimed, "Deposit should not be claimed");
        assertFalse(disputed, "Deposit should not be disputed");
        
        // Verify token balances
        assertEq(token.balanceOf(user), userBalanceBefore - DEPOSIT_AMOUNT, "Incorrect user balance after deposit");
        assertEq(token.balanceOf(address(bridge)), bridgeBalanceBefore + amountAfterFee, "Incorrect bridge balance after deposit");
        
        vm.stopPrank();
        
        return depositId;
    }
    
    function test_DepositStorageAndRetrieval() public {
        // Create a deposit
        bytes32 depositId = test_DepositToNear();
        
        // Verify we can retrieve deposit information correctly
        (address depositor, uint256 amount, bool claimed, bool disputed) = _getDepositInfo(depositId);
        
        // Verify deposit properties
        assertEq(depositor, user, "Depositor should match");
        // Amount should be after fees since that's what the contract now stores
        uint256 expectedAmount = DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000);
        assertEq(amount, expectedAmount, "Amount should match (after fees)");
        assertFalse(claimed, "Should not be claimed initially");
        assertFalse(disputed, "Should not be disputed initially");
        
        // Verify secret hash is stored correctly
        string memory secret = "my-secret-123";
        bytes32 expectedHash = keccak256(abi.encodePacked(secret));
        
        (bool success, bytes memory data) = address(bridge).staticcall(
            abi.encodeWithSignature("deposits(bytes32)", depositId)
        );
        require(success, "Failed to get deposit info");
        
        (, , , , , , , , bytes32 storedSecretHash, ) = abi.decode(
            data,
            (address, address, string, uint256, uint256, bool, bool, uint256, bytes32, uint256)
        );
        
        assertEq(storedSecretHash, expectedHash, "Secret hash should be stored correctly");
    }
    
    function test_DepositIdCalculation() public {
        // Test that depositId is calculated consistently and uniquely
        vm.startPrank(user);
        
        token.approve(address(bridge), DEPOSIT_AMOUNT * 2);
        
        string memory secret = "my-secret-123";
        bytes32 secretHash = keccak256(abi.encodePacked(secret));
        uint256 timelock = block.timestamp + 1 days;
        
        // Create first deposit
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            secretHash,
            timelock
        );
        
        Vm.Log[] memory logs1 = vm.getRecordedLogs();
        bytes32 depositId1;
        for (uint i = 0; i < logs1.length; i++) {
            if (logs1[i].topics[0] == keccak256("DepositInitiated(bytes32,address,string,address,uint256,uint256,uint256)")) {
                depositId1 = logs1[i].topics[1];
                break;
            }
        }
        
        // Create second deposit with same parameters (should have different ID due to nonce/timestamp)
        vm.warp(block.timestamp + 1); // Change timestamp
        vm.recordLogs();
        bridge.depositToken(
            address(token),
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            secretHash,
            timelock + 1
        );
        
        Vm.Log[] memory logs2 = vm.getRecordedLogs();
        bytes32 depositId2;
        for (uint i = 0; i < logs2.length; i++) {
            if (logs2[i].topics[0] == keccak256("DepositInitiated(bytes32,address,string,address,uint256,uint256,uint256)")) {
                depositId2 = logs2[i].topics[1];
                break;
            }
        }
        
        // Verify depositIds are different
        assertTrue(depositId1 != depositId2, "DepositIds should be unique");
        
        // Verify both deposits exist
        (address depositor1, uint256 amount1, bool claimed1, bool disputed1) = _getDepositInfo(depositId1);
        (address depositor2, uint256 amount2, bool claimed2, bool disputed2) = _getDepositInfo(depositId2);
        
        assertEq(depositor1, user, "First deposit should have correct depositor");
        assertEq(depositor2, user, "Second deposit should have correct depositor");
        // Both deposits should store amount after fees
        uint256 expectedAmount = DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000);
        assertEq(amount1, expectedAmount, "First deposit should have correct amount (after fees)");
        assertEq(amount2, expectedAmount, "Second deposit should have correct amount (after fees)");
        
        vm.stopPrank();
    }
    
    function test_DisputeHandling() public {
        // Create a deposit first
        bytes32 depositId = test_DepositToNear();
        
        // Verify deposit is not disputed initially
        (address depositor, uint256 amount, bool claimed, bool disputed) = _getDepositInfo(depositId);
        assertFalse(disputed, "Deposit should not be disputed initially");
        
        // Initiate dispute as the depositor
        vm.prank(user);
        vm.expectEmit(address(bridge));
        emit NearBridge.DisputeInitiated(depositId, user, block.timestamp);
        bridge.initiateDispute(depositId);
        
        // Verify deposit is now disputed
        (depositor, amount, claimed, disputed) = _getDepositInfo(depositId);
        assertTrue(disputed, "Deposit should be disputed after initiateDispute");
        
        // Try to complete withdrawal while disputed (should fail)
        SignatureHelper sigHelper = new SignatureHelper();
        uint256 nonce = bridge.nonces(user);
        uint256 deadline = block.timestamp + bridge.MESSAGE_EXPIRY();
        
        bytes32 digest = sigHelper.getWithdrawHash(
            address(bridge),
            depositId,
            user,
            amount,
            nonce,
            deadline,
            block.chainid
        );
        
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(_relayer1Key, digest);
        bytes memory sig1 = abi.encodePacked(r1, s1, v1);
        
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(_relayer2Key, digest);
        bytes memory sig2 = abi.encodePacked(r2, s2, v2);
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = sig1;
        signatures[1] = sig2;
        
        // Should fail because deposit is disputed
        vm.expectRevert("Deposit is in dispute");
        bridge.completeWithdrawal(depositId, user, "my-secret-123", signatures);
        
        // Test that non-depositor cannot initiate dispute
        vm.prank(deployer);
        vm.expectRevert("Not the depositor");
        bridge.initiateDispute(depositId);
    }
    
    function test_WithdrawFromNear() public {
        // First, create a deposit and get the deposit ID
        bytes32 depositId = test_DepositToNear();
        
        // Get deposit info
        (address depositor, uint256 amount, bool claimed, bool disputed) = _getDepositInfo(depositId);
        require(!claimed, "Deposit already claimed");
        require(!disputed, "Deposit should not be disputed");
        
        // Record balances before withdrawal
        uint256 userBalanceBefore = token.balanceOf(user);
        uint256 bridgeBalanceBefore = token.balanceOf(address(bridge));
        
        // Calculate expected amount after fees
        uint256 bridgeFee = (amount * 30) / 10000; // 0.3% fee
        uint256 amountAfterFee = amount - bridgeFee;
        
        // Generate proper EIP-712 signature for withdrawal
        // The contract increments nonce DURING the call, so we use current nonce
        uint256 currentNonce = bridge.nonces(user);
        uint256 deadline = block.timestamp + bridge.MESSAGE_EXPIRY();
        
        // Create the exact hash that the contract will verify using _hashTypedDataV4
        // We need to construct the message hash the same way the contract does
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Withdraw(bytes32 depositId,address recipient,uint256 amount,uint256 nonce,uint256 deadline)"),
                depositId,
                user, // recipient
                amount, // amount stored in deposit (after fees)
                currentNonce, // current nonce (will be incremented in contract)
                deadline
            )
        );
        
        // Use the same domain separator construction as EIP712
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
        
        // Sign with relayers
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(_relayer1Key, messageHash);
        bytes memory sig1 = abi.encodePacked(r1, s1, v1);
        
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(_relayer2Key, messageHash);
        bytes memory sig2 = abi.encodePacked(r2, s2, v2);
        
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = sig1;
        signatures[1] = sig2;
        
        // Complete the withdrawal
        vm.expectEmit(address(bridge));
        emit NearBridge.WithdrawalCompleted(depositId, user, amount, block.timestamp);
        bridge.completeWithdrawal(depositId, user, "my-secret-123", signatures);
        
        // Verify deposit is now claimed
        (address updatedDepositor, uint256 updatedAmount, bool updatedClaimed, bool updatedDisputed) = _getDepositInfo(depositId);
        assertTrue(updatedClaimed, "Deposit should be claimed after withdrawal");
        
        // Verify token balances - user should receive the stored amount (after fees)
        assertEq(token.balanceOf(user), userBalanceBefore + amount, "Incorrect user balance after withdrawal");
        assertEq(token.balanceOf(address(bridge)), bridgeBalanceBefore - amount, "Incorrect bridge balance after withdrawal");
        
        // Verify nonce was incremented
        assertEq(bridge.nonces(user), currentNonce + 1, "Nonce should be incremented");
    }
    
    // Helper function to get deposit info
    function _getDepositInfo(bytes32 depositId) internal view returns (address depositor, uint256 amount, bool claimed, bool disputed) {
        // Access the deposit directly from storage
        (bool success, bytes memory data) = address(bridge).staticcall(
            abi.encodeWithSignature("deposits(bytes32)", depositId)
        );
        require(success, "Failed to get deposit info");
        
        // Decode the full deposit data (9 fields)
        (
            address tokenAddr,
            address _depositor,
            string memory nearRecipient,
            uint256 _amount,
            uint256 timestamp,
            bool _claimed,
            bool _disputed,
            uint256 disputeEndTime,
            bytes32 secretHash,
            uint256 timelock
        ) = abi.decode(
            data,
            (address, address, string, uint256, uint256, bool, bool, uint256, bytes32, uint256)
        );
        
        // Return only the fields we need
        depositor = _depositor;
        amount = _amount;
        claimed = _claimed;
        disputed = _disputed;
    }
}
