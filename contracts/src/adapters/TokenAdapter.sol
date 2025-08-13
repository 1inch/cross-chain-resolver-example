// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IAdapter.sol";

/// @custom:security-contact security@1inch.io

/**
 * @title Token Adapter for Cross-Chain Swaps
 * @dev Handles different token standards and provides a unified interface
 */
/// @title Token Adapter for Cross-Chain Swaps
/// @dev Handles different token standards and provides a unified interface
/// @custom:security-contact security@1inch.io
contract TokenAdapter is IAdapter, ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    // Supported token standards
    enum TokenStandard {
        ERC20,
        ERC20_WITH_DECIMALS,
        NATIVE
    }

    // Token information
    struct TokenInfo {
        address tokenAddress;
        TokenStandard standard;
        uint8 decimals;
    }
    
    // Roles
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    
    // Adapter metadata
    string public constant override name = "TokenAdapter";
    string public constant override version = "1.1.0";
    
    // Error messages
    error ZeroAddress();
    error TokenAlreadyRegistered();
    error TokenNotRegistered();
    error InvalidTokenStandard();
    error TransferFailed();

    // Mapping from token address to its info
    mapping(address => TokenInfo) public tokenInfo;

    // Events
    event TokenRegistered(address indexed token, TokenStandard standard, uint8 decimals);
    event TokenUnregistered(address indexed token);
    event TokensTransferred(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 amount
    );

    /**
     * @dev Initialize the contract with the default admin
     * @param admin The address that will be granted the DEFAULT_ADMIN_ROLE
     * @custom:reverts ZeroAddress if admin is the zero address
     */
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    /**
     * @dev Register a token with its standard
     * @param token Address of the token contract
     * @param standard The token standard (ERC20, ERC20_WITH_DECIMALS, NATIVE)
     * @custom:emits TokenRegistered when a new token is registered
     * @custom:reverts ZeroAddress if token is the zero address
     * @custom:reverts TokenAlreadyRegistered if token is already registered
     * @custom:reverts InvalidTokenStandard if standard is invalid
     * @custom:access Only callable by accounts with REGISTRAR_ROLE
     */
    function registerToken(address token, TokenStandard standard) 
        external 
        onlyRole(REGISTRAR_ROLE) 
        nonReentrant 
    {
        if (token == address(0)) revert ZeroAddress();
        if (tokenInfo[token].tokenAddress != address(0)) revert TokenAlreadyRegistered();
        if (uint(standard) > 2) revert InvalidTokenStandard();
        
        uint8 decimals = 18; // Default for native tokens
        
        if (standard != TokenStandard.NATIVE) {
            try IERC20Metadata(token).decimals() returns (uint8 tokenDecimals) {
                decimals = tokenDecimals;
            } catch {
                if (standard == TokenStandard.ERC20_WITH_DECIMALS) {
                    revert("Token does not support decimals()");
                }
            }
        }
        
        tokenInfo[token] = TokenInfo(token, standard, decimals);
        emit TokenRegistered(token, standard, decimals);
    }
    
    /**
     * @dev Unregister a token
     * @param token Address of the token to unregister
     * @custom:emits TokenUnregistered when a token is unregistered
     * @custom:reverts ZeroAddress if token is the zero address
     * @custom:reverts TokenNotRegistered if token is not registered
     * @custom:access Only callable by accounts with REGISTRAR_ROLE
     */
    function unregisterToken(address token) 
        external 
        onlyRole(REGISTRAR_ROLE)
        nonReentrant
    {
        if (token == address(0)) revert ZeroAddress();
        if (tokenInfo[token].tokenAddress == address(0)) revert TokenNotRegistered();
        
        delete tokenInfo[token];
        emit TokenUnregistered(token);
    }

    /**
     * @inheritdoc IAdapter
     */
    function isCompatible(address token) external view override returns (bool) {
        if (token == address(0)) return true;
        
        try IERC20(token).totalSupply() {
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * @inheritdoc IAdapter
     */
    function getBalance(address token, address account) external view override returns (uint256) {
        if (token == address(0)) {
            return account.balance;
        }
        return IERC20(token).balanceOf(account);
    }
    
    /**
     * @dev Transfer tokens from one address to another
     * @param token The address of the token to transfer
     * @param from The address to transfer from
     * @param to The address to transfer to
     * @param amount The amount to transfer
     * @custom:emits TokensTransferred when tokens are successfully transferred
     * @custom:reverts if token is not registered
     * @custom:reverts if transfer fails
     */
    function safeTransfer(
        address token,
        address from,
        address to,
        uint256 amount
    ) external override nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) return;
        
        if (token == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
            // Handle native ETH transfer
            (bool success, ) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            // Handle ERC20 token transfer
            IERC20 tokenContract = IERC20(token);
            tokenContract.safeTransferFrom(from, to, amount);
        }
        
        emit TokensTransferred(token, from, to, amount);
    }
    
    /**
     * @notice Allow receiving ETH to this contract
     */
    receive() external payable {}
}
