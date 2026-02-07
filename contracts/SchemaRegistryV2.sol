// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SchemaRegistryV1.sol";

/**
 * @title SchemaRegistryV2
 * @notice Application-scoped schemas — schemas created within an app are only visible to that app
 * @dev Extends SchemaRegistryV1. New storage is appended (safe for UUPS upgrade).
 *      V1's `createSchema` still works (creates schemas with applicationId=0).
 *      Frontend should use `createAppSchema` exclusively.
 */
contract SchemaRegistryV2 is SchemaRegistryV1 {

    // ============ Constants ============

    // Redeclared from V1 (private there, not inheritable)
    uint8 private constant _ROLE_ADMIN = 8;

    // ============ Version ============

    string public constant VERSION_V2 = "2.0.0";

    // ============ V2 Storage (appended below V1 state) ============

    /// @notice schemaId => applicationId (0 = legacy/unscoped)
    mapping(uint256 => uint256) public schemaApplicationId;

    /// @notice appId => array of schemaIds scoped to that app
    mapping(uint256 => uint256[]) internal _applicationSchemaIds;

    /// @notice keccak256(abi.encodePacked(appId, name)) => schemaId (per-app name uniqueness)
    mapping(bytes32 => uint256) public appSchemaNameHashes;

    // ============ V2 Events ============

    event AppSchemaCreated(uint256 indexed schemaId, uint256 indexed applicationId, string name, address indexed creator);
    event SchemaAssignedToApp(uint256 indexed schemaId, uint256 indexed applicationId);

    // ============ V2 Errors ============

    error InvalidApplicationId();
    error AppNameTaken();
    error NotAppAdmin();

    // ============ V2 Functions ============

    /**
     * @notice Create a schema scoped to an application
     * @dev Does NOT register in V1's global `schemaNameHashes`, allowing different apps
     *      to have schemas with the same name. Writes directly to V1 storage
     *      (`schemas`, `schemaVersions`, `schemaCount`) but uses per-app name hash.
     * @param appId Application to scope the schema to
     * @param name Unique name within this app
     * @param description Brief description
     * @param body Schema body
     * @return schemaId The new schema's ID
     */
    function createAppSchema(
        uint256 appId,
        string calldata name,
        string calldata description,
        string calldata body
    ) external returns (uint256) {
        if (appId == 0) revert InvalidApplicationId();
        _requireAppAdmin(appId);

        bytes memory nameBytes = bytes(name);
        if (nameBytes.length == 0 || nameBytes.length > 64) revert InvalidName();
        if (bytes(body).length == 0) revert EmptyBody();

        // Per-app name uniqueness
        bytes32 appNameHash = keccak256(abi.encodePacked(appId, name));
        if (appSchemaNameHashes[appNameHash] != 0) revert AppNameTaken();

        // Create schema in V1 storage (skip global schemaNameHashes)
        schemaCount++;
        uint256 schemaId = schemaCount;

        schemas[schemaId] = Schema({
            id: schemaId,
            name: name,
            description: description,
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            versionCount: 1,
            active: true
        });

        schemaVersions[schemaId][1] = SchemaVersion({
            body: body,
            publishedAt: uint64(block.timestamp)
        });

        // V2 scoping
        schemaApplicationId[schemaId] = appId;
        _applicationSchemaIds[appId].push(schemaId);
        appSchemaNameHashes[appNameHash] = schemaId;

        emit AppSchemaCreated(schemaId, appId, name, msg.sender);
        emit SchemaVersionPublished(schemaId, 1);

        return schemaId;
    }

    /**
     * @notice Get all schema IDs scoped to an application
     * @param appId Application ID
     * @return Array of schema IDs
     */
    function getApplicationSchemas(uint256 appId) external view returns (uint256[] memory) {
        return _applicationSchemaIds[appId];
    }

    /**
     * @notice Get the number of schemas scoped to an application
     * @param appId Application ID
     * @return Count of schemas
     */
    function getApplicationSchemaCount(uint256 appId) external view returns (uint256) {
        return _applicationSchemaIds[appId].length;
    }

    /**
     * @notice Get schema metadata including applicationId
     * @param schemaId Schema ID
     * @return id Schema ID
     * @return name Schema name
     * @return description Schema description
     * @return creator Creator address
     * @return createdAt Creation timestamp
     * @return versionCount Number of versions
     * @return active Whether schema is active
     * @return applicationId Application ID (0 = legacy/unscoped)
     */
    function getSchemaWithApp(uint256 schemaId) external view returns (
        uint256 id,
        string memory name,
        string memory description,
        address creator,
        uint64 createdAt,
        uint256 versionCount,
        bool active,
        uint256 applicationId
    ) {
        Schema storage s = schemas[schemaId];
        id = s.id;
        name = s.name;
        description = s.description;
        creator = s.creator;
        createdAt = s.createdAt;
        versionCount = s.versionCount;
        active = s.active;
        applicationId = schemaApplicationId[schemaId];
    }

    /**
     * @notice Assign an existing schema to an app's list (owner only, for migration/sharing)
     * @param schemaId Schema to assign
     * @param appId Application to assign to
     */
    function assignSchemaToApp(uint256 schemaId, uint256 appId) external onlyOwner {
        if (schemas[schemaId].id == 0) revert SchemaNotFound();
        if (appId == 0) revert InvalidApplicationId();

        _applicationSchemaIds[appId].push(schemaId);

        emit SchemaAssignedToApp(schemaId, appId);
    }

    /**
     * @notice Batch-assign schemas to an app (owner only, for migration)
     * @param schemaIds Array of schema IDs
     * @param appId Application to assign to
     */
    function batchAssignSchemas(uint256[] calldata schemaIds, uint256 appId) external onlyOwner {
        if (appId == 0) revert InvalidApplicationId();

        for (uint256 i = 0; i < schemaIds.length; i++) {
            if (schemas[schemaIds[i]].id == 0) revert SchemaNotFound();
            _applicationSchemaIds[appId].push(schemaIds[i]);
            emit SchemaAssignedToApp(schemaIds[i], appId);
        }
    }

    /**
     * @notice Get contract version (V1's getVersion is not virtual, so use a new name)
     * @return Version string
     */
    function contractVersion() external pure returns (string memory) {
        return VERSION_V2;
    }

    // ============ Internal Functions ============

    /**
     * @dev Check that msg.sender is an app admin via the registry.
     * App admin = app owner OR member with ROLE_ADMIN.
     *
     * Uses raw staticcall + assembly (same pattern as V1's _requireTopicAdmin)
     * to extract only needed fields from auto-generated struct getters.
     */
    function _requireAppAdmin(uint256 appId) internal view {
        address reg = registry;

        // applications(appId) — extract owner at ABI offset 160 (slot 4)
        // Layout: id (uint256), name offset, description offset, frontendUrl offset, owner (address)
        (bool ok, bytes memory data) = reg.staticcall(
            abi.encodeWithSignature("applications(uint256)", appId)
        );
        require(ok, "applications() call failed");

        uint256 id;
        address appOwner;
        assembly {
            id := mload(add(data, 32))            // slot 0: id
            appOwner := mload(add(data, 160))      // slot 4: owner
        }

        if (id == 0) revert InvalidApplicationId();
        if (msg.sender == appOwner) return;

        // members(appId, msg.sender) — extract roles at ABI offset 96 (slot 2)
        // Layout: account (address), nickname offset (dynamic), roles (uint8)
        (ok, data) = reg.staticcall(
            abi.encodeWithSignature("members(uint256,address)", appId, msg.sender)
        );
        require(ok, "members() call failed");

        uint8 roles;
        assembly {
            roles := mload(add(data, 96))          // slot 2: roles
        }

        if ((roles & _ROLE_ADMIN) == _ROLE_ADMIN) return;

        revert NotAppAdmin();
    }
}
