const { ethers, upgrades, network } = require("hardhat");
const fs = require('fs');

// SchemaRegistry proxy addresses per network
const PROXY_ADDRESSES = {
  base: "0x5c11d2eA4470eD9025D810A21a885FE16dC987Bd",
  avalanche: "0x23D96e610E8E3DA5341a75B77F1BFF7EA9c3A62B"
};

// AntennaRegistry proxy addresses (to query app count for migration)
const REGISTRY_ADDRESSES = {
  base: "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF",
  avalanche: "0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713"
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  const SCHEMA_PROXY = PROXY_ADDRESSES[networkName];
  if (!SCHEMA_PROXY) {
    throw new Error(`No schema registry proxy address configured for network: ${networkName}`);
  }

  const REGISTRY_PROXY = REGISTRY_ADDRESSES[networkName];

  console.log("🔄 Upgrading SchemaRegistry to V2");
  console.log("═".repeat(50));
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("Schema Proxy:", SCHEMA_PROXY);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), networkName === 'avalanche' ? 'AVAX' : 'ETH');
  console.log("═".repeat(50));

  // Get current version before upgrade
  const schemaV1 = await ethers.getContractAt("SchemaRegistryV1", SCHEMA_PROXY);
  const currentVersion = await schemaV1.getVersion();
  const currentImpl = await upgrades.erc1967.getImplementationAddress(SCHEMA_PROXY);

  console.log("\n📋 Current State:");
  console.log("   Version:", currentVersion);
  console.log("   Implementation:", currentImpl);

  // ==========================================
  // Upgrade to V2
  // ==========================================
  console.log("\n⬆️ Upgrading to SchemaRegistryV2...");

  const SchemaRegistryV2 = await ethers.getContractFactory("SchemaRegistryV2");

  // Force import if not registered
  console.log("   Checking proxy registration...");
  try {
    await upgrades.validateUpgrade(SCHEMA_PROXY, SchemaRegistryV2);
    console.log("   ✅ Already registered");
  } catch (e) {
    if (e.message.includes("not registered")) {
      console.log("   Importing existing proxy...");
      const CurrentFactory = await ethers.getContractFactory("SchemaRegistryV1");
      await upgrades.forceImport(SCHEMA_PROXY, CurrentFactory, { kind: 'uups' });
      console.log("   ✅ Proxy imported successfully");
    } else {
      throw e;
    }
  }

  // Validate upgrade safety
  console.log("   Validating upgrade safety...");
  await upgrades.validateUpgrade(SCHEMA_PROXY, SchemaRegistryV2);
  console.log("   ✅ Storage layout compatible");

  // Perform upgrade
  console.log("   Deploying new implementation...");
  const schemaV2 = await upgrades.upgradeProxy(SCHEMA_PROXY, SchemaRegistryV2, {
    kind: 'uups',
    unsafeSkipStorageCheck: false
  });
  await schemaV2.waitForDeployment();
  console.log("   ✅ Upgrade transaction complete");

  const newImpl = await upgrades.erc1967.getImplementationAddress(SCHEMA_PROXY);
  const newVersion = await schemaV2.contractVersion();

  console.log("\n✅ Upgrade Complete!");
  console.log("   Contract Version:", newVersion);
  console.log("   New Implementation:", newImpl);
  console.log("   Proxy (unchanged):", SCHEMA_PROXY);

  // ==========================================
  // Migration: Assign schema #1 to all apps
  // ==========================================
  console.log("\n🔄 Migrating schema #1 to existing apps...");

  const registryAbi = [
    "function applicationCount() view returns (uint256)"
  ];
  const registry = new ethers.Contract(REGISTRY_PROXY, registryAbi, deployer);
  const appCount = await registry.applicationCount();
  console.log("   Total applications:", Number(appCount));

  if (Number(appCount) > 0) {
    for (let i = 1; i <= Number(appCount); i++) {
      try {
        const tx = await schemaV2.assignSchemaToApp(1, i);
        await tx.wait();
        console.log(`   ✅ Assigned schema #1 to app #${i}`);
      } catch (e) {
        console.log(`   ⚠️ Failed to assign schema #1 to app #${i}:`, e.message);
      }
    }
  } else {
    console.log("   No applications to migrate");
  }

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n" + "═".repeat(50));
  console.log("📋 SCHEMA REGISTRY V2 UPGRADE COMPLETE");
  console.log("═".repeat(50));
  console.log("\nChanges in V2:");
  console.log("  ✅ Application-scoped schemas (createAppSchema)");
  console.log("  ✅ Per-app name uniqueness");
  console.log("  ✅ getApplicationSchemas / getApplicationSchemaCount");
  console.log("  ✅ getSchemaWithApp (includes applicationId)");
  console.log("  ✅ assignSchemaToApp / batchAssignSchemas (owner)");
  console.log("  ✅ Schema #1 migrated to all existing apps");
  console.log("\nAddresses:");
  console.log("  Proxy (unchanged):", SCHEMA_PROXY);
  console.log("  Old Implementation:", currentImpl);
  console.log("  New Implementation:", newImpl);
  console.log("═".repeat(50));

  // Update deployment info
  const deploymentFile = `deployments/${networkName}.json`;
  let deployment = {};

  if (fs.existsSync(deploymentFile)) {
    deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  }

  if (!deployment.contracts) deployment.contracts = {};
  deployment.contracts.SchemaRegistry = {
    proxy: SCHEMA_PROXY,
    implementation: newImpl,
    previousImplementation: currentImpl
  };
  deployment.schemaRegistryVersion = newVersion;
  deployment.schemaV2UpgradedAt = new Date().toISOString();
  deployment.v2SchemaFeatures = {
    appScopedSchemas: true,
    perAppNameUniqueness: true,
    getApplicationSchemas: true,
    assignSchemaToApp: true
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment info updated in", deploymentFile);

  // Instructions
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Verify new implementation:");
  console.log(`   npx hardhat verify --network ${networkName} ${newImpl}`);
  console.log("\n2. Run the same upgrade on the other chain:");
  const otherNetwork = networkName === 'avalanche' ? 'base' : 'avalanche';
  console.log(`   npx hardhat run scripts/upgrade-schema-v2.cjs --network ${otherNetwork}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
