// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title AntennaRegistryV1
 * @notice On-chain registry for Antenna applications, topics, and memberships
 * @dev UUPS upgradeable pattern for safe contract upgrades
 */
contract AntennaRegistryV1 is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    
    // ============ Version ============
    
    string public constant VERSION = "1.0.0";
    
    // ============ Structs ============
    
    struct Application {
        uint256 id;
        string name;
        string description;
        string frontendUrl;
        address owner;
        uint64 createdAt;
        uint32 memberCount;
        uint32 topicCount;
        bool active;
        bool allowPublicTopicCreation;
        address topicCreationFeeToken;
        uint256 topicCreationFeeAmount;
    }
    
    struct Topic {
        uint256 id;
        uint256 applicationId;
        string name;
        string description;
        address owner;
        address creator;
        uint64 createdAt;
        uint64 lastMessageAt;
        uint256 messageCount;
        uint8 accessLevel; // 0=PUBLIC, 1=PUBLIC_LIMITED, 2=PRIVATE
        bool active;
    }
    
    struct Member {
        address account;
        string nickname;
        uint8 roles; // Bitmask: 1=MEMBER, 2=SUPPORT, 4=TOPIC_MANAGER, 8=ADMIN, 16=OWNER_DELEGATE
        uint64 joinedAt;
    }
    
    // ============ Constants ============
    
    uint8 public constant ROLE_MEMBER = 1;
    uint8 public constant ROLE_SUPPORT_MANAGER = 2;
    uint8 public constant ROLE_TOPIC_MANAGER = 4;
    uint8 public constant ROLE_ADMIN = 8;
    uint8 public constant ROLE_OWNER_DELEGATE = 16;
    
    uint8 public constant ACCESS_PUBLIC = 0;
    uint8 public constant ACCESS_PUBLIC_LIMITED = 1;
    uint8 public constant ACCESS_PRIVATE = 2;
    
    uint8 public constant PERMISSION_NONE = 0;
    uint8 public constant PERMISSION_READ = 1;
    uint8 public constant PERMISSION_WRITE = 2;
    uint8 public constant PERMISSION_READ_WRITE = 3;
    uint8 public constant PERMISSION_ADMIN = 4;
    
    // ============ State ============
    
    // Fee configuration
    address public treasury;
    address public feeToken;
    uint256 public applicationFee;
    uint256 public topicFee;
    bool public feesEnabled; // Feature flag for fees
    
    // Counters
    uint256 public applicationCount;
    uint256 public topicCount;
    
    // Storage
    mapping(uint256 => Application) public applications;
    mapping(string => uint256) public applicationNames; // name => appId (for uniqueness)
    mapping(uint256 => Topic) public topics;
    
    // Memberships: appId => member => Member
    mapping(uint256 => mapping(address => Member)) public members;
    mapping(uint256 => address[]) public applicationMembers; // For enumeration
    
    // Topic permissions: topicId => user => permission
    mapping(uint256 => mapping(address => uint8)) public topicPermissions;
    
    // App topics: appId => topicIds[]
    mapping(uint256 => uint256[]) public applicationTopics;
    
    // ============ Events ============
    
    event ApplicationCreated(uint256 indexed applicationId, string name, address indexed owner);
    event ApplicationUpdated(uint256 indexed applicationId);
    event TopicCreated(uint256 indexed topicId, uint256 indexed applicationId, string name, address indexed creator, uint8 accessLevel);
    event TopicUpdated(uint256 indexed topicId);
    event MemberAdded(uint256 indexed applicationId, address indexed member, string nickname, uint8 roles);
    event MemberRemoved(uint256 indexed applicationId, address indexed member);
    event MemberRolesUpdated(uint256 indexed applicationId, address indexed member, uint8 roles);
    event NicknameUpdated(uint256 indexed applicationId, address indexed member, string nickname);
    event TopicPermissionSet(uint256 indexed topicId, address indexed user, uint8 permission);
    event MessageSent(uint256 indexed topicId, address indexed sender, bytes payload, uint256 timestamp);
    event FrontendUrlUpdated(uint256 indexed applicationId, string frontendUrl);
    event FeesEnabledUpdated(bool enabled);
    event FeesUpdated(uint256 applicationFee, uint256 topicFee);
    
    // ============ Errors ============
    
    error NotAuthorized();
    error InvalidName();
    error NameTaken();
    error ApplicationNotFound();
    error TopicNotFound();
    error NotMember();
    error AlreadyMember();
    error InsufficientBalance();
    error InsufficientAllowance();
    error CannotRemoveSelf();
    error InvalidAccessLevel();
    
    // ============ Initializer ============
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(address _treasury) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        
        treasury = _treasury;
        feesEnabled = false; // Fees disabled by default
        applicationFee = 0;
        topicFee = 0;
    }
    
    // ============ Upgrade Authorization ============
    
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
    
    // ============ Admin Functions ============
    
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }
    
    function setFeeToken(address _token) external onlyOwner {
        feeToken = _token;
    }
    
    function setFees(uint256 _applicationFee, uint256 _topicFee) external onlyOwner {
        applicationFee = _applicationFee;
        topicFee = _topicFee;
        emit FeesUpdated(_applicationFee, _topicFee);
    }
    
    function setFeesEnabled(bool _enabled) external onlyOwner {
        feesEnabled = _enabled;
        emit FeesEnabledUpdated(_enabled);
    }
    
    // ============ Application Functions ============
    
    function createApplication(
        string calldata name,
        string calldata description,
        string calldata frontendUrl,
        bool allowPublicTopicCreation
    ) external nonReentrant returns (uint256) {
        // Validate name
        bytes memory nameBytes = bytes(name);
        if (nameBytes.length == 0 || nameBytes.length > 64) revert InvalidName();
        if (applicationNames[name] != 0) revert NameTaken();
        
        // Collect fee if enabled
        if (feesEnabled && applicationFee > 0 && feeToken != address(0)) {
            _collectFee(applicationFee);
        }
        
        // Create application
        applicationCount++;
        uint256 appId = applicationCount;
        
        applications[appId] = Application({
            id: appId,
            name: name,
            description: description,
            frontendUrl: frontendUrl,
            owner: msg.sender,
            createdAt: uint64(block.timestamp),
            memberCount: 1,
            topicCount: 0,
            active: true,
            allowPublicTopicCreation: allowPublicTopicCreation,
            topicCreationFeeToken: address(0),
            topicCreationFeeAmount: 0
        });
        
        applicationNames[name] = appId;
        
        // Add creator as owner with all roles
        members[appId][msg.sender] = Member({
            account: msg.sender,
            nickname: "",
            roles: ROLE_MEMBER | ROLE_ADMIN | ROLE_OWNER_DELEGATE,
            joinedAt: uint64(block.timestamp)
        });
        applicationMembers[appId].push(msg.sender);
        
        emit ApplicationCreated(appId, name, msg.sender);
        emit MemberAdded(appId, msg.sender, "", ROLE_MEMBER | ROLE_ADMIN | ROLE_OWNER_DELEGATE);
        
        return appId;
    }
    
    function updateApplicationFrontendUrl(uint256 appId, string calldata frontendUrl) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (msg.sender != app.owner && !_hasRole(appId, msg.sender, ROLE_ADMIN)) revert NotAuthorized();
        
        app.frontendUrl = frontendUrl;
        emit FrontendUrlUpdated(appId, frontendUrl);
    }
    
    function setTopicCreationFee(uint256 appId, address feeTokenAddr, uint256 feeAmount) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (msg.sender != app.owner && !_hasRole(appId, msg.sender, ROLE_ADMIN)) revert NotAuthorized();
        
        app.topicCreationFeeToken = feeTokenAddr;
        app.topicCreationFeeAmount = feeAmount;
        emit ApplicationUpdated(appId);
    }
    
    function getApplication(uint256 appId) external view returns (Application memory) {
        return applications[appId];
    }
    
    // ============ Topic Functions ============
    
    function createTopic(
        uint256 appId,
        string calldata name,
        string calldata description,
        uint8 accessLevel
    ) external payable virtual nonReentrant returns (uint256) {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (accessLevel > ACCESS_PRIVATE) revert InvalidAccessLevel();
        
        // Check permission
        bool canCreate = app.allowPublicTopicCreation || 
                        msg.sender == app.owner ||
                        _hasRole(appId, msg.sender, ROLE_TOPIC_MANAGER) ||
                        _hasRole(appId, msg.sender, ROLE_ADMIN);
        if (!canCreate) revert NotAuthorized();
        
        // Collect app-level topic fee if set (and fees enabled globally)
        if (feesEnabled && app.topicCreationFeeAmount > 0 && app.topicCreationFeeToken != address(0)) {
            IERC20 token = IERC20(app.topicCreationFeeToken);
            if (token.balanceOf(msg.sender) < app.topicCreationFeeAmount) revert InsufficientBalance();
            if (token.allowance(msg.sender, address(this)) < app.topicCreationFeeAmount) revert InsufficientAllowance();
            token.transferFrom(msg.sender, app.owner, app.topicCreationFeeAmount);
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
    
    function getTopic(uint256 topicId) external view returns (Topic memory) {
        return topics[topicId];
    }
    
    function getApplicationTopics(uint256 appId) external view returns (uint256[] memory) {
        return applicationTopics[appId];
    }
    
    function setTopicPermission(uint256 topicId, address user, uint8 permission) external {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) revert TopicNotFound();
        
        // Check caller has admin permission on topic or is app admin
        bool canManage = topicPermissions[topicId][msg.sender] == PERMISSION_ADMIN ||
                        msg.sender == topic.owner ||
                        _hasRole(topic.applicationId, msg.sender, ROLE_ADMIN);
        if (!canManage) revert NotAuthorized();
        
        topicPermissions[topicId][user] = permission;
        emit TopicPermissionSet(topicId, user, permission);
    }
    
    function getTopicPermission(uint256 topicId, address user) external view returns (uint8) {
        return topicPermissions[topicId][user];
    }
    
    // ============ Membership Functions ============
    
    function addMember(uint256 appId, address member, string calldata nickname, uint8 roles) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (!_hasRole(appId, msg.sender, ROLE_ADMIN) && msg.sender != app.owner) revert NotAuthorized();
        if (members[appId][member].account != address(0)) revert AlreadyMember();
        
        members[appId][member] = Member({
            account: member,
            nickname: nickname,
            roles: roles | ROLE_MEMBER, // Always include MEMBER role
            joinedAt: uint64(block.timestamp)
        });
        applicationMembers[appId].push(member);
        app.memberCount++;
        
        emit MemberAdded(appId, member, nickname, roles | ROLE_MEMBER);
    }
    
    function removeMember(uint256 appId, address member) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (!_hasRole(appId, msg.sender, ROLE_ADMIN) && msg.sender != app.owner) revert NotAuthorized();
        if (members[appId][member].account == address(0)) revert NotMember();
        if (member == app.owner) revert CannotRemoveSelf(); // Can't remove owner
        
        delete members[appId][member];
        app.memberCount--;
        
        emit MemberRemoved(appId, member);
    }
    
    function updateMemberRoles(uint256 appId, address member, uint8 roles) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (!_hasRole(appId, msg.sender, ROLE_ADMIN) && msg.sender != app.owner) revert NotAuthorized();
        if (members[appId][member].account == address(0)) revert NotMember();
        
        members[appId][member].roles = roles | ROLE_MEMBER;
        emit MemberRolesUpdated(appId, member, roles | ROLE_MEMBER);
    }
    
    function updateMemberNickname(uint256 appId, string calldata nickname) external {
        if (members[appId][msg.sender].account == address(0)) revert NotMember();
        
        members[appId][msg.sender].nickname = nickname;
        emit NicknameUpdated(appId, msg.sender, nickname);
    }
    
    // Alias for backwards compatibility
    function setMemberNickname(uint256 appId, string calldata nickname) external {
        if (members[appId][msg.sender].account == address(0)) revert NotMember();
        
        members[appId][msg.sender].nickname = nickname;
        emit NicknameUpdated(appId, msg.sender, nickname);
    }
    
    function getMember(uint256 appId, address account) external view returns (Member memory) {
        return members[appId][account];
    }
    
    function isMember(uint256 appId, address account) external view returns (bool) {
        return members[appId][account].account != address(0);
    }
    
    function getApplicationMembers(uint256 appId) external view returns (address[] memory) {
        return applicationMembers[appId];
    }
    
    // ============ Messaging Functions ============
    
    function sendMessage(uint256 topicId, bytes calldata payload) external payable virtual {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) revert TopicNotFound();
        if (!canWriteToTopic(topicId, msg.sender)) revert NotAuthorized();
        
        topic.messageCount++;
        topic.lastMessageAt = uint64(block.timestamp);
        
        emit MessageSent(topicId, msg.sender, payload, block.timestamp);
    }
    
    // ============ Permission Helpers ============
    
    function canReadTopic(uint256 topicId, address user) public view returns (bool) {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) return false;
        
        // Public topics: anyone can read
        if (topic.accessLevel == ACCESS_PUBLIC || topic.accessLevel == ACCESS_PUBLIC_LIMITED) {
            return true;
        }
        
        // Private topics: need explicit permission or app admin
        uint8 perm = topicPermissions[topicId][user];
        if (perm >= PERMISSION_READ) return true;
        if (_hasRole(topic.applicationId, user, ROLE_ADMIN)) return true;
        if (user == topic.owner) return true;
        
        return false;
    }
    
    function canWriteToTopic(uint256 topicId, address user) public view returns (bool) {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) return false;
        
        // Public topics: anyone can write
        if (topic.accessLevel == ACCESS_PUBLIC) {
            return true;
        }
        
        // Public limited: need to be member or have permission
        if (topic.accessLevel == ACCESS_PUBLIC_LIMITED) {
            if (members[topic.applicationId][user].account != address(0)) return true;
            if (topicPermissions[topicId][user] >= PERMISSION_WRITE) return true;
            return false;
        }
        
        // Private: need explicit write permission or admin
        uint8 perm = topicPermissions[topicId][user];
        if (perm == PERMISSION_WRITE || perm == PERMISSION_READ_WRITE || perm == PERMISSION_ADMIN) return true;
        if (_hasRole(topic.applicationId, user, ROLE_ADMIN)) return true;
        if (user == topic.owner) return true;
        
        return false;
    }
    
    function _hasRole(uint256 appId, address user, uint8 role) internal view returns (bool) {
        return (members[appId][user].roles & role) == role;
    }
    
    // ============ Fee Collection ============
    
    function _collectFee(uint256 amount) internal {
        if (feeToken == address(0)) return;
        
        IERC20 token = IERC20(feeToken);
        if (token.balanceOf(msg.sender) < amount) revert InsufficientBalance();
        if (token.allowance(msg.sender, address(this)) < amount) revert InsufficientAllowance();
        
        token.transferFrom(msg.sender, treasury, amount);
    }
    
    // ============ Migration Helpers ============
    
    /**
     * @notice Export user data for migration to a new contract version
     * @param appId Application ID
     * @param user User address
     * @return Encoded membership data
     */
    function exportMemberData(uint256 appId, address user) external view returns (bytes memory) {
        Member memory member = members[appId][user];
        return abi.encode(
            appId,
            user,
            member.nickname,
            member.roles,
            member.joinedAt
        );
    }
    
    /**
     * @notice Export application data for migration
     * @param appId Application ID
     * @return Encoded application data
     */
    function exportApplicationData(uint256 appId) external view returns (bytes memory) {
        Application memory app = applications[appId];
        return abi.encode(app);
    }
    
    /**
     * @notice Get contract version for client compatibility checks
     */
    function getVersion() external pure virtual returns (string memory) {
        return VERSION;
    }
}
