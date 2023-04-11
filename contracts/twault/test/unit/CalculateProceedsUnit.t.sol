// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import "../HelperContract.sol";
import "../../interfaces/ICronV1PoolExposed.sol";

// Underflow Test
// ================================================================================

// Description: The calculate proceeds method, _calculateProceeds, relies on the
//              distance between the end and start of an order in computing user
// 			 proceeds. This distance should be the same even in the presence
// 			 of a proceeds overflow. This test simulates that scenario and
// 			 compares it to a non overflowed scenario.
// 			 The maximum possible distance between start and finish is (2**128)-1,
// 			 which occurs when the end proceeds is start proceeds minus one.

// Test Procedure:

// 		Variation A.1: Small Distance, No Proceeds Overflow
// 				1. _stakedAmount = 2 ** 64
// 				2. _startScaledProceedsU128F64 = 0
// 				3. _scaledProceedsU128F64 = 1
// 				4. Call _calculateProceeds and get proceedsU112
// 				5. Expect proceedsU112 == 1
// 		Variation A.2: Small Distance, Proceeds Overflow
// 				6. _startScaledProceedsU128F64 = (2 ** 128)-1
// 				7. _scaledProceedsU128F64 = 0
// 				8. Call _calculateProceeds and get proceedsU112
// 				9. Expect proceedsU112 == 1

// 		Variation B.1: Medium Distance, No Proceeds Overflow
// 				1. _stakedAmount = 2 ** 32
// 				2. _startScaledProceedsU128F64 = 0
// 				3. _scaledProceedsU128F64 = 2 ** 127
// 				4. Call _calculateProceeds and get proceedsU112
// 				5. Expect proceedsU112 == 39614081257132168796771975168
// 		Variation B.2: Medium Distance, Proceeds Overflow
// 				6. _startScaledProceedsU128F64 = (2 ** 128)-1
// 				7. _scaledProceedsU128F64 = (2 ** 127)-1
// 				8. Call _calculateProceeds and get proceedsU112
// 				9. Expect proceedsU112 == 39614081257132168796771975168

// 		Variation C.1: Full Distance, No Proceeds Overflow
// 				1. _stakedAmount = 2 ** 0
// 				2. _startScaledProceedsU128F64 = 0
// 				3. _scaledProceedsU128F64 = (2 ** 128)-1
// 				4. Call _calculateProceeds and get proceedsU112
// 				5. Expect proceedsU112 == 18446744073709551615
// 		Variation C.2: Full Distance, Proceeds Overflow
// 				6. _startScaledProceedsU128F64 = 1
// 				7. _scaledProceedsU128F64 = 0
// 				8. Call _calculateProceeds and get proceedsU112
// 				9. Expect proceedsU112 == 18446744073709551615

contract CalculateProceedsUnit is HelperContract {

  function setUp() public {}

  function testAutoUnitCalculateProceedsA1() public {
		uint256 _scaledProceedsU128F64 = 1;
		uint256 _startScaledProceedsU128F64 = 0;
    uint256 _stakedAmountU112 = 2 ** 64;

    uint256 proceedsU112 = ICronV1PoolExposed(exposedPool).iCalculateProceeds(_scaledProceedsU128F64, _startScaledProceedsU128F64, _stakedAmountU112);
    // console.log("proceeds a1", proceedsU112);
    assertEq(proceedsU112, 1);
  }

  function testAutoUnitCalculateProceedsA2() public {
		uint256 _scaledProceedsU128F64 = 0;
		uint256 _startScaledProceedsU128F64 = (2 ** 128)-1;
    uint256 _stakedAmountU112 = 2 ** 64;

    uint256 proceedsU112 = ICronV1PoolExposed(exposedPool).iCalculateProceeds(_scaledProceedsU128F64, _startScaledProceedsU128F64, _stakedAmountU112);
    // console.log("proceeds a2", proceedsU112);
    assertEq(proceedsU112, 1);
  }

  function testAutoUnitCalculateProceedsB1() public {
		uint256 _scaledProceedsU128F64 = 2 ** 127;
		uint256 _startScaledProceedsU128F64 = 0;
    uint256 _stakedAmountU112 = 2 ** 32;

    uint256 proceedsU112 = ICronV1PoolExposed(exposedPool).iCalculateProceeds(_scaledProceedsU128F64, _startScaledProceedsU128F64, _stakedAmountU112);
    // console.log("proceeds b1", proceedsU112);
    assertApproxEqRel(proceedsU112, 73075081866545145910184241635, 2);
  }

  function testAutoUnitCalculateProceedsB2() public {
		uint256 _scaledProceedsU128F64 = (2 ** 127)-1;
		uint256 _startScaledProceedsU128F64 = (2 ** 128)-1;
    uint256 _stakedAmountU112 = 2 ** 32;

    uint256 proceedsU112 = ICronV1PoolExposed(exposedPool).iCalculateProceeds(_scaledProceedsU128F64, _startScaledProceedsU128F64, _stakedAmountU112);
    // console.log("proceeds b2", proceedsU112);
    assertApproxEqRel(proceedsU112, 73075081866545145910184241635, 2);
  }

  function testAutoUnitCalculateProceedsC1() public {
		uint256 _scaledProceedsU128F64 = (2 ** 128)-1;
		uint256 _startScaledProceedsU128F64 = 0;
    uint256 _stakedAmountU112 = 2 ** 0;

    uint256 proceedsU112 = ICronV1PoolExposed(exposedPool).iCalculateProceeds(_scaledProceedsU128F64, _startScaledProceedsU128F64, _stakedAmountU112);
    // console.log("proceeds c1", proceedsU112);
    assertApproxEqRel(proceedsU112, 34028236692093846346, 2);
  }

  function testAutoUnitCalculateProceedsC2() public {
		uint256 _scaledProceedsU128F64 = 0;
		uint256 _startScaledProceedsU128F64 = 1;
    uint256 _stakedAmountU112 = 2 ** 0;

    uint256 proceedsU112 = ICronV1PoolExposed(exposedPool).iCalculateProceeds(_scaledProceedsU128F64, _startScaledProceedsU128F64, _stakedAmountU112);
    // console.log("proceeds c2", proceedsU112);
    assertApproxEqRel(proceedsU112, 34028236692093846346, 2);
  }
}
