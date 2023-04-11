// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { ICronV1PoolFactory } from "../interfaces/ICronV1PoolFactory.sol";

import { CronV1Actions } from "../periphery/CronV1Actions.sol";

address constant VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
// Mainnet ADDRESS
// address constant FACTORY = 0xD64c9CD98949C07F3C85730a37c13f4e78f35E77;
// Goerli ADDRESS
address constant FACTORY = 0x3Db2b6cB59Bb9717cfBaBb805a888e59e3292AAE;

// forge script contracts/twault/scripts/CronV1Relayer.s.sol:CronV1RelayerScript --rpc-url $GOERLI_RPC_URL --broadcast --verify -vvvv

contract CronV1RelayerScript is Script {
  function run() external {
    vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
    CronV1Actions action = new CronV1Actions(IVault(VAULT), ICronV1PoolFactory(FACTORY));
    console.log("actions library deployed", address(action));
    vm.stopBroadcast();
  }
}
