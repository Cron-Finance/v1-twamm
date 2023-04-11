pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract FuzzAddLiquidity is HelperContract {

  uint112 internal constant POOL_MIN_LIQUIDITY = 1001;
  uint112 internal constant POOL_MAX_LIQUIDITY = type(uint112).max - POOL_MIN_LIQUIDITY;

  function fuzzAssumptions(uint112 _liquidity0, uint112 _liquidity1) public pure {
    // liquidity has to be non-zero, and less than max liquidity number
    vm.assume(_liquidity0 > 0 && _liquidity0 < POOL_MAX_LIQUIDITY);
    vm.assume(_liquidity1 > 0 && _liquidity1 < POOL_MAX_LIQUIDITY);
  }

  function _addLiquidity (uint112 _liquidity0, uint112 _liquidity1) internal {
    fuzzAssumptions(_liquidity0, _liquidity1);
    _addFuzzInitialLiquidity(POOL_MIN_LIQUIDITY, POOL_MIN_LIQUIDITY);
    uint joinKind = 0;
    addLiquidity(_liquidity0, _liquidity1, joinKind);
  }

  // add initial liquidity to a new pool
  function testFuzzAutoAddInitialLiquidity(uint112 _liquidity0, uint112 _liquidity1) public {
    // min initial liquidity > 1001
    vm.assume(_liquidity0 > POOL_MIN_LIQUIDITY);
    vm.assume(_liquidity1 > POOL_MIN_LIQUIDITY);
    _addFuzzInitialLiquidity(_liquidity0, _liquidity1);
  }

  // add liquidity with regular join
  function testFuzzAutoAddLiquidity(uint112 _liquidity0, uint112 _liquidity1) public {
    _addLiquidity(_liquidity0, _liquidity1);
  }

  // add liquidity with donate
  function testFuzzAutoDonateLiquidity(uint112 _liquidity0, uint112 _liquidity1) public {
    fuzzAssumptions(_liquidity0, _liquidity1);
    _addFuzzInitialLiquidity(POOL_MIN_LIQUIDITY, POOL_MIN_LIQUIDITY);
    uint joinKind = 1;
    addLiquidity(_liquidity0, _liquidity1, joinKind);
  }

  // add liquidity and burn the liquidity
  function testFuzzAutoBurnLiquidity(uint112 _liquidity0, uint112 _liquidity1) public {
    _addLiquidity(_liquidity0, _liquidity1);
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit);
  }
  
}
