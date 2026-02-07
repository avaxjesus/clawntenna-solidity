const { ethers, upgrades, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ERC-8004 Identity Registry (same on all chains)
const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for testnet node to catch up between transactions
async function pause(label) {
  console.log(`   (waiting 10s for ${label} to settle...)`);
  await sleep(10000);
}

// Testnet nodes can be laggy — retry reads after deploy/upgrade
async function retry(fn, label, retries = 10, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i < retries - 1) {
        console.log(`   (${label}: retrying in ${delayMs / 1000}s... attempt ${i + 2}/${retries})`);
        await sleep(delayMs);
      } else {
        throw e;
      }
    }
  }
}

async function main() {
  console.log("🚀 Deploying full Clawntenna stack to Base Sepolia\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name);
  console.log("Chain ID:", network.config.chainId);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    throw new Error("No ETH balance! Get Sepolia ETH from a faucet first.");
  }

  const treasury = deployer.address;

  // ============================================================
  // 1. Deploy AntennaRegistryV1
  // ============================================================
  console.log("═".repeat(60));
  console.log("📡 Step 1: Deploy AntennaRegistryV1");
  console.log("═".repeat(60));

  const RegistryV1 = await ethers.getContractFactory("AntennaRegistryV1");
  const registry = await upgrades.deployProxy(RegistryV1, [treasury], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();
  const registryProxy = await registry.getAddress();
  console.log("   Proxy:", registryProxy);

  let version = await retry(() => registry.getVersion(), "getVersion");
  console.log("   Version:", version);
  console.log("");
  await pause("V1 deploy");

  // ============================================================
  // 2. Upgrade V1 → V2
  // ============================================================
  console.log("═".repeat(60));
  console.log("⬆️  Step 2: Upgrade Registry V1 → V2");
  console.log("═".repeat(60));

  const RegistryV2 = await ethers.getContractFactory("AntennaRegistryV2");
  const registryV2 = await upgrades.upgradeProxy(registryProxy, RegistryV2, {
    kind: "uups",
  });
  await registryV2.waitForDeployment();
  version = await retry(() => registryV2.getVersion(), "getVersion");
  console.log("   Version:", version);
  console.log("");
  await pause("V2 upgrade");

  // ============================================================
  // 3. Upgrade V2 → V3
  // ============================================================
  console.log("═".repeat(60));
  console.log("⬆️  Step 3: Upgrade Registry V2 → V3");
  console.log("═".repeat(60));

  const RegistryV3 = await ethers.getContractFactory("AntennaRegistryV3");
  const registryV3 = await upgrades.upgradeProxy(registryProxy, RegistryV3, {
    kind: "uups",
  });
  await registryV3.waitForDeployment();
  version = await retry(() => registryV3.getVersion(), "getVersion");
  console.log("   Version:", version);
  console.log("");
  await pause("V3 upgrade");

  // ============================================================
  // 4. Upgrade V3 → V4
  // ============================================================
  console.log("═".repeat(60));
  console.log("⬆️  Step 4: Upgrade Registry V3 → V4");
  console.log("═".repeat(60));

  const RegistryV4 = await ethers.getContractFactory("AntennaRegistryV4");
  const registryV4 = await upgrades.upgradeProxy(registryProxy, RegistryV4, {
    kind: "uups",
  });
  await registryV4.waitForDeployment();
  version = await retry(() => registryV4.getVersion(), "getVersion");
  console.log("   Version:", version);
  console.log("");
  await pause("V4 upgrade");

  // ============================================================
  // 5. Upgrade V4 → V5
  // ============================================================
  console.log("═".repeat(60));
  console.log("⬆️  Step 5: Upgrade Registry V4 → V5");
  console.log("═".repeat(60));

  const RegistryV5 = await ethers.getContractFactory("AntennaRegistryV5");
  const registryV5 = await upgrades.upgradeProxy(registryProxy, RegistryV5, {
    kind: "uups",
  });
  await registryV5.waitForDeployment();
  version = await retry(() => registryV5.getVersion(), "getVersion");
  console.log("   Version:", version);
  await pause("V5 upgrade tx");

  // Set identity registry
  console.log("   Setting identity registry...");
  let tx = await registryV5.setIdentityRegistryAddress(IDENTITY_REGISTRY);
  await tx.wait();
  console.log("   Identity registry set to:", IDENTITY_REGISTRY);
  console.log("");
  await pause("V5 upgrade");

  // ============================================================
  // 6. Deploy TopicKeyManagerV1
  // ============================================================
  console.log("═".repeat(60));
  console.log("🔐 Step 6: Deploy TopicKeyManagerV1");
  console.log("═".repeat(60));

  const KeyManager = await ethers.getContractFactory("TopicKeyManagerV1");
  const keyManager = await upgrades.deployProxy(KeyManager, [registryProxy], {
    initializer: "initialize",
    kind: "uups",
  });
  await keyManager.waitForDeployment();
  const keyManagerProxy = await keyManager.getAddress();
  console.log("   Proxy:", keyManagerProxy);

  const keyManagerVersion = await retry(() => keyManager.getVersion(), "getVersion");
  console.log("   Version:", keyManagerVersion);
  console.log("");
  await pause("KeyManager deploy");

  // ============================================================
  // 7. Deploy SchemaRegistryV1
  // ============================================================
  console.log("═".repeat(60));
  console.log("📋 Step 7: Deploy SchemaRegistryV1");
  console.log("═".repeat(60));

  const SchemaV1 = await ethers.getContractFactory("SchemaRegistryV1");
  const schemaRegistry = await upgrades.deployProxy(SchemaV1, [registryProxy], {
    initializer: "initialize",
    kind: "uups",
  });
  await schemaRegistry.waitForDeployment();
  const schemaProxy = await schemaRegistry.getAddress();
  console.log("   Proxy:", schemaProxy);

  let schemaVersion = await retry(() => schemaRegistry.getVersion(), "getVersion");
  console.log("   Version:", schemaVersion);

  const schemaCount = await retry(() => schemaRegistry.schemaCount(), "schemaCount");
  console.log("   Default schema count:", schemaCount.toString());
  console.log("");
  await pause("SchemaRegistry deploy");

  // ============================================================
  // 8. Upgrade SchemaRegistry V1 → V2
  // ============================================================
  console.log("═".repeat(60));
  console.log("⬆️  Step 8: Upgrade SchemaRegistry V1 → V2");
  console.log("═".repeat(60));

  const SchemaV2 = await ethers.getContractFactory("SchemaRegistryV2");
  const schemaV2 = await upgrades.upgradeProxy(schemaProxy, SchemaV2, {
    kind: "uups",
  });
  await schemaV2.waitForDeployment();
  schemaVersion = await retry(() => schemaV2.contractVersion(), "contractVersion");
  console.log("   Version:", schemaVersion);
  console.log("");
  await pause("SchemaRegistry V2 upgrade");

  // ============================================================
  // 9. Create ClawtennaChat app + default topics
  // ============================================================
  console.log("═".repeat(60));
  console.log("💬 Step 9: Create ClawtennaChat app + topics");
  console.log("═".repeat(60));

  tx = await registryV5.createApplication(
    "ClawtennaChat",
    "Encrypted on-chain messaging",
    "https://clawntenna.com",
    true // allowPublicTopicCreation
  );
  await tx.wait();
  const appCount = await registryV5.applicationCount();
  console.log("   Created app ID:", appCount.toString());
  const appId = Number(appCount);
  await pause("createApplication");

  // Create #general topic (PUBLIC = 0)
  tx = await registryV5.createTopic(appId, "general", "General discussion", 0);
  await tx.wait();
  console.log("   Created #general (topic 1)");
  await pause("topic 1");

  // Create #announcements topic (PUBLIC = 0)
  tx = await registryV5.createTopic(appId, "announcements", "Announcements", 0);
  await tx.wait();
  console.log("   Created #announcements (topic 2)");
  await pause("topic 2");

  // Create #private topic (PRIVATE = 2)
  tx = await registryV5.createTopic(appId, "private", "Private channel", 2);
  await tx.wait();
  console.log("   Created #private (topic 3)");
  await pause("topic 3");

  // Assign default schema to the app
  tx = await schemaV2.assignSchemaToApp(1, appId);
  await tx.wait();
  console.log("   Assigned schema #1 to app");
  await pause("assignSchema");

  // Bind schema to all 3 topics
  tx = await schemaV2.batchSetTopicSchema([1, 2, 3], 1, 1);
  await tx.wait();
  console.log("   Bound schema #1 v1 to all topics");
  console.log("");

  // ============================================================
  // 10. Verify versions
  // ============================================================
  console.log("═".repeat(60));
  console.log("✅ Step 10: Verify versions");
  console.log("═".repeat(60));

  const finalRegistryVersion = await registryV5.getVersion();
  const finalKeyManagerVersion = await keyManager.getVersion();
  const finalSchemaVersion = await schemaV2.contractVersion();

  console.log("   Registry:", finalRegistryVersion);
  console.log("   KeyManager:", finalKeyManagerVersion);
  console.log("   SchemaRegistry:", finalSchemaVersion);

  if (finalRegistryVersion !== "5.0.0") {
    throw new Error(`Registry version mismatch! Expected 5.0.0, got ${finalRegistryVersion}`);
  }
  if (finalKeyManagerVersion !== "1.0.0") {
    throw new Error(`KeyManager version mismatch! Expected 1.0.0, got ${finalKeyManagerVersion}`);
  }
  if (finalSchemaVersion !== "2.0.0") {
    throw new Error(`SchemaRegistry version mismatch! Expected 2.0.0, got ${finalSchemaVersion}`);
  }
  console.log("   All versions correct!");
  console.log("");

  // ============================================================
  // 11. Get implementation addresses & save deployment JSON
  // ============================================================
  console.log("   Resolving implementation addresses...");
  const registryImpl = await retry(
    () => upgrades.erc1967.getImplementationAddress(registryProxy),
    "registry impl"
  );
  const keyManagerImpl = await retry(
    () => upgrades.erc1967.getImplementationAddress(keyManagerProxy),
    "keyManager impl"
  );
  const schemaImpl = await retry(
    () => upgrades.erc1967.getImplementationAddress(schemaProxy),
    "schema impl"
  );

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deployment = {
    network: "baseSepolia",
    chainId: 84532,
    deployer: deployer.address,
    treasury: treasury,
    contracts: {
      AntennaRegistry: {
        proxy: registryProxy,
        implementation: registryImpl,
      },
      TopicKeyManager: {
        proxy: keyManagerProxy,
        implementation: keyManagerImpl,
      },
      SchemaRegistry: {
        proxy: schemaProxy,
        implementation: schemaImpl,
      },
    },
    identityRegistry: IDENTITY_REGISTRY,
    version: finalRegistryVersion,
    keyManagerVersion: finalKeyManagerVersion,
    schemaRegistryVersion: finalSchemaVersion,
    app: {
      id: appId,
      name: "ClawtennaChat",
      topics: ["general", "announcements", "private"],
    },
    deployedAt: new Date().toISOString(),
  };

  const deploymentPath = path.join(deploymentsDir, "baseSepolia.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("📁 Deployment saved to deployments/baseSepolia.json");

  // ============================================================
  // Summary
  // ============================================================
  console.log("\n" + "═".repeat(60));
  console.log("🎉 FULL STACK DEPLOYMENT COMPLETE — Base Sepolia");
  console.log("═".repeat(60));
  console.log("\nContracts:");
  console.log("  Registry Proxy:      ", registryProxy);
  console.log("  Registry Impl:       ", registryImpl);
  console.log("  KeyManager Proxy:    ", keyManagerProxy);
  console.log("  KeyManager Impl:     ", keyManagerImpl);
  console.log("  SchemaRegistry Proxy:", schemaProxy);
  console.log("  SchemaRegistry Impl: ", schemaImpl);
  console.log("  Identity Registry:   ", IDENTITY_REGISTRY);
  console.log("\nApp:");
  console.log("  ClawtennaChat (ID 1) with #general, #announcements, #private");
  console.log("\nVersions:");
  console.log("  Registry:       ", finalRegistryVersion);
  console.log("  KeyManager:     ", finalKeyManagerVersion);
  console.log("  SchemaRegistry: ", finalSchemaVersion);

  const endBalance = await ethers.provider.getBalance(deployer.address);
  console.log("\nGas used:", ethers.formatEther(balance - endBalance), "ETH");
  console.log("Remaining balance:", ethers.formatEther(endBalance), "ETH");

  console.log("\n📋 Update clawntenna-web/lib/constants.ts with these addresses!");
  console.log("═".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
