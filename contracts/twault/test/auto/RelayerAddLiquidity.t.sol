pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../RelayerHelperContract.sol";

contract RelayerAddLiquidity is RelayerHelperContract {

  // add initial liquidity to a new pool
  function testAutoRelayerAddInitialLiquidity() public {
    _addInitialLiquidity();
  }

  // add liquidity with regular join
  function testAutoRelayerAddLiquidity() public {
    _addInitialLiquidity();
    uint liquidity0 = 10e18;
    uint liquidity1 = 10e18;
    uint poolType = 1;
    addLiquidity(liquidity0, liquidity1, poolType);
  }

  // add liquidity and burn the liquidity
  function testAutoRelayerBurnLiquidity() public {
    _addInitialLiquidity();
    uint liquidity0 = 10e18;
    uint liquidity1 = 10e18;
    uint poolType = 1;
    addLiquidity(liquidity0, liquidity1, poolType);
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit);
  }
  
}
