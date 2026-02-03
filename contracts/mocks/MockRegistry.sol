// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockRegistry
 * @notice Minimal mock registry for testing TopicKeyManagerV1
 */
contract MockRegistry {
    // Minimal implementation - just needs to exist for initialization
    
    function getVersion() external pure returns (string memory) {
        return "mock";
    }
}
