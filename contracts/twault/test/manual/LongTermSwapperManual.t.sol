pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract LongTermSwapper is HelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function testManualLongTermSwap0To1Withdraw() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    mineBlocks(10);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualLongTermSwap1To0Withdraw() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = false;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    mineBlocks(10);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualLongTermSwap0To1MultipleWithdraw() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // emit log_uint(orderIds[0]);
    mineBlocks(20);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(40);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(20);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(20);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    // mineBlocks(100);
    // exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualLongTermSwap1To0MultipleWithdraw() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = false;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // emit log_uint(orderIds[0]);
    mineBlocks(20);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(40);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(20);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(20);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    // mineBlocks(100);
    // exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualLongTermSwapMultipleCancelSameBlock() public {
    swap(10e18, 15, ICronV1PoolEnums.SwapType.LongTermSwap, true);
    swap(20e18, 25, ICronV1PoolEnums.SwapType.LongTermSwap, true);
    swap(30e18, 35, ICronV1PoolEnums.SwapType.LongTermSwap, true);
    swap(15e18, 15, ICronV1PoolEnums.SwapType.LongTermSwap, false);
    swap(25e18, 25, ICronV1PoolEnums.SwapType.LongTermSwap, false);
    swap(35e18, 35, ICronV1PoolEnums.SwapType.LongTermSwap, false);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    mineBlocks(10);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
    exit(orderIds[3], ICronV1PoolEnums.ExitType.Cancel);
    mineBlocks(10);
    exit(orderIds[4], ICronV1PoolEnums.ExitType.Cancel);
    exit(orderIds[1], ICronV1PoolEnums.ExitType.Cancel);
    mineBlocks(10);
    exit(orderIds[5], ICronV1PoolEnums.ExitType.Cancel);
    exit(orderIds[2], ICronV1PoolEnums.ExitType.Cancel);
    mineBlocks(10);
  }
}
