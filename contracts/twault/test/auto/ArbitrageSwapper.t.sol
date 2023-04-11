pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract ArbitrageSwapper is HelperContract {

  // example way of swapping via arbitrage
  function arbitrageSwap() public {
    _addInitialLiquidity();
    (uint256 amountOut) = swap(1e18, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, true);
    assertGt(amountOut, 989e15);
  }

  // address is not authorized to arbitrage
  function testFailAutoArbitrageSwap() public {
    arbitrageSwap();
  }

  // address is authorized to arbitrage
  function testAutoArbitrageSwap() public {
    ICronV1Pool(pool).setArbitragePartner(owner, address(arbPartners));
    // ICronV1Pool(pool).updateArbitrageList();
    arbitrageSwap();
  }
}
