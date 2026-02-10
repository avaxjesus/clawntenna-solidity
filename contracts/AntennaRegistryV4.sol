// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AntennaRegistryV3.sol";

/**
 * @title AntennaRegistryV4
 * @notice Upgrade with fee exemptions for topic owners and app admins
 * @dev Topic owners, app admins, and app owners are exempt from message fees
 */
contract AntennaRegistryV4 is AntennaRegistryV3 {

    // ============ Version ============

    string public constant VERSION_V4 = "4.0.0";

    // ============ V4 Functions ============

    /**
     * @notice Send a message to a topic (V4 with fee exemptions)
     * @dev Topic owner, app owner, and app admins are exempt from message fees.
     *      The topic owner would otherwise pay themselves (minus platform fee),
     *      and admins should be able to moderate without cost.
     * @param topicId Topic ID
     * @param payload Message payload (encrypted)
     */
    function sendMessage(uint256 topicId, bytes calldata payload) external virtual override nonReentrant {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) revert TopicNotFound();
        if (!canWriteToTopic(topicId, msg.sender)) revert NotAuthorized();

        // Collect message fee if set, but exempt privileged users
        uint256 feeAmount = topicMessageFeeAmount[topicId];
        address feeTokenAddr = topicMessageFeeToken[topicId];
        if (feeAmount > 0 && feeTokenAddr != address(0)) {
            // Exempt: topic owner, app owner, app admins, topic admins
            bool isExempt = msg.sender == topic.owner ||
                            msg.sender == applications[topic.applicationId].owner ||
                            _hasRole(topic.applicationId, msg.sender, ROLE_ADMIN) ||
                            topicPermissions[topicId][msg.sender] == PERMISSION_ADMIN;

            if (!isExempt) {
                _collectFeeWithPlatformSplit(feeTokenAddr, feeAmount, topic.owner);
            }
        }

        topic.messageCount++;
        topic.lastMessageAt = uint64(block.timestamp);

        emit MessageSent(topicId, msg.sender, payload, block.timestamp);
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure virtual override returns (string memory) {
        return VERSION_V4;
    }
}
