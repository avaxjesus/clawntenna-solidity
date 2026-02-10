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

  console.log("Upgrading AntennaRegistry to V8 (Message Escrow)");
  console.log("=".repeat(50));
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("Proxy Address:", REGISTRY_PROXY);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), networkName === 'avalanche' ? 'AVAX' : 'ETH');
  console.log("=".repeat(50));

  // Get current version
  const registryV7 = await ethers.getContractAt("AntennaRegistryV7", REGISTRY_PROXY);
  const currentVersion = await registryV7.getVersion();
  const currentImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);

  console.log("\nCurrent State:");
  console.log("  Version:", currentVersion);
  console.log("  Implementation:", currentImpl);

  // Read escrow address from deployment file
  const deploymentFile = `deployments/${networkName}.json`;
  let deployment = {};
  if (fs.existsSync(deploymentFile)) {
    deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  }

  const escrowAddress = deployment.contracts?.MessageEscrow?.proxy;
  if (!escrowAddress) {
    throw new Error(`No MessageEscrow address found in ${deploymentFile}. Run deploy-escrow.cjs first.`);
  }
  console.log("  Escrow:", escrowAddress);

  // Upgrade to V8
  console.log("\nUpgrading to AntennaRegistryV8...");
  const AntennaRegistryV8 = await ethers.getContractFactory("AntennaRegistryV8");

  // Force import if not registered
  console.log("  Checking proxy registration...");
  try {
    await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV8);
    console.log("  Already registered");
  } catch (e) {
    if (e.message.includes("not registered")) {
      console.log("  Importing existing proxy...");
      const CurrentFactory = await ethers.getContractFactory("AntennaRegistryV7");
      await upgrades.forceImport(REGISTRY_PROXY, CurrentFactory, { kind: 'uups' });
      console.log("  Proxy imported successfully");
    } else {
      throw e;
    }
  }

  // Validate upgrade safety
  console.log("  Validating upgrade safety...");
  await upgrades.validateUpgrade(REGISTRY_PROXY, AntennaRegistryV8);
  console.log("  Storage layout compatible");

  // Perform upgrade
  console.log("  Deploying new implementation...");
  const registryV8 = await upgrades.upgradeProxy(REGISTRY_PROXY, AntennaRegistryV8, {
    kind: 'uups',
    unsafeSkipStorageCheck: false
  });
  await registryV8.waitForDeployment();
  console.log("  Upgrade transaction complete");

  const newImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);
  const newVersion = await registryV8.getVersion();

  console.log("\nUpgrade Complete!");
  console.log("  New Version:", newVersion);
  console.log("  New Implementation:", newImpl);
  console.log("  Proxy (unchanged):", REGISTRY_PROXY);

  if (newVersion !== "8.0.0") {
    throw new Error(`Version mismatch! Expected 8.0.0, got ${newVersion}`);
  }

  // Set escrow contract
  console.log("\nSetting escrow contract...");
  const tx = await registryV8.setEscrowContract(escrowAddress);
  await tx.wait();
  console.log("  Escrow contract set to:", escrowAddress);

  // Verify
  const setEscrow = await registryV8.escrowContract();
  if (setEscrow !== escrowAddress) {
    throw new Error(`Escrow address mismatch! Expected ${escrowAddress}, got ${setEscrow}`);
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("ANTENNA V8 UPGRADE COMPLETE");
  console.log("=".repeat(50));
  console.log("\nChanges in V8:");
  console.log("  - Optional message fee escrow per topic");
  console.log("  - Fees held until topic owner responds");
  console.log("  - Refund after configurable timeout");
  console.log("  - Backwards compatible (escrow must be explicitly enabled)");
  console.log("\nAddresses:");
  console.log("  Proxy (unchanged):", REGISTRY_PROXY);
  console.log("  Old Implementation:", currentImpl);
  console.log("  New Implementation:", newImpl);
  console.log("  Escrow:", escrowAddress);
  console.log("=".repeat(50));

  // Update deployment info
  if (deployment.contracts && deployment.contracts.AntennaRegistry) {
    deployment.contracts.AntennaRegistry.implementation = newImpl;
    deployment.contracts.AntennaRegistry.previousImplementation = currentImpl;
  }
  deployment.version = newVersion;
  deployment.upgradedAt = new Date().toISOString();
  deployment.v8Features = {
    messageEscrow: true,
    escrowContract: escrowAddress
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\nDeployment info updated in", deploymentFile);

  console.log("\nNEXT STEPS:");
  console.log("1. Verify new implementation:");
  console.log(`   npx hardhat verify --network ${networkName} ${newImpl}`);
  console.log("\n2. Run the same upgrade on the other chain:");
  const otherNetwork = networkName === 'avalanche' ? 'base' : 'avalanche';
  console.log(`   npx hardhat run scripts/deploy-escrow.cjs --network ${otherNetwork}`);
  console.log(`   npx hardhat run scripts/upgrade-v8.cjs --network ${otherNetwork}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
