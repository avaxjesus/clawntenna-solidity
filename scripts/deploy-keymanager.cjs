const { ethers, upgrades, network } = require("hardhat");
const fs = require("fs");

const REGISTRY_ADDRESS = "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF";

async function main() {
  console.log("🔐 Deploying TopicKeyManagerV1 to Base Mainnet\n");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Registry:", REGISTRY_ADDRESS);
  console.log("Network:", network.name);
  console.log("");

  // Deploy TopicKeyManagerV1
  console.log("🔐 Deploying TopicKeyManagerV1...");
  const KeyManager = await ethers.getContractFactory("TopicKeyManagerV1");
  const keyManager = await upgrades.deployProxy(KeyManager, [REGISTRY_ADDRESS], {
    initializer: "initialize",
    kind: "uups",
  });
  await keyManager.waitForDeployment();
  const keyManagerAddress = await keyManager.getAddress();
  console.log("   KeyManager Proxy:", keyManagerAddress);
  
  // Try to get impl address, but don't fail if it errors
  try {
    const keyManagerImplAddress = await upgrades.erc1967.getImplementationAddress(keyManagerAddress);
    console.log("   KeyManager Impl:", keyManagerImplAddress);
  } catch (e) {
    console.log("   (Could not verify impl address, checking manually...)");
  }
  console.log("");

  // Verify version
  const keyManagerVersion = await keyManager.getVersion();
  console.log("✅ KeyManager version:", keyManagerVersion);
  console.log("");

  console.log("═".repeat(60));
  console.log("🎉 KEYMANAGER DEPLOYED!");
  console.log("═".repeat(60));
  console.log("\nRegistry:", REGISTRY_ADDRESS);
  console.log("KeyManager:", keyManagerAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
