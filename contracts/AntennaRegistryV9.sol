// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AntennaRegistryV8.sol";

/**
 * @title AntennaRegistryV9
 * @notice Adds native ETH fee support alongside existing ERC-20 fees
 * @dev Uses address(0) as sentinel for "native ETH fee" (standard pattern).
 *      Both sendMessage and createTopic are now payable. When feeTokenAddr == address(0),
 *      msg.value is used for fee payment with the same 90/5/5 split.
 *      Excess msg.value is refunded to the sender.
 */
contract AntennaRegistryV9 is AntennaRegistryV8 {

    // ============ Version ============

    string public constant VERSION_V9 = "9.0.0";

    // ============ V9 Errors ============

    error InsufficientNativePayment();
    error NativeTransferFailed();

    // ============ V9 Internal Functions ============

    /**
     * @notice Collect native ETH fee with three-way split: 90% recipient, 5% app owner, 5% treasury
     * @dev When recipient == appOwner, combines into a single 95% transfer to save gas.
     * @param amount Total fee amount in wei
     * @param recipient Primary recipient (topic owner) — receives 90%
     * @param appOwner App owner — receives 5%
     */
    function _collectNativeFeeWithTripleSplit(
        uint256 amount,
        address recipient,
        address appOwner
    ) internal {
        uint256 platformFee = (amount * PLATFORM_FEE_BPS_V7) / BPS_DENOMINATOR;
        uint256 appOwnerFee = (amount * APP_OWNER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 recipientAmount = amount - platformFee - appOwnerFee;

        // Optimize: if recipient == appOwner, combine into single transfer (95%)
        if (recipient == appOwner) {
            (bool ok, ) = recipient.call{value: recipientAmount + appOwnerFee}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            (bool ok1, ) = recipient.call{value: recipientAmount}("");
            if (!ok1) revert NativeTransferFailed();
            (bool ok2, ) = appOwner.call{value: appOwnerFee}("");
            if (!ok2) revert NativeTransferFailed();
        }

        // Transfer platform fee to treasury (5%)
        if (platformFee > 0 && treasury != address(0)) {
            (bool ok, ) = treasury.call{value: platformFee}("");
            if (!ok) revert NativeTransferFailed();
        }

        emit FeeCollected(
            address(0), amount,
            recipient, recipientAmount,
            appOwner, appOwnerFee,
            platformFee
        );
    }

    /**
     * @dev Refund excess native ETH to sender
     */
    function _refundExcessETH(uint256 consumed) internal {
        uint256 excess = msg.value - consumed;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            if (!ok) revert NativeTransferFailed();
        }
    }

    // ============ V9 Overrides ============

    /**
     * @notice Send a message to a topic (V9 with native ETH fee support)
     * @dev When feeTokenAddr == address(0), fees are paid in native ETH via msg.value.
     *      When feeTokenAddr != address(0), falls back to V8's ERC-20 path.
     *      Excess msg.value is always refunded.
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
        uint256 nativeConsumed = 0;

        if (feeAmount > 0) {
            bool isExempt = msg.sender == topic.owner ||
                            msg.sender == applications[topic.applicationId].owner ||
                            _hasRole(topic.applicationId, msg.sender, ROLE_ADMIN) ||
                            topicPermissions[topicId][msg.sender] == PERMISSION_ADMIN;

            if (!isExempt) {
                if (feeTokenAddr == address(0)) {
                    // Native ETH path
                    if (msg.value < feeAmount) revert InsufficientNativePayment();
                    nativeConsumed = feeAmount;

                    if (escrowContract != address(0) && IMessageEscrow(escrowContract).isEscrowEnabled(topicId)) {
                        // Escrow path: forward ETH to escrow
                        IMessageEscrow(escrowContract).recordDeposit{value: feeAmount}(
                            topicId,
                            msg.sender,
                            address(0),
                            feeAmount,
                            topic.owner,
                            applications[topic.applicationId].owner
                        );
                    } else {
                        // Direct native split
                        _collectNativeFeeWithTripleSplit(
                            feeAmount,
                            topic.owner,
                            applications[topic.applicationId].owner
                        );
                    }
                } else {
                    // ERC-20 path (same as V8)
                    if (escrowContract != address(0) && IMessageEscrow(escrowContract).isEscrowEnabled(topicId)) {
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
                        _collectFeeWithTripleSplit(
                            feeTokenAddr,
                            feeAmount,
                            topic.owner,
                            applications[topic.applicationId].owner
                        );
                    }
                }
            }
        }

        topic.messageCount++;
        topic.lastMessageAt = uint64(block.timestamp);

        emit MessageSent(topicId, msg.sender, payload, block.timestamp);

        // If the topic owner is sending a message, release pending escrow deposits
        if (msg.sender == topic.owner && escrowContract != address(0)) {
            IMessageEscrow(escrowContract).releaseForTopic(topicId);
        }

        // Refund excess ETH (covers overpayment and exempt users who sent ETH)
        if (msg.value > nativeConsumed) {
            _refundExcessETH(nativeConsumed);
        }
    }

    /**
     * @notice Create a topic (V9 with native ETH fee support)
     * @dev Topic creation fees now support native ETH when topicCreationFeeToken == address(0).
     *      Excess msg.value is refunded.
     * @param appId Application ID
     * @param name Topic name
     * @param description Topic description
     * @param accessLevel Access level (PUBLIC, PUBLIC_LIMITED, PRIVATE)
     * @return topicId The newly created topic ID
     */
    function createTopic(
        uint256 appId,
        string calldata name,
        string calldata description,
        uint8 accessLevel
    ) external payable virtual override nonReentrant returns (uint256) {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (accessLevel > ACCESS_PRIVATE) revert InvalidAccessLevel();

        // Check permission
        bool canCreate = app.allowPublicTopicCreation ||
                        msg.sender == app.owner ||
                        _hasRole(appId, msg.sender, ROLE_TOPIC_MANAGER) ||
                        _hasRole(appId, msg.sender, ROLE_ADMIN);
        if (!canCreate) revert NotAuthorized();

        // Collect app-level topic fee if set
        uint256 nativeConsumed = 0;
        if (app.topicCreationFeeAmount > 0) {
            if (app.topicCreationFeeToken == address(0)) {
                // Native ETH path
                if (msg.value < app.topicCreationFeeAmount) revert InsufficientNativePayment();
                nativeConsumed = app.topicCreationFeeAmount;

                _collectNativeFeeWithTripleSplit(
                    app.topicCreationFeeAmount,
                    app.owner,   // recipient (topic creation fees go to app owner)
                    app.owner    // appOwner (same — combines to 95%)
                );
            } else {
                // ERC-20 path (same as V7)
                _collectFeeWithTripleSplit(
                    app.topicCreationFeeToken,
                    app.topicCreationFeeAmount,
                    app.owner,
                    app.owner
                );
            }
        }

        // Create topic
        topicCount++;
        uint256 topicId = topicCount;

        topics[topicId] = Topic({
            id: topicId,
            applicationId: appId,
            name: name,
            description: description,
            owner: msg.sender,
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            lastMessageAt: 0,
            messageCount: 0,
            accessLevel: accessLevel,
            active: true
        });

        applicationTopics[appId].push(topicId);
        app.topicCount++;

        // Give creator admin permission on topic
        topicPermissions[topicId][msg.sender] = PERMISSION_ADMIN;

        emit TopicCreated(topicId, appId, name, msg.sender, accessLevel);
        emit TopicPermissionSet(topicId, msg.sender, PERMISSION_ADMIN);

        // Refund excess ETH
        if (msg.value > nativeConsumed) {
            _refundExcessETH(nativeConsumed);
        }

        return topicId;
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure override returns (string memory) {
        return VERSION_V9;
    }
}
