const { ethers, upgrades, network } = require("hardhat");

// Registry proxy addresses per chain
const REGISTRY_ADDRESSES = {
  base: "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF",
  avalanche: "0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713",
};

async function main() {
  const chainName = network.name;
  const registryAddress = REGISTRY_ADDRESSES[chainName];
  if (!registryAddress) {
    console.error(`No registry address configured for network: ${chainName}`);
    console.error(`Supported networks: ${Object.keys(REGISTRY_ADDRESSES).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n📋 Deploying SchemaRegistryV1 to ${chainName}\n`);

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Registry:", registryAddress);
  console.log("Network:", chainName);
  console.log("");

  // Deploy SchemaRegistryV1
  console.log("📋 Deploying SchemaRegistryV1...");
  const SchemaRegistry = await ethers.getContractFactory("SchemaRegistryV1");
  const schemaRegistry = await upgrades.deployProxy(SchemaRegistry, [registryAddress], {
    initializer: "initialize",
    kind: "uups",
  });
  await schemaRegistry.waitForDeployment();
  const schemaRegistryAddress = await schemaRegistry.getAddress();
  console.log("   SchemaRegistry Proxy:", schemaRegistryAddress);

  try {
    const implAddress = await upgrades.erc1967.getImplementationAddress(schemaRegistryAddress);
    console.log("   SchemaRegistry Impl:", implAddress);
  } catch (e) {
    console.log("   (Could not verify impl address, checking manually...)");
  }
  console.log("");

  // Verify version and default schema
  const version = await schemaRegistry.getVersion();
  console.log("Version:", version);

  const schemaCount = await schemaRegistry.schemaCount();
  console.log("Default schema count:", schemaCount.toString());

  const [schemaId, , body] = await schemaRegistry.getSchema(1);
  console.log("Default schema ID:", schemaId.toString());
  console.log("");

  // Bind default schema to all existing topics
  console.log("🔗 Binding default schema to existing topics...");

  const registryAbi = [
    "function topicCount() view returns (uint256)",
  ];
  const registry = new ethers.Contract(registryAddress, registryAbi, deployer);
  const topicCount = await registry.topicCount();
  const totalTopics = Number(topicCount);
  console.log(`   Found ${totalTopics} existing topics`);

  if (totalTopics > 0) {
    // Build array of topic IDs [1, 2, ..., totalTopics]
    const topicIds = [];
    for (let i = 1; i <= totalTopics; i++) {
      topicIds.push(i);
    }

    // Batch in chunks of 50 to avoid gas limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < topicIds.length; i += BATCH_SIZE) {
      const batch = topicIds.slice(i, i + BATCH_SIZE);
      console.log(`   Binding topics ${batch[0]}-${batch[batch.length - 1]}...`);
      const tx = await schemaRegistry.batchSetTopicSchema(batch, 1, 1);
      await tx.wait();
    }
    console.log(`   Bound ${totalTopics} topics to default schema (ID 1, version 1)`);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("🎉 SCHEMA REGISTRY DEPLOYED!");
  console.log("=".repeat(60));
  console.log("\nRegistry:", registryAddress);
  console.log("SchemaRegistry:", schemaRegistryAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
