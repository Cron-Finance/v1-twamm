pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract PauseTestsManual is HelperContract {

  function setUp() public {
    addLiquidity(100e18, 100e18, 0);
  }

  function testFailManualPauseWithdraw() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    ICronV1Pool(pool).setPause(true);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    mineBlocks(10);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testFailManualPauseWithdrawNoEVO() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    mineBlocks(10);
    ICronV1Pool(pool).setPause(true);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualPauseWithdraw() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    mineBlocks(10);
    // EVO happens, proceeds available to withdraw
    swap(1e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    ICronV1Pool(pool).setPause(true);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function mockPauseCompletedOrderScenario() public {
    uint swapAmount = 100e18;
    uint swapInterval = 20;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    mineBlocks(15);
    // EVO happens, proceeds available to withdraw
    swap(25e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    mineBlocks(15);
    // EVO happens, proceeds available to withdraw
    swap(25e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    ICronV1Pool(pool).setPause(true);
  }

  // canceling a completed order shouldn't be possible?
  function testManualPauseCancelCompletedOrder() public {
    mockPauseCompletedOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("CFI#212"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
  }

  function testManualPauseWithdrawCompletedOrder() public {
    mockPauseCompletedOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testFailManualPauseWithdrawCompletedOrderTwice() public {
    mockPauseCompletedOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function mockPauseIncompleteCompleteOrderScenario() public {
    uint swapAmount = 100e18;
    uint swapInterval = 60;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    mineBlocks(15);
    // EVO happens, proceeds available to withdraw
    swap(25e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    mineBlocks(15);
    // EVO happens, proceeds available to withdraw
    swap(25e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    ICronV1Pool(pool).setPause(true);
  }

  // - [ ]  LT swap, mine 1/2 way through LT swap, EVO, pause, withdraw
  //   - [ ]  Can you resume, mine past LT swap end, EVO, withdraw
  //   - [ ]  Can you resume, mine past LT swap end, EVO, pause, withdraw
  //   - This scenario probably needs a test matrix

  function testManualPauseWithdrawIncompleteOrder() public {
    mockPauseIncompleteCompleteOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testFailManualPauseWithdrawIncompleteOrder() public {
    mockPauseIncompleteCompleteOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(30);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualPauseWithdrawUnpauseIncompleteOrder1() public {
    mockPauseIncompleteCompleteOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    ICronV1Pool(pool).setPause(false);
    swap(25e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    mineBlocks(30);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualPauseWithdrawUnpauseIncompleteOrder2() public {
    mockPauseIncompleteCompleteOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(30);
    ICronV1Pool(pool).setPause(false);
    swap(25e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualPauseWithdrawUnpauseIncompleteOrder3() public {
    mockPauseIncompleteCompleteOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    ICronV1Pool(pool).setPause(false);
    mineBlocks(30);
    swap(25e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testFailManualPauseWithdrawUnpauseIncompleteOrder4() public {
    mockPauseIncompleteCompleteOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    swap(25e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, false);
    ICronV1Pool(pool).setPause(false);
    mineBlocks(30);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  function testManualPauseWithdrawUnpauseIncompleteOrder5() public {
    mockPauseIncompleteCompleteOrderScenario();
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // vm.expectRevert(bytes("no proceeds to withdraw"));
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
    mineBlocks(30);
    ICronV1Pool(pool).setPause(false);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }
  
}
