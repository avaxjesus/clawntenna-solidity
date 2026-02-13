// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MessageEscrowV1
 * @notice Holds message fees in escrow until the topic owner responds or timeout expires.
 * @dev UUPS upgradeable. Funds are released with the same 90/5/5 split as AntennaRegistryV7
 *      when the topic owner responds, or refunded in full to the sender after timeout.
 *
 * Token flow:
 *   1. Registry calls recordDeposit() — tokens already transferred from sender to this contract
 *   2. Topic owner responds → registry calls releaseForTopic() → escrow distributes 90/5/5
 *   3. Timeout expires → sender calls claimRefund() → escrow returns full amount
 */
contract MessageEscrowV1 is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Version ============

    string public constant VERSION = "1.0.0";

    // ============ Constants ============

    uint256 public constant PLATFORM_FEE_BPS = 500;  // 5%
    uint256 public constant APP_OWNER_FEE_BPS = 500;  // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;

    uint256 public constant MIN_TIMEOUT = 60;         // 1 minute
    uint256 public constant MAX_TIMEOUT = 7 days;
    uint256 public constant MAX_BATCH_SIZE = 50;

    // ============ Enums ============

    enum DepositStatus { Pending, Released, Refunded }

    // ============ Structs ============

    struct EscrowDeposit {
        uint256 id;
        uint256 topicId;
        address sender;
        address recipient;     // topic owner (receives 90%)
        address token;
        uint256 amount;
        address appOwner;      // receives 5%
        uint64 depositedAt;
        uint64 timeout;
        DepositStatus status;
    }

    // ============ State ============

    address public registry;
    address public treasury;

    uint256 public depositCount;

    /// @notice depositId => EscrowDeposit
    mapping(uint256 => EscrowDeposit) public deposits;

    /// @notice topicId => whether escrow is enabled
    mapping(uint256 => bool) public topicEscrowEnabled;

    /// @notice topicId => timeout in seconds
    mapping(uint256 => uint64) public topicEscrowTimeout;

    /// @notice topicId => array of pending (unresolved) deposit IDs
    mapping(uint256 => uint256[]) internal _pendingDepositIds;

    // ============ Events ============

    event EscrowEnabled(uint256 indexed topicId, uint64 timeout);
    event EscrowDisabled(uint256 indexed topicId);
    event DepositRecorded(uint256 indexed depositId, uint256 indexed topicId, address indexed sender, uint256 amount);
    event DepositReleased(uint256 indexed depositId, uint256 indexed topicId, uint256 recipientAmount, uint256 appOwnerAmount, uint256 platformAmount);
    event DepositRefunded(uint256 indexed depositId, uint256 indexed topicId, address indexed sender, uint256 amount);

    // ============ Errors ============

    error OnlyRegistry();
    error InvalidTimeout();
    error TopicNotFound();
    error NotTopicOwner();
    error DepositNotFound();
    error AlreadyResolved();
    error TimeoutNotExpired();
    error NotDepositor();
    error BatchTooLarge();

    // ============ Modifiers ============

    modifier onlyRegistry() {
        if (msg.sender != registry) revert OnlyRegistry();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _registry, address _treasury) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        registry = _registry;
        treasury = _treasury;
    }

    // ============ Upgrade Authorization ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============ Admin Functions ============

    function setRegistry(address _registry) external onlyOwner {
        registry = _registry;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    // ============ Topic Owner Configuration ============

    /**
     * @notice Enable escrow for a topic with a configurable timeout
     * @dev Only the topic owner can enable escrow. Topic ownership is validated
     *      by querying the registry's topics() getter via staticcall.
     * @param topicId Topic ID
     * @param timeoutSeconds Timeout in seconds (60s to 7 days)
     */
    function enableEscrow(uint256 topicId, uint64 timeoutSeconds) external {
        if (timeoutSeconds < MIN_TIMEOUT || timeoutSeconds > MAX_TIMEOUT) revert InvalidTimeout();
        _requireTopicOwner(topicId);

        topicEscrowEnabled[topicId] = true;
        topicEscrowTimeout[topicId] = timeoutSeconds;

        emit EscrowEnabled(topicId, timeoutSeconds);
    }

    /**
     * @notice Disable escrow for a topic (pending deposits are unaffected)
     * @param topicId Topic ID
     */
    function disableEscrow(uint256 topicId) external {
        _requireTopicOwner(topicId);

        topicEscrowEnabled[topicId] = false;

        emit EscrowDisabled(topicId);
    }

    // ============ Registry Functions ============

    /**
     * @notice Record a deposit in escrow (called by registry during sendMessage)
     * @dev Tokens must already be transferred to this contract before calling.
     * @param topicId Topic ID
     * @param sender Message sender who paid the fee
     * @param token ERC20 token address
     * @param amount Total fee amount
     * @param recipient Primary recipient (topic owner)
     * @param appOwner Application owner
     */
    function recordDeposit(
        uint256 topicId,
        address sender,
        address token,
        uint256 amount,
        address recipient,
        address appOwner
    ) external payable virtual onlyRegistry {
        depositCount++;
        uint256 depositId = depositCount;

        deposits[depositId] = EscrowDeposit({
            id: depositId,
            topicId: topicId,
            sender: sender,
            recipient: recipient,
            token: token,
            amount: amount,
            appOwner: appOwner,
            depositedAt: uint64(block.timestamp),
            timeout: topicEscrowTimeout[topicId],
            status: DepositStatus.Pending
        });

        _pendingDepositIds[topicId].push(depositId);

        emit DepositRecorded(depositId, topicId, sender, amount);
    }

    /**
     * @notice Release all pending deposits for a topic (called when topic owner responds)
     * @dev Distributes each deposit with the 90/5/5 split. Processes up to MAX_BATCH_SIZE
     *      deposits per call; remainder persists for the next call.
     * @param topicId Topic ID
     */
    function releaseForTopic(uint256 topicId) external onlyRegistry nonReentrant {
        uint256[] storage pending = _pendingDepositIds[topicId];
        uint256 count = pending.length;
        if (count == 0) return;

        uint256 toProcess = count > MAX_BATCH_SIZE ? MAX_BATCH_SIZE : count;

        for (uint256 i = 0; i < toProcess; i++) {
            uint256 depositId = pending[i];
            EscrowDeposit storage deposit = deposits[depositId];

            if (deposit.status != DepositStatus.Pending) continue;

            // CEI: mark resolved before transfers
            deposit.status = DepositStatus.Released;

            _distributeDeposit(deposit);
        }

        // Remove processed entries from front of array
        if (toProcess == count) {
            // All processed — clear the array
            delete _pendingDepositIds[topicId];
        } else {
            // Shift remaining entries to front
            uint256 remaining = count - toProcess;
            for (uint256 i = 0; i < remaining; i++) {
                pending[i] = pending[toProcess + i];
            }
            for (uint256 i = 0; i < toProcess; i++) {
                pending.pop();
            }
        }
    }

    // ============ Sender Functions ============

    /**
     * @notice Claim a refund for a single deposit after timeout
     * @param depositId Deposit ID to refund
     */
    function claimRefund(uint256 depositId) external nonReentrant {
        _processRefund(depositId);
    }

    /**
     * @notice Claim refunds for multiple deposits after timeout
     * @param depositIds Array of deposit IDs to refund
     */
    function batchClaimRefunds(uint256[] calldata depositIds) external nonReentrant {
        if (depositIds.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        for (uint256 i = 0; i < depositIds.length; i++) {
            _processRefund(depositIds[i]);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Check if escrow is enabled for a topic
     */
    function isEscrowEnabled(uint256 topicId) external view returns (bool) {
        return topicEscrowEnabled[topicId];
    }

    /**
     * @notice Get deposit details
     */
    function getDeposit(uint256 depositId) external view returns (
        uint256 id,
        uint256 topicId,
        address sender,
        address recipient,
        address token,
        uint256 amount,
        address appOwner,
        uint64 depositedAt,
        uint64 timeout,
        uint8 status
    ) {
        EscrowDeposit storage d = deposits[depositId];
        return (d.id, d.topicId, d.sender, d.recipient, d.token, d.amount, d.appOwner, d.depositedAt, d.timeout, uint8(d.status));
    }

    /**
     * @notice Get deposit status (0=Pending, 1=Released, 2=Refunded)
     */
    function getDepositStatus(uint256 depositId) external view returns (uint8) {
        return uint8(deposits[depositId].status);
    }

    /**
     * @notice Get pending deposit IDs for a topic
     */
    function getPendingDeposits(uint256 topicId) external view returns (uint256[] memory) {
        return _pendingDepositIds[topicId];
    }

    /**
     * @notice Check if a deposit can be refunded (timeout expired and not resolved)
     */
    function canClaimRefund(uint256 depositId) external view returns (bool) {
        EscrowDeposit storage d = deposits[depositId];
        if (d.id == 0 || d.status != DepositStatus.Pending) return false;
        return block.timestamp >= d.depositedAt + d.timeout;
    }

    /**
     * @notice Get contract version
     */
    function getVersion() external pure virtual returns (string memory) {
        return VERSION;
    }

    // ============ Internal Functions ============

    /**
     * @dev Distribute a deposit with the 90/5/5 split
     */
    function _distributeDeposit(EscrowDeposit storage deposit) internal virtual {
        IERC20 token = IERC20(deposit.token);

        uint256 platformFee = (deposit.amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 appOwnerFee = (deposit.amount * APP_OWNER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 recipientAmount = deposit.amount - platformFee - appOwnerFee;

        // Optimize: if recipient == appOwner, combine into single transfer (95%)
        if (deposit.recipient == deposit.appOwner) {
            token.safeTransfer(deposit.recipient, recipientAmount + appOwnerFee);
        } else {
            token.safeTransfer(deposit.recipient, recipientAmount);
            token.safeTransfer(deposit.appOwner, appOwnerFee);
        }

        // Transfer platform fee to treasury (5%)
        if (platformFee > 0 && treasury != address(0)) {
            token.safeTransfer(treasury, platformFee);
        }

        emit DepositReleased(
            deposit.id,
            deposit.topicId,
            recipientAmount,
            appOwnerFee,
            platformFee
        );
    }

    /**
     * @dev Process a single refund
     */
    function _processRefund(uint256 depositId) internal virtual {
        EscrowDeposit storage deposit = deposits[depositId];
        if (deposit.id == 0) revert DepositNotFound();
        if (deposit.status != DepositStatus.Pending) revert AlreadyResolved();
        if (msg.sender != deposit.sender) revert NotDepositor();
        if (block.timestamp < deposit.depositedAt + deposit.timeout) revert TimeoutNotExpired();

        // CEI: mark resolved before transfer
        deposit.status = DepositStatus.Refunded;

        // Remove from pending array
        _removePendingDeposit(deposit.topicId, depositId);

        IERC20(deposit.token).safeTransfer(deposit.sender, deposit.amount);

        emit DepositRefunded(depositId, deposit.topicId, deposit.sender, deposit.amount);
    }

    /**
     * @dev Remove a deposit ID from the pending array for a topic
     */
    function _removePendingDeposit(uint256 topicId, uint256 depositId) internal {
        uint256[] storage pending = _pendingDepositIds[topicId];
        uint256 len = pending.length;
        for (uint256 i = 0; i < len; i++) {
            if (pending[i] == depositId) {
                pending[i] = pending[len - 1];
                pending.pop();
                return;
            }
        }
    }

    /**
     * @dev Validate that msg.sender is the topic owner via the registry.
     * Uses raw staticcall + assembly to extract the owner from the topics() getter
     * (same pattern as SchemaRegistryV1._requireTopicAdmin).
     */
    function _requireTopicOwner(uint256 topicId) internal view {
        (bool ok, bytes memory data) = registry.staticcall(
            abi.encodeWithSignature("topics(uint256)", topicId)
        );
        require(ok, "topics() call failed");

        uint256 id;
        address topicOwner;
        assembly {
            id := mload(add(data, 32))         // slot 0: id
            // slot 1: applicationId
            // slot 2: name offset (dynamic)
            // slot 3: description offset (dynamic)
            // slot 4: owner at ABI offset 160
            topicOwner := mload(add(data, 160))
        }

        if (id == 0) revert TopicNotFound();
        if (msg.sender != topicOwner) revert NotTopicOwner();
    }
}
