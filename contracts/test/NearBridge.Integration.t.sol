// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/NearBridge.sol";
import "../src/adapters/TokenAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title NearBridge Integration Tests
 * @dev Tests NearBridge with forked networks, real token interactions, and relayer integration
 * @notice These tests require forked network setup and may take longer to run
 */
contract NearBridgeIntegrationTest is Test {
    using ECDSA for bytes32;
    
    NearBridge public bridge;
    TokenAdapter public adapter;
    
    // Real token addresses on Ethereum mainnet
    address constant USDC = 0xa0B86a33E6441d1F6f0b8c2c5e8b8B8B8b8B8b8B; // USDC on mainnet
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // WETH on mainnet
    address constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;  // DAI on mainnet
    
    // Test accounts
    address public deployer;
    address public user;
    address public relayer1;
    address public relayer2;
    address public feeCollector;
    
    // Private keys for relayers
    uint256 _relayer1Key = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    uint256 _relayer2Key = 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890;
    
    // Test constants
    uint256 public constant DEPOSIT_AMOUNT = 100 * 10 ** 6; // 100 USDC (6 decimals)
    string public constant NEAR_ACCOUNT = "integration-test.near";
    
    // Events
    event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp);
    event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp);
    
    function setUp() public {
        // Skip if not running on forked network
        if (block.chainid != 1) {
            vm.skip(true);
            return;
        }
        
        // Set up accounts
        deployer = address(this);
        user = address(0x2);
        feeCollector = address(0x3);
        relayer1 = vm.addr(_relayer1Key);
        relayer2 = vm.addr(_relayer2Key);
        
        // Deploy adapter
        adapter = new TokenAdapter(deployer);
        
        // Deploy bridge with USDC as fee token
        bridge = new NearBridge(
            deployer,                    // _owner
            USDC,                       // _feeToken (USDC)
            address(0),                 // _accessToken (optional)
            feeCollector,               // _feeCollector
            1 * 10 ** 6,               // _minDeposit (1 USDC)
            1000000 * 10 ** 6,         // _maxDeposit (1M USDC)
            7 days,                     // _disputePeriod
            30,                         // _bridgeFeeBps (0.3%)
            NearBridge.BridgeStatus.ACTIVE // _initialStatus
        );
        
        // Set up supported tokens
        bridge.setSupportedToken(WETH, true);
        
        // Fund test accounts with real tokens (impersonate whale accounts)
        _fundAccountWithUSDC(user, 10000 * 10 ** 6); // 10,000 USDC
        _fundAccountWithWETH(user, 10 ether); // 10 WETH
        
        // Give accounts ETH for gas
        vm.deal(user, 10 ether);
        vm.deal(deployer, 10 ether);
        vm.deal(feeCollector, 1 ether);
    }
    
    // ============ Integration Tests ============
    
    function testFork_DepositUSDCToNear() public {
        if (block.chainid != 1) return;
        
        vm.startPrank(user);
        
        // Check initial balances
        uint256 userBalanceBefore = IERC20(USDC).balanceOf(user);
        uint256 bridgeBalanceBefore = IERC20(USDC).balanceOf(address(bridge));
        uint256 feeCollectorBalanceBefore = IERC20(USDC).balanceOf(feeCollector);
        
        // Approve and deposit USDC
        IERC20(USDC).approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            USDC,
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("integration-secret")),
            block.timestamp + 1 days
        );
        
        // Verify event emission
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool depositEventFound = false;
        bytes32 depositId;
        
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("DepositInitiated(bytes32,address,string,address,uint256,uint256,uint256)")) {
                depositEventFound = true;
                depositId = logs[i].topics[1];
                break;
            }
        }
        
        assertTrue(depositEventFound, "DepositInitiated event should be emitted");
        
        // Verify balances changed correctly
        uint256 expectedFee = (DEPOSIT_AMOUNT * 30) / 10000; // 0.3% fee
        uint256 expectedAmountAfterFee = DEPOSIT_AMOUNT - expectedFee;
        
        assertEq(
            IERC20(USDC).balanceOf(user),
            userBalanceBefore - DEPOSIT_AMOUNT,
            "User balance should decrease by deposit amount"
        );
        
        assertEq(
            IERC20(USDC).balanceOf(address(bridge)),
            bridgeBalanceBefore + expectedAmountAfterFee,
            "Bridge should hold amount after fees"
        );
        
        assertEq(
            IERC20(USDC).balanceOf(feeCollector),
            feeCollectorBalanceBefore + expectedFee,
            "Fee collector should receive fee"
        );
        
        vm.stopPrank();
    }
    
    function testFork_DepositWETHToNear() public {
        if (block.chainid != 1) return;
        
        vm.startPrank(user);
        
        // Check initial balances
        uint256 userBalanceBefore = IERC20(WETH).balanceOf(user);
        uint256 bridgeBalanceBefore = IERC20(WETH).balanceOf(address(bridge));
        
        // Approve and deposit WETH
        IERC20(WETH).approve(address(bridge), 1 ether);
        
        vm.recordLogs();
        bridge.depositToken(
            WETH,
            1 ether,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("weth-secret")),
            block.timestamp + 1 days
        );
        
        // Verify balances
        uint256 expectedFee = (1 ether * 30) / 10000; // 0.3% fee
        uint256 expectedAmountAfterFee = 1 ether - expectedFee;
        
        assertEq(
            IERC20(WETH).balanceOf(user),
            userBalanceBefore - 1 ether,
            "User WETH balance should decrease"
        );
        
        assertEq(
            IERC20(WETH).balanceOf(address(bridge)),
            bridgeBalanceBefore + expectedAmountAfterFee,
            "Bridge should hold WETH after fees"
        );
        
        vm.stopPrank();
    }
    
    function testFork_DepositETHToNear() public {
        if (block.chainid != 1) return;
        
        vm.startPrank(user);
        
        // Check initial balances
        uint256 userBalanceBefore = user.balance;
        uint256 bridgeBalanceBefore = address(bridge).balance;
        
        // Deposit ETH
        vm.recordLogs();
        bridge.depositEth{value: 1 ether}(
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("eth-secret")),
            block.timestamp + 1 days
        );
        
        // Verify balances (accounting for gas costs)
        uint256 expectedFee = (1 ether * 30) / 10000; // 0.3% fee
        uint256 expectedAmountAfterFee = 1 ether - expectedFee;
        
        assertLt(
            user.balance,
            userBalanceBefore - 1 ether,
            "User ETH balance should decrease by more than 1 ETH (including gas)"
        );
        
        assertEq(
            address(bridge).balance,
            bridgeBalanceBefore + expectedAmountAfterFee,
            "Bridge should hold ETH after fees"
        );
        
        vm.stopPrank();
    }
    
    function testFork_CompleteWithdrawalFlow() public {
        if (block.chainid != 1) return;
        
        // First, create a deposit
        vm.startPrank(user);
        IERC20(USDC).approve(address(bridge), DEPOSIT_AMOUNT);
        
        vm.recordLogs();
        bridge.depositToken(
            USDC,
            DEPOSIT_AMOUNT,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("withdrawal-secret")),
            block.timestamp + 1 days
        );
        
        // Extract deposit ID from logs
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositId;
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("DepositInitiated(bytes32,address,string,address,uint256,uint256,uint256)")) {
                depositId = logs[i].topics[1];
                break;
            }
        }
        vm.stopPrank();
        
        // Generate valid signatures for withdrawal
        uint256 expectedAmountAfterFee = DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000);
        bytes[] memory signatures = _generateValidSignatures(depositId, user, expectedAmountAfterFee);
        
        // Record balances before withdrawal
        uint256 userBalanceBefore = IERC20(USDC).balanceOf(user);
        uint256 bridgeBalanceBefore = IERC20(USDC).balanceOf(address(bridge));
        
        // Complete withdrawal
        vm.expectEmit(address(bridge));
        emit WithdrawalCompleted(depositId, user, expectedAmountAfterFee, block.timestamp);
        
        bridge.completeWithdrawal(
            depositId,
            user,
            "withdrawal-secret",
            signatures
        );
        
        // Verify balances after withdrawal
        assertEq(
            IERC20(USDC).balanceOf(user),
            userBalanceBefore + expectedAmountAfterFee,
            "User should receive amount after fees"
        );
        
        assertEq(
            IERC20(USDC).balanceOf(address(bridge)),
            bridgeBalanceBefore - expectedAmountAfterFee,
            "Bridge balance should decrease"
        );
    }
    
    function testFork_HighVolumeDeposits() public {
        if (block.chainid != 1) return;
        
        vm.startPrank(user);
        
        // Make multiple deposits to test gas efficiency and state management
        uint256 numDeposits = 5;
        bytes32[] memory depositIds = new bytes32[](numDeposits);
        
        for (uint i = 0; i < numDeposits; i++) {
            IERC20(USDC).approve(address(bridge), DEPOSIT_AMOUNT);
            
            vm.recordLogs();
            bridge.depositToken(
                USDC,
                DEPOSIT_AMOUNT,
                NEAR_ACCOUNT,
                keccak256(abi.encodePacked("secret", i)),
                block.timestamp + 1 days
            );
            
            // Extract deposit ID
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint j = 0; j < logs.length; j++) {
                if (logs[j].topics[0] == keccak256("DepositInitiated(bytes32,address,string,address,uint256,uint256,uint256)")) {
                    depositIds[i] = logs[j].topics[1];
                    break;
                }
            }
        }
        
        vm.stopPrank();
        
        // Verify all deposits are unique and stored correctly
        for (uint i = 0; i < numDeposits; i++) {
            for (uint j = i + 1; j < numDeposits; j++) {
                assertTrue(depositIds[i] != depositIds[j], "All deposit IDs should be unique");
            }
        }
        
        // Verify bridge holds correct total amount
        uint256 expectedTotalAfterFees = numDeposits * (DEPOSIT_AMOUNT - ((DEPOSIT_AMOUNT * 30) / 10000));
        assertGe(
            IERC20(USDC).balanceOf(address(bridge)),
            expectedTotalAfterFees,
            "Bridge should hold total amount after fees"
        );
    }
    
    // ============ Stress Tests ============
    
    function testFork_MaximumDepositAmount() public {
        if (block.chainid != 1) return;
        
        uint256 maxAmount = 1000000 * 10 ** 6; // 1M USDC (bridge's max)
        
        // Fund user with max amount
        _fundAccountWithUSDC(user, maxAmount);
        
        vm.startPrank(user);
        IERC20(USDC).approve(address(bridge), maxAmount);
        
        // Should succeed with max amount
        bridge.depositToken(
            USDC,
            maxAmount,
            NEAR_ACCOUNT,
            keccak256(abi.encodePacked("max-secret")),
            block.timestamp + 1 days
        );
        
        vm.stopPrank();
        
        // Verify deposit succeeded
        uint256 expectedAmountAfterFee = maxAmount - ((maxAmount * 30) / 10000);
        assertGe(
            IERC20(USDC).balanceOf(address(bridge)),
            expectedAmountAfterFee,
            "Bridge should hold max amount after fees"
        );
    }
    
    // ============ Helper Functions ============
    
    function _fundAccountWithUSDC(address account, uint256 amount) internal {
        // Impersonate a USDC whale (Circle's account)
        address usdcWhale = 0x55FE002aefF02F77364de339a1292923A15844B8; // Circle account
        
        vm.startPrank(usdcWhale);
        IERC20(USDC).transfer(account, amount);
        vm.stopPrank();
    }
    
    function _fundAccountWithWETH(address account, uint256 amount) internal {
        // Impersonate a WETH whale
        address wethWhale = 0x2F0b23f53734252Bda2277357e97e1517d6B042A; // Gemini account
        
        vm.startPrank(wethWhale);
        IERC20(WETH).transfer(account, amount);
        vm.stopPrank();
    }
    
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
}
