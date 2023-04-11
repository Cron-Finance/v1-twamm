// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import "../HelperContract.sol";
import "../../interfaces/ICronV1PoolExposed.sol";

// Overflow Test
// ================================================================================

// Description: The increment scaled proceeds method, _incrementScaledProceeds, 
//              is used to add proceeds to the scaled proceeds storage. This stored
// 			 value is used as a measure of distance between previously stored 
// 			 values. It makes use of overflow to enable a 2**128 - 1 total 
// 			 possible distance at any given time. This test simulates scenarios
// 			 that should result in an overflow of the incremented proceeds.

// Notes: Solve for sales rate for maximum distance.

// 	     	 scaledProceeds --> maxU128 > 0 + (maxU112 << 64)
// 	     	  								  ---------------
// 	     	 								 	 salesRate

// 	     	 				    salesRate > maxU112 << 64
// 	     	 							    -------------
// 	     	 								   maxU128

// 	     	 				    salesRate > 281474976710655

// Test Procedure:

// 	Variation A.1: Small Distance, No Overflow
// 			1. _scaledProceedsU128F64 = 0
// 			2. _tokenOutU112 = 1
// 			3. _salesRateU112 = 2 ** 64
// 			4. Call _incrementScaledProceeds and get scaledProceedsU128F64
// 			5. Expect scaledProceedsU128F64 = 1
// 	Variation A.2: Small Distance, Overflows
// 			6. _scaledProceedsU128F64 = (2 ** 128) - 1
// 			7. _tokenOutU112 = 1
// 			8. _salesRateU112 = 2 ** 64
// 			9. Call _incrementScaledProceeds and get scaledProceedsU128F64
// 			10. Expect scaledProceedsU128F64 = 0

// 	Variation B.1: Medium Distance, No Overflow
// 			1. _scaledProceedsU128F64 = 0
// 			2. _tokenOutU112 = 2 ** 64
// 			3. _salesRateU112 = 2 ** 64
// 			4. Call _incrementScaledProceeds and get scaledProceedsU128F64
// 			5. Expect scaledProceedsU128F64 = 18446744073709551616
// 	Variation B.2: Medium Distance, Overflows
// 			6. _scaledProceedsU128F64 = (2 ** 128) - 1
// 			7. _tokenOutU112 = 2 ** 64
// 			8. _salesRateU112 = 2 ** 64
// 			9. Call _incrementScaledProceeds and get scaledProceedsU128F64
// 			10. Expect scaledProceedsU128F64 = 18446744073709551615

// 	Variation C.1: Full Distance U112, No Overflow
// 			1. _scaledProceedsU128F64 = 0
// 			2. _tokenOutU112 = (2 ** 112) - 1
// 			3. _salesRateU112 = 281474976710656		// Solve for scaled proceeds being
// 			                                        // close to maxU128, then correct
// 													// manually to account for division
// 													// precision effect. See Notes
// 													// above.
// 			4. Call _incrementScaledProceeds and get scaledProceedsU128F64
// 			5. Expect scaledProceedsU128F64 = 340282366920938463463374607431768145920
// 	Variation C.2: Full Distance U112, Overflows
// 			6. _scaledProceedsU128F64 = (2 ** 128) - 1
// 			7. _tokenOutU112 = (2 ** 112) - 1
// 			8. _salesRateU112 = 281474976710656
// 			9. Call _incrementScaledProceeds and get scaledProceedsU128F64
// 			10. Expect scaledProceedsU128F64 = 340282366920938463463374607431768145919

// 	Variation D.1: Full Distance U128, No Overflow
// 			1. _scaledProceedsU128F64 = 0
// 			2. _tokenOutU112 = (2 ** 128) - 1
// 			3. _salesRateU112 = 2 ** 64
// 			4. Call _incrementScaledProceeds and get scaledProceedsU128F64
// 			5. Expect scaledProceedsU128F64 = (2 ** 128) - 1
// 	Variation D.2: Full Distance U128, Overflows
// 			6. _scaledProceedsU128F64 = (2 ** 128) - 1
// 			7. _tokenOutU112 = (2 ** 112) - 1
// 			8. _salesRateU112 = 2 ** 64
// 			9. Call _incrementScaledProceeds and get scaledProceedsU128F64
// 			10. Expect scaledProceedsU128F64 =  (2 ** 128) - 2

contract IncrementScaledProceedsUnit is HelperContract {

  function setUp() public {}

//  function testAutoUnitIncrementScaledProceedsA1() public {
//		uint256 _scaledProceedsU128F64 = 0;
//		uint256 _tokenOutU112 = 1;
//    uint256 _salesRateU112 = 2 ** 64;
//
//    uint256 scaledProceedsU128F64 = ICronV1PoolExposed(exposedPool).iIncrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112);
//    // console.log("scaledProceedsU128F64 a1", scaledProceedsU128F64);
//    assertEq(scaledProceedsU128F64, 1);
//  }
//
//  function testAutoUnitIncrementScaledProceedsA2() public {
//		uint256 _scaledProceedsU128F64 = (2 ** 128) - 1;
//		uint256 _tokenOutU112 = 1;
//    uint256 _salesRateU112 = 2 ** 64;
//
//    uint256 scaledProceedsU128F64 = ICronV1PoolExposed(exposedPool).iIncrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112);
//    // console.log("scaledProceedsU128F64 a2", scaledProceedsU128F64);
//    assertEq(scaledProceedsU128F64, 0);
//  }
//
//  function testAutoUnitIncrementScaledProceedsB1() public {
//		uint256 _scaledProceedsU128F64 = 0;
//		uint256 _tokenOutU112 = 2 ** 64;
//    uint256 _salesRateU112 = 2 ** 64;
//
//    uint256 scaledProceedsU128F64 = ICronV1PoolExposed(exposedPool).iIncrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112);
//    // console.log("scaledProceedsU128F64 b1", scaledProceedsU128F64);
//    assertEq(scaledProceedsU128F64, 18446744073709551616);
//  }
//
//  function testAutoUnitIncrementScaledProceedsB2() public {
//		uint256 _scaledProceedsU128F64 = (2 ** 128)-1;
//		uint256 _tokenOutU112 = 2 ** 64;
//    uint256 _salesRateU112 = 2 ** 64;
//
//    uint256 scaledProceedsU128F64 = ICronV1PoolExposed(exposedPool).iIncrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112);
//    // console.log("scaledProceedsU128F64 b2", scaledProceedsU128F64);
//    assertEq(scaledProceedsU128F64, 18446744073709551615);
//  }
//
//  function testAutoUnitIncrementScaledProceedsC1() public {
//		uint256 _scaledProceedsU128F64 = 0;
//		uint256 _tokenOutU112 = (2 ** 112)-1;
//    uint256 _salesRateU112 = 281474976710656;
//
//    uint256 scaledProceedsU128F64 = ICronV1PoolExposed(exposedPool).iIncrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112);
//    // console.log("scaledProceedsU128F64 c1", scaledProceedsU128F64);
//    assertEq(scaledProceedsU128F64, 340282366920938463463374607431768145920);
//  }
//
//  function testAutoUnitIncrementScaledProceedsC2() public {
//		uint256 _scaledProceedsU128F64 = (2 ** 128)-1;
//		uint256 _tokenOutU112 = (2 ** 112)-1;
//    uint256 _salesRateU112 = 281474976710656;
//
//    uint256 scaledProceedsU128F64 = ICronV1PoolExposed(exposedPool).iIncrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112);
//    // console.log("scaledProceedsU128F64 c2", scaledProceedsU128F64);
//    assertEq(scaledProceedsU128F64, 340282366920938463463374607431768145919);
//  }
//
//  function testAutoUnitIncrementScaledProceedsD1() public {
//		uint256 _scaledProceedsU128F64 = 0;
//		uint256 _tokenOutU112 = (2 ** 128)-1;
//    uint256 _salesRateU112 = 2 ** 64;
//
//    uint256 scaledProceedsU128F64 = ICronV1PoolExposed(exposedPool).iIncrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112);
//    // console.log("scaledProceedsU128F64 d1", scaledProceedsU128F64);
//    assertEq(scaledProceedsU128F64, (2 ** 128) - 1);
//  }
//
//  function testAutoUnitIncrementScaledProceedsD2() public {
//		uint256 _scaledProceedsU128F64 = (2 ** 128)-1;
//		uint256 _tokenOutU112 = (2 ** 128)-1;
//    uint256 _salesRateU112 = 2 ** 64;
//
//    uint256 scaledProceedsU128F64 = ICronV1PoolExposed(exposedPool).iIncrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112);
//    // console.log("scaledProceedsU128F64 d2", scaledProceedsU128F64);
//    assertEq(scaledProceedsU128F64, (2 ** 128) - 2);
//  }
}
