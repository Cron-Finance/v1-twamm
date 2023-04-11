pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { C } from "../../miscellany/Constants.sol";

// Set Param Method
// ================================================================================
// Description:
//   Need to confirm that the set param method works for supported values and
//   errors for others.

// Test Procedure:
//   1. User A initializes a pool with a join of 1M Token 0 : 1M Token 1
//      - Mine a block
//   2. Set the short term swap fee points to 1/2 of C.MAX_FEE_FP
//   3. Get the short term swap fee and confirm it is the value set in step 2.
//   4. Set the short term swap foee to 1 + C.MAX_FEE_FP
//      * expect error PARAM_ERROR
//   5. Set the partner swap fee points to 1/2 of C.MAX_FEE_FP
//   6. Get the partner swap fee and confirm it is the value set in step 5.
//   7. Set the partner swap fee points to 1 + C.MAX_FEE_FP
//      * expect error PARAM_ERROR
//   8. Set the long term swap fee points to 1/2 of C.MAX_FEE_FP
//   9. Get the long term swap fee and confirm it is the value set in step 8.
//  10. Set the long term swap fee points to 1 + C.MAX_FEE_FP
//      * expect error PARAM_ERROR
//  11. Set the holding penalty points to 1/2 of C.MAX_HOLDING_PENALTY
//  12. Get the holding penalty and confirm it is the value set in step 11.
//  13. Set the holding penalty points to 1 + C.MAX_HOLDING_PENALTY
//      * expect error PARAM_ERROR
//  14. Set the holding period to 1/2 of C.MAX_HOLDING_PERIOD
//  15. Get the holding period and confirm it is the value set in step 14.
//  16. Set the holding period to 1 + C.MAX_HOLDING_PERIOD
//      * expect error PARAM_ERROR
//  17. Call setParmeter with _paramTypeU=5
//      * expect error PARAM_ERROR

contract SetParamsTests is HelperContract {

  function testManualSetParams() public {
    address newPool = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Liquid",
      "T1-T2-L",
      1
    );
    ICronV1Pool(newPool).setAdminStatus(address(owner), true);
    addLiquidity(newPool, address(this), address(this), 1e21, 1e21, 0);
    mineBlocks(1);
    // Swap Fee
    ICronV1Pool(newPool).setParameter(0, C.MAX_FEE_FP/2);
    uint swapFee = ICronV1Pool(newPool).getShortTermFeePoints();
    mineBlocks(1);
    assertEq(swapFee, C.MAX_FEE_FP/2);
    vm.expectRevert(bytes("CFI#403"));
    ICronV1Pool(newPool).setParameter(0, 1+C.MAX_FEE_FP);
    // Partner Fee
    ICronV1Pool(newPool).setParameter(1, C.MAX_FEE_FP/2);
    uint partnerFee = ICronV1Pool(newPool).getPartnerFeePoints();
    mineBlocks(1);
    assertEq(partnerFee, C.MAX_FEE_FP/2);
    vm.expectRevert(bytes("CFI#403"));
    ICronV1Pool(newPool).setParameter(1, 1+C.MAX_FEE_FP);
    // LongSwap Fee
    ICronV1Pool(newPool).setParameter(2, C.MAX_FEE_FP/2);
    uint longFee = ICronV1Pool(newPool).getLongTermFeePoints();
    mineBlocks(1);
    assertEq(longFee, C.MAX_FEE_FP/2);
    vm.expectRevert(bytes("CFI#403"));
    ICronV1Pool(newPool).setParameter(2, 1+C.MAX_FEE_FP);
//    // Holding Penalty Fee
//    ICronV1Pool(newPool).setParameter(3, C.MAX_HOLDING_PENALTY_FP/2);
//    uint holdingPenalty = ICronV1Pool(newPool).getHoldingPenaltyPoints();
//    mineBlocks(1);
//    assertEq(holdingPenalty, C.MAX_HOLDING_PENALTY_FP/2);
//    vm.expectRevert(bytes("CFI#403"));
//    ICronV1Pool(newPool).setParameter(3, 1+C.MAX_HOLDING_PENALTY_FP);
//    // Holding Period
//    ICronV1Pool(newPool).setParameter(4, C.MAX_HOLDING_PERIOD/2);
//    uint holdingPeriod = ICronV1Pool(newPool).getHoldingPeriod();
//    mineBlocks(1);
//    assertEq(holdingPeriod, C.MAX_HOLDING_PERIOD/2);
//    vm.expectRevert(bytes("CFI#403"));
//    ICronV1Pool(newPool).setParameter(4, 1+C.MAX_HOLDING_PERIOD);
//    mineBlocks(1);
  }

  function testFailManualSetParams() public {
    address newPool = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Liquid",
      "T1-T2-L",
      1
    );
    addLiquidity(newPool, address(this), address(this), 1e21, 1e21, 0);
    mineBlocks(1);
    ICronV1Pool(newPool).setParameter(5, 1);
  }
}
