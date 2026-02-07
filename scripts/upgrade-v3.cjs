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

  console.log("🔄 Upgrading AntennaRegistry to V3");
  console.log("═".repeat(50));
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("Proxy Address:", REGISTRY_PROXY);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH/AVAX");
  console.log("═".repeat(50));

  // Get current version before upgrade
  const registryV2 = await ethers.getContractAt("AntennaRegistryV2", REGISTRY_PROXY);
  const currentVersion = await registryV2.getVersion();
  const currentImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);

  console.log("\n📋 Current State:");
  console.log("   Version:", currentVersion);
  console.log("   Implementation:", currentImpl);

  // ==========================================
  // Upgrade to V3
  // ==========================================
  console.log("\n⬆️ Upgrading to AntennaRegistryV3...");

  const AntennaRegistryV3 = await ethers.getContractFactory("AntennaRegistryV3");

  // Force import if not registered (for previously deployed proxies)
  console.log("   Checking proxy registration...");
  try {
    await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV3);
    console.log("   ✅ Already registered");
  } catch (e) {
    if (e.message.includes("not registered")) {
      console.log("   Importing existing proxy...");
      // Get the contract factory for the current implementation
      const currentVersionNum = currentVersion.split('.')[0];
      const CurrentFactory = await ethers.getContractFactory(
        currentVersionNum === "1" ? "AntennaRegistryV1" : "AntennaRegistryV2"
      );
      await upgrades.forceImport(REGISTRY_PROXY, CurrentFactory, { kind: 'uups' });
      console.log("   ✅ Proxy imported successfully");
    } else {
      throw e;
    }
  }

  // Validate upgrade safety (checks storage layout compatibility)
  console.log("   Validating upgrade safety...");
  await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV3);
  console.log("   ✅ Storage layout compatible");

  // Perform upgrade
  console.log("   Deploying new implementation...");
  const registryV3 = await upgrades.upgradeProxy(REGISTRY_PROXY, AntennaRegistryV3, {
    kind: 'uups',
    unsafeSkipStorageCheck: false
  });
  await registryV3.waitForDeployment();
  console.log("   ✅ Upgrade transaction complete");

  const newImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);
  const newVersion = await registryV3.getVersion();

  console.log("\n✅ Upgrade Complete!");
  console.log("   New Version:", newVersion);
  console.log("   New Implementation:", newImpl);
  console.log("   Proxy (unchanged):", REGISTRY_PROXY);

  // Verify new features are available
  console.log("\n🔍 Verifying V3 Features:");
  // Test that the new function exists
  const cooldown = await registryV3.appNicknameCooldown(1);
  console.log("   appNicknameCooldown accessible:", true);
  console.log("   App 1 cooldown:", cooldown.toString(), "seconds");

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n" + "═".repeat(50));
  console.log("📶 ANTENNA V3 UPGRADE COMPLETE");
  console.log("═".repeat(50));
  console.log("\nChanges in V3:");
  console.log("  ✅ Anyone can set their own nickname (no membership required)");
  console.log("  ✅ App admins can set nickname change cooldown");
  console.log("  ✅ getNickname() returns member nickname or user nickname");
  console.log("  ✅ canChangeNickname() to check cooldown status");
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

  deployment.contracts.AntennaRegistry.implementation = newImpl;
  deployment.contracts.AntennaRegistry.previousImplementation = currentImpl;
  deployment.version = newVersion;
  deployment.upgradedAt = new Date().toISOString();
  deployment.v3Features = {
    userNicknames: true,
    nicknameCooldown: true,
    getNickname: true,
    canChangeNickname: true
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment info updated in", deploymentFile);

  // Instructions
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Verify new implementation:");
  console.log(`   npx hardhat verify --network ${networkName} ${newImpl}`);
  console.log("\n2. Users can set nicknames:");
  console.log("   await registry.setNickname(appId, 'MyNickname')");
  console.log("\n3. App admins can set cooldown:");
  console.log("   await registry.setNicknameCooldown(appId, 86400) // 24 hours");
  console.log("\n4. Check if user can change:");
  console.log("   const [canChange, timeLeft] = await registry.canChangeNickname(appId, userAddr)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
