// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/Resolver.sol";
import "../src/interfaces/IPartialFillHandler.sol";

/**
 * @title ResolverPartialFillTest
 * @dev Comprehensive Foundry tests for Resolver contract partial fill functionality
 * Tests partial fills, order splitting, refunds, and event emissions
 */
contract ResolverPartialFillTest is Test {
    Resolver public resolver;
    address public owner;
    address public user1;
    address public user2;

    // Test constants
    bytes32 constant ORDER_HASH = keccak256("test_order_123");
    bytes32 constant SECRET_HASH = keccak256("test_secret");
    uint256 constant INITIAL_AMOUNT = 1 ether;
    uint256 constant PARTIAL_FILL_AMOUNT = 0.3 ether;
    uint256 constant REMAINING_AMOUNT = INITIAL_AMOUNT - PARTIAL_FILL_AMOUNT;

    // Events for testing
    event OrderPartiallyFilled(
        bytes32 indexed orderHash,
        uint256 filledAmount,
        uint256 remainingAmount,
        uint256 fillCount,
        bytes32 secretHash
    );

    event OrderSplit(
        bytes32 indexed orderHash,
        uint256 childCount,
        bytes32 secretHash
    );

    event RefundIssued(
        bytes32 indexed orderHash,
        address indexed recipient,
        uint256 amount,
        string reason,
        bytes32 secretHash
    );

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        // Deploy Resolver contract
        resolver = new Resolver();

        // Give users some ETH for testing
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);
    }

    /*//////////////////////////////////////////////////////////////
                        PARTIAL FILL PROCESSING TESTS
    //////////////////////////////////////////////////////////////*/

    function testProcessPartialFill() public {
        // Process partial fill
        vm.expectEmit(true, false, false, true);
        emit OrderPartiallyFilled(
            ORDER_HASH,
            PARTIAL_FILL_AMOUNT,
            REMAINING_AMOUNT,
            1,
            SECRET_HASH
        );

        resolver.processPartialFill(ORDER_HASH, PARTIAL_FILL_AMOUNT, SECRET_HASH);

        // Verify order state
        (
            uint256 filledAmount,
            uint256 remainingAmount,
            uint256 fillCount,
            bool isFullyFilled,
            bool isCancelled,
            uint256 lastFillTimestamp,
            bytes32[] memory childOrders
        ) = resolver.getOrderState(ORDER_HASH);

        assertEq(filledAmount, PARTIAL_FILL_AMOUNT);
        assertEq(remainingAmount, REMAINING_AMOUNT);
        assertEq(fillCount, 1);
        assertFalse(isFullyFilled);
        assertFalse(isCancelled);
        assertGt(lastFillTimestamp, 0);
        assertEq(childOrders.length, 0);
    }

    function testMultiplePartialFills() public {
        uint256 firstFill = 0.3 ether;
        uint256 secondFill = 0.2 ether;
        uint256 thirdFill = 0.5 ether;

        // First partial fill
        resolver.processPartialFill(ORDER_HASH, firstFill, SECRET_HASH);
        
        // Second partial fill
        resolver.processPartialFill(ORDER_HASH, secondFill, SECRET_HASH);
        
        // Third partial fill (should complete the order)
        vm.expectEmit(true, false, false, true);
        emit OrderPartiallyFilled(ORDER_HASH, thirdFill, 0, 3, SECRET_HASH);
        
        resolver.processPartialFill(ORDER_HASH, thirdFill, SECRET_HASH);

        // Verify final order state
        (
            uint256 filledAmount,
            uint256 remainingAmount,
            uint256 fillCount,
            bool isFullyFilled,
            ,
            ,
        ) = resolver.getOrderState(ORDER_HASH);

        assertEq(filledAmount, INITIAL_AMOUNT);
        assertEq(remainingAmount, 0);
        assertEq(fillCount, 3);
        assertTrue(isFullyFilled);
    }

    function testRevertPartialFillExceedsRemaining() public {
        // First fill most of the order
        resolver.processPartialFill(ORDER_HASH, 0.8 ether, SECRET_HASH);

        // Try to fill more than remaining (should fail)
        vm.expectRevert("Fill amount exceeds remaining");
        resolver.processPartialFill(ORDER_HASH, 0.5 ether, SECRET_HASH);
    }

    function testRevertZeroFillAmount() public {
        vm.expectRevert("Fill amount must be greater than zero");
        resolver.processPartialFill(ORDER_HASH, 0, SECRET_HASH);
    }

    function testRevertMaximumFillsExceeded() public {
        uint256 smallFillAmount = 0.05 ether;

        // Process 10 partial fills (should succeed)
        for (uint256 i = 0; i < 10; i++) {
            resolver.processPartialFill(ORDER_HASH, smallFillAmount, SECRET_HASH);
        }

        // 11th fill should fail
        vm.expectRevert("Maximum fills exceeded");
        resolver.processPartialFill(ORDER_HASH, smallFillAmount, SECRET_HASH);
    }

    function testRevertMinimumFillPercentage() public {
        uint256 tooSmallFill = 0.05 ether; // 5% of 1 ETH (below 10% minimum)

        vm.expectRevert("Fill amount below minimum percentage");
        resolver.processPartialFill(ORDER_HASH, tooSmallFill, SECRET_HASH);
    }

    /*//////////////////////////////////////////////////////////////
                            ORDER SPLITTING TESTS
    //////////////////////////////////////////////////////////////*/

    function testSplitOrder() public {
        uint256[] memory childAmounts = new uint256[](3);
        childAmounts[0] = 0.3 ether;
        childAmounts[1] = 0.4 ether;
        childAmounts[2] = 0.3 ether;

        vm.expectEmit(true, false, false, true);
        emit OrderSplit(ORDER_HASH, 3, SECRET_HASH);

        resolver.splitOrder(ORDER_HASH, childAmounts, SECRET_HASH);

        // Verify parent order state
        (
            ,
            ,
            ,
            ,
            ,
            ,
            bytes32[] memory childOrders
        ) = resolver.getOrderState(ORDER_HASH);

        assertEq(childOrders.length, 3);
        
        // Verify order is marked as split
        assertTrue(resolver.isOrderSplit(ORDER_HASH));
    }

    function testRevertSplitAmountsExceedTotal() public {
        uint256[] memory invalidAmounts = new uint256[](2);
        invalidAmounts[0] = 0.6 ether;
        invalidAmounts[1] = 0.6 ether; // Total 1.2 ETH > 1.0 ETH original

        vm.expectRevert("Total split amounts exceed order amount");
        resolver.splitOrder(ORDER_HASH, invalidAmounts, SECRET_HASH);
    }

    function testRevertSplitAlreadySplitOrder() public {
        uint256[] memory childAmounts = new uint256[](2);
        childAmounts[0] = 0.5 ether;
        childAmounts[1] = 0.5 ether;

        // First split should succeed
        resolver.splitOrder(ORDER_HASH, childAmounts, SECRET_HASH);

        // Second split should fail
        vm.expectRevert("Order already split");
        resolver.splitOrder(ORDER_HASH, childAmounts, SECRET_HASH);
    }

    function testRevertSplitEmptyAmounts() public {
        uint256[] memory emptyAmounts = new uint256[](0);

        vm.expectRevert("Must provide child amounts");
        resolver.splitOrder(ORDER_HASH, emptyAmounts, SECRET_HASH);
    }

    function testRevertTooManyChildOrders() public {
        // Create array with more than maximum allowed child orders (assume max is 10)
        uint256[] memory tooManyAmounts = new uint256[](15);
        for (uint256 i = 0; i < 15; i++) {
            tooManyAmounts[i] = 0.05 ether;
        }

        vm.expectRevert("Too many child orders");
        resolver.splitOrder(ORDER_HASH, tooManyAmounts, SECRET_HASH);
    }

    /*//////////////////////////////////////////////////////////////
                            REFUND PROCESSING TESTS
    //////////////////////////////////////////////////////////////*/

    function testProcessRefund() public {
        uint256 refundAmount = 0.5 ether;
        string memory reason = "Order expired";

        vm.expectEmit(true, true, false, true);
        emit RefundIssued(ORDER_HASH, user1, refundAmount, reason, SECRET_HASH);

        resolver.processRefund(ORDER_HASH, user1, refundAmount, reason, SECRET_HASH);

        // Verify refund state
        (
            address recipient,
            uint256 amount,
            bool isProcessed,
            string memory refundReason
        ) = resolver.getRefundState(ORDER_HASH);

        assertEq(recipient, user1);
        assertEq(amount, refundAmount);
        assertTrue(isProcessed);
        assertEq(refundReason, reason);
    }

    function testRevertDuplicateRefund() public {
        uint256 refundAmount = 0.5 ether;
        string memory reason = "Order expired";

        // First refund should succeed
        resolver.processRefund(ORDER_HASH, user1, refundAmount, reason, SECRET_HASH);

        // Second refund should fail
        vm.expectRevert("Refund already processed");
        resolver.processRefund(ORDER_HASH, user1, refundAmount, reason, SECRET_HASH);
    }

    function testRevertZeroRefundAmount() public {
        vm.expectRevert("Refund amount must be greater than zero");
        resolver.processRefund(ORDER_HASH, user1, 0, "Invalid refund", SECRET_HASH);
    }

    function testRevertRefundToZeroAddress() public {
        vm.expectRevert("Invalid recipient address");
        resolver.processRefund(ORDER_HASH, address(0), 0.5 ether, "Invalid recipient", SECRET_HASH);
    }

    /*//////////////////////////////////////////////////////////////
                            ACCESS CONTROL TESTS
    //////////////////////////////////////////////////////////////*/

    function testOnlyOwnerCanProcessPartialFill() public {
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        resolver.processPartialFill(ORDER_HASH, PARTIAL_FILL_AMOUNT, SECRET_HASH);
    }

    function testOnlyOwnerCanSplitOrder() public {
        uint256[] memory childAmounts = new uint256[](2);
        childAmounts[0] = 0.5 ether;
        childAmounts[1] = 0.5 ether;

        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        resolver.splitOrder(ORDER_HASH, childAmounts, SECRET_HASH);
    }

    function testOnlyOwnerCanProcessRefund() public {
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        resolver.processRefund(ORDER_HASH, user2, 0.5 ether, "Unauthorized refund", SECRET_HASH);
    }

    /*//////////////////////////////////////////////////////////////
                            GAS OPTIMIZATION TESTS
    //////////////////////////////////////////////////////////////*/

    function testGasUsagePartialFill() public {
        uint256 gasBefore = gasleft();
        resolver.processPartialFill(ORDER_HASH, PARTIAL_FILL_AMOUNT, SECRET_HASH);
        uint256 gasUsed = gasBefore - gasleft();

        // Should use reasonable gas (less than 200k)
        assertLt(gasUsed, 200_000);
    }

    function testGasUsageOrderSplit() public {
        uint256[] memory childAmounts = new uint256[](3);
        childAmounts[0] = 0.3 ether;
        childAmounts[1] = 0.3 ether;
        childAmounts[2] = 0.4 ether;

        uint256 gasBefore = gasleft();
        resolver.splitOrder(ORDER_HASH, childAmounts, SECRET_HASH);
        uint256 gasUsed = gasBefore - gasleft();

        // Should use reasonable gas for splitting (less than 300k)
        assertLt(gasUsed, 300_000);
    }

    function testGasUsageRefund() public {
        uint256 gasBefore = gasleft();
        resolver.processRefund(ORDER_HASH, user1, 0.5 ether, "Test refund", SECRET_HASH);
        uint256 gasUsed = gasBefore - gasleft();

        // Should use reasonable gas (less than 150k)
        assertLt(gasUsed, 150_000);
    }

    /*//////////////////////////////////////////////////////////////
                            INTEGRATION SCENARIOS
    //////////////////////////////////////////////////////////////*/

    function testCompletePartialFillWorkflow() public {
        // 1. Split order into child orders
        uint256[] memory childAmounts = new uint256[](2);
        childAmounts[0] = 0.4 ether;
        childAmounts[1] = 0.6 ether;
        
        resolver.splitOrder(ORDER_HASH, childAmounts, SECRET_HASH);

        // 2. Process partial fills for child orders
        bytes32 childOrderHash1 = keccak256(abi.encode(ORDER_HASH, uint256(0)));
        
        resolver.processPartialFill(childOrderHash1, 0.2 ether, SECRET_HASH);

        // 3. Process refund for remaining amount
        resolver.processRefund(childOrderHash1, user1, 0.2 ether, "Partial refund", SECRET_HASH);

        // Verify all operations completed successfully
        assertTrue(resolver.isOrderSplit(ORDER_HASH));
        (,,,,,,bytes32[] memory childOrders) = resolver.getOrderState(ORDER_HASH);
        assertEq(childOrders.length, 2);
    }

    function testCrossChainCoordinationScenario() public {
        // Simulate cross-chain partial fill with matching secret hashes
        bytes32 crossChainSecretHash = keccak256("cross_chain_secret");
        
        // Process partial fill with cross-chain secret
        vm.expectEmit(true, false, false, true);
        emit OrderPartiallyFilled(
            ORDER_HASH,
            PARTIAL_FILL_AMOUNT,
            REMAINING_AMOUNT,
            1,
            crossChainSecretHash
        );

        resolver.processPartialFill(ORDER_HASH, PARTIAL_FILL_AMOUNT, crossChainSecretHash);
    }

    /*//////////////////////////////////////////////////////////////
                            FUZZ TESTS
    //////////////////////////////////////////////////////////////*/

    function testFuzzPartialFillAmounts(uint256 fillAmount) public {
        // Bound fill amount to reasonable range (10% to 100% of order)
        fillAmount = bound(fillAmount, 0.1 ether, 1 ether);
        
        resolver.processPartialFill(ORDER_HASH, fillAmount, SECRET_HASH);
        
        (uint256 filledAmount, uint256 remainingAmount,,,,,) = resolver.getOrderState(ORDER_HASH);
        
        assertEq(filledAmount, fillAmount);
        assertEq(remainingAmount, INITIAL_AMOUNT - fillAmount);
    }

    function testFuzzSplitAmounts(uint256 amount1, uint256 amount2) public {
        // Bound amounts to ensure they don't exceed total
        amount1 = bound(amount1, 0.1 ether, 0.5 ether);
        amount2 = bound(amount2, 0.1 ether, INITIAL_AMOUNT - amount1);
        
        uint256[] memory childAmounts = new uint256[](2);
        childAmounts[0] = amount1;
        childAmounts[1] = amount2;
        
        resolver.splitOrder(ORDER_HASH, childAmounts, SECRET_HASH);
        
        assertTrue(resolver.isOrderSplit(ORDER_HASH));
    }

    function testFuzzRefundAmounts(uint256 refundAmount, address recipient) public {
        // Bound refund amount and ensure valid recipient
        refundAmount = bound(refundAmount, 0.01 ether, 1 ether);
        vm.assume(recipient != address(0));
        
        resolver.processRefund(ORDER_HASH, recipient, refundAmount, "Fuzz test refund", SECRET_HASH);
        
        (address refundRecipient, uint256 amount, bool isProcessed,) = resolver.getRefundState(ORDER_HASH);
        
        assertEq(refundRecipient, recipient);
        assertEq(amount, refundAmount);
        assertTrue(isProcessed);
    }

    /*//////////////////////////////////////////////////////////////
                            INVARIANT TESTS
    //////////////////////////////////////////////////////////////*/

    function invariant_FilledPlusRemainingEqualsTotal() public {
        (uint256 filledAmount, uint256 remainingAmount,,,,,) = resolver.getOrderState(ORDER_HASH);
        assertEq(filledAmount + remainingAmount, INITIAL_AMOUNT);
    }

    function invariant_FillCountNeverExceedsMaximum() public {
        (,, uint256 fillCount,,,,,) = resolver.getOrderState(ORDER_HASH);
        assertLe(fillCount, 10); // Assuming max fills is 10
    }

    function invariant_RefundOnlyProcessedOnce() public {
        (,, bool isProcessed,) = resolver.getRefundState(ORDER_HASH);
        // If processed, attempting another refund should fail
        if (isProcessed) {
            vm.expectRevert("Refund already processed");
            resolver.processRefund(ORDER_HASH, user1, 0.1 ether, "Duplicate", SECRET_HASH);
        }
    }
}
