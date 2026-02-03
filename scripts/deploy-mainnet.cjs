const { ethers, upgrades, network } = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("🚀 Deploying Clawntenna to Base Mainnet\n");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    throw new Error("No ETH balance!");
  }

  // Use deployer as treasury for now
  const treasury = deployer.address;
  console.log("Treasury:", treasury);
  console.log("Network:", network.name);
  console.log("");

  // Deploy AntennaRegistryV1
  console.log("📡 Deploying AntennaRegistryV1...");
  const Registry = await ethers.getContractFactory("AntennaRegistryV1");
  const registry = await upgrades.deployProxy(Registry, [treasury], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("   Registry Proxy:", registryAddress);
  
  const registryImplAddress = await upgrades.erc1967.getImplementationAddress(registryAddress);
  console.log("   Registry Impl:", registryImplAddress);
  console.log("");

  // Deploy TopicKeyManagerV1
  console.log("🔐 Deploying TopicKeyManagerV1...");
  const KeyManager = await ethers.getContractFactory("TopicKeyManagerV1");
  const keyManager = await upgrades.deployProxy(KeyManager, [registryAddress], {
    initializer: "initialize",
    kind: "uups",
  });
  await keyManager.waitForDeployment();
  const keyManagerAddress = await keyManager.getAddress();
  console.log("   KeyManager Proxy:", keyManagerAddress);
  
  const keyManagerImplAddress = await upgrades.erc1967.getImplementationAddress(keyManagerAddress);
  console.log("   KeyManager Impl:", keyManagerImplAddress);
  console.log("");

  // Verify versions
  const registryVersion = await registry.getVersion();
  const keyManagerVersion = await keyManager.getVersion();
  console.log("✅ Registry version:", registryVersion);
  console.log("✅ KeyManager version:", keyManagerVersion);
  console.log("");

  // Save deployment info
  const deployment = {
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    treasury: treasury,
    contracts: {
      registry: {
        proxy: registryAddress,
        implementation: registryImplAddress
      },
      keyManager: {
        proxy: keyManagerAddress,
        implementation: keyManagerImplAddress
      }
    },
    feesEnabled: false,
    version: registryVersion,
    deployedAt: new Date().toISOString()
  };

  const filename = `deployment-${network.name}.json`;
  fs.writeFileSync(filename, JSON.stringify(deployment, null, 2));
  console.log(`📁 Deployment saved to ${filename}`);
  
  console.log("\n" + "═".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("═".repeat(60));
  console.log("\nRegistry:", registryAddress);
  console.log("KeyManager:", keyManagerAddress);
  console.log("\nUpdate your site config with these addresses!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
