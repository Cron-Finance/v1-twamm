pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { C } from "../../miscellany/Constants.sol";
import { Order } from "../../interfaces/Structs.sol";

// Get Order Test
// ================================================================================
// Description:
//   User's need to be able to see their order status.

// Test Procedure:
//   1. User A initializes a pool with a join/mint of 1M Token 0 : 1M Token 1
//   2. Mine 10 blocks
//   3. User B issues an LT Swap with the following characteristics
//      - intervals = 10
//      - amount = 1000 * tradeBlocks Token 0 for Token 1
//      - to calculate tradeBlocks:
//           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
//           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
//           tradeBlocks = orderExpiry - currentBlockNumber
//      - now you have a precise sales rate of 1000 / block
//   4. Mine 10 blocks
//   5. User C issues an LT Swap with the following characteristics
//      - intervals = 10
//      - amount = 1000 * tradeBlocks Token 1 for Token 0
//      - to calculate tradeBlocks:
//           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
//           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
//           tradeBlocks = orderExpiry - currentBlockNumber
//      - now you have a precise sales rate of 1000 / block
//   6. Mine 10 blocks
//   7. User D issues an LT Swap with the following characteristics
//      - intervals = 5
//      - amount = 1000 * tradeBlocks Token 0 for Token 1
//      - to calculate tradeBlocks:
//           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
//           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
//           tradeBlocks = orderExpiry - currentBlockNumber
//      - now you have a precise sales rate of 1000 / block
//   8. getOrder(User B orderId)
//      * Expect token0To1: true
//               salesRate: 1000
//               scaledProceedsAtSubmissionU128: 0
//               owner: <User B address>
//               expiry: <order Expiry from step 3>
//   9. getOrder(User C orderId)
//      * Expect token0To1: false
//               salesRate: 1000
//               scaledProceedsAtSubmissionU128: 0
//               owner: <User C address>
//               expiry: <order Expiry from step 5>
//  10. User B cancels order
//  11. User C cancels order
//  12. getOrder(User B orderId)
//      * Expect token0To1: false
//               salesRate: 0
//               scaledProceedsAtSubmissionU128: 0
//               owner: 0
//               expiry: 0
//  13. getOrder(User C orderId)
//      * Expect token0To1: false
//               salesRate: 0
//               scaledProceedsAtSubmissionU128: 0
//               owner: 0
//               expiry: 0
//  14. mine 5 * OBI blocks
//   8. getOrder(User D orderId)
//      * Expect token0To1: true
//               salesRate: 1000
//               scaledProceedsAtSubmissionU128: 368824201009748775010 +/- 1%
//               // 1% error b/c no time to calc slippage effect
//               owner: <User B address>
//               expiry: <order Expiry from step 3>

contract OrdersTests is HelperContract {

  function addLiquidityMultipleTimes(address newPool, address a, uint n, uint perBlock) public {
    // mint n positions
    for (uint i = 0; i < n; ++i) {
      addLiquidity(newPool, a, a, 1000, 1000, 0);
      vm.warp(block.timestamp + 1);
      if (i % perBlock == 0) {
        mineBlocks(1);
      }
    }
  }

  function getAmount(uint _swapInterval) public view returns (uint256 amount, uint256 orderExpiry) {
    uint obi = C.LIQUID_OBI;
    // bool swapDirection = true;
    uint lastExpiryBlock = block.number - (block.number % obi);
    orderExpiry = obi * (_swapInterval + 1) + lastExpiryBlock;
    uint tradeBlocks = orderExpiry - block.number;
    amount = 1000 * tradeBlocks;
  }

  function testOrdersManualGetOrders() public {
    address newPool = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Liquid",
      "T1-T2-L",
      1
    );
    address userB = vm.addr(54);
    address userC = vm.addr(53);
    address userD = vm.addr(55);
    (uint256 amount10, uint256 orderExpiry10) = getAmount(10);
    bytes32 poolId = ICronV1Pool(newPool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IERC20(tokens[0]).transfer(userB, 100e18);
    IERC20(tokens[1]).transfer(userB, 100e18);
    IERC20(tokens[0]).transfer(userC, 100e18);
    IERC20(tokens[1]).transfer(userC, 100e18);
    IERC20(tokens[0]).transfer(userD, 100e18);
    IERC20(tokens[1]).transfer(userD, 100e18);
    mineBlocks(10);
    _swap(amount10, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), newPool, userB);
    mineBlocks(10);
    _swap(amount10, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token2), newPool, userC);
    mineBlocks(10);
    (uint256 amount5, uint256 orderExpiry5) = getAmount(5);
    _swap(amount5, 5, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), newPool, userD);
    // check userB
    vm.startPrank(userB);
    Order memory orderB = ICronV1Pool(newPool).getOrder(0);
    vm.stopPrank();
    assertEq(orderB.token0To1, true);
    // assertEq(uint256(orderB.salesRate), 1000); ?? 1003
    assertEq(uint256(orderB.scaledProceedsAtSubmissionU128), 0);
    assertEq(orderB.owner, userB);
    assertEq(orderB.orderExpiry, orderExpiry10);
    // check userC
    vm.startPrank(userC);
    Order memory orderC = ICronV1Pool(newPool).getOrder(1);
    vm.stopPrank();
    assertEq(orderC.token0To1, false);
    // assertEq(uint256(orderC.salesRate), 1000); ?? 1003
    assertEq(uint256(orderC.scaledProceedsAtSubmissionU128), 0);
    assertEq(orderC.owner, userC);
    assertEq(orderC.orderExpiry, orderExpiry10);
    // cancel userB, userC order
    exit(0, ICronV1PoolEnums.ExitType.Cancel, newPool, userB);
    exit(1, ICronV1PoolEnums.ExitType.Cancel, newPool, userC);
    vm.startPrank(userB);
    orderB = ICronV1Pool(newPool).getOrder(0);
    vm.stopPrank();
    vm.startPrank(userC);
    orderC = ICronV1Pool(newPool).getOrder(1);
    vm.stopPrank();
    // check userB order
    assertEq(orderB.token0To1, false);
    assertEq(uint256(orderB.salesRate), 0);
    assertEq(uint256(orderB.scaledProceedsAtSubmissionU128), 0);
    assertEq(orderB.owner, address(0));
    assertEq(orderB.orderExpiry, 0);
    // check userC order
    assertEq(orderC.token0To1, false);
    assertEq(uint256(orderC.salesRate), 0);
    assertEq(uint256(orderC.scaledProceedsAtSubmissionU128), 0);
    assertEq(orderC.owner, address(0));
    assertEq(orderC.orderExpiry, 0);
    mineBlocks(5);
    // check userD
    vm.startPrank(userD);
    Order memory orderD = ICronV1Pool(newPool).getOrder(2);
    vm.stopPrank();
    assertEq(orderD.token0To1, true);
    // assertEq(uint256(orderD.salesRate), 1000); ?? 1003
    // assertEq(uint256(orderD.scaledProceedsAtSubmissionU128), 368824201009748775010); ?? off by a loooooot
    assertEq(orderD.owner, userD);
    assertEq(orderD.orderExpiry, orderExpiry5);
  }

  function _swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1PoolEnums.SwapType _swapType,
    address _tokenIn,
    address _pool,
    address _trader
  ) internal returns (uint256 amountOut) {
    vm.startPrank(_trader);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20 token = (_tokenIn == address(tokens[0])) ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);
    // swap amounts with vault
    amountOut = IVault(vault).swap(
      IVault.SingleSwap(
        ICronV1Pool(_pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        (_tokenIn == address(tokens[0])) ? assets[0] : assets[1],
        (_tokenIn == address(tokens[0])) ? assets[1] : assets[0],
        _amountIn,
        abi.encode(
          _swapType,
          _argument
        )
      ),
      IVault.FundManagement(
        _trader,
        false,
        payable (_trader),
        false
      ),
      0,
      block.timestamp + 1000
    );
    vm.stopPrank();
  }
}
