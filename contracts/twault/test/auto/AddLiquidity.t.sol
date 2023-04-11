pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract AddLiquidity is HelperContract {

  // add initial liquidity to a new pool
  function testAutoAddInitialLiquidity() public {
    _addInitialLiquidity();
  }

  // add liquidity with regular join
  function testAutoAddLiquidity() public {
    _addInitialLiquidity();
    uint liquidity0 = 10e18;
    uint liquidity1 = 10e18;
    uint joinKind = 0;
    addLiquidity(liquidity0, liquidity1, joinKind);
  }

  // add liquidity with donate
  function testAutoDonateLiquidity() public {
    _addInitialLiquidity();
    uint liquidity0 = 10e18;
    uint liquidity1 = 10e18;
    uint joinKind = 1;
    addLiquidity(liquidity0, liquidity1, joinKind);
  }

  // add liquidity and burn the liquidity
  function testAutoBurnLiquidity() public {
    _addInitialLiquidity();
    uint liquidity0 = 10e18;
    uint liquidity1 = 10e18;
    uint joinKind = 0;
    addLiquidity(liquidity0, liquidity1, joinKind);
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit);
  }
  
}
