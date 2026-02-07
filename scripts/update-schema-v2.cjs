const { ethers, network } = require("hardhat");

// SchemaRegistry proxy addresses per chain
const SCHEMA_REGISTRY_ADDRESSES = {
  base: "0x5c11d2eA4470eD9025D810A21a885FE16dC987Bd",
  avalanche: "0x23D96e610E8E3DA5341a75B77F1BFF7EA9c3A62B",
};

const REGISTRY_ADDRESSES = {
  base: "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF",
  avalanche: "0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713",
};

const SCHEMA_REGISTRY_ABI = [
  "function publishSchemaVersion(uint256 schemaId, string body) returns (uint256)",
  "function batchSetTopicSchema(uint256[] topicIds, uint256 schemaId, uint256 version)",
  "function getSchema(uint256 schemaId) view returns (uint256 id, string name, string description, address creator, uint64 createdAt, uint256 versionCount, bool active)",
  "function getSchemaBody(uint256 schemaId, uint256 version) view returns (string)",
  "function schemaCount() view returns (uint256)",
];

const REGISTRY_ABI = [
  "function topicCount() view returns (uint256)",
];

// New JSON schema body for clawntenna-message-v1
const NEW_SCHEMA_BODY = JSON.stringify({
  "$schema": "clawntenna-message-v1",
  "type": "object",
  "fields": {
    "text": { "type": "string", "required": true, "description": "Message content" },
    "replyTo": { "type": "string", "description": "Transaction hash of replied message" },
    "replyText": { "type": "string", "description": "Preview of replied message" },
    "replyAuthor": { "type": "string", "description": "Address of replied message author" },
    "mentions": { "type": "string[]", "description": "Mentioned addresses" }
  }
}, null, 2);

async function main() {
  const chainName = network.name;
  const schemaRegistryAddress = SCHEMA_REGISTRY_ADDRESSES[chainName];
  const registryAddress = REGISTRY_ADDRESSES[chainName];

  if (!schemaRegistryAddress) {
    console.error(`No schema registry address configured for network: ${chainName}`);
    console.error(`Supported networks: ${Object.keys(SCHEMA_REGISTRY_ADDRESSES).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n📋 Updating schema #1 to JSON format on ${chainName}\n`);

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Schema Registry:", schemaRegistryAddress);
  console.log("");

  const schemaRegistry = new ethers.Contract(schemaRegistryAddress, SCHEMA_REGISTRY_ABI, deployer);
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, deployer);

  // Check current state
  const schema = await schemaRegistry.getSchema(1);
  console.log("Current schema #1:");
  console.log("  Name:", schema.name);
  console.log("  Versions:", schema.versionCount.toString());
  console.log("  Creator:", schema.creator);
  console.log("");

  const currentBody = await schemaRegistry.getSchemaBody(1, 1);
  console.log("Current v1 body:");
  console.log(currentBody);
  console.log("");

  // Publish v2 with JSON body
  console.log("📝 Publishing version 2 with JSON format...");
  console.log("New body:");
  console.log(NEW_SCHEMA_BODY);
  console.log("");

  const publishTx = await schemaRegistry.publishSchemaVersion(1, NEW_SCHEMA_BODY);
  console.log("  Tx:", publishTx.hash);
  await publishTx.wait();
  console.log("  Version 2 published!");
  console.log("");

  // Update all topic bindings to v2
  const topicCount = await registry.topicCount();
  const totalTopics = Number(topicCount);
  console.log(`🔗 Updating ${totalTopics} topic bindings to v2...`);

  if (totalTopics > 0) {
    const topicIds = [];
    for (let i = 1; i <= totalTopics; i++) {
      topicIds.push(i);
    }

    const BATCH_SIZE = 50;
    for (let i = 0; i < topicIds.length; i += BATCH_SIZE) {
      const batch = topicIds.slice(i, i + BATCH_SIZE);
      console.log(`   Binding topics ${batch[0]}-${batch[batch.length - 1]} to schema 1 v2...`);
      const tx = await schemaRegistry.batchSetTopicSchema(batch, 1, 2);
      await tx.wait();
    }
    console.log(`   Updated ${totalTopics} topics to schema 1 v2`);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("Schema #1 updated to JSON format (v2)!");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
