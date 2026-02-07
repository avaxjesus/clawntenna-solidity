const { ethers, upgrades, network } = require("hardhat");
const fs = require('fs');

// Proxy addresses per network
const PROXY_ADDRESSES = {
  base: "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF",
  avalanche: "0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713"
};

// ERC-8004 Identity Registry (same on both chains)
const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  const REGISTRY_PROXY = PROXY_ADDRESSES[networkName];
  if (!REGISTRY_PROXY) {
    throw new Error(`No proxy address configured for network: ${networkName}`);
  }

  console.log("🔄 Upgrading AntennaRegistry to V5");
  console.log("═".repeat(50));
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("Proxy Address:", REGISTRY_PROXY);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), networkName === 'avalanche' ? 'AVAX' : 'ETH');
  console.log("═".repeat(50));

  // Get current version before upgrade
  const registryV4 = await ethers.getContractAt("AntennaRegistryV4", REGISTRY_PROXY);
  const currentVersion = await registryV4.getVersion();
  const currentImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);

  console.log("\n📋 Current State:");
  console.log("   Version:", currentVersion);
  console.log("   Implementation:", currentImpl);

  // ==========================================
  // Upgrade to V5
  // ==========================================
  console.log("\n⬆️ Upgrading to AntennaRegistryV5...");

  const AntennaRegistryV5 = await ethers.getContractFactory("AntennaRegistryV5");

  // Force import if not registered (for previously deployed proxies)
  console.log("   Checking proxy registration...");
  try {
    await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV5);
    console.log("   ✅ Already registered");
  } catch (e) {
    if (e.message.includes("not registered")) {
      console.log("   Importing existing proxy...");
      const CurrentFactory = await ethers.getContractFactory("AntennaRegistryV4");
      await upgrades.forceImport(REGISTRY_PROXY, CurrentFactory, { kind: 'uups' });
      console.log("   ✅ Proxy imported successfully");
    } else {
      throw e;
    }
  }

  // Validate upgrade safety (checks storage layout compatibility)
  console.log("   Validating upgrade safety...");
  await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV5);
  console.log("   ✅ Storage layout compatible");

  // Perform upgrade
  console.log("   Deploying new implementation...");
  const registryV5 = await upgrades.upgradeProxy(REGISTRY_PROXY, AntennaRegistryV5, {
    kind: 'uups',
    unsafeSkipStorageCheck: false
  });
  await registryV5.waitForDeployment();
  console.log("   ✅ Upgrade transaction complete");

  // ==========================================
  // Post-upgrade: Set identity registry address
  // ==========================================
  console.log("\n🔧 Setting identity registry address...");
  console.log("   Identity Registry:", IDENTITY_REGISTRY);
  const tx = await registryV5.setIdentityRegistryAddress(IDENTITY_REGISTRY);
  await tx.wait();
  console.log("   ✅ Identity registry address set");

  const newImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);
  const newVersion = await registryV5.getVersion();

  console.log("\n✅ Upgrade Complete!");
  console.log("   New Version:", newVersion);
  console.log("   New Implementation:", newImpl);
  console.log("   Proxy (unchanged):", REGISTRY_PROXY);

  // Verify version
  if (newVersion !== "5.0.0") {
    throw new Error(`Version mismatch! Expected 5.0.0, got ${newVersion}`);
  }

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n" + "═".repeat(50));
  console.log("📶 ANTENNA V5 UPGRADE COMPLETE");
  console.log("═".repeat(50));
  console.log("\nChanges in V5:");
  console.log("  ✅ On-chain agent identity registration (ERC-8004)");
  console.log("  ✅ registerAgentIdentity(appId, tokenId) — verified via ownerOf");
  console.log("  ✅ clearAgentIdentity(appId) — remove registration");
  console.log("  ✅ getAgentTokenId(appId, user) — canonical lookup");
  console.log("  ✅ hasAgentIdentity(appId, user) — quick check");
  console.log("  ✅ Identity registry set to:", IDENTITY_REGISTRY);
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
  deployment.v5Features = {
    agentIdentityRegistration: true,
    identityRegistryAddress: IDENTITY_REGISTRY
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment info updated in", deploymentFile);

  // Instructions
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Verify new implementation:");
  console.log(`   npx hardhat verify --network ${networkName} ${newImpl}`);
  console.log("\n2. Run the same upgrade on the other chain:");
  const otherNetwork = networkName === 'avalanche' ? 'base' : 'avalanche';
  console.log(`   npx hardhat run scripts/upgrade-v5.cjs --network ${otherNetwork}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
