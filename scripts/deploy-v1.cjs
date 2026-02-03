const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("🚀 Deploying Upgradeable Antenna Contracts (V1)");
  console.log("═".repeat(50));
  console.log("Deployer:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("═".repeat(50));

  // Treasury address (receives any fees when enabled)
  const treasury = deployer.address; // Change for production!

  // ==========================================
  // Deploy AntennaRegistryV1 (UUPS Proxy)
  // ==========================================
  console.log("\n1️⃣ Deploying AntennaRegistryV1...");
  
  const AntennaRegistryV1 = await ethers.getContractFactory("AntennaRegistryV1");
  const registry = await upgrades.deployProxy(
    AntennaRegistryV1,
    [treasury], // initialize(address _treasury)
    { 
      kind: 'uups',
      initializer: 'initialize'
    }
  );
  await registry.waitForDeployment();
  
  const registryAddress = await registry.getAddress();
  const registryImplAddress = await upgrades.erc1967.getImplementationAddress(registryAddress);
  
  console.log("✅ AntennaRegistryV1 deployed!");
  console.log("   Proxy:", registryAddress);
  console.log("   Implementation:", registryImplAddress);
  
  // Verify initial state
  const version = await registry.getVersion();
  const feesEnabled = await registry.feesEnabled();
  console.log("   Version:", version);
  console.log("   Fees Enabled:", feesEnabled);

  // ==========================================
  // Deploy TopicKeyManagerV1 (UUPS Proxy)
  // ==========================================
  console.log("\n2️⃣ Deploying TopicKeyManagerV1...");
  
  const TopicKeyManagerV1 = await ethers.getContractFactory("TopicKeyManagerV1");
  const keyManager = await upgrades.deployProxy(
    TopicKeyManagerV1,
    [registryAddress], // initialize(address _registry)
    {
      kind: 'uups',
      initializer: 'initialize'
    }
  );
  await keyManager.waitForDeployment();
  
  const keyManagerAddress = await keyManager.getAddress();
  const keyManagerImplAddress = await upgrades.erc1967.getImplementationAddress(keyManagerAddress);
  
  console.log("✅ TopicKeyManagerV1 deployed!");
  console.log("   Proxy:", keyManagerAddress);
  console.log("   Implementation:", keyManagerImplAddress);
  
  const kmVersion = await keyManager.getVersion();
  console.log("   Version:", kmVersion);

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n" + "═".repeat(50));
  console.log("📶 ANTENNA V1 DEPLOYMENT COMPLETE");
  console.log("═".repeat(50));
  console.log("\nProxy Addresses (use these in your app):");
  console.log("  AntennaRegistry:", registryAddress);
  console.log("  TopicKeyManager:", keyManagerAddress);
  console.log("\nImplementation Addresses (for verification):");
  console.log("  Registry Impl:", registryImplAddress);
  console.log("  KeyManager Impl:", keyManagerImplAddress);
  console.log("\nConfiguration:");
  console.log("  Treasury:", treasury);
  console.log("  Fees Enabled:", feesEnabled);
  console.log("  Upgradeable:", "Yes (UUPS)");
  console.log("═".repeat(50));

  // Save deployment info
  const fs = require('fs');
  const deployment = {
    network: hre.network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    treasury: treasury,
    contracts: {
      registry: {
        proxy: registryAddress,
        implementation: registryImplAddress,
        version: version
      },
      keyManager: {
        proxy: keyManagerAddress,
        implementation: keyManagerImplAddress,
        version: kmVersion
      }
    },
    config: {
      feesEnabled: feesEnabled,
      applicationFee: "0",
      topicFee: "0"
    },
    upgradeable: true,
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync('deployment-v1.json', JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment info saved to deployment-v1.json");

  // Instructions
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Verify contracts on BaseScan:");
  console.log(`   npx hardhat verify --network ${hre.network.name} ${registryImplAddress}`);
  console.log(`   npx hardhat verify --network ${hre.network.name} ${keyManagerImplAddress}`);
  console.log("\n2. Update your frontend with new addresses");
  console.log("\n3. To enable fees later:");
  console.log("   await registry.setFeeToken(tokenAddress)");
  console.log("   await registry.setFees(appFee, topicFee)");
  console.log("   await registry.setFeesEnabled(true)");
  console.log("\n4. To upgrade contracts:");
  console.log("   const V2 = await ethers.getContractFactory('AntennaRegistryV2')");
  console.log(`   await upgrades.upgradeProxy('${registryAddress}', V2)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
