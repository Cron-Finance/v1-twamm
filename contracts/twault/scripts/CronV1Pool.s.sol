// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { ICronV1PoolFactory } from "../interfaces/ICronV1PoolFactory.sol";
import { ICronV1PoolEnums } from "../interfaces/pool/ICronV1PoolEnums.sol";
import { IVault } from "../balancer-core-v2/vault/interfaces/IVault.sol";

// Mainnet ADDRESS
address constant VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
address constant FACTORY = 0xD64c9CD98949C07F3C85730a37c13f4e78f35E77;
address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

// forge script contracts/twault/scripts/CronV1Pool.s.sol:CronV1PoolScript --rpc-url $GOERLI_RPC_URL --broadcast --verify -vvvv

contract CronV1PoolScript is Script {
  function run() external {
    vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
    address pool = ICronV1PoolFactory(FACTORY).create(
      address(USDC),
      address(WETH),
      "USDC-WETH-Liquid",
      "USDC/WETH/L",
      uint256(ICronV1PoolEnums.PoolType.Liquid)
    );
    console.log("USDC/WETH Pool", pool);
    vm.stopBroadcast();
  }
}
