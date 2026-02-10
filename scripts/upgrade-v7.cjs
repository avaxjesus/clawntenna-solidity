const { ethers, upgrades, network } = require("hardhat");
const fs = require('fs');

// Proxy addresses per network
const PROXY_ADDRESSES = {
  base: "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF",
  avalanche: "0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713",
  baseSepolia: "0xf39b193aedC1Ec9FD6C5ccc24fBAe58ba9f52413"
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  const REGISTRY_PROXY = PROXY_ADDRESSES[networkName];
  if (!REGISTRY_PROXY) {
    throw new Error(`No proxy address configured for network: ${networkName}`);
  }

  console.log("🔄 Upgrading AntennaRegistry to V7 (90/5/5 Fee Split)");
  console.log("═".repeat(50));
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("Proxy Address:", REGISTRY_PROXY);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), networkName === 'avalanche' ? 'AVAX' : 'ETH');
  console.log("═".repeat(50));

  // Get current version before upgrade
  const registryV6 = await ethers.getContractAt("AntennaRegistryV6", REGISTRY_PROXY);
  const currentVersion = await registryV6.getVersion();
  const currentImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);

  console.log("\n📋 Current State:");
  console.log("   Version:", currentVersion);
  console.log("   Implementation:", currentImpl);

  // ==========================================
  // Upgrade to V7
  // ==========================================
  console.log("\n⬆️ Upgrading to AntennaRegistryV7...");

  const AntennaRegistryV7 = await ethers.getContractFactory("AntennaRegistryV7");

  // Force import if not registered (for previously deployed proxies)
  console.log("   Checking proxy registration...");
  try {
    await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV7);
    console.log("   ✅ Already registered");
  } catch (e) {
    if (e.message.includes("not registered")) {
      console.log("   Importing existing proxy...");
      const CurrentFactory = await ethers.getContractFactory("AntennaRegistryV6");
      await upgrades.forceImport(REGISTRY_PROXY, CurrentFactory, { kind: 'uups' });
      console.log("   ✅ Proxy imported successfully");
    } else {
      throw e;
    }
  }

  // Validate upgrade safety (checks storage layout compatibility)
  console.log("   Validating upgrade safety...");
  await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV7);
  console.log("   ✅ Storage layout compatible");

  // Perform upgrade
  console.log("   Deploying new implementation...");
  const registryV7 = await upgrades.upgradeProxy(REGISTRY_PROXY, AntennaRegistryV7, {
    kind: 'uups',
    unsafeSkipStorageCheck: false
  });
  await registryV7.waitForDeployment();
  console.log("   ✅ Upgrade transaction complete");

  const newImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);
  const newVersion = await registryV7.getVersion();

  console.log("\n✅ Upgrade Complete!");
  console.log("   New Version:", newVersion);
  console.log("   New Implementation:", newImpl);
  console.log("   Proxy (unchanged):", REGISTRY_PROXY);

  // Verify version
  if (newVersion !== "7.0.0") {
    throw new Error(`Version mismatch! Expected 7.0.0, got ${newVersion}`);
  }

  // Verify new fee constants
  const platformFeeBps = await registryV7.PLATFORM_FEE_BPS_V7();
  const appOwnerFeeBps = await registryV7.APP_OWNER_FEE_BPS();
  console.log("\n📊 Fee Constants:");
  console.log("   PLATFORM_FEE_BPS_V7:", platformFeeBps.toString(), "(5%)");
  console.log("   APP_OWNER_FEE_BPS:", appOwnerFeeBps.toString(), "(5%)");
  console.log("   Topic owner share: 90%");

  if (Number(platformFeeBps) !== 500 || Number(appOwnerFeeBps) !== 500) {
    throw new Error("Fee constant mismatch!");
  }

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n" + "═".repeat(50));
  console.log("📶 ANTENNA V7 UPGRADE COMPLETE");
  console.log("═".repeat(50));
  console.log("\nChanges in V7:");
  console.log("  ✅ Universal 90/5/5 fee split (topic owner / app owner / treasury)");
  console.log("  ✅ Message fees: 90% topic owner, 5% app owner, 5% platform");
  console.log("  ✅ Topic creation fees: 95% app owner, 5% platform");
  console.log("  ✅ Same-address optimization (single transfer when recipient == appOwner)");
  console.log("  ✅ FeeCollected event with full breakdown");
  console.log("  ✅ Fee exemptions unchanged (topic/app owner, app/topic admin)");
  console.log("\nAddresses:");
  console.log("  Proxy (unchanged):", REGISTRY_PROXY);
  console.log("  Old Implementation:", currentImpl);
  console.log("  New Implementation:", newImpl);
  console.log("═".repeat(50));

  // Update deployment info
  const deploymentFile = `deployments/${networkName}.json`;
  let deployment = {};

  if (fs.existsSync(deploymentFile)) {
    deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  }

  if (deployment.contracts && deployment.contracts.AntennaRegistry) {
    deployment.contracts.AntennaRegistry.implementation = newImpl;
    deployment.contracts.AntennaRegistry.previousImplementation = currentImpl;
  }
  deployment.version = newVersion;
  deployment.upgradedAt = new Date().toISOString();
  deployment.v7Features = {
    universalTripleSplit: true,
    platformFeeBps: 500,
    appOwnerFeeBps: 500,
    topicOwnerBps: 9000
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment info updated in", deploymentFile);

  // Instructions
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Verify new implementation:");
  console.log(`   npx hardhat verify --network ${networkName} ${newImpl}`);
  console.log("\n2. Run the same upgrade on the other chain:");
  const otherNetwork = networkName === 'avalanche' ? 'base' : 'avalanche';
  console.log(`   npx hardhat run scripts/upgrade-v7.cjs --network ${otherNetwork}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
