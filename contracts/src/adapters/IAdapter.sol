// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

/**
 * @title Adapter Interface
 * @dev Standard interface for all adapter contracts
 */
interface IAdapter {
    /**
     * @dev Get the name of the adapter
     * @return name Adapter name
     */
    function name() external pure returns (string memory);
    
    /**
     * @dev Get the version of the adapter
     * @return version Adapter version
     */
    function version() external pure returns (string memory);
    
    /**
     * @dev Check if the adapter is compatible with a specific token
     * @param token Address of the token to check
     * @return isCompatible Whether the token is compatible
     */
    function isCompatible(address token) external view returns (bool);
    
    /**
     * @dev Get the balance of a token for an account
     * @param token Address of the token
     * @param account Address of the account
     * @return balance Token balance
     */
    function getBalance(address token, address account) external view returns (uint256);
    
    /**
     * @dev Transfer tokens
     * @param token Address of the token
     * @param from Sender address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function safeTransfer(
        address token,
        address from,
        address to,
        uint256 amount
    ) external;
}
