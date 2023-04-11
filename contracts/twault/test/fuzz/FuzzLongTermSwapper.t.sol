pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { C } from "../../miscellany/Constants.sol";

contract FuzzLongTermSwapper is HelperContract {
  // swap tokens cannot exceed pool max liquidity of uint112 per token
  uint112 internal constant INITIAL_LIQUIDITY = 1000e18;
  uint112 internal constant MAX_SWAP_AMOUNT = type(uint112).max - INITIAL_LIQUIDITY;
  uint16  internal liquidOBI = C.LIQUID_OBI; // ~ 60m@ 12s/block
  uint112 internal maxIntervals = C.LIQUID_MAX_INTERVALS;


  function fuzzAssumptions(uint256 _swapAmount, uint256 _swapInterval) public view {
    vm.assume(_swapAmount > 1); // non-zero trade amount
    vm.assume(_swapAmount < MAX_SWAP_AMOUNT); // less than uint112 container
    vm.assume(_swapAmount > _swapInterval); // trade amount > # of trade intervals
    // checks to ensure sellingRate > 0
    uint256 lastExpiryBlock = block.number - (block.number % liquidOBI);
    uint256 orderExpiry = liquidOBI * (_swapInterval + 1) + lastExpiryBlock; // +1 protects from div 0
    uint256 tradeBlocks = orderExpiry - block.number;
    vm.assume(_swapAmount > tradeBlocks); // trade amount > # of trade blocks
    uint256 sellingRate = _swapAmount / tradeBlocks;
    vm.assume(sellingRate > 0); // sellingRate must be greater than 0
    vm.assume(_swapInterval < maxIntervals);
  }

  function setUp() public {
    _addFuzzInitialLiquidity(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY);
  }

  // got through fuzzing??
  // [1294663378474746987034556414799002, 60610469165776197998410462987005]
  // [425629212293737227040133960468010, 424273284160433385988873240909035]
  // [1117576350349833008695385934498805, 60610469165776197998410462987005]

  function testFuzzAutoLongTermSwap0To1Issuance(uint112 _swapAmount, uint112 _swapInterval) public {
    fuzzAssumptions(_swapAmount, _swapInterval);
    swap(_swapAmount, _swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, true);
  }

  function testFuzzAutoLongTermSwap1To0Issuance(uint112 _swapAmount, uint112 _swapInterval) public {
    fuzzAssumptions(_swapAmount, _swapInterval);
    swap(_swapAmount, _swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, false);
  }

  function testFuzzAutoMultipleLongTermSwaps(uint112 _swapAmount, uint112 _swapInterval) public {
    fuzzAssumptions(_swapAmount, _swapInterval);
    swap(_swapAmount, _swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, true);
    swap(_swapAmount, _swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, false);
  }
}
