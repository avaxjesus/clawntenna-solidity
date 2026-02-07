const { ethers, upgrades, network } = require("hardhat");
const fs = require('fs');

// Proxy addresses per network
const PROXY_ADDRESSES = {
  base: "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF",
  avalanche: "0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713"
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  const REGISTRY_PROXY = PROXY_ADDRESSES[networkName];
  if (!REGISTRY_PROXY) {
    throw new Error(`No proxy address configured for network: ${networkName}`);
  }

  console.log("🔄 Upgrading AntennaRegistry to V4");
  console.log("═".repeat(50));
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("Proxy Address:", REGISTRY_PROXY);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), networkName === 'avalanche' ? 'AVAX' : 'ETH');
  console.log("═".repeat(50));

  // Get current version before upgrade
  const registryV3 = await ethers.getContractAt("AntennaRegistryV3", REGISTRY_PROXY);
  const currentVersion = await registryV3.getVersion();
  const currentImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);

  console.log("\n📋 Current State:");
  console.log("   Version:", currentVersion);
  console.log("   Implementation:", currentImpl);

  // ==========================================
  // Upgrade to V4
  // ==========================================
  console.log("\n⬆️ Upgrading to AntennaRegistryV4...");

  const AntennaRegistryV4 = await ethers.getContractFactory("AntennaRegistryV4");

  // Force import if not registered (for previously deployed proxies)
  console.log("   Checking proxy registration...");
  try {
    await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV4);
    console.log("   ✅ Already registered");
  } catch (e) {
    if (e.message.includes("not registered")) {
      console.log("   Importing existing proxy...");
      const CurrentFactory = await ethers.getContractFactory("AntennaRegistryV3");
      await upgrades.forceImport(REGISTRY_PROXY, CurrentFactory, { kind: 'uups' });
      console.log("   ✅ Proxy imported successfully");
    } else {
      throw e;
    }
  }

  // Validate upgrade safety (checks storage layout compatibility)
  console.log("   Validating upgrade safety...");
  await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV4);
  console.log("   ✅ Storage layout compatible");

  // Perform upgrade
  console.log("   Deploying new implementation...");
  const registryV4 = await upgrades.upgradeProxy(REGISTRY_PROXY, AntennaRegistryV4, {
    kind: 'uups',
    unsafeSkipStorageCheck: false
  });
  await registryV4.waitForDeployment();
  console.log("   ✅ Upgrade transaction complete");

  const newImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);
  const newVersion = await registryV4.getVersion();

  console.log("\n✅ Upgrade Complete!");
  console.log("   New Version:", newVersion);
  console.log("   New Implementation:", newImpl);
  console.log("   Proxy (unchanged):", REGISTRY_PROXY);

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n" + "═".repeat(50));
  console.log("📶 ANTENNA V4 UPGRADE COMPLETE");
  console.log("═".repeat(50));
  console.log("\nChanges in V4:");
  console.log("  ✅ Topic owners exempt from message fees");
  console.log("  ✅ App owners exempt from message fees");
  console.log("  ✅ App admins exempt from message fees");
  console.log("  ✅ Topic admins (PERMISSION_ADMIN) exempt from message fees");
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
  deployment.v4Features = {
    feeExemptTopicOwner: true,
    feeExemptAppOwner: true,
    feeExemptAppAdmin: true,
    feeExemptTopicAdmin: true
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment info updated in", deploymentFile);

  // Instructions
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Verify new implementation:");
  console.log(`   npx hardhat verify --network ${networkName} ${newImpl}`);
  console.log("\n2. Run the same upgrade on the other chain:");
  const otherNetwork = networkName === 'avalanche' ? 'base' : 'avalanche';
  console.log(`   npx hardhat run scripts/upgrade-v4.cjs --network ${otherNetwork}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
