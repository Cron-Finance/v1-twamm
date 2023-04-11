// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { CronV1Tester } from "../test/CronV1Tester.sol";
import { IVault } from "../balancer-core-v2/vault/interfaces/IVault.sol";

// forge script contracts/twault/scripts/CronV1Tester.s.sol:CronV1TesterScript --rpc-url $GOERLI_RPC_URL --broadcast --verify -vvvv

contract CronV1TesterScript is Script {
  function run() external {
    vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
    CronV1Tester tester = new CronV1Tester();
    console.log("Tester Address", address(tester));
    vm.stopBroadcast();
  }
}
