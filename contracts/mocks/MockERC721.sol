// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/**
 * @title MockERC721
 * @notice Minimal ERC721 mock for testing agent identity registration
 */
contract MockERC721 is ERC721Enumerable {
    constructor() ERC721("MockAgent", "MAGT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}
