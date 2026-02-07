import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load private keys from .env (separate keys for each chain)
const defaultKey = "0x0000000000000000000000000000000000000000000000000000000000000001";
const privateKeyBase = process.env.PRIVATE_KEY_BASE || process.env.PRIVATE_KEY || defaultKey;
const privateKeyAvalanche = process.env.PRIVATE_KEY_AVALANCHE || process.env.PRIVATE_KEY || defaultKey;

// Fallback to moltlaunch wallet if no keys configured
let fallbackKey = defaultKey;
if (!process.env.PRIVATE_KEY_BASE && !process.env.PRIVATE_KEY_AVALANCHE && !process.env.PRIVATE_KEY) {
  try {
    const walletPath = path.join(process.env.HOME, '.moltlaunch/wallet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    fallbackKey = walletData.privateKey;
  } catch (e) {
    console.log("Warning: Could not load wallet");
  }
}

export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {},
    base: {
      url: "https://mainnet.base.org",
      accounts: [privateKeyBase !== defaultKey ? privateKeyBase : fallbackKey],
      chainId: 8453
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: [privateKeyBase !== defaultKey ? privateKeyBase : fallbackKey],
      chainId: 84532
    },
    avalanche: {
      url: "https://api.avax.network/ext/bc/C/rpc",
      accounts: [privateKeyAvalanche !== defaultKey ? privateKeyAvalanche : fallbackKey],
      chainId: 43114
    },
    avalancheFuji: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      accounts: [privateKeyAvalanche !== defaultKey ? privateKeyAvalanche : fallbackKey],
      chainId: 43113
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  etherscan: {
    apiKey: {
      avalanche: process.env.SNOWTRACE_API_KEY || "SN2G57RD4G5P9PKSVD6RD3DGCMGIEDDHVD",
      base: process.env.BASESCAN_API_KEY || "SN2G57RD4G5P9PKSVD6RD3DGCMGIEDDHVD"
    }
  },
  sourcify: {
    enabled: true
  }
};
