pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract FuzzShortTermSwapper is HelperContract {
  uint112 internal constant INITIAL_LIQUIDITY = 1000e18;
  uint112 internal constant MAX_SWAP_AMOUNT = type(uint112).max - INITIAL_LIQUIDITY;

  function fuzzAssumptions(uint256 _swapAmount) public  pure {
    // swap tokens cannot exceed pool max liquidity of uint112 per token
    vm.assume(_swapAmount > 1 && _swapAmount < MAX_SWAP_AMOUNT);
  }

  function setUp() public {
    _addFuzzInitialLiquidity(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY);
  }

//  function testFuzzAutoArbitrageSwap0(uint112 _swapAmount) public {
//    fuzzAssumptions(_swapAmount);
//    ICronV1Pool(pool).setArbitragePartner(owner, address(arbPartners), true);
//    swap(_swapAmount, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, true);
//  }
//
//  function testFuzzAutoArbitrageSwap1(uint112 _swapAmount) public {
//    fuzzAssumptions(_swapAmount);
//    ICronV1Pool(pool).setArbitragePartner(owner, address(arbPartners), true);
//    swap(_swapAmount, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, false);
//  }
}
