import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-solhint";
import "@nomiclabs/hardhat-ganache";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-web3";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import "solidity-docgen";
import "@tenderly/hardhat-tenderly";
import "solidity-coverage";
import "@typechain/hardhat";
import "@typechain/ethers-v5";
import "hardhat-abi-exporter";

import "dotenv/config.js";

import { HardhatUserConfig } from "hardhat/config";

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
const GOERLI_RPC_URL = `https://eth-goerli.alchemyapi.io/v2/${ALCHEMY_KEY}`;
const ETHERSCAN_TOKEN =
  process.env.ETHERSCAN_API_KEY || "Your etherscan API key";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// This task ignored solidity test files needed for foundry from hardhat builds
// See more: https://github.com/NomicFoundation/hardhat/issues/2306#issuecomment-1039452928
const {subtask} = require("hardhat/config");
const {TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS} = require("hardhat/builtin-tasks/task-names")
subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS)
.setAction(async (_: any, __: any, runSuper: () => any) => {
  const paths = await runSuper();
  let excludeCount = 0;
  const filteredPaths = paths.filter((p: string) => {
    let includePath = !p.endsWith(".t.sol") && !p.endsWith(".s.sol")

    // Exclude solidity we're not using anymore (but keep in case of need to benchmark/test.)
    // If you're file / path still appears to be compiled, keep in mind that there's a cache.  (See hh-cache below.)
    //
    // See: https://github.com/NomicFoundation/hardhat/issues/2306
    if (includePath) {
      const excludeSubDirs = [ "twault/test", "twault/scripts" ]
      for (const excludeSubDir of excludeSubDirs) {
        if (p.includes(excludeSubDir)) {
          // console.log(`Excluding ${p}`)
          excludeCount++
          includePath = false
          break
        }
      }
    }
    return includePath
  });

  // console.log(`Compiling solidity paths: ${JSON.stringify(filteredPaths, null, 2)}`)
  console.log(`Excluded ${excludeCount} of ${paths.length} paths for compilation.`)
  return filteredPaths
});

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  typechain: {
    outDir: "typechain/",
    target: "ethers-v5",
    alwaysGenerateOverloads: true,
    externalArtifacts: ["externalArtifacts/*.json"],
  },
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 575,
          },
        },
      },
      {
        // For Rook Integration Test
        version: "0.8.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 575,
          },
        },
      },
      {
        version: "0.8.10",
        settings: {
          optimizer: {
            enabled: true,
            runs: 575,
          },
        },
      },
    ],
  },
  gasReporter: {
    currency: "USD",
    gasPrice: 100,
    enabled: process.env.REPORT_GAS ? true : false,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    maxMethodDiff: 10,
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: true,
    runOnCompile: false,
    strict: false,
    only: ["CronV1Pool", "CronV1PoolFactory", "CronFiRelayer", "CronFiActions"],
  },
  networks: {
    hardhat: {
      // Massive limit for testing ridiculous TWAMM scenarios:
      blockGasLimit: 300_000_000,
      allowUnlimitedContractSize: true,
      mining: {
        auto: false,
        interval: 0,
        mempool: {
          order: "fifo",
        },
      },
      // forking: {
      //   url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_KEY}`,
      //   blockNumber: 13629030,
      // },
    },
    local: {
      allowUnlimitedContractSize: true,
      mining: {
        auto: false,
        interval: 0,
        mempool: {
          order: "fifo",
        },
      },
      url: "http://localhost:8545",
      // Massive timeout for testing ridiculous TWAMM scenarios (gas measurement rpc times out otherwise):
      timeout: 120000,
    },
    goerli: {
      url: GOERLI_RPC_URL,
      accounts: [PRIVATE_KEY ? PRIVATE_KEY : ""],
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_TOKEN,
  },
  mocha: {
   timeout: 0,
   bail: true
  },
  docgen: {
    outputDir: "docs",
    pages: "files",
    theme: "markdown",
    collapseNewlines: true,
    pageExtension: ".md",
  },
  abiExporter: [
    {
      path: './abi/json',
      format: "json",
    },
    {
      path: './abi/minimal',
      format: "minimal",
    },
    {
      path: './abi/fullName',
      format: "fullName",
    },
  ]
}

export default config;
