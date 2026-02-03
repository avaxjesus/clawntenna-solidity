const { ethers, upgrades } = require("hardhat");
const fs = require('fs');

// Mainnet proxy address from deployment
const REGISTRY_PROXY = "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("🔄 Upgrading AntennaRegistry to V2");
  console.log("═".repeat(50));
  console.log("Deployer:", deployer.address);
  console.log("Proxy Address:", REGISTRY_PROXY);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("═".repeat(50));

  // Get current version before upgrade
  const registryV1 = await ethers.getContractAt("AntennaRegistryV1", REGISTRY_PROXY);
  const currentVersion = await registryV1.getVersion();
  const currentImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);

  console.log("\n📋 Current State:");
  console.log("   Version:", currentVersion);
  console.log("   Implementation:", currentImpl);

  // ==========================================
  // Upgrade to V2
  // ==========================================
  console.log("\n⬆️ Upgrading to AntennaRegistryV2...");

  const AntennaRegistryV2 = await ethers.getContractFactory("AntennaRegistryV2");

  // Validate upgrade safety (checks storage layout compatibility)
  console.log("   Validating upgrade safety...");
  await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV2);
  console.log("   ✅ Storage layout compatible");

  // Perform upgrade
  const registryV2 = await upgrades.upgradeProxy(REGISTRY_PROXY, AntennaRegistryV2);
  await registryV2.waitForDeployment();

  const newImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);
  const newVersion = await registryV2.getVersion();

  console.log("\n✅ Upgrade Complete!");
  console.log("   New Version:", newVersion);
  console.log("   New Implementation:", newImpl);
  console.log("   Proxy (unchanged):", REGISTRY_PROXY);

  // Verify new features are available
  console.log("\n🔍 Verifying V2 Features:");
  const platformFeeBps = await registryV2.PLATFORM_FEE_BPS();
  console.log("   Platform Fee:", platformFeeBps.toString(), "basis points (3%)");

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n" + "═".repeat(50));
  console.log("📶 ANTENNA V2 UPGRADE COMPLETE");
  console.log("═".repeat(50));
  console.log("\nChanges in V2:");
  console.log("  ✅ Topic creation fees now work without global feesEnabled");
  console.log("  ✅ Message fees can be set per-topic");
  console.log("  ✅ 3% platform fee on all app/topic fees");
  console.log("\nAddresses:");
  console.log("  Proxy (unchanged):", REGISTRY_PROXY);
  console.log("  Old Implementation:", currentImpl);
  console.log("  New Implementation:", newImpl);
  console.log("═".repeat(50));

  // Update deployment info
  const deploymentFile = 'deployment-base-mainnet.json';
  let deployment = {};

  if (fs.existsSync(deploymentFile)) {
    deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  }

  deployment.contracts.registry.implementation = newImpl;
  deployment.contracts.registry.previousImplementation = currentImpl;
  deployment.version = newVersion;
  deployment.upgradedAt = new Date().toISOString();
  deployment.v2Features = {
    platformFeeBps: platformFeeBps.toString(),
    topicMessageFees: true,
    decoupledAppFees: true
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment info updated in", deploymentFile);

  // Instructions
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Verify new implementation on BaseScan:");
  console.log(`   npx hardhat verify --network ${hre.network.name} ${newImpl}`);
  console.log("\n2. App owners can now set topic creation fees:");
  console.log("   await registry.setTopicCreationFee(appId, tokenAddress, amount)");
  console.log("\n3. Topic owners can set message fees:");
  console.log("   await registry.setTopicMessageFee(topicId, tokenAddress, amount)");
  console.log("\n4. Fee split: 97% to owner, 3% to treasury");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
