#!/usr/bin/env node
/**
 * Verify Clawntenna contracts on Basescan
 *
 * Usage:
 *   node scripts/verify-contracts.mjs
 *
 * Requires:
 *   - BASESCAN_API_KEY in .env file
 *   - Contracts compiled with same settings as deployment
 */

import { execSync } from 'child_process';
import fs from 'fs';

// Contract addresses from deployment
const deployment = JSON.parse(fs.readFileSync('./deployment-base-mainnet.json', 'utf8'));

const REGISTRY_PROXY = deployment.contracts.registry.proxy;
const REGISTRY_IMPL = deployment.contracts.registry.implementation;
const KEY_MANAGER_PROXY = deployment.contracts.keyManager.proxy;
const KEY_MANAGER_IMPL = deployment.contracts.keyManager.implementation;

// Treasury address used in initialize()
const TREASURY = deployment.treasury;

console.log('Clawntenna Contract Verification');
console.log('=================================\n');
console.log('Registry Proxy:', REGISTRY_PROXY);
console.log('Registry Implementation:', REGISTRY_IMPL);
console.log('KeyManager Proxy:', KEY_MANAGER_PROXY);
console.log('KeyManager Implementation:', KEY_MANAGER_IMPL);
console.log('Treasury:', TREASURY);
console.log('');

// Check for API key
if (!process.env.BASESCAN_API_KEY) {
  console.log('ERROR: BASESCAN_API_KEY not found in environment');
  console.log('');
  console.log('To get an API key:');
  console.log('1. Go to https://basescan.org/myapikey');
  console.log('2. Create a free account and generate an API key');
  console.log('3. Add to .env file: BASESCAN_API_KEY=your_key_here');
  process.exit(1);
}

function runVerify(address, contractPath, constructorArgs = []) {
  const argsStr = constructorArgs.length > 0
    ? `--constructor-args ${constructorArgs.join(' ')}`
    : '';

  const cmd = `npx hardhat verify --network base ${address} ${contractPath ? `--contract ${contractPath}` : ''} ${argsStr}`;

  console.log(`Running: ${cmd}\n`);

  try {
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch (e) {
    if (e.message?.includes('Already Verified')) {
      console.log('Contract already verified!\n');
      return true;
    }
    console.log('Verification failed:', e.message);
    return false;
  }
}

async function main() {
  console.log('\n--- Verifying AntennaRegistryV1 Implementation ---\n');
  runVerify(
    REGISTRY_IMPL,
    'contracts/AntennaRegistryV1.sol:AntennaRegistryV1'
  );

  console.log('\n--- Verifying TopicKeyManagerV1 Implementation ---\n');
  runVerify(
    KEY_MANAGER_IMPL,
    'contracts/TopicKeyManagerV1.sol:TopicKeyManagerV1'
  );

  console.log('\n=================================');
  console.log('Verification complete!');
  console.log('');
  console.log('View on Basescan:');
  console.log(`  Registry: https://basescan.org/address/${REGISTRY_PROXY}#code`);
  console.log(`  KeyManager: https://basescan.org/address/${KEY_MANAGER_PROXY}#code`);
  console.log('');
  console.log('Note: For UUPS proxies, Basescan should automatically link');
  console.log('the implementation once verified. If not, you may need to');
  console.log('manually "Is this a proxy?" on the proxy contract page.');
}

main().catch(console.error);
