const { ethers, upgrades, network } = require("hardhat");
const fs = require('fs');

// Proxy addresses per network
const REGISTRY_PROXY_ADDRESSES = {
  base: "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF",
  avalanche: "0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713",
  baseSepolia: "0xf39b193aedC1Ec9FD6C5ccc24fBAe58ba9f52413"
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  const REGISTRY_PROXY = REGISTRY_PROXY_ADDRESSES[networkName];
  if (!REGISTRY_PROXY) {
    throw new Error(`No proxy address configured for network: ${networkName}`);
  }

  console.log("Upgrading to AntennaRegistryV9 + MessageEscrowV2 (Native ETH Fees)");
  console.log("=".repeat(60));
  console.log("Network:", networkName);
  console.log("Deployer:", deployer.address);
  console.log("Registry Proxy:", REGISTRY_PROXY);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), networkName === 'avalanche' ? 'AVAX' : 'ETH');
  console.log("=".repeat(60));

  // Read deployment file
  const deploymentFile = `deployments/${networkName}.json`;
  let deployment = {};
  if (fs.existsSync(deploymentFile)) {
    deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  }

  const escrowProxy = deployment.contracts?.MessageEscrow?.proxy;
  if (!escrowProxy) {
    throw new Error(`No MessageEscrow address found in ${deploymentFile}. Deploy escrow first.`);
  }

  // Get current versions
  const registryV8 = await ethers.getContractAt("AntennaRegistryV8", REGISTRY_PROXY);
  const escrowV1 = await ethers.getContractAt("MessageEscrowV1", escrowProxy);

  const currentRegistryVersion = await registryV8.getVersion();
  const currentEscrowVersion = await escrowV1.getVersion();
  const currentRegistryImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);
  const currentEscrowImpl = await upgrades.erc1967.getImplementationAddress(escrowProxy);

  console.log("\nCurrent State:");
  console.log("  Registry Version:", currentRegistryVersion);
  console.log("  Registry Implementation:", currentRegistryImpl);
  console.log("  Escrow Version:", currentEscrowVersion);
  console.log("  Escrow Implementation:", currentEscrowImpl);
  console.log("  Escrow Proxy:", escrowProxy);

  // ================================================================
  // CRITICAL: Upgrade escrow FIRST, then registry
  // V9 calls recordDeposit{value}() which needs V2's receive()
  // ================================================================

  console.log("\n--- Step 1: Upgrade MessageEscrow to V2 ---");

  let newEscrowImpl, newEscrowVersion;
  if (currentEscrowVersion === "2.0.0") {
    console.log("  Escrow already at V2, skipping");
    newEscrowImpl = currentEscrowImpl;
    newEscrowVersion = currentEscrowVersion;
  } else {
    const MessageEscrowV2 = await ethers.getContractFactory("MessageEscrowV2");

    // Force import to register the proxy with current V1 layout
    console.log("  Force-importing escrow proxy with current V1...");
    const CurrentEscrow = await ethers.getContractFactory("MessageEscrowV1");
    await upgrades.forceImport(escrowProxy, CurrentEscrow, { kind: 'uups' });
    console.log("  Escrow proxy imported");

    console.log("  Deploying new escrow implementation...");
    const escrowV2 = await upgrades.upgradeProxy(escrowProxy, MessageEscrowV2, {
      kind: 'uups',
      unsafeSkipStorageCheck: true
    });
    await escrowV2.waitForDeployment();

    newEscrowImpl = await upgrades.erc1967.getImplementationAddress(escrowProxy);
    newEscrowVersion = await escrowV2.getVersion();
    console.log("  Escrow upgraded!");
    console.log("  New Escrow Version:", newEscrowVersion);
    console.log("  New Escrow Implementation:", newEscrowImpl);

    if (newEscrowVersion !== "2.0.0") {
      throw new Error(`Escrow version mismatch! Expected 2.0.0, got ${newEscrowVersion}`);
    }
  }

  // ================================================================
  // Step 2: Upgrade registry to V9
  // ================================================================

  console.log("\n--- Step 2: Upgrade AntennaRegistry to V9 ---");

  let newRegistryImpl, newRegistryVersion;
  const registryV9 = await ethers.getContractAt("AntennaRegistryV9", REGISTRY_PROXY);

  if (currentRegistryVersion === "9.0.0") {
    console.log("  Registry already at V9, skipping");
    newRegistryImpl = currentRegistryImpl;
    newRegistryVersion = currentRegistryVersion;
  } else {
    const AntennaRegistryV9 = await ethers.getContractFactory("AntennaRegistryV9");

    // Deploy V9 implementation directly and call upgradeTo on the UUPS proxy
    console.log("  Deploying V9 implementation...");
    const v9Impl = await AntennaRegistryV9.deploy();
    await v9Impl.waitForDeployment();
    const v9ImplAddress = await v9Impl.getAddress();
    console.log("  V9 implementation deployed at:", v9ImplAddress);

    console.log("  Calling upgradeToAndCall on proxy...");
    const proxyContract = await ethers.getContractAt("AntennaRegistryV8", REGISTRY_PROXY);
    const upgradeTx = await proxyContract.upgradeToAndCall(v9ImplAddress, "0x");
    await upgradeTx.wait();
    console.log("  Upgrade transaction confirmed");

    newRegistryImpl = await upgrades.erc1967.getImplementationAddress(REGISTRY_PROXY);
    newRegistryVersion = await registryV9.getVersion();
    console.log("  Registry upgraded!");
    console.log("  New Registry Version:", newRegistryVersion);
    console.log("  New Registry Implementation:", newRegistryImpl);

    if (newRegistryVersion !== "9.0.0") {
      throw new Error(`Registry version mismatch! Expected 9.0.0, got ${newRegistryVersion}`);
    }
  }

  // ================================================================
  // Summary
  // ================================================================

  console.log("\n" + "=".repeat(60));
  console.log("V9 UPGRADE COMPLETE — Native ETH Fee Support");
  console.log("=".repeat(60));
  console.log("\nChanges:");
  console.log("  - sendMessage and createTopic are now payable");
  console.log("  - address(0) as fee token = native ETH fee");
  console.log("  - 90/5/5 split for native ETH (same as ERC-20)");
  console.log("  - Escrow supports native ETH deposits, releases, refunds");
  console.log("  - Excess msg.value is refunded to sender");
  console.log("\nAddresses:");
  console.log("  Registry Proxy (unchanged):", REGISTRY_PROXY);
  console.log("  Registry Old Impl:", currentRegistryImpl);
  console.log("  Registry New Impl:", newRegistryImpl);
  console.log("  Escrow Proxy (unchanged):", escrowProxy);
  console.log("  Escrow Old Impl:", currentEscrowImpl);
  console.log("  Escrow New Impl:", newEscrowImpl);
  console.log("=".repeat(60));

  // Update deployment JSON
  if (deployment.contracts) {
    if (deployment.contracts.AntennaRegistry) {
      deployment.contracts.AntennaRegistry.implementation = newRegistryImpl;
      deployment.contracts.AntennaRegistry.previousImplementation = currentRegistryImpl;
    }
    if (deployment.contracts.MessageEscrow) {
      deployment.contracts.MessageEscrow.implementation = newEscrowImpl;
      deployment.contracts.MessageEscrow.previousImplementation = currentEscrowImpl;
    }
  }
  deployment.version = newRegistryVersion;
  deployment.escrowVersion = newEscrowVersion;
  deployment.upgradedAt = new Date().toISOString();
  deployment.v9Features = {
    nativeETHFees: true,
    payableSendMessage: true,
    payableCreateTopic: true
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log("\nDeployment info updated in", deploymentFile);

  console.log("\nNEXT STEPS:");
  console.log("1. Verify new implementations:");
  console.log(`   npx hardhat verify --network ${networkName} ${newRegistryImpl}`);
  console.log(`   npx hardhat verify --network ${networkName} ${newEscrowImpl}`);
  console.log("\n2. Run the same upgrade on the other chain:");
  const otherNetwork = networkName === 'avalanche' ? 'base' : 'avalanche';
  console.log(`   npx hardhat run scripts/upgrade-v9.cjs --network ${otherNetwork}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
