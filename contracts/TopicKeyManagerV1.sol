// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title TopicKeyManagerV1
 * @notice ECDH-based key distribution for private Antenna topics
 * @dev UUPS upgradeable pattern for safe contract upgrades
 * 
 * Flow:
 * 1. Users register their secp256k1 public key
 * 2. Topic admins encrypt symmetric keys using ECDH
 * 3. Users fetch and decrypt their keys client-side
 */
contract TopicKeyManagerV1 is UUPSUpgradeable, OwnableUpgradeable {
    
    // ============ Version ============
    
    string public constant VERSION = "1.0.0";
    
    // ============ Structs ============
    
    struct KeyGrant {
        bytes encryptedKey;      // Topic key encrypted with ECDH shared secret
        bytes granterPublicKey;  // Granter's ECDH public key (for decryption)
        address granter;         // Who granted access
        uint256 keyVersion;      // Version when granted
        uint64 grantedAt;        // Timestamp
    }
    
    // ============ State ============
    
    address public registry;  // AntennaRegistry address
    
    // User ECDH public keys: user => compressed secp256k1 public key (33 bytes)
    mapping(address => bytes) public publicKeys;
    
    // Key grants: topicId => user => KeyGrant
    mapping(uint256 => mapping(address => KeyGrant)) public keyGrants;
    
    // Key versions: topicId => current version (increments on rotation)
    mapping(uint256 => uint256) public keyVersions;
    
    // ============ Events ============
    
    event PublicKeyRegistered(address indexed user, bytes publicKey);
    event PublicKeyUpdated(address indexed user, bytes publicKey);
    event KeyAccessGranted(uint256 indexed topicId, address indexed user, address indexed granter, uint256 version);
    event KeyAccessRevoked(uint256 indexed topicId, address indexed user);
    event KeyRotated(uint256 indexed topicId, uint256 newVersion);
    
    // ============ Errors ============
    
    error InvalidPublicKey();
    error PublicKeyNotRegistered(address user);
    error NotAuthorized();
    error InvalidEncryptedKey();
    error TopicNotFound();
    error ArrayLengthMismatch();
    error BatchSizeTooLarge();
    
    // ============ Initializer ============
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(address _registry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        
        registry = _registry;
    }
    
    // ============ Upgrade Authorization ============
    
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
    
    // ============ Admin Functions ============
    
    function setRegistry(address _registry) external onlyOwner {
        registry = _registry;
    }
    
    // ============ Public Key Registration ============
    
    /**
     * @notice Register your ECDH public key for receiving encrypted topic keys
     * @param publicKey Compressed secp256k1 public key (33 bytes, starts with 0x02 or 0x03)
     */
    function registerPublicKey(bytes calldata publicKey) external {
        // Validate: compressed secp256k1 public key should be 33 bytes
        if (publicKey.length != 33) revert InvalidPublicKey();
        // First byte should be 0x02 or 0x03 (compressed format)
        if (publicKey[0] != 0x02 && publicKey[0] != 0x03) revert InvalidPublicKey();
        
        bool isUpdate = publicKeys[msg.sender].length > 0;
        publicKeys[msg.sender] = publicKey;
        
        if (isUpdate) {
            emit PublicKeyUpdated(msg.sender, publicKey);
        } else {
            emit PublicKeyRegistered(msg.sender, publicKey);
        }
    }
    
    /**
     * @notice Check if a user has registered their public key
     */
    function hasPublicKey(address user) external view returns (bool) {
        return publicKeys[user].length > 0;
    }
    
    /**
     * @notice Get a user's registered public key
     */
    function getPublicKey(address user) external view returns (bytes memory) {
        return publicKeys[user];
    }
    
    // ============ Key Grant Functions ============
    
    /**
     * @notice Grant encrypted topic key access to a user
     * @param topicId Topic ID
     * @param user Recipient address
     * @param encryptedKey Topic symmetric key encrypted using ECDH (IV + ciphertext + tag)
     * @dev Caller must be topic admin. User must have registered public key.
     */
    function grantKeyAccess(uint256 topicId, address user, bytes calldata encryptedKey) external {
        // Validate encrypted key (should be at least IV(12) + some ciphertext + tag(16))
        if (encryptedKey.length < 44) revert InvalidEncryptedKey();
        
        // Check user has registered public key
        if (publicKeys[user].length == 0) revert PublicKeyNotRegistered(user);
        
        // Check caller has registered public key (needed for recipient to decrypt)
        if (publicKeys[msg.sender].length == 0) revert PublicKeyNotRegistered(msg.sender);
        
        // TODO: Optionally verify caller is topic admin via registry
        // For now, anyone with a public key can grant (caller takes responsibility)
        
        uint256 currentVersion = keyVersions[topicId];
        
        keyGrants[topicId][user] = KeyGrant({
            encryptedKey: encryptedKey,
            granterPublicKey: publicKeys[msg.sender],
            granter: msg.sender,
            keyVersion: currentVersion,
            grantedAt: uint64(block.timestamp)
        });
        
        emit KeyAccessGranted(topicId, user, msg.sender, currentVersion);
    }
    
    /**
     * @notice Batch grant key access to multiple users
     * @param topicId Topic ID
     * @param users Array of recipient addresses
     * @param encryptedKeys Array of encrypted keys (one per user)
     */
    function batchGrantKeyAccess(
        uint256 topicId,
        address[] calldata users,
        bytes[] calldata encryptedKeys
    ) external {
        if (users.length != encryptedKeys.length) revert ArrayLengthMismatch();
        if (users.length > 50) revert BatchSizeTooLarge(); // Gas limit protection
        
        if (publicKeys[msg.sender].length == 0) revert PublicKeyNotRegistered(msg.sender);
        
        uint256 currentVersion = keyVersions[topicId];
        bytes memory granterPubKey = publicKeys[msg.sender];
        
        for (uint256 i = 0; i < users.length; i++) {
            if (encryptedKeys[i].length < 44) revert InvalidEncryptedKey();
            if (publicKeys[users[i]].length == 0) revert PublicKeyNotRegistered(users[i]);
            
            keyGrants[topicId][users[i]] = KeyGrant({
                encryptedKey: encryptedKeys[i],
                granterPublicKey: granterPubKey,
                granter: msg.sender,
                keyVersion: currentVersion,
                grantedAt: uint64(block.timestamp)
            });
            
            emit KeyAccessGranted(topicId, users[i], msg.sender, currentVersion);
        }
    }
    
    /**
     * @notice Revoke a user's key access
     * @param topicId Topic ID
     * @param user User to revoke
     * @dev Note: User may still have cached key. Rotate key for full revocation.
     */
    function revokeKeyAccess(uint256 topicId, address user) external {
        KeyGrant storage grant = keyGrants[topicId][user];
        
        // Only granter or owner can revoke
        if (grant.granter != msg.sender && owner() != msg.sender) revert NotAuthorized();
        
        delete keyGrants[topicId][user];
        emit KeyAccessRevoked(topicId, user);
    }
    
    /**
     * @notice Rotate topic key version (use after revoking users)
     * @param topicId Topic ID
     * @dev After rotation, re-grant keys to remaining authorized users
     */
    function rotateKey(uint256 topicId) external {
        // TODO: Optionally verify caller is topic admin via registry
        keyVersions[topicId]++;
        emit KeyRotated(topicId, keyVersions[topicId]);
    }
    
    // ============ Key Retrieval ============
    
    /**
     * @notice Check if user has key access to a topic
     */
    function hasKeyAccess(uint256 topicId, address user) external view returns (bool) {
        return keyGrants[topicId][user].encryptedKey.length > 0;
    }
    
    /**
     * @notice Get your encrypted topic key
     * @param topicId Topic ID
     * @return encryptedKey The encrypted symmetric key
     * @return granterPublicKey Granter's public key (for ECDH decryption)
     * @return granter Address who granted access
     * @return keyVersion Version when key was granted
     * @return currentVersion Current key version (if different, key was rotated)
     */
    function getMyKey(uint256 topicId) external view returns (
        bytes memory encryptedKey,
        bytes memory granterPublicKey,
        address granter,
        uint256 keyVersion,
        uint256 currentVersion
    ) {
        KeyGrant storage grant = keyGrants[topicId][msg.sender];
        return (
            grant.encryptedKey,
            grant.granterPublicKey,
            grant.granter,
            grant.keyVersion,
            keyVersions[topicId]
        );
    }
    
    /**
     * @notice Get key grant details for a user (for admins)
     */
    function getKeyGrant(uint256 topicId, address user) external view returns (KeyGrant memory) {
        return keyGrants[topicId][user];
    }
    
    // ============ Migration Helpers ============
    
    /**
     * @notice Export user's public key and grants for migration
     * @param user User address
     * @param topicIds Topics to export grants for
     */
    function exportUserData(address user, uint256[] calldata topicIds) external view returns (bytes memory) {
        bytes[] memory grants = new bytes[](topicIds.length);
        
        for (uint256 i = 0; i < topicIds.length; i++) {
            KeyGrant storage grant = keyGrants[topicIds[i]][user];
            grants[i] = abi.encode(
                topicIds[i],
                grant.encryptedKey,
                grant.granterPublicKey,
                grant.granter,
                grant.keyVersion,
                grant.grantedAt
            );
        }
        
        return abi.encode(
            user,
            publicKeys[user],
            grants
        );
    }
    
    /**
     * @notice Get contract version
     */
    function getVersion() external pure returns (string memory) {
        return VERSION;
    }
}
