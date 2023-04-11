pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

// Get Order Ids Test
// ================================================================================
// TODO: Need to update this test for API change in order id getter from audit
//       (allows user to set max results).
//
// Description:
//   Confirm correct pagination behavior of getOrderIds and limits.

// Test Procedure:
//   1. User A initializes a pool with a join of 100M Token 0 : 100M Token 1
//      - Mine a block
//   2. User A issues 5 LT Swaps of 10,000 Token 0 over 10 intervals
//      - One order, then mine a block, then next order...
//   3. User A calls getOrderIds with _offset = 0
//      * Expect:
//                 orderIds.length = 100
//                 numResults = 5
//                 totalResults = 5
//   4. User A issues 200 more LT Swaps of 10,000 Token 0 over 10 intervals
//      - One order, then mine a block, then next order...
//   5. User A calls getOrderIds with _offset = 0
//      * Expect:
//                 orderIds.length = 100 
//                 numResults = 100 
//                 totalResults = 205
//   6. User A calls getOrderIds with _offset = 100
//      * Expect:
//                 orderIds.length = 100 
//                 numResults = 100
//                 totalResults = 205
//      * Expect: orderIds[0 - 99] = 100 - 199  // i.e. orderIds[0] = 100 ...
//                                              //      orderIds[99] = 199
//   6. User A calls getOrderIds with _offset = 200
//      * Expect:
//                 orderIds.length = 100 
//                 numResults = 5
//                 totalResults = 205
//      * Expect: orderIds[0 - 4] = 200 - 204 // i.e. orderIds[0] = 200 ...
//                                            //      orderIds[4] = 204

contract OrderIdsTests is HelperContract {
  function issueLTSwap (address _pool, uint _numSwaps, address _user) public {
    for (uint i = 0; i < _numSwaps; i++) {
      swapPoolAddr(10e21, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), _pool, _user);
      vm.warp(block.timestamp + 1);
      mineBlocks(1);
    }
  }

  function testManualOrderIdsLimits() public {
    address userA = vm.addr(1323);
    address stablePool = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Stable",
      "T1-T2-S",
      0
    );
    IERC20(token1).transfer(userA, 100e30);
    IERC20(token2).transfer(userA, 100e30);
    addLiquidity(stablePool, address(this), address(this), 1e24, 1e24, 0);
    mineBlocks(1);
    issueLTSwap(stablePool, 5, userA);
    uint256 maxOrderIds = 100;
    (uint256[] memory orderIds, uint256 numResults, uint256 totalResults) = ICronV1Pool(stablePool).getOrderIds(userA, 0, maxOrderIds);
    assertEq(orderIds.length, 100);
    assertEq(numResults, 5);
    assertEq(totalResults, 5);
    issueLTSwap(stablePool, 200, userA);
    (orderIds, numResults, totalResults) = ICronV1Pool(stablePool).getOrderIds(userA, 0, maxOrderIds);
    assertEq(orderIds.length, 100);
    assertEq(numResults, 100);
    assertEq(totalResults, 205);
    (orderIds, numResults, totalResults) = ICronV1Pool(stablePool).getOrderIds(userA, 100, maxOrderIds);
    assertEq(orderIds.length, 100);
    assertEq(numResults, 100);
    assertEq(totalResults, 205);
    assertEq(orderIds[0], 100);
    assertEq(orderIds[99], 199);
    (orderIds, numResults, totalResults) = ICronV1Pool(stablePool).getOrderIds(userA, 200, maxOrderIds);
    assertEq(orderIds.length, 100);
    assertEq(numResults, 5);
    assertEq(totalResults, 205);
    assertEq(orderIds[0], 200);
    assertEq(orderIds[4], 204);
  }
}
