pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract PauseTests is HelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function testFailAutoPauseNewMint() public {
    ICronV1Pool(pool).setPause(true);
    // vm.expectRevert(bytes("Pool paused"));
    uint liquidity0 = 100e18;
    uint liquidity1 = 100e18;
    uint joinKind = 0;
    addLiquidity(liquidity0, liquidity1, joinKind);
  }

  function testFailAutoPauseNewShortTermSwaps() public {
    ICronV1Pool(pool).setPause(true);
    uint swapAmount = 1e18;
    uint swapInterval = 0;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.RegularSwap, swapDirection);
  }

  function testFailAutoPauseNewArbitrages() public {
    ICronV1Pool(pool).setPause(true);
    ICronV1Pool(pool).setArbitragePartner(owner, address(arbPartners));
    uint swapAmount = 1e18;
    uint swapInterval = 0;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.PartnerSwap, swapDirection);
  }

  function testFailAutoPauseNewLongTermSwaps() public {
    ICronV1Pool(pool).setPause(true);
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
  }

  function testAutoPauseBurn() public {
    ICronV1Pool(pool).setPause(true);
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit);
  }

  function testAutoPauseCancel() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    ICronV1Pool(pool).setPause(true);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
  }

  function testFailAutoPauseWithdraw() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, swapDirection);
    ICronV1Pool(pool).setPause(true);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    // nothing to withdraw #212
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }
  
}
