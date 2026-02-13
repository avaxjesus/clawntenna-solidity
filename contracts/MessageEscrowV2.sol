// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MessageEscrowV1.sol";

/**
 * @title MessageEscrowV2
 * @notice Adds native ETH escrow support alongside existing ERC-20 escrow
 * @dev When token == address(0), deposits/releases/refunds use native ETH.
 *      The registry forwards ETH via recordDeposit{value}() for native fee deposits.
 */
contract MessageEscrowV2 is MessageEscrowV1 {
    using SafeERC20 for IERC20;

    // ============ Version ============

    string public constant VERSION_V2 = "2.0.0";

    // ============ V2 Errors ============

    error NativeValueMismatch();
    error NativeTransferFailed();

    // ============ Receive ============

    /// @notice Accept plain ETH transfers (needed for registry to forward native fees)
    receive() external payable {}

    // ============ V2 Overrides ============

    /**
     * @notice Record a deposit in escrow (V2 with native ETH support)
     * @dev When token == address(0), validates msg.value == amount.
     *      When token != address(0), same as V1 (tokens already transferred).
     */
    function recordDeposit(
        uint256 topicId,
        address sender,
        address token,
        uint256 amount,
        address recipient,
        address appOwner
    ) external payable override onlyRegistry {
        if (token == address(0)) {
            // Native ETH: validate msg.value matches amount
            if (msg.value != amount) revert NativeValueMismatch();
        }
        // For ERC-20, tokens are already transferred to this contract by the registry

        depositCount++;
        uint256 depositId = depositCount;

        deposits[depositId] = EscrowDeposit({
            id: depositId,
            topicId: topicId,
            sender: sender,
            recipient: recipient,
            token: token,
            amount: amount,
            appOwner: appOwner,
            depositedAt: uint64(block.timestamp),
            timeout: topicEscrowTimeout[topicId],
            status: DepositStatus.Pending
        });

        _pendingDepositIds[topicId].push(depositId);

        emit DepositRecorded(depositId, topicId, sender, amount);
    }

    /**
     * @dev Distribute a deposit with the 90/5/5 split (V2 with native ETH support)
     */
    function _distributeDeposit(EscrowDeposit storage deposit) internal override {
        if (deposit.token == address(0)) {
            // Native ETH path
            uint256 platformFee = (deposit.amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
            uint256 appOwnerFee = (deposit.amount * APP_OWNER_FEE_BPS) / BPS_DENOMINATOR;
            uint256 recipientAmount = deposit.amount - platformFee - appOwnerFee;

            // Optimize: if recipient == appOwner, combine into single transfer (95%)
            if (deposit.recipient == deposit.appOwner) {
                (bool ok, ) = deposit.recipient.call{value: recipientAmount + appOwnerFee}("");
                if (!ok) revert NativeTransferFailed();
            } else {
                (bool ok1, ) = deposit.recipient.call{value: recipientAmount}("");
                if (!ok1) revert NativeTransferFailed();
                (bool ok2, ) = deposit.appOwner.call{value: appOwnerFee}("");
                if (!ok2) revert NativeTransferFailed();
            }

            // Transfer platform fee to treasury (5%)
            if (platformFee > 0 && treasury != address(0)) {
                (bool ok, ) = treasury.call{value: platformFee}("");
                if (!ok) revert NativeTransferFailed();
            }

            emit DepositReleased(
                deposit.id,
                deposit.topicId,
                recipientAmount,
                appOwnerFee,
                platformFee
            );
        } else {
            // ERC-20 path: delegate to V1
            super._distributeDeposit(deposit);
        }
    }

    /**
     * @dev Process a single refund (V2 with native ETH support)
     */
    function _processRefund(uint256 depositId) internal override {
        EscrowDeposit storage deposit = deposits[depositId];
        if (deposit.id == 0) revert DepositNotFound();
        if (deposit.status != DepositStatus.Pending) revert AlreadyResolved();
        if (msg.sender != deposit.sender) revert NotDepositor();
        if (block.timestamp < deposit.depositedAt + deposit.timeout) revert TimeoutNotExpired();

        // CEI: mark resolved before transfer
        deposit.status = DepositStatus.Refunded;

        // Remove from pending array
        _removePendingDeposit(deposit.topicId, depositId);

        if (deposit.token == address(0)) {
            // Native ETH refund
            (bool ok, ) = deposit.sender.call{value: deposit.amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            // ERC-20 refund
            IERC20(deposit.token).safeTransfer(deposit.sender, deposit.amount);
        }

        emit DepositRefunded(depositId, deposit.topicId, deposit.sender, deposit.amount);
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure override returns (string memory) {
        return VERSION_V2;
    }
}
