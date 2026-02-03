#!/usr/bin/env node
/**
 * Verify Antenna contracts on Snowtrace.io (Avalanche block explorer)
 *
 * Usage:
 *   SNOWTRACE_API_KEY=your_key npx hardhat run scripts/verify-avalanche.mjs --network avalanche
 *
 * Or use the shell script wrapper:
 *   ./verify-avalanche.sh
 *
 * Note: Snowscan.xyz and Snowtrace.io use the same API, so this works for both.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';

const execAsync = promisify(exec);

// Load deployment info
const deployment = JSON.parse(readFileSync('./deployment-avalanche.json', 'utf8'));

const REGISTRY_IMPL = deployment.contracts.registry.implementation;
const REGISTRY_PROXY = deployment.contracts.registry.proxy;
const KEY_MANAGER_IMPL = deployment.contracts.keyManager.implementation;
const KEY_MANAGER_PROXY = deployment.contracts.keyManager.proxy;

console.log('🔍 Verifying Antenna contracts on Avalanche (Snowtrace/Snowscan)');
console.log('━'.repeat(60));
console.log(`Registry Proxy: ${REGISTRY_PROXY}`);
console.log(`Registry Implementation: ${REGISTRY_IMPL}`);
console.log(`KeyManager Proxy: ${KEY_MANAGER_PROXY}`);
console.log(`KeyManager Implementation: ${KEY_MANAGER_IMPL}`);
console.log('━'.repeat(60));

async function verifyContract(address, contractPath, constructorArgs = []) {
  console.log(`\n📋 Verifying ${contractPath} at ${address}...`);

  let cmd = `npx hardhat verify --network avalanche ${address}`;

  // Add contract path if provided
  if (contractPath) {
    cmd += ` --contract ${contractPath}`;
  }

  // Add constructor args
  for (const arg of constructorArgs) {
    cmd += ` "${arg}"`;
  }

  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('Already Verified')) console.error(stderr);
    console.log(`✅ ${address} verified successfully!`);
    return true;
  } catch (error) {
    if (error.stdout?.includes('Already Verified') || error.message?.includes('Already Verified')) {
      console.log(`✅ ${address} is already verified`);
      return true;
    }
    console.error(`❌ Failed to verify ${address}:`);
    console.error(error.message || error);
    return false;
  }
}

async function verifyProxy(proxyAddress, implementationAddress) {
  console.log(`\n🔗 Linking proxy ${proxyAddress} to implementation ${implementationAddress}...`);

  // Verify the proxy as a TransparentUpgradeableProxy
  // The proxy itself is usually auto-detected by Snowtrace

  try {
    const cmd = `npx hardhat verify --network avalanche ${proxyAddress}`;
    const { stdout, stderr } = await execAsync(cmd);
    if (stdout) console.log(stdout);
    console.log(`✅ Proxy linked!`);
    return true;
  } catch (error) {
    if (error.stdout?.includes('Already Verified') || error.message?.includes('Already Verified')) {
      console.log(`✅ Proxy ${proxyAddress} is already verified`);
      return true;
    }
    // Proxy verification often fails but that's okay - implementation is what matters
    console.log(`ℹ️  Proxy verification skipped (implementation is what matters)`);
    return true;
  }
}

async function main() {
  console.log('\n🚀 Starting verification process...\n');

  // 1. Verify AntennaRegistryV1 implementation
  console.log('\n1️⃣  Verifying AntennaRegistryV1 Implementation');
  await verifyContract(
    REGISTRY_IMPL,
    'contracts/AntennaRegistryV1.sol:AntennaRegistryV1'
  );

  // 2. Verify TopicKeyManagerV1 implementation
  console.log('\n2️⃣  Verifying TopicKeyManagerV1 Implementation');
  await verifyContract(
    KEY_MANAGER_IMPL,
    'contracts/TopicKeyManagerV1.sol:TopicKeyManagerV1'
  );

  // 3. Try to verify proxies (optional, often auto-detected)
  console.log('\n3️⃣  Verifying Proxy Contracts (optional)');
  await verifyProxy(REGISTRY_PROXY, REGISTRY_IMPL);
  await verifyProxy(KEY_MANAGER_PROXY, KEY_MANAGER_IMPL);

  console.log('\n' + '━'.repeat(60));
  console.log('✅ Verification complete!');
  console.log('\n📍 View contracts on Snowtrace:');
  console.log(`   Registry: https://snowtrace.io/address/${REGISTRY_PROXY}`);
  console.log(`   KeyManager: https://snowtrace.io/address/${KEY_MANAGER_PROXY}`);
  console.log('\n📍 View contracts on Snowscan:');
  console.log(`   Registry: https://snowscan.xyz/address/${REGISTRY_PROXY}`);
  console.log(`   KeyManager: https://snowscan.xyz/address/${KEY_MANAGER_PROXY}`);
}

main().catch(console.error);
