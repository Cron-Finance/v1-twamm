pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { C } from "../../miscellany/Constants.sol";

// LT Swap Proceeds Bug Test
// ================================================================================
// Description:
//   Confirm that proceeds increases at right time in LT Swap cycle.
//   (A check that proceeds > 0, for an issue found during opt of withdraw/cancel)

// Test Procedure:
//   1. User A initializes a pool with a join of 100M Token 0 : 100M Token 1
//      - Mine a block
//   2. User B issues an LT Swap with the following characteristics
//      - intervals = 10
//      - amount = 1000 * tradeBlocks Token 0 for Token 1
//      - to calculate tradeBlocks:
//           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
//           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
//           tradeBlocks = orderExpiry - currentBlockNumber
//      - now you have a precise sales rate of 1000 / block
//      - Mine a block
//   3. Capture Token 1 proceeds
//      * expect proceeds1 = 0
//      - Mine a block
//   4. User B withdraws order
//      * Expect User B to receive 1000 Token 1 minus fee
//      ! Careful - note that there have only been 2 blocks mined since the LT swap
//        (1 for the LT swap and 1 to make the order start).

contract LTSwapProceedsBug is HelperContract {

  function getTradeBlocks(uint _obi) public view returns (uint256 tradeBlocks) {
    uint swapInterval = 10;
    uint lastExpiryBlock = block.number - (block.number % _obi);
    uint orderExpiry = _obi * (swapInterval + 1) + lastExpiryBlock;
    tradeBlocks = orderExpiry - block.number;
  }

  function testManualLTSwapProceedsBug() public {
    address userA = address(this);
    address userB = vm.addr(1323);
    address poolAddr = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      1
    );
    addLiquidity(poolAddr, userA, userA, 100e6, 100e6, 0);
    mineBlocks();
    IERC20(token1).transfer(userB, 100e30);
    mineBlocks();
    uint256 tradeBlocks = getTradeBlocks(C.LIQUID_OBI);
    swapPoolAddr(1000*tradeBlocks, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), poolAddr, userB);
    mineBlocks();
    uint256 preUserB = IERC20(token2).balanceOf(userB);
    assertEq(preUserB, 0);
    exit(0, ICronV1PoolEnums.ExitType.Withdraw, poolAddr, userB);
    mineBlocks();
    uint256 postUserB = IERC20(token2).balanceOf(userB);
    uint256 expectedBProceeds = 999;  // Should be this (1000*(100000-30))/100000 = 999.7
    uint256 actualBProceeds = postUserB - preUserB;
    // roughly ~1% of the expected values
    assertApproxEqRel(actualBProceeds, expectedBProceeds, 0.01e18);
  }
}
