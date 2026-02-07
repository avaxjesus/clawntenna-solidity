// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AntennaRegistryV4.sol";

interface IERC721Ownable {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title AntennaRegistryV5
 * @notice Upgrade with on-chain agent identity registration
 * @dev Allows agents to register their ERC-8004 token ID per application,
 *      verified via ownerOf. Provides canonical (appId, address) → tokenId mapping.
 */
contract AntennaRegistryV5 is AntennaRegistryV4 {

    // ============ Version ============

    string public constant VERSION_V5 = "5.0.0";

    // ============ V5 Storage ============

    /// @notice Address of the ERC-8004 identity registry contract
    address public identityRegistryAddress;

    /// @notice Mapping of (appId, userAddress) → ERC-8004 tokenId (0 = not registered)
    mapping(uint256 => mapping(address => uint256)) public agentTokenIds;

    // ============ V5 Events ============

    event AgentIdentityRegistered(uint256 indexed applicationId, address indexed user, uint256 tokenId);
    event AgentIdentityCleared(uint256 indexed applicationId, address indexed user);
    event IdentityRegistryAddressUpdated(address identityRegistryAddress);

    // ============ V5 Errors ============

    error IdentityRegistryNotSet();
    error NotTokenOwner();
    error InvalidTokenId();

    // ============ V5 Functions ============

    /**
     * @notice Set the ERC-8004 identity registry address (owner only)
     * @param _identityRegistryAddress Address of the identity registry contract
     */
    function setIdentityRegistryAddress(address _identityRegistryAddress) external onlyOwner {
        identityRegistryAddress = _identityRegistryAddress;
        emit IdentityRegistryAddressUpdated(_identityRegistryAddress);
    }

    /**
     * @notice Register your ERC-8004 agent identity for an application
     * @dev Verifies caller owns the token via ownerOf. Does not require membership.
     * @param appId Application ID (must exist)
     * @param tokenId ERC-8004 token ID (must be > 0)
     */
    function registerAgentIdentity(uint256 appId, uint256 tokenId) external {
        if (identityRegistryAddress == address(0)) revert IdentityRegistryNotSet();
        if (tokenId == 0) revert InvalidTokenId();
        if (applications[appId].id == 0) revert ApplicationNotFound();

        // Verify caller owns the token
        address tokenOwner = IERC721Ownable(identityRegistryAddress).ownerOf(tokenId);
        if (tokenOwner != msg.sender) revert NotTokenOwner();

        agentTokenIds[appId][msg.sender] = tokenId;
        emit AgentIdentityRegistered(appId, msg.sender, tokenId);
    }

    /**
     * @notice Clear your agent identity registration for an application
     * @param appId Application ID (must exist)
     */
    function clearAgentIdentity(uint256 appId) external {
        if (applications[appId].id == 0) revert ApplicationNotFound();

        delete agentTokenIds[appId][msg.sender];
        emit AgentIdentityCleared(appId, msg.sender);
    }

    /**
     * @notice Get the registered agent token ID for a user in an application
     * @param appId Application ID
     * @param user User address
     * @return tokenId The registered token ID (0 = not registered)
     */
    function getAgentTokenId(uint256 appId, address user) external view virtual returns (uint256) {
        return agentTokenIds[appId][user];
    }

    /**
     * @notice Check if a user has a registered agent identity for an application
     * @param appId Application ID
     * @param user User address
     * @return True if the user has a registered agent identity
     */
    function hasAgentIdentity(uint256 appId, address user) external view virtual returns (bool) {
        return agentTokenIds[appId][user] > 0;
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure virtual override returns (string memory) {
        return VERSION_V5;
    }
}
