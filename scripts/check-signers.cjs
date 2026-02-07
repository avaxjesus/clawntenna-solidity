const { ethers, network } = require("hardhat");
async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Signer: ${signer.address}`);
}
main();
