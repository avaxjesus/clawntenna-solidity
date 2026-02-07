// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AntennaRegistryV2.sol";

/**
 * @title AntennaRegistryV3
 * @notice Upgrade with user nicknames for non-members
 * @dev Allows anyone to set a nickname without requiring membership
 */
contract AntennaRegistryV3 is AntennaRegistryV2 {

    // ============ Version ============

    string public constant VERSION_V3 = "3.0.0";

    // ============ V3 Storage ============

    // User nicknames - anyone can set their own (not just members)
    // appId => user => nickname
    mapping(uint256 => mapping(address => string)) public userNicknames;

    // Nickname change cooldown tracking
    // appId => user => lastChangeTimestamp
    mapping(uint256 => mapping(address => uint256)) public nicknameLastChanged;

    // Per-app cooldown settings (0 = no cooldown, default)
    // appId => cooldownSeconds
    mapping(uint256 => uint256) public appNicknameCooldown;

    // ============ V3 Events ============

    event UserNicknameSet(uint256 indexed applicationId, address indexed user, string nickname);
    event NicknameCooldownSet(uint256 indexed applicationId, uint256 cooldownSeconds);

    // ============ V3 Errors ============

    error NicknameCooldownActive(uint256 timeRemaining);

    // ============ V3 Functions ============

    /**
     * @notice Set your own nickname for an application (no membership required)
     * @dev Users can only set their own nickname (msg.sender). Subject to app-specific cooldown.
     * @param appId Application ID
     * @param nickname Your display name (max 64 chars)
     */
    function setNickname(uint256 appId, string calldata nickname) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();

        // Check app-specific cooldown (skip if cooldown is 0 or first time setting)
        uint256 cooldown = appNicknameCooldown[appId];
        if (cooldown > 0) {
            uint256 lastChanged = nicknameLastChanged[appId][msg.sender];
            if (lastChanged > 0) {
                uint256 timeSinceChange = block.timestamp - lastChanged;
                if (timeSinceChange < cooldown) {
                    revert NicknameCooldownActive(cooldown - timeSinceChange);
                }
            }
        }

        // Basic validation - prevent excessively long nicknames
        require(bytes(nickname).length <= 64, "Nickname too long");

        userNicknames[appId][msg.sender] = nickname;
        nicknameLastChanged[appId][msg.sender] = block.timestamp;
        emit UserNicknameSet(appId, msg.sender, nickname);
    }

    /**
     * @notice Clear your nickname for an application
     * @dev Subject to the same app-specific cooldown as setNickname
     * @param appId Application ID
     */
    function clearNickname(uint256 appId) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();

        // Check app-specific cooldown
        uint256 cooldown = appNicknameCooldown[appId];
        if (cooldown > 0) {
            uint256 lastChanged = nicknameLastChanged[appId][msg.sender];
            if (lastChanged > 0) {
                uint256 timeSinceChange = block.timestamp - lastChanged;
                if (timeSinceChange < cooldown) {
                    revert NicknameCooldownActive(cooldown - timeSinceChange);
                }
            }
        }

        delete userNicknames[appId][msg.sender];
        nicknameLastChanged[appId][msg.sender] = block.timestamp;
        emit UserNicknameSet(appId, msg.sender, "");
    }

    /**
     * @notice Set the nickname change cooldown for an application (owner/admin only)
     * @dev Set to 0 to disable cooldown
     * @param appId Application ID
     * @param cooldownSeconds Cooldown in seconds (e.g., 86400 for 24 hours, 0 to disable)
     */
    function setNicknameCooldown(uint256 appId, uint256 cooldownSeconds) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();

        // Only owner or admin can set cooldown
        bool canManage = msg.sender == app.owner || _hasRole(appId, msg.sender, ROLE_ADMIN);
        if (!canManage) revert NotAuthorized();

        appNicknameCooldown[appId] = cooldownSeconds;
        emit NicknameCooldownSet(appId, cooldownSeconds);
    }

    /**
     * @notice Get a user's nickname (checks member nickname first, then user nickname)
     * @dev Member nicknames take priority over user nicknames
     * @param appId Application ID
     * @param user User address
     * @return nickname The user's nickname (empty string if not set)
     */
    function getNickname(uint256 appId, address user) external view returns (string memory) {
        // Check if member with nickname first (members take priority)
        Member storage member = members[appId][user];
        if (member.account != address(0) && bytes(member.nickname).length > 0) {
            return member.nickname;
        }
        // Fall back to user nickname
        return userNicknames[appId][user];
    }

    /**
     * @notice Check if a user has a nickname set (either as member or user)
     * @param appId Application ID
     * @param user User address
     * @return hasNickname True if user has a nickname
     */
    function hasNickname(uint256 appId, address user) external view returns (bool) {
        // Check member nickname
        Member storage member = members[appId][user];
        if (member.account != address(0) && bytes(member.nickname).length > 0) {
            return true;
        }
        // Check user nickname
        return bytes(userNicknames[appId][user]).length > 0;
    }

    /**
     * @notice Check when a user can next change their nickname
     * @param appId Application ID
     * @param user User address
     * @return canChange Whether the user can change now
     * @return timeRemaining Seconds until they can change (0 if can change now)
     */
    function canChangeNickname(uint256 appId, address user) external view returns (bool canChange, uint256 timeRemaining) {
        uint256 cooldown = appNicknameCooldown[appId];

        // No cooldown set for this app
        if (cooldown == 0) {
            return (true, 0);
        }

        uint256 lastChanged = nicknameLastChanged[appId][user];
        if (lastChanged == 0) {
            return (true, 0);
        }

        uint256 timeSinceChange = block.timestamp - lastChanged;
        if (timeSinceChange >= cooldown) {
            return (true, 0);
        }

        return (false, cooldown - timeSinceChange);
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure virtual override returns (string memory) {
        return VERSION_V3;
    }
}
