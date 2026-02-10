const { ethers, upgrades, network } = require("hardhat");
const fs = require('fs');

// Registry proxy addresses per network
const REGISTRY_ADDRESSES = {
  base: "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF",
  avalanche: "0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713",
  baseSepolia: "0xf39b193aedC1Ec9FD6C5ccc24fBAe58ba9f52413"
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  const registryAddress = REGISTRY_ADDRESSES[networkName];
  if (!registryAddress) {
    throw new Error(`No registry address configured for network: ${networkName}`);
  }

  console.log("Deploying MessageEscrowV1");
  console.log("=".repeat(50));
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("Registry:", registryAddress);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), networkName === 'avalanche' ? 'AVAX' : 'ETH');
  console.log("=".repeat(50));

  // Read treasury from existing registry
  const registryAbi = ["function treasury() view returns (address)"];
  const registry = new ethers.Contract(registryAddress, registryAbi, deployer);
  const treasury = await registry.treasury();
  console.log("\nTreasury:", treasury);

  // Deploy MessageEscrowV1
  console.log("\nDeploying MessageEscrowV1...");
  const MessageEscrow = await ethers.getContractFactory("MessageEscrowV1");
  const escrow = await upgrades.deployProxy(MessageEscrow, [registryAddress, treasury], {
    initializer: "initialize",
    kind: "uups",
  });
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("  Proxy:", escrowAddress);

  try {
    const implAddress = await upgrades.erc1967.getImplementationAddress(escrowAddress);
    console.log("  Implementation:", implAddress);
  } catch (e) {
    console.log("  (Could not verify impl address)");
  }

  // Verify
  const version = await escrow.getVersion();
  console.log("\nVersion:", version);
  if (version !== "1.0.0") {
    throw new Error(`Version mismatch! Expected 1.0.0, got ${version}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("MESSAGE ESCROW DEPLOYED");
  console.log("=".repeat(50));
  console.log("\nAddresses:");
  console.log("  Registry:", registryAddress);
  console.log("  Escrow:", escrowAddress);
  console.log("  Treasury:", treasury);

  // Update deployment info
  const deploymentFile = `deployments/${networkName}.json`;
  let deployment = {};
  if (fs.existsSync(deploymentFile)) {
    deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  }
  if (!deployment.contracts) deployment.contracts = {};
  deployment.contracts.MessageEscrow = {
    proxy: escrowAddress,
    version: "1.0.0",
    deployedAt: new Date().toISOString()
  };
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\nDeployment info updated in", deploymentFile);

  console.log("\nNEXT STEPS:");
  console.log("1. Upgrade registry to V8:");
  console.log(`   npx hardhat run scripts/upgrade-v8.cjs --network ${networkName}`);
  console.log("2. Verify escrow contract:");
  try {
    const implAddr = await upgrades.erc1967.getImplementationAddress(escrowAddress);
    console.log(`   npx hardhat verify --network ${networkName} ${implAddr}`);
  } catch (e) {}
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
