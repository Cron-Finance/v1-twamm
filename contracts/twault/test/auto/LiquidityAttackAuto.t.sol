pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { C } from "../../miscellany/Constants.sol";
import { ICronV1PoolEnums } from "./../../interfaces/pool/ICronV1PoolEnums.sol";
import { ExecVirtualOrdersMem } from "../../interfaces/Structs.sol";

contract LiquidityAttack is HelperContract {

  uint256 WAD = 10**18;
  uint256 AMT_1M = 10**6 * WAD;
  uint256 AMT_1K = 10**3 * WAD;
  uint256 AMT_999K = AMT_1M - AMT_1K;

  // Highlights price manipulation sandwich attack against LP that doesn't set 
  // minimums.
  //
  function testAutoJoinSandwich() public {
    address userA = address(this);
    address userB = vm.addr(1323);
    
    // Add some base liquidity from the future attacker.
    addLiquidity(pool, userA, userA, 10**7 * WAD, 10**7 * WAD, 0);
    assertEq(CronV1Pool(pool).balanceOf(userA), 10**7 * WAD - C.MINIMUM_LIQUIDITY);

    // Give userB some tokens to LP with.
    token0.transfer(userB, 1_000_000 * WAD);
    token1.transfer(userB, 1_000_000 * WAD);
    addLiquidity(pool, userB, userB, 10**6 * WAD, 10**6 * WAD, 0);
    assertEq(CronV1Pool(pool).balanceOf(userB), 10**6 * WAD);
    exit(10**6 * WAD, ICronV1PoolEnums.ExitType(0), pool, userB);
    assertEq(CronV1Pool(pool).balanceOf(userB), 0);

    // Full amounts are returned b/c the exit penalty has been removed (as is being done anyway).
    assertEq(token0.balanceOf(userB), 1_000_000 * WAD);
    assertEq(token1.balanceOf(userB), 1_000_000 * WAD);

    // Now we'll do the same thing, simulating a sandwich from userA.
    uint256 swapProceeds =
      swapPoolAddr(5 * 10**6 * WAD, /* unused */ 0, ICronV1PoolEnums.SwapType(0), address(token0), pool, userA);

    // Original tx from userB is sandwiched now...
    addLiquidity(pool, userB, userB, 10**6 * WAD, 10**6 * WAD, 0);

    // Sell back what was gained from the first swap.
    swapProceeds =
      swapPoolAddr(swapProceeds, /* unused */ 0, ICronV1PoolEnums.SwapType(0), address(token1), pool, userA);
    emit log_named_uint("swapProceeds 1 to 0", swapProceeds);  // allows seeing what userA lost to fees
    assertEq(swapProceeds, 4845178856516554015932796);

    // Let's see what poor userB gets back of their million token0 and million token1...
    assertEq(token0.balanceOf(userB), 0);
    assertEq(token1.balanceOf(userB), 0); 
    exit(ICronV1Pool(pool).balanceOf(userB), ICronV1PoolEnums.ExitType(0), pool, userB);
    emit log_named_uint("userB token0 after", token0.balanceOf(userB));
    emit log_named_uint("userB token1 after", token1.balanceOf(userB));
    assertEq(token0.balanceOf(userB), 697176321467715374004199);
    assertEq(token1.balanceOf(userB), 687499999999999999999999);
  }

  // Highlights price manipulation sandwich attack prevented against LP by setting minimums.
  //
  function testAutoJoinProtectedFromSandwich() public {
    address userA = address(this);
    address userB = vm.addr(1323);
    
    // Add some base liquidity from the future attacker.
    addLiquidity(pool, userA, userA, 10**7 * WAD, 10**7 * WAD, 0);
    assertEq(CronV1Pool(pool).balanceOf(userA), 10**7 * WAD - C.MINIMUM_LIQUIDITY);

    // Give userB some tokens to LP with.
    token0.transfer(userB, 1_000_000 * WAD);
    token1.transfer(userB, 1_000_000 * WAD);
    addLiquidityWithMin(pool, userB, userB, AMT_1M, AMT_1M, AMT_999K, AMT_999K, 0, "");
    assertEq(CronV1Pool(pool).balanceOf(userB), 10**6 * WAD);
    exit(10**6 * WAD, ICronV1PoolEnums.ExitType(0), pool, userB);
    assertEq(CronV1Pool(pool).balanceOf(userB), 0);

    // Full amounts are returned
    assertEq(token0.balanceOf(userB), 1_000_000 * WAD);
    assertEq(token1.balanceOf(userB), 1_000_000 * WAD);

    // Now we'll do the same thing, simulating a sandwich from userA.
    swapPoolAddr(5 * 10**6 * WAD, /* unused */ 0, ICronV1PoolEnums.SwapType(0), address(token0), pool, userA);

    // Original tx from userB is sandwiched now...
    addLiquidityWithMin(pool, userB, userB, AMT_1M, AMT_1M, AMT_999K, AMT_999K, 0, "CFI#228");
  }

  function testAutoExitSandwich() public {
    address userA = address(this);
    address userB = vm.addr(1323);
    
    // Add some base liquidity from the future attacker.
    addLiquidity(pool, userA, userA, 10**7 * WAD, 10**7 * WAD, 0);
    assertEq(CronV1Pool(pool).balanceOf(userA), 10**7 * WAD - C.MINIMUM_LIQUIDITY);

    // Give userB some tokens to LP with.
    token0.transfer(userB, 1_000_000 * WAD);
    token1.transfer(userB, 1_000_000 * WAD);
    addLiquidity(pool, userB, userB, 10**6 * WAD, 10**6 * WAD, 0);
    assertEq(CronV1Pool(pool).balanceOf(userB), 10**6 * WAD);
    exit(10**6 * WAD, ICronV1PoolEnums.ExitType(0), pool, userB);
    assertEq(CronV1Pool(pool).balanceOf(userB), 0);

    // Full amounts are returned 
    assertEq(token0.balanceOf(userB), 1_000_000 * WAD);
    assertEq(token1.balanceOf(userB), 1_000_000 * WAD);


    // Now we'll do the same thing, simulating a sandwich on the exit from userA.
    //
    addLiquidity(pool, userB, userB, 10**6 * WAD, 10**6 * WAD, 0);
    assertEq(token0.balanceOf(userB), 0);
    assertEq(token1.balanceOf(userB), 0); 

    uint256 swapProceeds =
      swapPoolAddr(5 * 10**6 * WAD, /* unused */ 0, ICronV1PoolEnums.SwapType(0), address(token0), pool, userA);
    
    // Original exit tx from userB is sandwiched now...
    exit(ICronV1Pool(pool).balanceOf(userB), ICronV1PoolEnums.ExitType(0), pool, userB);

    // Sell back what was gained from the first swap.
    swapProceeds =
      swapPoolAddr(swapProceeds, /* unused */ 0, ICronV1PoolEnums.SwapType(0), address(token1), pool, userA);
    emit log_named_uint("swapProceeds 1 to 0", swapProceeds);  // allows seeing what userA lost to fees
    assertEq(swapProceeds, 4845252256071911722157166);

    // Now let's see what poor userB got back of their million token0 and million token1...
    exit(ICronV1Pool(pool).balanceOf(userB), ICronV1PoolEnums.ExitType(0), pool, userB);
    emit log_named_uint("userB token0 after", token0.balanceOf(userB));
    emit log_named_uint("userB token1 after", token1.balanceOf(userB));
    assertEq(token0.balanceOf(userB), 1454545454545454545454545);
    assertEq(token1.balanceOf(userB), 687607438662290982966088);
  }

  function testAutoExitProtectedAgainstSandwichMovement() public {
    address userA = address(this);
    address userB = vm.addr(1323);
    
    // Add some base liquidity from the future attacker.
    addLiquidity(pool, userA, userA, 10**7 * WAD, 10**7 * WAD, 0);
    assertEq(CronV1Pool(pool).balanceOf(userA), 10**7 * WAD - C.MINIMUM_LIQUIDITY);

    // Give userB some tokens to LP with.
    token0.transfer(userB, AMT_1M);
    token1.transfer(userB, AMT_1M);
    addLiquidity(pool, userB, userB, AMT_1M, AMT_1M, 0);
    assertEq(CronV1Pool(pool).balanceOf(userB), AMT_1M);
    exit(10**6 * WAD, ICronV1PoolEnums.ExitType(0), pool, userB);
    assertEq(CronV1Pool(pool).balanceOf(userB), 0);

    // Full amounts are returned 
    assertEq(token0.balanceOf(userB), AMT_1M);
    assertEq(token1.balanceOf(userB), AMT_1M);


    // Now we'll do the same thing, simulating a sandwich on the exit from userA that userB 
    // wishes to prevent exiting at this prive movement.
    //
    addLiquidity(pool, userB, userB, AMT_1M, AMT_1M, 0);
    assertEq(token0.balanceOf(userB), 0);
    assertEq(token1.balanceOf(userB), 0); 

    uint256 swapProceeds =
      swapPoolAddr(5 * 10**6 * WAD, /* unused */ 0, ICronV1PoolEnums.SwapType(0), address(token0), pool, userA);
    
    // Original exit tx from userB is sandwiched now...
    exit(ICronV1Pool(pool).balanceOf(userB), ICronV1PoolEnums.ExitType(0), pool, userB);

    // Sell back what was gained from the first swap.
    swapProceeds =
      swapPoolAddr(swapProceeds, /* unused */ 0, ICronV1PoolEnums.SwapType(0), address(token1), pool, userA);
    emit log_named_uint("swapProceeds 1 to 0", swapProceeds);  // allows seeing what userA lost to fees
    assertEq(swapProceeds, 4845252256071911722157166);

    // Now let's ensure userB can reject large price movements in a sandwich that 
    // would move their million token0 and million token1 significantly
    //
    exitRevertWithMin(ICronV1Pool(pool).balanceOf(userB),
                      AMT_999K,
                      AMT_999K,
                      ICronV1PoolEnums.ExitType(0),
                      pool,
                      userB,
                      "BAL#505" /* EXIT_BELOW_MIN */ );
  }
}
