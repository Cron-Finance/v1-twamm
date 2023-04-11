pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../RelayerHelperContract.sol";

contract RelayerNegativeLiquidityTests is RelayerHelperContract {

  function testFailAutoRelayerBurnLiquidity() public {
    _addInitialLiquidity();
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted+1000, ICronV1PoolEnums.ExitType.Exit);
  }

  function testFailAutoRelayerNoLiquidityShortTermSwap() public {
    uint swapAmount = 1e18;
    uint swapInterval = 0;
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    (uint256 amountOut) = swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokens[0]));
    assertGt(amountOut, 1e3);
  }

  // broken
  function testFailAutoRelayerBurnLiquidityShortTermSwap() public {
    _addInitialLiquidity();
    // remove all liquidity provided to cause swap to fail
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit);
    uint swapAmount = 1e18;
    uint swapInterval = 0;
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    (uint256 amountOut) = swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokens[0]));
    assertGt(amountOut, 1e3);
  }
}
