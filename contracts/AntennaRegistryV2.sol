// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AntennaRegistryV1.sol";

/**
 * @title AntennaRegistryV2
 * @notice Upgrade with message fees and decoupled app-level fees
 * @dev Adds 3% platform fee on all app/topic-level fees
 */
contract AntennaRegistryV2 is AntennaRegistryV1 {

    // ============ Version ============

    string public constant VERSION_V2 = "2.0.0";

    // ============ V2 Constants ============

    uint256 public constant PLATFORM_FEE_BPS = 300; // 3% = 300 basis points
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ============ V2 Storage ============

    // Message fees per topic (appended storage - safe for upgrade)
    mapping(uint256 => address) public topicMessageFeeToken;
    mapping(uint256 => uint256) public topicMessageFeeAmount;

    // ============ V2 Events ============

    event TopicMessageFeeUpdated(uint256 indexed topicId, address token, uint256 amount);
    event PlatformFeeCollected(address indexed token, uint256 amount, address indexed recipient, address indexed treasury);

    // ============ V2 Functions ============

    /**
     * @notice Set message fee for a topic
     * @param topicId Topic ID
     * @param feeTokenAddr ERC20 token address for fee payment
     * @param feeAmount Amount to charge per message
     */
    function setTopicMessageFee(
        uint256 topicId,
        address feeTokenAddr,
        uint256 feeAmount
    ) external {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) revert TopicNotFound();

        // Topic owner, topic admin (PERMISSION_ADMIN), or app admin can set message fee
        bool canManage = msg.sender == topic.owner ||
                         topicPermissions[topicId][msg.sender] == PERMISSION_ADMIN ||
                         _hasRole(topic.applicationId, msg.sender, ROLE_ADMIN);
        if (!canManage) revert NotAuthorized();

        topicMessageFeeToken[topicId] = feeTokenAddr;
        topicMessageFeeAmount[topicId] = feeAmount;

        emit TopicMessageFeeUpdated(topicId, feeTokenAddr, feeAmount);
    }

    /**
     * @notice Get message fee configuration for a topic
     * @param topicId Topic ID
     * @return token Fee token address
     * @return amount Fee amount
     */
    function getTopicMessageFee(uint256 topicId) external view returns (address token, uint256 amount) {
        return (topicMessageFeeToken[topicId], topicMessageFeeAmount[topicId]);
    }

    /**
     * @notice Send a message to a topic (V2 with fee collection)
     * @param topicId Topic ID
     * @param payload Message payload (encrypted)
     */
    function sendMessage(uint256 topicId, bytes calldata payload) external virtual override nonReentrant {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) revert TopicNotFound();
        if (!canWriteToTopic(topicId, msg.sender)) revert NotAuthorized();

        // Collect message fee if set (independent of global feesEnabled)
        uint256 feeAmount = topicMessageFeeAmount[topicId];
        address feeTokenAddr = topicMessageFeeToken[topicId];
        if (feeAmount > 0 && feeTokenAddr != address(0)) {
            _collectFeeWithPlatformSplit(feeTokenAddr, feeAmount, topic.owner);
        }

        topic.messageCount++;
        topic.lastMessageAt = uint64(block.timestamp);

        emit MessageSent(topicId, msg.sender, payload, block.timestamp);
    }

    /**
     * @notice Create a topic (V2 with decoupled fees)
     * @dev Topic creation fees now work independently of global feesEnabled flag
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

        // Collect app-level topic fee if set (DECOUPLED from global feesEnabled)
        if (app.topicCreationFeeAmount > 0 && app.topicCreationFeeToken != address(0)) {
            _collectFeeWithPlatformSplit(app.topicCreationFeeToken, app.topicCreationFeeAmount, app.owner);
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

    /**
     * @notice Collect fee with 3% platform split
     * @param tokenAddr ERC20 token address
     * @param amount Total fee amount
     * @param recipient App/topic owner who receives 97%
     */
    function _collectFeeWithPlatformSplit(
        address tokenAddr,
        uint256 amount,
        address recipient
    ) internal {
        IERC20 token = IERC20(tokenAddr);

        if (token.balanceOf(msg.sender) < amount) revert InsufficientBalance();
        if (token.allowance(msg.sender, address(this)) < amount) revert InsufficientAllowance();

        // Calculate platform fee (3%)
        uint256 platformFee = (amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 recipientAmount = amount - platformFee;

        // Transfer to recipient (97%)
        token.transferFrom(msg.sender, recipient, recipientAmount);

        // Transfer platform fee to treasury (3%)
        if (platformFee > 0 && treasury != address(0)) {
            token.transferFrom(msg.sender, treasury, platformFee);
            emit PlatformFeeCollected(tokenAddr, platformFee, recipient, treasury);
        }
    }

    /**
     * @notice Get contract version
     */
    function getVersion() external pure virtual override returns (string memory) {
        return VERSION_V2;
    }
}
