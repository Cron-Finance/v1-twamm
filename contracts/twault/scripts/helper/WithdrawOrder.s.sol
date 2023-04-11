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
// forge script contracts/twault/scripts/helper/WithdrawOrder.s.sol:WithdrawOrderTestnetScript --rpc-url $GOERLI_RPC_URL --broadcast --slow -vvvv

// ensure correct orderId is passed in
contract WithdrawOrderTestnetScript is Script {
  function run() external {
    vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
    address user = vm.envAddress("ETH_FROM");
    // get pool from factory
    address pool = ICronV1PoolFactory(FACTORY).getPool(USDC, WETH, uint256(ICronV1PoolEnums.PoolType.Liquid));
    console.log("pool address", pool);
    uint256 orderId = 0;
    // setup information for pool exit
    bytes memory userData = abi.encode(ICronV1PoolEnums.ExitType.Withdraw, orderId);
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    console.log("pool id", vm.toString(poolId));
    (IERC20[] memory tokens, , ) = IVault(VAULT).getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory minAmountOut = getMinAmountsOut(0, 0);
    // exit the pool
    IVault(VAULT).exitPool(
      ICronV1Pool(pool).POOL_ID(),
      user,
      payable(user),
      IVault.ExitPoolRequest(assets, minAmountOut, userData, false)
    );
    console.log("cancel order complete");
    vm.stopBroadcast();
  }

  function getMinAmountsOut(uint256 _minToken0, uint256 _minToken1)
    public
    pure
    returns (uint256[] memory minAmountsOut)
  {
    minAmountsOut = new uint256[](2);
    minAmountsOut[0] = _minToken0;
    minAmountsOut[1] = _minToken1;
  }

  function _convertERC20sToAssets(IERC20[] memory _tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := _tokens
    }
  }
}
