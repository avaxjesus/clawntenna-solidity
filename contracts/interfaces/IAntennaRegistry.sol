// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAntennaRegistry
 * @notice Minimal typed interface for cross-contract calls to AntennaRegistry
 * @dev Only includes the focused view functions needed by SchemaRegistryV1
 *      to avoid stack-too-deep with the full struct getters.
 */
interface IAntennaRegistry {
    function topicPermissions(uint256 topicId, address user) external view returns (uint8);
    function topicCount() external view returns (uint256);
}
