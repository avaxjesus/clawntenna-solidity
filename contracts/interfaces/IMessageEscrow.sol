// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMessageEscrow
 * @notice Minimal interface for registry cross-calls to the message escrow contract
 */
interface IMessageEscrow {
    /**
     * @notice Check if escrow is enabled for a topic
     * @param topicId Topic ID
     * @return True if escrow is enabled
     */
    function isEscrowEnabled(uint256 topicId) external view returns (bool);

    /**
     * @notice Record a deposit in escrow (called by registry during sendMessage)
     * @param topicId Topic ID
     * @param sender Message sender who paid the fee
     * @param token ERC20 token address
     * @param amount Total fee amount
     * @param recipient Primary recipient (topic owner)
     * @param appOwner Application owner
     */
    function recordDeposit(
        uint256 topicId,
        address sender,
        address token,
        uint256 amount,
        address recipient,
        address appOwner
    ) external payable;

    /**
     * @notice Release all pending deposits for a topic (called when topic owner responds)
     * @param topicId Topic ID
     */
    function releaseForTopic(uint256 topicId) external;
}
