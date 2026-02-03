# Antenna Contracts V1 (Upgradeable)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ANTENNA V1 ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐     ┌─────────────────────┐       │
│  │ Registry Proxy      │     │ KeyManager Proxy    │       │
│  │ (ERC1967)           │     │ (ERC1967)           │       │
│  │                     │     │                     │       │
│  │ Fixed address ✓     │     │ Fixed address ✓     │       │
│  │ Stores all data ✓   │     │ Stores all data ✓   │       │
│  └──────────┬──────────┘     └──────────┬──────────┘       │
│             │                           │                   │
│             ▼                           ▼                   │
│  ┌─────────────────────┐     ┌─────────────────────┐       │
│  │ AntennaRegistryV1   │     │ TopicKeyManagerV1   │       │
│  │ (Implementation)    │     │ (Implementation)    │       │
│  │                     │     │                     │       │
│  │ Upgradeable ✓       │     │ Upgradeable ✓       │       │
│  └─────────────────────┘     └─────────────────────┘       │
│                                                              │
│  UUPS Pattern: Implementation controls upgrade logic        │
│  Data stays in proxy, logic can be upgraded                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Contracts

### AntennaRegistryV1.sol
- Applications, topics, memberships
- Message events
- Role-based permissions
- **Fees disabled by default** (feature flag)

### TopicKeyManagerV1.sol
- ECDH public key registration
- Encrypted key grants
- Key rotation support
- Migration helpers

## Key Features

### 1. UUPS Upgradeable
Both contracts use OpenZeppelin's UUPS proxy pattern:
- Proxy address never changes (users don't need to update)
- All data stored in proxy
- Implementation can be upgraded by owner
- Upgrade logic lives in implementation (safer)

### 2. Fees Disabled by Default
```solidity
bool public feesEnabled; // false by default

// Owner can enable when ready:
function setFeesEnabled(bool _enabled) external onlyOwner;
function setFees(uint256 _applicationFee, uint256 _topicFee) external onlyOwner;
function setFeeToken(address _token) external onlyOwner;
```

### 3. Version Tracking
```solidity
string public constant VERSION = "1.0.0";
function getVersion() external pure returns (string memory);
```

### 4. Migration Helpers
```solidity
// Export user data for migration
function exportMemberData(uint256 appId, address user) external view returns (bytes memory);
function exportApplicationData(uint256 appId) external view returns (bytes memory);
function exportUserData(address user, uint256[] calldata topicIds) external view returns (bytes memory);
```

## Deployment

### Prerequisites
```bash
npm install
cp .env.example .env
# Edit .env with your PRIVATE_KEY
```

### Deploy to Testnet
```bash
npm run deploy:testnet
```

### Deploy to Mainnet
```bash
npm run deploy:mainnet
```

### Verify on BaseScan
```bash
npx hardhat verify --network base-sepolia <IMPLEMENTATION_ADDRESS>
```

## Upgrading

### 1. Create New Implementation
```solidity
// contracts/AntennaRegistryV2.sol
contract AntennaRegistryV2 is AntennaRegistryV1 {
    string public constant VERSION = "2.0.0";
    
    // Add new features...
    function newFeature() external { ... }
}
```

### 2. Deploy Upgrade
```javascript
const V2 = await ethers.getContractFactory("AntennaRegistryV2");
await upgrades.upgradeProxy(PROXY_ADDRESS, V2);
```

### 3. Verify
```bash
npx hardhat verify --network base <NEW_IMPL_ADDRESS>
```

## Security Considerations

### Upgrade Authorization
- Only contract owner can upgrade
- Consider adding timelock for mainnet
- Consider multisig ownership

### Recommended for Production
```solidity
// Add to constructor or separate contract:
TimelockController timelock = new TimelockController(
    2 days,  // Minimum delay
    [admin1, admin2],  // Proposers
    [admin1, admin2],  // Executors
    address(0)  // No admin
);

// Transfer ownership to timelock
registry.transferOwnership(address(timelock));
```

## Testing

```bash
npx hardhat test
```

## Environment Variables

```bash
# .env
PRIVATE_KEY=0x...
BASE_SEPOLIA_RPC=https://base-sepolia-rpc.publicnode.com
BASE_RPC=https://mainnet.base.org
BASESCAN_API_KEY=...
```

## Gas Estimates

| Operation | Estimated Gas |
|-----------|--------------|
| Deploy Registry Proxy | ~2,500,000 |
| Deploy KeyManager Proxy | ~1,500,000 |
| Create Application | ~150,000 |
| Create Topic | ~120,000 |
| Send Message | ~80,000 |
| Register Public Key | ~50,000 |
| Grant Key Access | ~80,000 |

## License

MIT
