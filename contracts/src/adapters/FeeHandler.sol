// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "openzeppelin-contracts/contracts/access/Ownable.sol";
import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Fee Handler for Cross-Chain Swaps
 * @dev Manages fee calculations and distributions
 */
contract FeeHandler is Ownable {
    using SafeERC20 for IERC20;

    // Fee configuration
    struct FeeConfig {
        uint256 baseFee; // Base fee in basis points (1 = 0.01%)
        uint256 minFee; // Minimum fee amount
        uint256 maxFee; // Maximum fee amount
        address feeRecipient; // Address to receive fees
        bool isActive; // Whether the fee configuration is active
    }

    // Token-specific fee configurations
    mapping(address => FeeConfig) public tokenFeeConfigs;
    
    // Default fee configuration
    FeeConfig public defaultFeeConfig;

    // Events
    event FeeCollected(address indexed token, uint256 amount, address indexed recipient);
    event FeeConfigUpdated(
        address indexed token,
        uint256 baseFee,
        uint256 minFee,
        uint256 maxFee,
        address feeRecipient,
        bool isActive
    );

    /**
     * @dev Constructor
     * @param _defaultFeeRecipient Default address to receive fees
     * @param _defaultBaseFee Default base fee in basis points (1 = 0.01%)
     * @param _defaultMinFee Default minimum fee amount
     * @param _defaultMaxFee Default maximum fee amount
     * @param initialOwner The address that will be the initial owner
     */
    constructor(
        address _defaultFeeRecipient,
        uint256 _defaultBaseFee,
        uint256 _defaultMinFee,
        uint256 _defaultMaxFee,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_defaultFeeRecipient != address(0), "FeeHandler: Invalid fee recipient");
        
        defaultFeeConfig = FeeConfig({
            baseFee: _defaultBaseFee,
            minFee: _defaultMinFee,
            maxFee: _defaultMaxFee,
            feeRecipient: _defaultFeeRecipient,
            isActive: true
        });
    }

    /**
     * @dev Calculate fee for a given amount
     * @param token Address of the token (address(0) for native token)
     * @param amount Amount to calculate fee for
     * @return fee Calculated fee amount
     */
    function calculateFee(address token, uint256 amount) public view returns (uint256) {
        FeeConfig memory config = tokenFeeConfigs[token];
        
        // Use default config if token-specific config doesn't exist or is inactive
        if (!config.isActive || config.feeRecipient == address(0)) {
            config = defaultFeeConfig;
        }
        
        require(config.isActive, "FeeHandler: Fee collection is not active");
        
        uint256 fee = (amount * config.baseFee) / 10_000; // 1 basis point = 0.01%
        
        // Apply min/max bounds
        if (fee < config.minFee) {
            fee = config.minFee;
        } else if (fee > config.maxFee && config.maxFee > 0) {
            fee = config.maxFee;
        }
        
        return fee;
    }

    /**
     * @dev Collect fees for a token transfer
     * @param token Address of the token (address(0) for native token)
     * @param from Sender address
     * @param amount Amount being transferred
     * @return netAmount Amount after fee deduction
     */
    function collectFee(
        address token,
        address from,
        uint256 amount
    ) external payable returns (uint256) {
        uint256 fee = calculateFee(token, amount);
        FeeConfig memory config = tokenFeeConfigs[token];
        
        // Use default config if token-specific config doesn't exist or is inactive
        if (!config.isActive || config.feeRecipient == address(0)) {
            config = defaultFeeConfig;
        }
        
        require(amount > fee, "FeeHandler: Amount less than fee");
        uint256 netAmount = amount - fee;
        
        // Transfer fee to fee recipient
        if (token == address(0)) {
            // Native token
            require(msg.value >= amount, "FeeHandler: Insufficient value");
            (bool success, ) = config.feeRecipient.call{value: fee}("");
            require(success, "FeeHandler: Fee transfer failed");
        } else {
            // ERC20 token
            IERC20(token).safeTransferFrom(from, config.feeRecipient, fee);
        }
        
        emit FeeCollected(token, fee, config.feeRecipient);
        return netAmount;
    }

    /**
     * @dev Update fee configuration for a specific token
     * @param token Address of the token (address(0) for default config)
     * @param baseFee New base fee in basis points (1 = 0.01%)
     * @param minFee New minimum fee amount
     * @param maxFee New maximum fee amount (0 for no max)
     * @param feeRecipient Address to receive fees
     * @param isActive Whether the fee configuration is active
     */
    function updateFeeConfig(
        address token,
        uint256 baseFee,
        uint256 minFee,
        uint256 maxFee,
        address feeRecipient,
        bool isActive
    ) external onlyOwner {
        require(feeRecipient != address(0), "FeeHandler: Invalid fee recipient");
        require(baseFee <= 10_000, "FeeHandler: Fee exceeds 100%");
        
        FeeConfig memory newConfig = FeeConfig({
            baseFee: baseFee,
            minFee: minFee,
            maxFee: maxFee,
            feeRecipient: feeRecipient,
            isActive: isActive
        });
        
        if (token == address(0)) {
            defaultFeeConfig = newConfig;
        } else {
            tokenFeeConfigs[token] = newConfig;
        }
        
        emit FeeConfigUpdated(token, baseFee, minFee, maxFee, feeRecipient, isActive);
    }
    
    /**
     * @dev Withdraw tokens from the contract (emergency use)
     * @param token Address of the token to withdraw (address(0) for native token)
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawTokens(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "FeeHandler: Invalid recipient");
        
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "FeeHandler: Native token transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
