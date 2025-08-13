// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/TestEscrowFactory.sol";
import "../lib/cross-chain-swap/contracts/interfaces/IBaseEscrow.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18);
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TestEscrowFactoryTest is Test {
    TestEscrowFactory public factory;
    MockERC20 public feeToken;
    MockERC20 public accessToken;
    
    address public owner;
    address public user;
    address public limitOrderProtocol;
    
    uint32 public constant RESCUE_DELAY_SRC = 7 days;
    uint32 public constant RESCUE_DELAY_DST = 3 days;
    
    event NearEscrowCreated(
        address indexed escrowAddress,
        string nearRecipient,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );

    function setUp() public {
        owner = address(this);
        user = address(0x1);
        limitOrderProtocol = address(0x2);
        
        // Deploy mock tokens
        feeToken = new MockERC20("Fee Token", "FEE");
        accessToken = new MockERC20("Access Token", "ACCESS");
        
        // Deploy TestEscrowFactory
        factory = new TestEscrowFactory(
            limitOrderProtocol,
            IERC20(address(feeToken)),
            IERC20(address(accessToken)),
            owner,
            RESCUE_DELAY_SRC,
            RESCUE_DELAY_DST
        );
    }
    
    // ==================== NEAR Account Validation Tests ====================
    
    function test_ValidNearAccounts() public {
        // Valid NEAR account formats
        assertTrue(factory.isValidNearAccount("alice.near"));
        assertTrue(factory.isValidNearAccount("test_account.testnet"));
        assertTrue(factory.isValidNearAccount("user123.near"));
        assertTrue(factory.isValidNearAccount("my_wallet.near"));
        assertTrue(factory.isValidNearAccount("ab")); // Minimum length
        assertTrue(factory.isValidNearAccount("sub.domain.near"));
        assertTrue(factory.isValidNearAccount("123456789.near"));
        assertTrue(factory.isValidNearAccount("a1b2c3.testnet"));
    }
    
    function test_InvalidNearAccounts() public {
        // Too short (less than 2 characters)
        assertFalse(factory.isValidNearAccount("a"));
        assertFalse(factory.isValidNearAccount(""));
        
        // Too long (more than 64 characters)
        string memory longAccount = "this_is_a_very_long_account_name_that_exceeds_the_maximum_length_limit.near";
        assertFalse(factory.isValidNearAccount(longAccount));
        
        // Starts with dot
        assertFalse(factory.isValidNearAccount(".alice.near"));
        
        // Ends with dot
        assertFalse(factory.isValidNearAccount("alice.near."));
        
        // Consecutive dots
        assertFalse(factory.isValidNearAccount("alice..near"));
        assertFalse(factory.isValidNearAccount("test...account"));
        
        // Invalid characters
        assertFalse(factory.isValidNearAccount("alice@near"));
        assertFalse(factory.isValidNearAccount("alice#near"));
        assertFalse(factory.isValidNearAccount("alice near")); // space
        assertFalse(factory.isValidNearAccount("Alice.near")); // uppercase
        assertFalse(factory.isValidNearAccount("alice-near!")); // exclamation
        assertFalse(factory.isValidNearAccount("alice/near")); // slash
    }
    
    function test_EdgeCaseNearAccounts() public {
        // Edge cases that should be valid
        assertTrue(factory.isValidNearAccount("a.b"));
        assertTrue(factory.isValidNearAccount("1.2"));
        assertTrue(factory.isValidNearAccount("test_account"));
        assertTrue(factory.isValidNearAccount("123"));
        
        // Edge cases that should be invalid
        assertFalse(factory.isValidNearAccount(".")); // Only dot
        assertFalse(factory.isValidNearAccount("..")); // Only dots
        assertFalse(factory.isValidNearAccount("a.")); // Ends with dot
        assertFalse(factory.isValidNearAccount(".a")); // Starts with dot
    }
    
    // ==================== Escrow Creation Tests ====================
    
    function test_IsNearEscrow() public {
        address mockEscrow = address(0x123);
        
        // Initially should not be a NEAR escrow
        assertFalse(factory.isNearEscrow(mockEscrow));
        
        // This would be set internally by createDstEscrow if it detects a NEAR account
        // For testing, we can't easily test this without mocking the entire escrow creation flow
    }
    
    function test_HandleNearDeposit_OnlyOwner() public {
        address mockEscrow = address(0x123);
        string memory nearRecipient = "alice.near";
        uint256 amount = 1000;
        bytes32 secretHash = keccak256("secret");
        uint256 timelock = block.timestamp + 1 hours;
        
        // Should fail when called by non-owner
        vm.prank(user);
        vm.expectRevert();
        factory.handleNearDeposit(mockEscrow, nearRecipient, amount, secretHash, timelock);
        
        // Should succeed when called by owner (but will fail because escrow is not marked as NEAR)
        vm.expectRevert("Not a NEAR escrow");
        factory.handleNearDeposit(mockEscrow, nearRecipient, amount, secretHash, timelock);
    }
    
    function test_HandleNearDeposit_InvalidParameters() public {
        address mockEscrow = address(0x123);
        string memory nearRecipient = "alice.near";
        bytes32 secretHash = keccak256("secret");
        
        // Manually mark as NEAR escrow for testing
        vm.store(
            address(factory),
            keccak256(abi.encode(mockEscrow, uint256(3))), // slot 3 is nearEscrows mapping
            bytes32(uint256(1))
        );
        
        // Test invalid amount (zero)
        vm.expectRevert("Invalid amount");
        factory.handleNearDeposit(mockEscrow, nearRecipient, 0, secretHash, block.timestamp + 1 hours);
        
        // Test invalid timelock (in the past)
        vm.expectRevert("Invalid timelock");
        factory.handleNearDeposit(mockEscrow, nearRecipient, 1000, secretHash, block.timestamp - 1);
    }
    
    function test_HandleNearDeposit_Success() public {
        address mockEscrow = address(0x123);
        string memory nearRecipient = "alice.near";
        uint256 amount = 1000;
        bytes32 secretHash = keccak256("secret");
        uint256 timelock = block.timestamp + 1 hours;
        
        // Manually mark as NEAR escrow for testing
        vm.store(
            address(factory),
            keccak256(abi.encode(mockEscrow, uint256(3))), // slot 3 is nearEscrows mapping
            bytes32(uint256(1))
        );
        
        // Expect the event to be emitted
        vm.expectEmit(true, false, false, true);
        emit NearEscrowCreated(mockEscrow, nearRecipient, amount, secretHash, timelock);
        
        factory.handleNearDeposit(mockEscrow, nearRecipient, amount, secretHash, timelock);
    }
    
    // ==================== Access Control Tests ====================
    
    function test_OnlyOwnerFunctions() public {
        address mockEscrow = address(0x123);
        string memory nearRecipient = "alice.near";
        uint256 amount = 1000;
        bytes32 secretHash = keccak256("secret");
        uint256 timelock = block.timestamp + 1 hours;
        
        // Test that non-owner cannot call handleNearDeposit
        vm.prank(user);
        vm.expectRevert();
        factory.handleNearDeposit(mockEscrow, nearRecipient, amount, secretHash, timelock);
    }
    
    // ==================== Constants Tests ====================
    
    function test_Constants() public {
        assertEq(factory.NEAR_CHAIN_ID(), 397);
        assertEq(factory.MIN_NEAR_ACCOUNT_LENGTH(), 2);
        assertEq(factory.MAX_NEAR_ACCOUNT_LENGTH(), 64);
        assertEq(factory.NEAR_ACCOUNT_SEPARATOR(), bytes1('.'));
    }
    
    // ==================== Comprehensive NEAR Account Validation ====================
    
    function test_NearAccountValidation_Comprehensive() public {
        // Test all valid character combinations
        string[24] memory validAccounts = [
            "aa", "ab", "a1", "1a", "11", // minimum length variations
            "alice", "bob123", "test_account", // basic valid accounts
            "alice.near", "bob.testnet", "user.mainnet", // with domains
            "sub.domain.near", "deep.sub.domain.testnet", // nested domains
            "123.456", "a.b.c.d", "test.1.2.3", // numeric and mixed
            "a_b_c", "test_123", "user_wallet", // with underscores
            "verylongaccountnamethatisstillvalid", // long but valid
            "a1b2c3d4e5f6", "test123test456", // alphanumeric mix
            "account", "wallet" // simple names
        ];
        
        for (uint i = 0; i < validAccounts.length; i++) {
            assertTrue(factory.isValidNearAccount(validAccounts[i]), 
                string(abi.encodePacked("Should be valid: ", validAccounts[i])));
        }
        
        // Test all invalid character combinations
        string[17] memory invalidAccounts = [
            "a", "", // too short
            "this_is_definitely_way_too_long_for_a_near_account_name_and_should_fail", // too long
            ".alice", "alice.", // starts/ends with dot
            "alice..near", "test...account", // consecutive dots
            "Alice", "ALICE", "AlIcE", // uppercase
            "alice near", "test account", // spaces
            "alice@near", "test#account", // special characters
            "alice/near", "test\\account", "user|name" // more special chars
        ];
        
        for (uint i = 0; i < invalidAccounts.length; i++) {
            assertFalse(factory.isValidNearAccount(invalidAccounts[i]), 
                string(abi.encodePacked("Should be invalid: ", invalidAccounts[i])));
        }
    }
    
    // ==================== Boundary Tests ====================
    
    function test_NearAccountLength_Boundaries() public {
        // Test exact boundary lengths
        string memory exactMin = "ab"; // exactly 2 characters
        string memory exactMax = "1234567890123456789012345678901234567890123456789012345678901234"; // exactly 64 characters
        
        assertTrue(factory.isValidNearAccount(exactMin));
        assertTrue(factory.isValidNearAccount(exactMax));
        
        // Test just outside boundaries
        string memory tooShort = "a"; // 1 character
        string memory tooLong = "12345678901234567890123456789012345678901234567890123456789012345"; // 65 characters
        
        assertFalse(factory.isValidNearAccount(tooShort));
        assertFalse(factory.isValidNearAccount(tooLong));
    }
    
    // ==================== Gas Usage Tests ====================
    
    function test_NearAccountValidation_GasUsage() public {
        string memory shortAccount = "ab";
        string memory longAccount = "this.is.a.reasonably.long.account.name.for.testing.purposes";
        
        uint256 gasBefore = gasleft();
        factory.isValidNearAccount(shortAccount);
        uint256 gasUsedShort = gasBefore - gasleft();
        
        gasBefore = gasleft();
        factory.isValidNearAccount(longAccount);
        uint256 gasUsedLong = gasBefore - gasleft();
        
        // Gas usage should be reasonable and scale with length
        assertTrue(gasUsedShort < 50000, "Gas usage too high for short account");
        assertTrue(gasUsedLong < 100000, "Gas usage too high for long account");
        assertTrue(gasUsedLong > gasUsedShort, "Long account should use more gas");
    }
    
    // ==================== Integration Tests ====================
    
    function test_Integration_NearAccountInEscrowFlow() public {
        // This would test the integration with the actual escrow creation
        // For now, we can only test the validation part since the delegatecall
        // in createDstEscrow has issues that would need to be fixed first
        
        string memory validNearAccount = "alice.near";
        string memory invalidNearAccount = "Alice.NEAR";
        
        assertTrue(factory.isValidNearAccount(validNearAccount));
        assertFalse(factory.isValidNearAccount(invalidNearAccount));
    }
    
    // ==================== Fuzz Tests ====================
    
    function testFuzz_NearAccountValidation(string memory account) public {
        bool isValid = factory.isValidNearAccount(account);
        bytes memory accountBytes = bytes(account);
        
        // If the account is valid, it must meet basic requirements
        if (isValid) {
            assertTrue(accountBytes.length >= 2, "Valid account must be at least 2 chars");
            assertTrue(accountBytes.length <= 64, "Valid account must be at most 64 chars");
            assertTrue(accountBytes[0] != bytes1('.'), "Valid account cannot start with dot");
            assertTrue(accountBytes[accountBytes.length - 1] != bytes1('.'), "Valid account cannot end with dot");
        }
        
        // If the account doesn't meet basic requirements, it must be invalid
        if (accountBytes.length < 2 || accountBytes.length > 64) {
            assertFalse(isValid, "Account with invalid length should be invalid");
        }
        
        if (accountBytes.length > 0) {
            if (accountBytes[0] == bytes1('.') || accountBytes[accountBytes.length - 1] == bytes1('.')) {
                assertFalse(isValid, "Account starting or ending with dot should be invalid");
            }
        }
    }
}
