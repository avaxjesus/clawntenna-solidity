// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IAntennaRegistry.sol";

/**
 * @title SchemaRegistryV1
 * @notice On-chain registry for human-readable message schema definitions
 * @dev UUPS upgradeable pattern matching TopicKeyManagerV1
 *
 * Schemas describe the expected structure of decrypted message payloads.
 * Topics can bind to a schema so clients know how to parse messages.
 */
contract SchemaRegistryV1 is UUPSUpgradeable, OwnableUpgradeable {

    // ============ Version ============

    string public constant VERSION = "1.0.0";

    // ============ Constants ============

    uint8 private constant PERMISSION_ADMIN = 4;
    uint8 private constant ROLE_ADMIN = 8;

    // ============ Structs ============

    struct Schema {
        uint256 id;
        string name;
        string description;
        address creator;
        uint64 createdAt;
        uint256 versionCount;
        bool active;
    }

    struct SchemaVersion {
        string body;
        uint64 publishedAt;
    }

    struct TopicSchemaBinding {
        uint256 schemaId;
        uint256 version; // 0 = track latest
    }

    // ============ State ============

    address public registry;
    uint256 public schemaCount;

    // schemaId => Schema
    mapping(uint256 => Schema) public schemas;

    // schemaId => version => SchemaVersion
    mapping(uint256 => mapping(uint256 => SchemaVersion)) public schemaVersions;

    // keccak256(name) => schemaId (name uniqueness)
    mapping(bytes32 => uint256) public schemaNameHashes;

    // topicId => TopicSchemaBinding
    mapping(uint256 => TopicSchemaBinding) public topicSchemas;

    // ============ Events ============

    event SchemaCreated(uint256 indexed schemaId, string name, address indexed creator);
    event SchemaVersionPublished(uint256 indexed schemaId, uint256 version);
    event SchemaDeactivated(uint256 indexed schemaId);
    event TopicSchemaSet(uint256 indexed topicId, uint256 indexed schemaId, uint256 version);
    event TopicSchemaCleared(uint256 indexed topicId);

    // ============ Errors ============

    error InvalidName();
    error NameTaken();
    error SchemaNotFound();
    error SchemaNotActive();
    error NotSchemaCreator();
    error NotTopicAdmin();
    error EmptyBody();
    error InvalidVersion();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _registry) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        registry = _registry;

        // Register default schema (ID 1)
        _createSchemaInternal(
            "clawntenna-message-v1",
            "Standard Clawntenna chat message format",
            "text: string (required) - message content\n"
            "replyTo: string (optional) - tx hash of replied message\n"
            "replyText: string (optional) - preview of replied message\n"
            "replyAuthor: string (optional) - address of replied message author\n"
            "mentions: string[] (optional) - mentioned addresses",
            msg.sender
        );
    }

    // ============ Upgrade Authorization ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============ Admin Functions ============

    function setRegistry(address _registry) external onlyOwner {
        registry = _registry;
    }

    // ============ Schema CRUD ============

    /**
     * @notice Create a new schema (permissionless)
     * @param name Unique human-readable name
     * @param description Brief description
     * @param body Schema body in human-readable DSL
     * @return schemaId The new schema's ID
     */
    function createSchema(
        string calldata name,
        string calldata description,
        string calldata body
    ) external returns (uint256) {
        return _createSchemaInternal(name, description, body, msg.sender);
    }

    /**
     * @notice Publish a new version of a schema (creator only)
     * @param schemaId Schema to update
     * @param body New version's body
     * @return version The new version number
     */
    function publishSchemaVersion(uint256 schemaId, string calldata body) external returns (uint256) {
        Schema storage schema = schemas[schemaId];
        if (schema.id == 0) revert SchemaNotFound();
        if (!schema.active) revert SchemaNotActive();
        if (schema.creator != msg.sender) revert NotSchemaCreator();
        if (bytes(body).length == 0) revert EmptyBody();

        schema.versionCount++;
        uint256 version = schema.versionCount;

        schemaVersions[schemaId][version] = SchemaVersion({
            body: body,
            publishedAt: uint64(block.timestamp)
        });

        emit SchemaVersionPublished(schemaId, version);
        return version;
    }

    /**
     * @notice Deactivate a schema (creator or contract owner)
     * @param schemaId Schema to deactivate
     */
    function deactivateSchema(uint256 schemaId) external {
        Schema storage schema = schemas[schemaId];
        if (schema.id == 0) revert SchemaNotFound();
        if (schema.creator != msg.sender && owner() != msg.sender) revert NotSchemaCreator();

        schema.active = false;
        emit SchemaDeactivated(schemaId);
    }

    // ============ Topic Binding ============

    /**
     * @notice Bind a topic to a schema version
     * @param topicId Topic to bind
     * @param schemaId Schema to bind to
     * @param version Version to pin (0 = track latest)
     */
    function setTopicSchema(uint256 topicId, uint256 schemaId, uint256 version) external {
        _requireTopicAdmin(topicId);

        Schema storage schema = schemas[schemaId];
        if (schema.id == 0) revert SchemaNotFound();
        if (!schema.active) revert SchemaNotActive();
        if (version > schema.versionCount) revert InvalidVersion();

        topicSchemas[topicId] = TopicSchemaBinding({
            schemaId: schemaId,
            version: version
        });

        emit TopicSchemaSet(topicId, schemaId, version);
    }

    /**
     * @notice Clear a topic's schema binding
     * @param topicId Topic to unbind
     */
    function clearTopicSchema(uint256 topicId) external {
        _requireTopicAdmin(topicId);

        delete topicSchemas[topicId];
        emit TopicSchemaCleared(topicId);
    }

    /**
     * @notice Bind the default schema to a batch of topics (owner only, for migration)
     * @param topicIds Array of topic IDs to bind
     * @param schemaId Schema ID to bind
     * @param version Version to pin (0 = track latest)
     */
    function batchSetTopicSchema(
        uint256[] calldata topicIds,
        uint256 schemaId,
        uint256 version
    ) external onlyOwner {
        Schema storage schema = schemas[schemaId];
        if (schema.id == 0) revert SchemaNotFound();
        if (!schema.active) revert SchemaNotActive();
        if (version > schema.versionCount) revert InvalidVersion();

        for (uint256 i = 0; i < topicIds.length; i++) {
            topicSchemas[topicIds[i]] = TopicSchemaBinding({
                schemaId: schemaId,
                version: version
            });
            emit TopicSchemaSet(topicIds[i], schemaId, version);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get schema metadata
     */
    function getSchema(uint256 schemaId) external view returns (
        uint256 id,
        string memory name,
        string memory description,
        address creator,
        uint64 createdAt,
        uint256 versionCount,
        bool active
    ) {
        Schema storage schema = schemas[schemaId];
        return (
            schema.id,
            schema.name,
            schema.description,
            schema.creator,
            schema.createdAt,
            schema.versionCount,
            schema.active
        );
    }

    /**
     * @notice Get schema body for a specific version
     */
    function getSchemaBody(uint256 schemaId, uint256 version) external view returns (string memory) {
        if (schemas[schemaId].id == 0) revert SchemaNotFound();
        if (version == 0 || version > schemas[schemaId].versionCount) revert InvalidVersion();
        return schemaVersions[schemaId][version].body;
    }

    /**
     * @notice Get full schema version details
     */
    function getSchemaVersion(uint256 schemaId, uint256 version) external view returns (
        string memory body,
        uint64 publishedAt
    ) {
        if (schemas[schemaId].id == 0) revert SchemaNotFound();
        if (version == 0 || version > schemas[schemaId].versionCount) revert InvalidVersion();
        SchemaVersion storage sv = schemaVersions[schemaId][version];
        return (sv.body, sv.publishedAt);
    }

    /**
     * @notice Get a topic's bound schema, resolving version=0 to latest
     * @return schemaId The bound schema ID (0 if none)
     * @return version The resolved version number
     * @return body The schema body
     */
    function getTopicSchema(uint256 topicId) external view returns (
        uint256 schemaId,
        uint256 version,
        string memory body
    ) {
        TopicSchemaBinding storage binding = topicSchemas[topicId];
        if (binding.schemaId == 0) {
            return (0, 0, "");
        }

        Schema storage schema = schemas[binding.schemaId];
        uint256 resolvedVersion = binding.version == 0 ? schema.versionCount : binding.version;

        return (
            binding.schemaId,
            resolvedVersion,
            schemaVersions[binding.schemaId][resolvedVersion].body
        );
    }

    /**
     * @notice Get contract version
     */
    function getVersion() external pure returns (string memory) {
        return VERSION;
    }

    // ============ Internal Functions ============

    function _createSchemaInternal(
        string memory name,
        string memory description,
        string memory body,
        address creator
    ) internal returns (uint256) {
        bytes memory nameBytes = bytes(name);
        if (nameBytes.length == 0 || nameBytes.length > 64) revert InvalidName();
        if (bytes(body).length == 0) revert EmptyBody();

        bytes32 nameHash = keccak256(nameBytes);
        if (schemaNameHashes[nameHash] != 0) revert NameTaken();

        schemaCount++;
        uint256 schemaId = schemaCount;

        schemas[schemaId] = Schema({
            id: schemaId,
            name: name,
            description: description,
            creator: creator,
            createdAt: uint64(block.timestamp),
            versionCount: 1,
            active: true
        });

        schemaVersions[schemaId][1] = SchemaVersion({
            body: body,
            publishedAt: uint64(block.timestamp)
        });

        schemaNameHashes[nameHash] = schemaId;

        emit SchemaCreated(schemaId, name, creator);
        emit SchemaVersionPublished(schemaId, 1);

        return schemaId;
    }

    /**
     * @dev Check that msg.sender is a topic admin via the registry.
     * Topic admin = topic owner OR PERMISSION_ADMIN OR app ROLE_ADMIN OR app owner.
     *
     * Uses raw staticcall + targeted abi.decode to extract only the needed fields
     * from the auto-generated struct getters, avoiding stack-too-deep errors.
     */
    function _requireTopicAdmin(uint256 topicId) internal view {
        address reg = registry;

        // topics(topicId) returns (id, applicationId, ..., owner at slot 4, ...)
        // We only need: slot 0 (id), slot 1 (applicationId), slot 4 (owner)
        (bool ok, bytes memory data) = reg.staticcall(
            abi.encodeWithSignature("topics(uint256)", topicId)
        );
        require(ok, "topics() call failed");

        uint256 id;
        uint256 applicationId;
        address topicOwner;
        assembly {
            id := mload(add(data, 32))             // slot 0: id
            applicationId := mload(add(data, 64))  // slot 1: applicationId
            // slot 2,3 are name/description (dynamic, skip)
            // slot 4: owner — but dynamic types shift things.
            // Struct with dynamic fields: the ABI encodes fixed fields in order,
            // with offsets for dynamic ones. For the Topic struct:
            // 0: id (uint256) — 32 bytes
            // 1: applicationId (uint256) — 32 bytes
            // 2: name offset (uint256) — 32 bytes
            // 3: description offset (uint256) — 32 bytes
            // 4: owner (address) — 32 bytes
            topicOwner := mload(add(data, 160))     // 32 + 4*32 = 160
        }

        if (id == 0) revert SchemaNotFound();
        if (msg.sender == topicOwner) return;

        // Topic PERMISSION_ADMIN
        IAntennaRegistry iReg = IAntennaRegistry(reg);
        if (iReg.topicPermissions(topicId, msg.sender) == PERMISSION_ADMIN) return;

        // applications(applicationId) — we need slot 4 (owner)
        (ok, data) = reg.staticcall(
            abi.encodeWithSignature("applications(uint256)", applicationId)
        );
        require(ok, "applications() call failed");

        address appOwner;
        assembly {
            // Same layout: id, name offset, description offset, frontendUrl offset, owner
            // 0: id (uint256)
            // 1: name offset
            // 2: description offset
            // 3: frontendUrl offset
            // 4: owner (address)
            appOwner := mload(add(data, 160))
        }

        if (msg.sender == appOwner) return;

        // members(applicationId, msg.sender) — returns (account, nickname, roles, joinedAt)
        // We need slot 2 (roles)
        (ok, data) = reg.staticcall(
            abi.encodeWithSignature("members(uint256,address)", applicationId, msg.sender)
        );
        require(ok, "members() call failed");

        uint8 roles;
        assembly {
            // 0: account (address)
            // 1: nickname offset (dynamic)
            // 2: roles (uint8)
            roles := mload(add(data, 96))
        }

        if ((roles & ROLE_ADMIN) == ROLE_ADMIN) return;

        revert NotTopicAdmin();
    }
}
