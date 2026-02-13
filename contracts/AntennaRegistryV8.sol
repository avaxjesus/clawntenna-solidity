// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AntennaRegistryV7.sol";
import "./interfaces/IMessageEscrow.sol";

/**
 * @title AntennaRegistryV8
 * @notice Adds optional message fee escrow — fees are held until topic owner responds
 * @dev When escrow is enabled for a topic, sendMessage routes fees to the escrow contract
 *      instead of distributing them immediately. When the topic owner sends a message
 *      (responds), pending escrow deposits are released with the standard 90/5/5 split.
 */
contract AntennaRegistryV8 is AntennaRegistryV7 {

    // ============ Version ============

    string public constant VERSION_V8 = "8.0.0";

    // ============ V8 Storage ============

    /// @notice Address of the MessageEscrow contract
    address public escrowContract;

    // ============ V8 Events ============

    event EscrowContractUpdated(address escrowContract);

    // ============ V8 Admin Functions ============

    /**
     * @notice Set the escrow contract address (owner only)
     * @param _escrowContract Address of the MessageEscrowV1 contract
     */
    function setEscrowContract(address _escrowContract) external onlyOwner {
        escrowContract = _escrowContract;
        emit EscrowContractUpdated(_escrowContract);
    }

    // ============ V8 Overrides ============

    /**
     * @notice Send a message to a topic (V8 with escrow support)
     * @dev When escrow is enabled for the topic:
     *      - Non-exempt sender fees are transferred to the escrow contract
     *      - When the topic owner sends a message, pending deposits are released
     *      When escrow is not enabled, falls back to V7's direct 90/5/5 split.
     * @param topicId Topic ID
     * @param payload Message payload (encrypted)
     */
    function sendMessage(uint256 topicId, bytes calldata payload) external payable virtual override nonReentrant {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) revert TopicNotFound();
        if (!canWriteToTopic(topicId, msg.sender)) revert NotAuthorized();

        // Collect message fee if set, but exempt privileged users
        uint256 feeAmount = topicMessageFeeAmount[topicId];
        address feeTokenAddr = topicMessageFeeToken[topicId];
        if (feeAmount > 0 && feeTokenAddr != address(0)) {
            bool isExempt = msg.sender == topic.owner ||
                            msg.sender == applications[topic.applicationId].owner ||
                            _hasRole(topic.applicationId, msg.sender, ROLE_ADMIN) ||
                            topicPermissions[topicId][msg.sender] == PERMISSION_ADMIN;

            if (!isExempt) {
                if (escrowContract != address(0) && IMessageEscrow(escrowContract).isEscrowEnabled(topicId)) {
                    // Escrow path: transfer full amount to escrow, then record deposit
                    IERC20 token = IERC20(feeTokenAddr);
                    token.transferFrom(msg.sender, escrowContract, feeAmount);
                    IMessageEscrow(escrowContract).recordDeposit(
                        topicId,
                        msg.sender,
                        feeTokenAddr,
                        feeAmount,
                        topic.owner,
                        applications[topic.applicationId].owner
                    );
                } else {
                    // Normal V7 path: direct 90/5/5 split
                    _collectFeeWithTripleSplit(
                        feeTokenAddr,
                        feeAmount,
                        topic.owner,
                        applications[topic.applicationId].owner
                    );
                }
            }
        }

        topic.messageCount++;
        topic.lastMessageAt = uint64(block.timestamp);

        emit MessageSent(topicId, msg.sender, payload, block.timestamp);

        // If the topic owner is sending a message, release pending escrow deposits
        if (msg.sender == topic.owner && escrowContract != address(0)) {
            // releaseForTopic is a no-op if nothing is pending
            IMessageEscrow(escrowContract).releaseForTopic(topicId);
        }
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure virtual override returns (string memory) {
        return VERSION_V8;
    }
}
