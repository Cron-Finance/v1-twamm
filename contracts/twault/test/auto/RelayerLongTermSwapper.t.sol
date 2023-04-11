pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../RelayerHelperContract.sol";

contract RelayerLongTermSwapper is RelayerHelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function testAutoRelayerLongTermSwap0To1Issuance() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokens[0]));
  }

  function testAutoRelayerLongTermSwap1To0Issuance() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokens[1]));
  }

  function testAutoRelayerLongTermSwapOrderIds() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokens[0]));
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokens[1]));
    uint256 maxOrderIds = 100;
    (,,uint256 totalResults) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    assertEq(totalResults, 2);
  }

  function testAutoRelayerLongTermSwap0To1Cancel() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokens[0]));
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,, ) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
  }

  function testAutoRelayerLongTermSwap1To0Cancel() public {
    uint swapAmount = 100e18;
    uint swapInterval = 100;
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokens[1]));
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel);
  }
}
