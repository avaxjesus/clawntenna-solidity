const { ethers } = require("hardhat");
async function main() {
  const network = hre.network.name;
  const registryAddr = network === 'base' 
    ? '0x5fF6BF04F1B5A78ae884D977a3C80A0D8E2072bF'
    : '0x3Ca2FF0bD1b3633513299EB5d3e2d63e058b0713';
  
  const registry = await ethers.getContractAt("AntennaRegistryV3", registryAddr);
  const app = await registry.applications(1);
  console.log(`${network}: App 1 owner = ${app.owner}`);
  console.log(`${network}: App 1 name = ${app.name}`);
}
main();
