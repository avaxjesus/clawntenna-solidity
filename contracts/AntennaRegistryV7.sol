// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AntennaRegistryV6.sol";

/**
 * @title AntennaRegistryV7
 * @notice Universal 90/5/5 fee split — topic owner, app owner, platform treasury
 * @dev Replaces the V2 two-way split (97% recipient / 3% treasury) with a three-way
 *      split: 90% topic owner, 5% app owner, 5% platform treasury.
 *      Applies to both message fees and topic creation fees.
 *      When recipient == appOwner, the two shares are combined into a single 95% transfer.
 */
contract AntennaRegistryV7 is AntennaRegistryV6 {

    // ============ Version ============

    string public constant VERSION_V7 = "7.0.0";

    // ============ V7 Constants ============

    /// @notice Platform treasury fee: 5% (500 basis points)
    uint256 public constant PLATFORM_FEE_BPS_V7 = 500;

    /// @notice App owner fee: 5% (500 basis points)
    uint256 public constant APP_OWNER_FEE_BPS = 500;

    // ============ V7 Events ============

    /**
     * @notice Emitted when a fee is collected with the three-way split
     * @param token ERC20 token address
     * @param totalAmount Total fee amount collected
     * @param recipient Primary recipient (topic owner) address
     * @param recipientAmount Amount sent to the primary recipient (90%)
     * @param appOwner App owner address
     * @param appOwnerAmount Amount sent to the app owner (5%)
     * @param platformAmount Amount sent to the platform treasury (5%)
     */
    event FeeCollected(
        address indexed token,
        uint256 totalAmount,
        address indexed recipient,
        uint256 recipientAmount,
        address indexed appOwner,
        uint256 appOwnerAmount,
        uint256 platformAmount
    );

    // ============ V7 Internal Functions ============

    /**
     * @notice Collect fee with three-way split: 90% recipient, 5% app owner, 5% treasury
     * @dev When recipient == appOwner, combines into a single 95% transfer to save gas.
     *      All transfers use transferFrom (sender must have approved this contract).
     * @param tokenAddr ERC20 token address
     * @param amount Total fee amount
     * @param recipient Primary recipient (topic owner) — receives 90%
     * @param appOwner App owner — receives 5%
     */
    function _collectFeeWithTripleSplit(
        address tokenAddr,
        uint256 amount,
        address recipient,
        address appOwner
    ) internal {
        IERC20 token = IERC20(tokenAddr);

        if (token.balanceOf(msg.sender) < amount) revert InsufficientBalance();
        if (token.allowance(msg.sender, address(this)) < amount) revert InsufficientAllowance();

        uint256 platformFee = (amount * PLATFORM_FEE_BPS_V7) / BPS_DENOMINATOR;
        uint256 appOwnerFee = (amount * APP_OWNER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 recipientAmount = amount - platformFee - appOwnerFee;

        // Optimize: if recipient == appOwner, combine into single transfer (95%)
        if (recipient == appOwner) {
            token.transferFrom(msg.sender, recipient, recipientAmount + appOwnerFee);
        } else {
            token.transferFrom(msg.sender, recipient, recipientAmount);
            token.transferFrom(msg.sender, appOwner, appOwnerFee);
        }

        // Transfer platform fee to treasury (5%)
        if (platformFee > 0 && treasury != address(0)) {
            token.transferFrom(msg.sender, treasury, platformFee);
        }

        emit FeeCollected(
            tokenAddr, amount,
            recipient, recipientAmount,
            appOwner, appOwnerFee,
            platformFee
        );
    }

    // ============ V7 Application Management ============

    /**
     * @notice Set application active status
     * @dev Only callable by the application owner.
     * @param appId Application ID
     * @param active New active status
     */
    function setApplicationActive(uint256 appId, bool active) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (msg.sender != app.owner) revert NotAuthorized();
        app.active = active;
    }

    /**
     * @notice Set whether public topic creation is allowed for an application
     * @dev Only callable by the application owner.
     * @param appId Application ID
     * @param allow Whether to allow public topic creation
     */
    function setAllowPublicTopicCreation(uint256 appId, bool allow) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (msg.sender != app.owner) revert NotAuthorized();
        app.allowPublicTopicCreation = allow;
    }

    // ============ V7 Overrides ============

    /**
     * @notice Send a message to a topic (V7 with 90/5/5 fee split)
     * @dev Topic owner, app owner, app admins, and topic admins are exempt from message fees.
     *      Non-exempt senders pay: 90% to topic owner, 5% to app owner, 5% to treasury.
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
                _collectFeeWithTripleSplit(
                    feeTokenAddr,
                    feeAmount,
                    topic.owner,
                    applications[topic.applicationId].owner
                );
            }
        }

        topic.messageCount++;
        topic.lastMessageAt = uint64(block.timestamp);

        emit MessageSent(topicId, msg.sender, payload, block.timestamp);
    }

    /**
     * @notice Create a topic (V7 with 90/5/5 fee split on topic creation fees)
     * @dev Topic creation fees now use the three-way split. Since both recipient and
     *      appOwner are app.owner, the optimization combines them into 95% app owner + 5% treasury.
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
    ) external override nonReentrant returns (uint256) {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (accessLevel > ACCESS_PRIVATE) revert InvalidAccessLevel();

        // Check permission
        bool canCreate = app.allowPublicTopicCreation ||
                        msg.sender == app.owner ||
                        _hasRole(appId, msg.sender, ROLE_TOPIC_MANAGER) ||
                        _hasRole(appId, msg.sender, ROLE_ADMIN);
        if (!canCreate) revert NotAuthorized();

        // Collect app-level topic fee if set (with 90/5/5 split)
        // recipient = app.owner, appOwner = app.owner → combined 95% + 5% treasury
        if (app.topicCreationFeeAmount > 0 && app.topicCreationFeeToken != address(0)) {
            _collectFeeWithTripleSplit(
                app.topicCreationFeeToken,
                app.topicCreationFeeAmount,
                app.owner,   // recipient (topic creation fees go to app owner)
                app.owner    // appOwner (same — combines to 95%)
            );
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

        return topicId;
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure virtual override returns (string memory) {
        return VERSION_V7;
    }
}
