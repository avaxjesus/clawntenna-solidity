

// Sources flattened with hardhat v2.28.4 https://hardhat.org

// SPDX-License-Identifier: MIT

// File @openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (proxy/utils/Initializable.sol)

pragma solidity ^0.8.20;

/**
 * @dev This is a base contract to aid in writing upgradeable contracts, or any kind of contract that will be deployed
 * behind a proxy. Since proxied contracts do not make use of a constructor, it's common to move constructor logic to an
 * external initializer function, usually called `initialize`. It then becomes necessary to protect this initializer
 * function so it can only be called once. The {initializer} modifier provided by this contract will have this effect.
 *
 * The initialization functions use a version number. Once a version number is used, it is consumed and cannot be
 * reused. This mechanism prevents re-execution of each "step" but allows the creation of new initialization steps in
 * case an upgrade adds a module that needs to be initialized.
 *
 * For example:
 *
 * [.hljs-theme-light.nopadding]
 * ```solidity
 * contract MyToken is ERC20Upgradeable {
 *     function initialize() initializer public {
 *         __ERC20_init("MyToken", "MTK");
 *     }
 * }
 *
 * contract MyTokenV2 is MyToken, ERC20PermitUpgradeable {
 *     function initializeV2() reinitializer(2) public {
 *         __ERC20Permit_init("MyToken");
 *     }
 * }
 * ```
 *
 * TIP: To avoid leaving the proxy in an uninitialized state, the initializer function should be called as early as
 * possible by providing the encoded function call as the `_data` argument to {ERC1967Proxy-constructor}.
 *
 * CAUTION: When used with inheritance, manual care must be taken to not invoke a parent initializer twice, or to ensure
 * that all initializers are idempotent. This is not verified automatically as constructors are by Solidity.
 *
 * [CAUTION]
 * ====
 * Avoid leaving a contract uninitialized.
 *
 * An uninitialized contract can be taken over by an attacker. This applies to both a proxy and its implementation
 * contract, which may impact the proxy. To prevent the implementation contract from being used, you should invoke
 * the {_disableInitializers} function in the constructor to automatically lock it when it is deployed:
 *
 * [.hljs-theme-light.nopadding]
 * ```
 * /// @custom:oz-upgrades-unsafe-allow constructor
 * constructor() {
 *     _disableInitializers();
 * }
 * ```
 * ====
 */
abstract contract Initializable {
    /**
     * @dev Storage of the initializable contract.
     *
     * It's implemented on a custom ERC-7201 namespace to reduce the risk of storage collisions
     * when using with upgradeable contracts.
     *
     * @custom:storage-location erc7201:openzeppelin.storage.Initializable
     */
    struct InitializableStorage {
        /**
         * @dev Indicates that the contract has been initialized.
         */
        uint64 _initialized;
        /**
         * @dev Indicates that the contract is in the process of being initialized.
         */
        bool _initializing;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant INITIALIZABLE_STORAGE = 0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00;

    /**
     * @dev The contract is already initialized.
     */
    error InvalidInitialization();

    /**
     * @dev The contract is not initializing.
     */
    error NotInitializing();

    /**
     * @dev Triggered when the contract has been initialized or reinitialized.
     */
    event Initialized(uint64 version);

    /**
     * @dev A modifier that defines a protected initializer function that can be invoked at most once. In its scope,
     * `onlyInitializing` functions can be used to initialize parent contracts.
     *
     * Similar to `reinitializer(1)`, except that in the context of a constructor an `initializer` may be invoked any
     * number of times. This behavior in the constructor can be useful during testing and is not expected to be used in
     * production.
     *
     * Emits an {Initialized} event.
     */
    modifier initializer() {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        // Cache values to avoid duplicated sloads
        bool isTopLevelCall = !$._initializing;
        uint64 initialized = $._initialized;

        // Allowed calls:
        // - initialSetup: the contract is not in the initializing state and no previous version was
        //                 initialized
        // - construction: the contract is initialized at version 1 (no reinitialization) and the
        //                 current contract is just being deployed
        bool initialSetup = initialized == 0 && isTopLevelCall;
        bool construction = initialized == 1 && address(this).code.length == 0;

        if (!initialSetup && !construction) {
            revert InvalidInitialization();
        }
        $._initialized = 1;
        if (isTopLevelCall) {
            $._initializing = true;
        }
        _;
        if (isTopLevelCall) {
            $._initializing = false;
            emit Initialized(1);
        }
    }

    /**
     * @dev A modifier that defines a protected reinitializer function that can be invoked at most once, and only if the
     * contract hasn't been initialized to a greater version before. In its scope, `onlyInitializing` functions can be
     * used to initialize parent contracts.
     *
     * A reinitializer may be used after the original initialization step. This is essential to configure modules that
     * are added through upgrades and that require initialization.
     *
     * When `version` is 1, this modifier is similar to `initializer`, except that functions marked with `reinitializer`
     * cannot be nested. If one is invoked in the context of another, execution will revert.
     *
     * Note that versions can jump in increments greater than 1; this implies that if multiple reinitializers coexist in
     * a contract, executing them in the right order is up to the developer or operator.
     *
     * WARNING: Setting the version to 2**64 - 1 will prevent any future reinitialization.
     *
     * Emits an {Initialized} event.
     */
    modifier reinitializer(uint64 version) {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        if ($._initializing || $._initialized >= version) {
            revert InvalidInitialization();
        }
        $._initialized = version;
        $._initializing = true;
        _;
        $._initializing = false;
        emit Initialized(version);
    }

    /**
     * @dev Modifier to protect an initialization function so that it can only be invoked by functions with the
     * {initializer} and {reinitializer} modifiers, directly or indirectly.
     */
    modifier onlyInitializing() {
        _checkInitializing();
        _;
    }

    /**
     * @dev Reverts if the contract is not in an initializing state. See {onlyInitializing}.
     */
    function _checkInitializing() internal view virtual {
        if (!_isInitializing()) {
            revert NotInitializing();
        }
    }

    /**
     * @dev Locks the contract, preventing any future reinitialization. This cannot be part of an initializer call.
     * Calling this in the constructor of a contract will prevent that contract from being initialized or reinitialized
     * to any version. It is recommended to use this to lock implementation contracts that are designed to be called
     * through proxies.
     *
     * Emits an {Initialized} event the first time it is successfully executed.
     */
    function _disableInitializers() internal virtual {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        if ($._initializing) {
            revert InvalidInitialization();
        }
        if ($._initialized != type(uint64).max) {
            $._initialized = type(uint64).max;
            emit Initialized(type(uint64).max);
        }
    }

    /**
     * @dev Returns the highest version that has been initialized. See {reinitializer}.
     */
    function _getInitializedVersion() internal view returns (uint64) {
        return _getInitializableStorage()._initialized;
    }

    /**
     * @dev Returns `true` if the contract is currently initializing. See {onlyInitializing}.
     */
    function _isInitializing() internal view returns (bool) {
        return _getInitializableStorage()._initializing;
    }

    /**
     * @dev Pointer to storage slot. Allows integrators to override it with a custom storage location.
     *
     * NOTE: Consider following the ERC-7201 formula to derive storage locations.
     */
    function _initializableStorageSlot() internal pure virtual returns (bytes32) {
        return INITIALIZABLE_STORAGE;
    }

    /**
     * @dev Returns a pointer to the storage namespace.
     */
    // solhint-disable-next-line var-name-mixedcase
    function _getInitializableStorage() private pure returns (InitializableStorage storage $) {
        bytes32 slot = _initializableStorageSlot();
        assembly {
            $.slot := slot
        }
    }
}


// File @openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract ContextUpgradeable is Initializable {
    function __Context_init() internal onlyInitializing {
    }

    function __Context_init_unchained() internal onlyInitializing {
    }
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}


// File @openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

pragma solidity ^0.8.20;


/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract OwnableUpgradeable is Initializable, ContextUpgradeable {
    /// @custom:storage-location erc7201:openzeppelin.storage.Ownable
    struct OwnableStorage {
        address _owner;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Ownable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant OwnableStorageLocation = 0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300;

    function _getOwnableStorage() private pure returns (OwnableStorage storage $) {
        assembly {
            $.slot := OwnableStorageLocation
        }
    }

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    function __Ownable_init(address initialOwner) internal onlyInitializing {
        __Ownable_init_unchained(initialOwner);
    }

    function __Ownable_init_unchained(address initialOwner) internal onlyInitializing {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        OwnableStorage storage $ = _getOwnableStorage();
        return $._owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        OwnableStorage storage $ = _getOwnableStorage();
        address oldOwner = $._owner;
        $._owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}


// File @openzeppelin/contracts/interfaces/draft-IERC1822.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/draft-IERC1822.sol)

pragma solidity >=0.4.16;

/**
 * @dev ERC-1822: Universal Upgradeable Proxy Standard (UUPS) documents a method for upgradeability through a simplified
 * proxy whose upgrades are fully controlled by the current implementation.
 */
interface IERC1822Proxiable {
    /**
     * @dev Returns the storage slot that the proxiable contract assumes is being used to store the implementation
     * address.
     *
     * IMPORTANT: A proxy pointing at a proxiable contract should not be considered proxiable itself, because this risks
     * bricking a proxy that upgrades to it, by delegating to itself until out of gas. Thus it is critical that this
     * function revert if invoked through a proxy.
     */
    function proxiableUUID() external view returns (bytes32);
}


// File @openzeppelin/contracts/interfaces/IERC1967.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC1967.sol)

pragma solidity >=0.4.11;

/**
 * @dev ERC-1967: Proxy Storage Slots. This interface contains the events defined in the ERC.
 */
interface IERC1967 {
    /**
     * @dev Emitted when the implementation is upgraded.
     */
    event Upgraded(address indexed implementation);

    /**
     * @dev Emitted when the admin account has changed.
     */
    event AdminChanged(address previousAdmin, address newAdmin);

    /**
     * @dev Emitted when the beacon is changed.
     */
    event BeaconUpgraded(address indexed beacon);
}


// File @openzeppelin/contracts/proxy/beacon/IBeacon.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (proxy/beacon/IBeacon.sol)

pragma solidity >=0.4.16;

/**
 * @dev This is the interface that {BeaconProxy} expects of its beacon.
 */
interface IBeacon {
    /**
     * @dev Must return an address that can be used as a delegate call target.
     *
     * {UpgradeableBeacon} will check that this address is a contract.
     */
    function implementation() external view returns (address);
}


// File @openzeppelin/contracts/utils/Errors.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/Errors.sol)

pragma solidity ^0.8.20;

/**
 * @dev Collection of common custom errors used in multiple contracts
 *
 * IMPORTANT: Backwards compatibility is not guaranteed in future versions of the library.
 * It is recommended to avoid relying on the error API for critical functionality.
 *
 * _Available since v5.1._
 */
library Errors {
    /**
     * @dev The ETH balance of the account is not enough to perform the operation.
     */
    error InsufficientBalance(uint256 balance, uint256 needed);

    /**
     * @dev A call to an address target failed. The target may have reverted.
     */
    error FailedCall();

    /**
     * @dev The deployment failed.
     */
    error FailedDeployment();

    /**
     * @dev A necessary precompile is missing.
     */
    error MissingPrecompile(address);
}


// File @openzeppelin/contracts/utils/Address.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/Address.sol)

pragma solidity ^0.8.20;

/**
 * @dev Collection of functions related to the address type
 */
library Address {
    /**
     * @dev There's no code at `target` (it is not a contract).
     */
    error AddressEmptyCode(address target);

    /**
     * @dev Replacement for Solidity's `transfer`: sends `amount` wei to
     * `recipient`, forwarding all available gas and reverting on errors.
     *
     * https://eips.ethereum.org/EIPS/eip-1884[EIP1884] increases the gas cost
     * of certain opcodes, possibly making contracts go over the 2300 gas limit
     * imposed by `transfer`, making them unable to receive funds via
     * `transfer`. {sendValue} removes this limitation.
     *
     * https://consensys.net/diligence/blog/2019/09/stop-using-soliditys-transfer-now/[Learn more].
     *
     * IMPORTANT: because control is transferred to `recipient`, care must be
     * taken to not create reentrancy vulnerabilities. Consider using
     * {ReentrancyGuard} or the
     * https://solidity.readthedocs.io/en/v0.8.20/security-considerations.html#use-the-checks-effects-interactions-pattern[checks-effects-interactions pattern].
     */
    function sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert Errors.InsufficientBalance(address(this).balance, amount);
        }

        (bool success, bytes memory returndata) = recipient.call{value: amount}("");
        if (!success) {
            _revert(returndata);
        }
    }

    /**
     * @dev Performs a Solidity function call using a low level `call`. A
     * plain `call` is an unsafe replacement for a function call: use this
     * function instead.
     *
     * If `target` reverts with a revert reason or custom error, it is bubbled
     * up by this function (like regular Solidity function calls). However, if
     * the call reverted with no returned reason, this function reverts with a
     * {Errors.FailedCall} error.
     *
     * Returns the raw returned data. To convert to the expected return value,
     * use https://solidity.readthedocs.io/en/latest/units-and-global-variables.html?highlight=abi.decode#abi-encoding-and-decoding-functions[`abi.decode`].
     *
     * Requirements:
     *
     * - `target` must be a contract.
     * - calling `target` with `data` must not revert.
     */
    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but also transferring `value` wei to `target`.
     *
     * Requirements:
     *
     * - the calling contract must have an ETH balance of at least `value`.
     * - the called Solidity function must be `payable`.
     */
    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a static call.
     */
    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a delegate call.
     */
    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Tool to verify that a low level call to smart-contract was successful, and reverts if the target
     * was not a contract or bubbling up the revert reason (falling back to {Errors.FailedCall}) in case
     * of an unsuccessful call.
     */
    function verifyCallResultFromTarget(
        address target,
        bool success,
        bytes memory returndata
    ) internal view returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            // only check if target is a contract if the call was successful and the return data is empty
            // otherwise we already know that it was a contract
            if (returndata.length == 0 && target.code.length == 0) {
                revert AddressEmptyCode(target);
            }
            return returndata;
        }
    }

    /**
     * @dev Tool to verify that a low level call was successful, and reverts if it wasn't, either by bubbling the
     * revert reason or with a default {Errors.FailedCall} error.
     */
    function verifyCallResult(bool success, bytes memory returndata) internal pure returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            return returndata;
        }
    }

    /**
     * @dev Reverts with returndata if present. Otherwise reverts with {Errors.FailedCall}.
     */
    function _revert(bytes memory returndata) private pure {
        // Look for revert reason and bubble it up if present
        if (returndata.length > 0) {
            // The easiest way to bubble the revert reason is using memory via assembly
            assembly ("memory-safe") {
                revert(add(returndata, 0x20), mload(returndata))
            }
        } else {
            revert Errors.FailedCall();
        }
    }
}


// File @openzeppelin/contracts/utils/StorageSlot.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/StorageSlot.sol)
// This file was procedurally generated from scripts/generate/templates/StorageSlot.js.

pragma solidity ^0.8.20;

/**
 * @dev Library for reading and writing primitive types to specific storage slots.
 *
 * Storage slots are often used to avoid storage conflict when dealing with upgradeable contracts.
 * This library helps with reading and writing to such slots without the need for inline assembly.
 *
 * The functions in this library return Slot structs that contain a `value` member that can be used to read or write.
 *
 * Example usage to set ERC-1967 implementation slot:
 * ```solidity
 * contract ERC1967 {
 *     // Define the slot. Alternatively, use the SlotDerivation library to derive the slot.
 *     bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
 *
 *     function _getImplementation() internal view returns (address) {
 *         return StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value;
 *     }
 *
 *     function _setImplementation(address newImplementation) internal {
 *         require(newImplementation.code.length > 0);
 *         StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value = newImplementation;
 *     }
 * }
 * ```
 *
 * TIP: Consider using this library along with {SlotDerivation}.
 */
library StorageSlot {
    struct AddressSlot {
        address value;
    }

    struct BooleanSlot {
        bool value;
    }

    struct Bytes32Slot {
        bytes32 value;
    }

    struct Uint256Slot {
        uint256 value;
    }

    struct Int256Slot {
        int256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    /**
     * @dev Returns an `AddressSlot` with member `value` located at `slot`.
     */
    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `BooleanSlot` with member `value` located at `slot`.
     */
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Bytes32Slot` with member `value` located at `slot`.
     */
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Uint256Slot` with member `value` located at `slot`.
     */
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Int256Slot` with member `value` located at `slot`.
     */
    function getInt256Slot(bytes32 slot) internal pure returns (Int256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `StringSlot` with member `value` located at `slot`.
     */
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `StringSlot` representation of the string storage pointer `store`.
     */
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }

    /**
     * @dev Returns a `BytesSlot` with member `value` located at `slot`.
     */
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `BytesSlot` representation of the bytes storage pointer `store`.
     */
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }
}


// File @openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (proxy/ERC1967/ERC1967Utils.sol)

pragma solidity ^0.8.21;




/**
 * @dev This library provides getters and event emitting update functions for
 * https://eips.ethereum.org/EIPS/eip-1967[ERC-1967] slots.
 */
library ERC1967Utils {
    /**
     * @dev Storage slot with the address of the current implementation.
     * This is the keccak-256 hash of "eip1967.proxy.implementation" subtracted by 1.
     */
    // solhint-disable-next-line private-vars-leading-underscore
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /**
     * @dev The `implementation` of the proxy is invalid.
     */
    error ERC1967InvalidImplementation(address implementation);

    /**
     * @dev The `admin` of the proxy is invalid.
     */
    error ERC1967InvalidAdmin(address admin);

    /**
     * @dev The `beacon` of the proxy is invalid.
     */
    error ERC1967InvalidBeacon(address beacon);

    /**
     * @dev An upgrade function sees `msg.value > 0` that may be lost.
     */
    error ERC1967NonPayable();

    /**
     * @dev Returns the current implementation address.
     */
    function getImplementation() internal view returns (address) {
        return StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value;
    }

    /**
     * @dev Stores a new address in the ERC-1967 implementation slot.
     */
    function _setImplementation(address newImplementation) private {
        if (newImplementation.code.length == 0) {
            revert ERC1967InvalidImplementation(newImplementation);
        }
        StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value = newImplementation;
    }

    /**
     * @dev Performs implementation upgrade with additional setup call if data is nonempty.
     * This function is payable only if the setup call is performed, otherwise `msg.value` is rejected
     * to avoid stuck value in the contract.
     *
     * Emits an {IERC1967-Upgraded} event.
     */
    function upgradeToAndCall(address newImplementation, bytes memory data) internal {
        _setImplementation(newImplementation);
        emit IERC1967.Upgraded(newImplementation);

        if (data.length > 0) {
            Address.functionDelegateCall(newImplementation, data);
        } else {
            _checkNonPayable();
        }
    }

    /**
     * @dev Storage slot with the admin of the contract.
     * This is the keccak-256 hash of "eip1967.proxy.admin" subtracted by 1.
     */
    // solhint-disable-next-line private-vars-leading-underscore
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    /**
     * @dev Returns the current admin.
     *
     * TIP: To get this value clients can read directly from the storage slot shown below (specified by ERC-1967) using
     * the https://eth.wiki/json-rpc/API#eth_getstorageat[`eth_getStorageAt`] RPC call.
     * `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103`
     */
    function getAdmin() internal view returns (address) {
        return StorageSlot.getAddressSlot(ADMIN_SLOT).value;
    }

    /**
     * @dev Stores a new address in the ERC-1967 admin slot.
     */
    function _setAdmin(address newAdmin) private {
        if (newAdmin == address(0)) {
            revert ERC1967InvalidAdmin(address(0));
        }
        StorageSlot.getAddressSlot(ADMIN_SLOT).value = newAdmin;
    }

    /**
     * @dev Changes the admin of the proxy.
     *
     * Emits an {IERC1967-AdminChanged} event.
     */
    function changeAdmin(address newAdmin) internal {
        emit IERC1967.AdminChanged(getAdmin(), newAdmin);
        _setAdmin(newAdmin);
    }

    /**
     * @dev The storage slot of the UpgradeableBeacon contract which defines the implementation for this proxy.
     * This is the keccak-256 hash of "eip1967.proxy.beacon" subtracted by 1.
     */
    // solhint-disable-next-line private-vars-leading-underscore
    bytes32 internal constant BEACON_SLOT = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;

    /**
     * @dev Returns the current beacon.
     */
    function getBeacon() internal view returns (address) {
        return StorageSlot.getAddressSlot(BEACON_SLOT).value;
    }

    /**
     * @dev Stores a new beacon in the ERC-1967 beacon slot.
     */
    function _setBeacon(address newBeacon) private {
        if (newBeacon.code.length == 0) {
            revert ERC1967InvalidBeacon(newBeacon);
        }

        StorageSlot.getAddressSlot(BEACON_SLOT).value = newBeacon;

        address beaconImplementation = IBeacon(newBeacon).implementation();
        if (beaconImplementation.code.length == 0) {
            revert ERC1967InvalidImplementation(beaconImplementation);
        }
    }

    /**
     * @dev Change the beacon and trigger a setup call if data is nonempty.
     * This function is payable only if the setup call is performed, otherwise `msg.value` is rejected
     * to avoid stuck value in the contract.
     *
     * Emits an {IERC1967-BeaconUpgraded} event.
     *
     * CAUTION: Invoking this function has no effect on an instance of {BeaconProxy} since v5, since
     * it uses an immutable beacon without looking at the value of the ERC-1967 beacon slot for
     * efficiency.
     */
    function upgradeBeaconToAndCall(address newBeacon, bytes memory data) internal {
        _setBeacon(newBeacon);
        emit IERC1967.BeaconUpgraded(newBeacon);

        if (data.length > 0) {
            Address.functionDelegateCall(IBeacon(newBeacon).implementation(), data);
        } else {
            _checkNonPayable();
        }
    }

    /**
     * @dev Reverts if `msg.value` is not zero. It can be used to avoid `msg.value` stuck in the contract
     * if an upgrade doesn't perform an initialization call.
     */
    function _checkNonPayable() private {
        if (msg.value > 0) {
            revert ERC1967NonPayable();
        }
    }
}


// File @openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (proxy/utils/UUPSUpgradeable.sol)

pragma solidity ^0.8.22;



/**
 * @dev An upgradeability mechanism designed for UUPS proxies. The functions included here can perform an upgrade of an
 * {ERC1967Proxy}, when this contract is set as the implementation behind such a proxy.
 *
 * A security mechanism ensures that an upgrade does not turn off upgradeability accidentally, although this risk is
 * reinstated if the upgrade retains upgradeability but removes the security mechanism, e.g. by replacing
 * `UUPSUpgradeable` with a custom implementation of upgrades.
 *
 * The {_authorizeUpgrade} function must be overridden to include access restriction to the upgrade mechanism.
 */
abstract contract UUPSUpgradeable is Initializable, IERC1822Proxiable {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable __self = address(this);

    /**
     * @dev The version of the upgrade interface of the contract. If this getter is missing, both `upgradeTo(address)`
     * and `upgradeToAndCall(address,bytes)` are present, and `upgradeTo` must be used if no function should be called,
     * while `upgradeToAndCall` will invoke the `receive` function if the second argument is the empty byte string.
     * If the getter returns `"5.0.0"`, only `upgradeToAndCall(address,bytes)` is present, and the second argument must
     * be the empty byte string if no function should be called, making it impossible to invoke the `receive` function
     * during an upgrade.
     */
    string public constant UPGRADE_INTERFACE_VERSION = "5.0.0";

    /**
     * @dev The call is from an unauthorized context.
     */
    error UUPSUnauthorizedCallContext();

    /**
     * @dev The storage `slot` is unsupported as a UUID.
     */
    error UUPSUnsupportedProxiableUUID(bytes32 slot);

    /**
     * @dev Check that the execution is being performed through a delegatecall call and that the execution context is
     * a proxy contract with an implementation (as defined in ERC-1967) pointing to self. This should only be the case
     * for UUPS and transparent proxies that are using the current contract as their implementation. Execution of a
     * function through ERC-1167 minimal proxies (clones) would not normally pass this test, but is not guaranteed to
     * fail.
     */
    modifier onlyProxy() {
        _checkProxy();
        _;
    }

    /**
     * @dev Check that the execution is not being performed through a delegate call. This allows a function to be
     * callable on the implementing contract but not through proxies.
     */
    modifier notDelegated() {
        _checkNotDelegated();
        _;
    }

    function __UUPSUpgradeable_init() internal onlyInitializing {
    }

    function __UUPSUpgradeable_init_unchained() internal onlyInitializing {
    }
    /**
     * @dev Implementation of the ERC-1822 {proxiableUUID} function. This returns the storage slot used by the
     * implementation. It is used to validate the implementation's compatibility when performing an upgrade.
     *
     * IMPORTANT: A proxy pointing at a proxiable contract should not be considered proxiable itself, because this risks
     * bricking a proxy that upgrades to it, by delegating to itself until out of gas. Thus it is critical that this
     * function revert if invoked through a proxy. This is guaranteed by the `notDelegated` modifier.
     */
    function proxiableUUID() external view virtual notDelegated returns (bytes32) {
        return ERC1967Utils.IMPLEMENTATION_SLOT;
    }

    /**
     * @dev Upgrade the implementation of the proxy to `newImplementation`, and subsequently execute the function call
     * encoded in `data`.
     *
     * Calls {_authorizeUpgrade}.
     *
     * Emits an {Upgraded} event.
     *
     * @custom:oz-upgrades-unsafe-allow-reachable delegatecall
     */
    function upgradeToAndCall(address newImplementation, bytes memory data) public payable virtual onlyProxy {
        _authorizeUpgrade(newImplementation);
        _upgradeToAndCallUUPS(newImplementation, data);
    }

    /**
     * @dev Reverts if the execution is not performed via delegatecall or the execution
     * context is not of a proxy with an ERC-1967 compliant implementation pointing to self.
     */
    function _checkProxy() internal view virtual {
        if (
            address(this) == __self || // Must be called through delegatecall
            ERC1967Utils.getImplementation() != __self // Must be called through an active proxy
        ) {
            revert UUPSUnauthorizedCallContext();
        }
    }

    /**
     * @dev Reverts if the execution is performed via delegatecall.
     * See {notDelegated}.
     */
    function _checkNotDelegated() internal view virtual {
        if (address(this) != __self) {
            // Must not be called through delegatecall
            revert UUPSUnauthorizedCallContext();
        }
    }

    /**
     * @dev Function that should revert when `msg.sender` is not authorized to upgrade the contract. Called by
     * {upgradeToAndCall}.
     *
     * Normally, this function will use an xref:access.adoc[access control] modifier such as {Ownable-onlyOwner}.
     *
     * ```solidity
     * function _authorizeUpgrade(address) internal onlyOwner {}
     * ```
     */
    function _authorizeUpgrade(address newImplementation) internal virtual;

    /**
     * @dev Performs an implementation upgrade with a security check for UUPS proxies, and additional setup call.
     *
     * As a security check, {proxiableUUID} is invoked in the new implementation, and the return value
     * is expected to be the implementation slot in ERC-1967.
     *
     * Emits an {IERC1967-Upgraded} event.
     */
    function _upgradeToAndCallUUPS(address newImplementation, bytes memory data) private {
        try IERC1822Proxiable(newImplementation).proxiableUUID() returns (bytes32 slot) {
            if (slot != ERC1967Utils.IMPLEMENTATION_SLOT) {
                revert UUPSUnsupportedProxiableUUID(slot);
            }
            ERC1967Utils.upgradeToAndCall(newImplementation, data);
        } catch {
            // The implementation is not UUPS
            revert ERC1967Utils.ERC1967InvalidImplementation(newImplementation);
        }
    }
}


// File @openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/ReentrancyGuard.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuardUpgradeable is Initializable {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /// @custom:storage-location erc7201:openzeppelin.storage.ReentrancyGuard
    struct ReentrancyGuardStorage {
        uint256 _status;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ReentrancyGuardStorageLocation = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    function _getReentrancyGuardStorage() private pure returns (ReentrancyGuardStorage storage $) {
        assembly {
            $.slot := ReentrancyGuardStorageLocation
        }
    }

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    function __ReentrancyGuard_init() internal onlyInitializing {
        __ReentrancyGuard_init_unchained();
    }

    function __ReentrancyGuard_init_unchained() internal onlyInitializing {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        $._status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if ($._status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        $._status = ENTERED;
    }

    function _nonReentrantAfter() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        $._status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        return $._status == ENTERED;
    }
}


// File @openzeppelin/contracts/token/ERC20/IERC20.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

pragma solidity >=0.4.16;

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}


// File contracts/AntennaRegistryV1.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;




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
    ) external virtual nonReentrant returns (uint256) {
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
    
    function sendMessage(uint256 topicId, bytes calldata payload) external virtual {
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


// File contracts/AntennaRegistryV2.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AntennaRegistryV2
 * @notice Upgrade with message fees and decoupled app-level fees
 * @dev Adds 3% platform fee on all app/topic-level fees
 */
contract AntennaRegistryV2 is AntennaRegistryV1 {

    // ============ Version ============

    string public constant VERSION_V2 = "2.0.0";

    // ============ V2 Constants ============

    uint256 public constant PLATFORM_FEE_BPS = 300; // 3% = 300 basis points
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ============ V2 Storage ============

    // Message fees per topic (appended storage - safe for upgrade)
    mapping(uint256 => address) public topicMessageFeeToken;
    mapping(uint256 => uint256) public topicMessageFeeAmount;

    // ============ V2 Events ============

    event TopicMessageFeeUpdated(uint256 indexed topicId, address token, uint256 amount);
    event PlatformFeeCollected(address indexed token, uint256 amount, address indexed recipient, address indexed treasury);

    // ============ V2 Functions ============

    /**
     * @notice Set message fee for a topic
     * @param topicId Topic ID
     * @param feeTokenAddr ERC20 token address for fee payment
     * @param feeAmount Amount to charge per message
     */
    function setTopicMessageFee(
        uint256 topicId,
        address feeTokenAddr,
        uint256 feeAmount
    ) external {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) revert TopicNotFound();

        // Topic owner, topic admin (PERMISSION_ADMIN), or app admin can set message fee
        bool canManage = msg.sender == topic.owner ||
                         topicPermissions[topicId][msg.sender] == PERMISSION_ADMIN ||
                         _hasRole(topic.applicationId, msg.sender, ROLE_ADMIN);
        if (!canManage) revert NotAuthorized();

        topicMessageFeeToken[topicId] = feeTokenAddr;
        topicMessageFeeAmount[topicId] = feeAmount;

        emit TopicMessageFeeUpdated(topicId, feeTokenAddr, feeAmount);
    }

    /**
     * @notice Get message fee configuration for a topic
     * @param topicId Topic ID
     * @return token Fee token address
     * @return amount Fee amount
     */
    function getTopicMessageFee(uint256 topicId) external view returns (address token, uint256 amount) {
        return (topicMessageFeeToken[topicId], topicMessageFeeAmount[topicId]);
    }

    /**
     * @notice Send a message to a topic (V2 with fee collection)
     * @param topicId Topic ID
     * @param payload Message payload (encrypted)
     */
    function sendMessage(uint256 topicId, bytes calldata payload) external override nonReentrant {
        Topic storage topic = topics[topicId];
        if (topic.id == 0) revert TopicNotFound();
        if (!canWriteToTopic(topicId, msg.sender)) revert NotAuthorized();

        // Collect message fee if set (independent of global feesEnabled)
        uint256 feeAmount = topicMessageFeeAmount[topicId];
        address feeTokenAddr = topicMessageFeeToken[topicId];
        if (feeAmount > 0 && feeTokenAddr != address(0)) {
            _collectFeeWithPlatformSplit(feeTokenAddr, feeAmount, topic.owner);
        }

        topic.messageCount++;
        topic.lastMessageAt = uint64(block.timestamp);

        emit MessageSent(topicId, msg.sender, payload, block.timestamp);
    }

    /**
     * @notice Create a topic (V2 with decoupled fees)
     * @dev Topic creation fees now work independently of global feesEnabled flag
     */
    function createTopic(
        uint256 appId,
        string calldata name,
        string calldata description,
        uint8 accessLevel
    ) external override nonReentrant returns (uint256) {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();
        if (accessLevel > ACCESS_PRIVATE) revert InvalidAccessLevel();

        // Check permission
        bool canCreate = app.allowPublicTopicCreation ||
                        msg.sender == app.owner ||
                        _hasRole(appId, msg.sender, ROLE_TOPIC_MANAGER) ||
                        _hasRole(appId, msg.sender, ROLE_ADMIN);
        if (!canCreate) revert NotAuthorized();

        // Collect app-level topic fee if set (DECOUPLED from global feesEnabled)
        if (app.topicCreationFeeAmount > 0 && app.topicCreationFeeToken != address(0)) {
            _collectFeeWithPlatformSplit(app.topicCreationFeeToken, app.topicCreationFeeAmount, app.owner);
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

    /**
     * @notice Collect fee with 3% platform split
     * @param tokenAddr ERC20 token address
     * @param amount Total fee amount
     * @param recipient App/topic owner who receives 97%
     */
    function _collectFeeWithPlatformSplit(
        address tokenAddr,
        uint256 amount,
        address recipient
    ) internal {
        IERC20 token = IERC20(tokenAddr);

        if (token.balanceOf(msg.sender) < amount) revert InsufficientBalance();
        if (token.allowance(msg.sender, address(this)) < amount) revert InsufficientAllowance();

        // Calculate platform fee (3%)
        uint256 platformFee = (amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 recipientAmount = amount - platformFee;

        // Transfer to recipient (97%)
        token.transferFrom(msg.sender, recipient, recipientAmount);

        // Transfer platform fee to treasury (3%)
        if (platformFee > 0 && treasury != address(0)) {
            token.transferFrom(msg.sender, treasury, platformFee);
            emit PlatformFeeCollected(tokenAddr, platformFee, recipient, treasury);
        }
    }

    /**
     * @notice Get contract version
     */
    function getVersion() external pure virtual override returns (string memory) {
        return VERSION_V2;
    }
}


// File contracts/AntennaRegistryV3.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AntennaRegistryV3
 * @notice Upgrade with user nicknames for non-members
 * @dev Allows anyone to set a nickname without requiring membership
 */
contract AntennaRegistryV3 is AntennaRegistryV2 {

    // ============ Version ============

    string public constant VERSION_V3 = "3.0.0";

    // ============ V3 Storage ============

    // User nicknames - anyone can set their own (not just members)
    // appId => user => nickname
    mapping(uint256 => mapping(address => string)) public userNicknames;

    // Nickname change cooldown tracking
    // appId => user => lastChangeTimestamp
    mapping(uint256 => mapping(address => uint256)) public nicknameLastChanged;

    // Per-app cooldown settings (0 = no cooldown, default)
    // appId => cooldownSeconds
    mapping(uint256 => uint256) public appNicknameCooldown;

    // ============ V3 Events ============

    event UserNicknameSet(uint256 indexed applicationId, address indexed user, string nickname);
    event NicknameCooldownSet(uint256 indexed applicationId, uint256 cooldownSeconds);

    // ============ V3 Errors ============

    error NicknameCooldownActive(uint256 timeRemaining);

    // ============ V3 Functions ============

    /**
     * @notice Set your own nickname for an application (no membership required)
     * @dev Users can only set their own nickname (msg.sender). Subject to app-specific cooldown.
     * @param appId Application ID
     * @param nickname Your display name (max 64 chars)
     */
    function setNickname(uint256 appId, string calldata nickname) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();

        // Check app-specific cooldown (skip if cooldown is 0 or first time setting)
        uint256 cooldown = appNicknameCooldown[appId];
        if (cooldown > 0) {
            uint256 lastChanged = nicknameLastChanged[appId][msg.sender];
            if (lastChanged > 0) {
                uint256 timeSinceChange = block.timestamp - lastChanged;
                if (timeSinceChange < cooldown) {
                    revert NicknameCooldownActive(cooldown - timeSinceChange);
                }
            }
        }

        // Basic validation - prevent excessively long nicknames
        require(bytes(nickname).length <= 64, "Nickname too long");

        userNicknames[appId][msg.sender] = nickname;
        nicknameLastChanged[appId][msg.sender] = block.timestamp;
        emit UserNicknameSet(appId, msg.sender, nickname);
    }

    /**
     * @notice Clear your nickname for an application
     * @dev Subject to the same app-specific cooldown as setNickname
     * @param appId Application ID
     */
    function clearNickname(uint256 appId) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();

        // Check app-specific cooldown
        uint256 cooldown = appNicknameCooldown[appId];
        if (cooldown > 0) {
            uint256 lastChanged = nicknameLastChanged[appId][msg.sender];
            if (lastChanged > 0) {
                uint256 timeSinceChange = block.timestamp - lastChanged;
                if (timeSinceChange < cooldown) {
                    revert NicknameCooldownActive(cooldown - timeSinceChange);
                }
            }
        }

        delete userNicknames[appId][msg.sender];
        nicknameLastChanged[appId][msg.sender] = block.timestamp;
        emit UserNicknameSet(appId, msg.sender, "");
    }

    /**
     * @notice Set the nickname change cooldown for an application (owner/admin only)
     * @dev Set to 0 to disable cooldown
     * @param appId Application ID
     * @param cooldownSeconds Cooldown in seconds (e.g., 86400 for 24 hours, 0 to disable)
     */
    function setNicknameCooldown(uint256 appId, uint256 cooldownSeconds) external {
        Application storage app = applications[appId];
        if (app.id == 0) revert ApplicationNotFound();

        // Only owner or admin can set cooldown
        bool canManage = msg.sender == app.owner || _hasRole(appId, msg.sender, ROLE_ADMIN);
        if (!canManage) revert NotAuthorized();

        appNicknameCooldown[appId] = cooldownSeconds;
        emit NicknameCooldownSet(appId, cooldownSeconds);
    }

    /**
     * @notice Get a user's nickname (checks member nickname first, then user nickname)
     * @dev Member nicknames take priority over user nicknames
     * @param appId Application ID
     * @param user User address
     * @return nickname The user's nickname (empty string if not set)
     */
    function getNickname(uint256 appId, address user) external view returns (string memory) {
        // Check if member with nickname first (members take priority)
        Member storage member = members[appId][user];
        if (member.account != address(0) && bytes(member.nickname).length > 0) {
            return member.nickname;
        }
        // Fall back to user nickname
        return userNicknames[appId][user];
    }

    /**
     * @notice Check if a user has a nickname set (either as member or user)
     * @param appId Application ID
     * @param user User address
     * @return hasNickname True if user has a nickname
     */
    function hasNickname(uint256 appId, address user) external view returns (bool) {
        // Check member nickname
        Member storage member = members[appId][user];
        if (member.account != address(0) && bytes(member.nickname).length > 0) {
            return true;
        }
        // Check user nickname
        return bytes(userNicknames[appId][user]).length > 0;
    }

    /**
     * @notice Check when a user can next change their nickname
     * @param appId Application ID
     * @param user User address
     * @return canChange Whether the user can change now
     * @return timeRemaining Seconds until they can change (0 if can change now)
     */
    function canChangeNickname(uint256 appId, address user) external view returns (bool canChange, uint256 timeRemaining) {
        uint256 cooldown = appNicknameCooldown[appId];

        // No cooldown set for this app
        if (cooldown == 0) {
            return (true, 0);
        }

        uint256 lastChanged = nicknameLastChanged[appId][user];
        if (lastChanged == 0) {
            return (true, 0);
        }

        uint256 timeSinceChange = block.timestamp - lastChanged;
        if (timeSinceChange >= cooldown) {
            return (true, 0);
        }

        return (false, cooldown - timeSinceChange);
    }

    // ============ Version ============

    /**
     * @notice Get contract version
     */
    function getVersion() external pure override returns (string memory) {
        return VERSION_V3;
    }
}
