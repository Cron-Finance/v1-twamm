pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract ShortTermSwapper is HelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function testAutoShortTermSwap() public {
    (uint256 amountOut) = swap(1e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, true);
    assertGt(amountOut, 989e15);
  }
}
