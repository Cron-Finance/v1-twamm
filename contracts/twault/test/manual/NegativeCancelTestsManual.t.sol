pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

// - [ ]  Cancel Withdraw
//     - [ ]  Can’t Cancel Withdraw before Cancel Refund
//     - [ ]  Can’t Cancel Withdraw twice
//     - [ ]  Can’t Cancel Withdraw from wrong account
//     - [ ]  Can’t Cancel Withdraw wrong order ID
//     - [ ]  Can’t Cancel Withdraw wrong swap order (i.e. for swap T0→T1, try Cancel Withdraw T1→T0)

// TODO: clean up exit function to no longer use direction

contract NegativeCancelTestsManual is HelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function testFailManualCancelRefundTwice() public {
    uint swapAmount = 100e18;
    uint swapInterval = 20;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
    // fail because: order already finished
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
  }

  function testFailManualCancelWrongAccount() public {
    uint swapAmount = 100e18;
    uint swapInterval = 20;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // emit log_address(address(this)); // correct address
    // emit log_address(vm.addr(1)); // wrong address
    vm.startPrank(vm.addr(1));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
    vm.stopPrank();
  }

  function testFailManualCancelWrongOrderId() public {
    uint swapAmount = 100e18;
    uint swapInterval = 20;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0] + 1, ICronV1PoolEnums.ExitType.Cancel);
  }

  function testFailManualCancelWrongSwapDirection() public {
    uint swapAmount = 100e18;
    uint swapInterval = 20;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    mineBlocks(30);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testFailManualWithdrawTwice() public {
    uint swapAmount = 100e18;
    uint swapInterval = 20;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    mineBlocks(30);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testFailManualWithdrawWrongAccount() public {
    uint swapAmount = 100e18;
    uint swapInterval = 20;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    mineBlocks(30);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    vm.startPrank(vm.addr(1));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    vm.stopPrank();
  }

  function testFailManualWithdrawWrongOrderId() public {
    uint swapAmount = 100e18;
    uint swapInterval = 20;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    mineBlocks(30);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0] + 1, ICronV1PoolEnums.ExitType.Withdraw);
  }
  
}
