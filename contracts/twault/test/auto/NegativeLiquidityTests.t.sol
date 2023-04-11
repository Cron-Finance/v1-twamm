pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract NegativeLiquidityTests is HelperContract {

  function testFailAutoBurnLiquidity() public {
    _addInitialLiquidity();
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted+1000, ICronV1PoolEnums.ExitType.Exit);
  }

  function testFailAutoNoLiquidityShortTermSwap() public {
    uint swapAmount = 1e18;
    uint swapInterval = 0;
    bool swapDirection = true;
    (uint256 amountOut) = swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.RegularSwap, swapDirection);
    assertGt(amountOut, 1e3);
  }

  // broken
  function testFailAutoBurnLiquidityShortTermSwap() public {
    _addInitialLiquidity();
    // remove all liquidity provided to cause swap to fail
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit);
    uint swapAmount = 1e18;
    uint swapInterval = 0;
    bool swapDirection = true;
    (uint256 amountOut) = swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.RegularSwap, swapDirection);
    assertGt(amountOut, 1e3);
  }

  function testFailAutoNonLiquidityArbitrageSwap() public {
    ICronV1Pool(pool).setArbitragePartner(owner, address(arbPartners));
    ICronV1Pool(pool).updateArbitrageList();
    uint swapAmount = 1e18;
    uint swapInterval = 0;
    bool swapDirection = true;
    (uint256 amountOut) = swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.PartnerSwap, swapDirection);
    assertGt(amountOut, 1e3);
  }

  function testFailAutoBurnLiquidityArbitrageSwap() public {
    _addInitialLiquidity();
    // remove all liquidity provided to cause swap to fail
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit);
    ICronV1Pool(pool).setArbitragePartner(owner, address(arbPartners));
    ICronV1Pool(pool).updateArbitrageList();
    uint swapAmount = 1e18;
    uint swapInterval = 0;
    bool swapDirection = true;
    (uint256 amountOut) = swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.PartnerSwap, swapDirection);
    assertGt(amountOut, 1e3);
  }
}
