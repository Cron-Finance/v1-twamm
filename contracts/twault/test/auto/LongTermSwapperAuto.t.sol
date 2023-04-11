pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract LongTermSwapper is HelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function testAutoLongTermSwap0To1Issuance() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
  }

  function testAutoLongTermSwap1To0Issuance() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = false;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
  }

  function testAutoLongTermSwapOrderIds() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = false;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, !swapDirection);
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (,,uint256 totalResults) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    assertEq(totalResults, 2);
  }

  function testAutoLongTermSwap0To1Cancel() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,, ) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
  }

  function testAutoLongTermSwap1To0Cancel() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = false;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
  }
}
