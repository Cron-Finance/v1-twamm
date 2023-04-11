// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;

pragma experimental ABIEncoderV2;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { IVault } from "../../balancer-core-v2/vault/interfaces/IVault.sol";
import { IAsset } from "../../balancer-core-v2/vault/interfaces/IAsset.sol";
import { IERC20 } from "../../balancer-core-v2/lib/openzeppelin/IERC20.sol";

import { ICronV1Pool } from "../../interfaces/ICronV1Pool.sol";
import { ICronV1PoolFactory } from "../../interfaces/ICronV1PoolFactory.sol";
import { ICronV1PoolEnums } from "../../interfaces/pool/ICronV1PoolEnums.sol";

// Goerli ADDRESS
address constant VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
address constant FACTORY = 0x3Db2b6cB59Bb9717cfBaBb805a888e59e3292AAE;
address constant USDC = 0x07865c6E87B9F70255377e024ace6630C1Eaa37F;
address constant WETH = 0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6;

// command to run the below script
// note the --slow flag is required to ensure transactions are processed before next transaction is executed
// forge script contracts/twault/scripts/helper/ShortTermTrade.s.sol:ShortTermTradeTestnetScript --rpc-url $GOERLI_RPC_URL --broadcast --slow -vvvv

// trade from token0 -> token1
contract ShortTermTradeTestnetScript is Script {
  function run() external {
    vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
    address user = vm.envAddress("ETH_FROM");
    // get pool from factory
    address pool = ICronV1PoolFactory(FACTORY).getPool(USDC, WETH, uint256(ICronV1PoolEnums.PoolType.Liquid));
    uint256 swapAmount = 10e6; //usdc
    // setup information for long term swap
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.SwapType.RegularSwap, // swap type
      0
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = IVault(VAULT).getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    tokens[0].approve(VAULT, swapAmount);
    // send short term order request to the pool via vault
    IVault(VAULT).swap(
      IVault.SingleSwap(poolId, IVault.SwapKind.GIVEN_IN, assets[0], assets[1], swapAmount, userData),
      IVault.FundManagement(user, false, payable(user), false),
      0,
      block.timestamp + 1000
    );
    vm.stopBroadcast();
  }

  function _convertERC20sToAssets(IERC20[] memory _tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := _tokens
    }
  }
}
