const { ethers, upgrades } = require("hardhat");
async function main() {
  const impl = await upgrades.erc1967.getImplementationAddress("0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF");
  console.log("Current implementation:", impl);
  const registry = await ethers.getContractAt("AntennaRegistryV3", "0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF");
  try {
    const version = await registry.getVersion();
    console.log("Version:", version);
    const cooldown = await registry.appNicknameCooldown(1);
    console.log("V3 function works - cooldown:", cooldown.toString());
  } catch (e) {
    console.log("V3 functions not available:", e.message);
  }
}
main();
