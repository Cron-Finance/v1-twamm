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
// forge script contracts/twault/scripts/helper/AddLiquidity.s.sol:AddLiquidityTestnetScript --rpc-url $GOERLI_RPC_URL --broadcast --slow -vvvv

contract AddLiquidityTestnetScript is Script {
  function run() external {
    vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
    address user = vm.envAddress("ETH_FROM");
    uint256 liquidityUSDC = 1000e6; // 1000 USDC
    uint256 liquidityWETH = 1e17; // 0.1 ETH
    // get pool from factory
    address pool = ICronV1PoolFactory(FACTORY).getPool(USDC, WETH, uint256(ICronV1PoolEnums.PoolType.Liquid));
    // setup information for pool join
    bytes memory userData = getJoinUserData(uint256(ICronV1PoolEnums.JoinType.Join), liquidityUSDC, liquidityWETH);
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = IVault(VAULT).getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
    bool fromInternalBalance = false;
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(VAULT, liquidityUSDC);
    IERC20(tokens[1]).approve(VAULT, liquidityWETH);
    // call joinPool function on TWAMMs
    // send join pool request to the pool via vault
    IVault(VAULT).joinPool(
      poolId,
      user,
      payable(user),
      IVault.JoinPoolRequest(assets, maxAmountsIn, userData, fromInternalBalance)
    );
    vm.stopBroadcast();
  }

  function getJoinUserData(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1
  ) public pure returns (bytes memory userData) {
    userData = getJoinUserDataWithMin(_joinKind, _liquidity0, _liquidity1, 0, 0);
  }

  function getJoinUserDataWithMin(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _minLiquidity0,
    uint256 _minLiquidity1
  ) public pure returns (bytes memory userData) {
    uint256[] memory balances = new uint256[](2);
    balances[0] = _liquidity0;
    balances[1] = _liquidity1;
    uint256[] memory minTokenAmt = new uint256[](2);
    minTokenAmt[0] = _minLiquidity0;
    minTokenAmt[1] = _minLiquidity1;
    userData = abi.encode(_joinKind, balances, minTokenAmt);
  }

  function _convertERC20sToAssets(IERC20[] memory _tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := _tokens
    }
  }
}
