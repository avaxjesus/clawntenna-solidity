// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AntennaRegistryV5.sol";

/**
 * @title AntennaRegistryV6
 * @notice Adds live ownership validation to agent identity lookups
 * @dev getAgentTokenId now verifies the registered token is still owned by the user
 *      via ownerOf. Stale registrations (transferred tokens) return 0.
 */
contract AntennaRegistryV6 is AntennaRegistryV5 {

    // ============ Version ============

    string public constant VERSION_V6 = "6.0.0";

    // ============ Overrides ============

    /**
     * @notice Get the registered agent token ID for a user, with live ownership validation
     * @param appId Application ID
     * @param user User address
     * @return tokenId The registered token ID (0 if not registered or no longer owned)
     */
    function getAgentTokenId(uint256 appId, address user) external view override returns (uint256) {
        uint256 tokenId = agentTokenIds[appId][user];
        if (tokenId == 0) return 0;
        if (identityRegistryAddress == address(0)) return tokenId;

        try IERC721Ownable(identityRegistryAddress).ownerOf(tokenId) returns (address owner) {
            return owner == user ? tokenId : 0;
        } catch {
            return 0;
        }
    }

    /**
     * @notice Check if a user has a valid registered agent identity for an application
     * @param appId Application ID
     * @param user User address
     * @return True if the user has a valid registered agent identity
     */
    function hasAgentIdentity(uint256 appId, address user) external view override returns (bool) {
        return this.getAgentTokenId(appId, user) > 0;
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure override returns (string memory) {
        return VERSION_V6;
    }
}
