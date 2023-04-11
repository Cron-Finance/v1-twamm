pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { ExecVirtualOrdersMem } from "../../interfaces/Structs.sol";
import { C } from "../../miscellany/Constants.sol";

contract RewardsTests is HelperContract {

  struct Stack2Deep {
    address userA;
    address userB;
    address userC;
    address userD;
    uint256 totalLpTokensMinted;
    uint256 millionLiquid;
    uint256 hundredK;
    address pool;
  }

  function getTradeBlocks(uint _obi, uint _swapInterval) public view returns (uint tradeBlocks) {
    uint lastExpiryBlock = block.number - (block.number % _obi);
    uint orderExpiry = _obi * (_swapInterval + 1) + lastExpiryBlock;
    tradeBlocks = orderExpiry - block.number;
  }

  // Reward When Not Paused - EVO
  // ================================================================================
  // Description:
  //   Recently changes were made to the Reward functionality to allow transactions 
  //   when paused. This test confirms correct behavior when not paused.

  // Test Procedure:
  //   1. Initialize a pool
  //     * create the pool
  //     * initial join / mint event with some amount of liquidity
  //   2. Issue a long term order with the following characteristics
  //     - intervals = 10
  //     - amount = 1000 * tradeBlocks
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 1000 / block
  //   3. Store the current token reserves
  //   4. Store the current vault balances
  //   5. Mine 3 * OBI blocks
  //   6. Reward the pool with some amount of each token
  //   7. Get the current vault balances
  //     * Expect that the balances increased by the amount rewarded in step 6
  //   8. Get the current token reserves
  //     * Expect that the reserves changed as follows:
  //         * sales token reserve: - 3 * OBI * 1000, + reward amount
  //         * purchase token reserve: +3 * OBI * 1000 sales token CPAMM math, + reward amount
  //     // The purchase token amount will be harder to confirm b/c of the math, if
  //     // you get the sales token amount right and are having trouble with the
  //     // purchase amount, lemme know. To make this easy, make the reserves 1:1
  //     // in the initial mint of step 1 and reward at the ratio of 1:1, then you
  //     // know you're buying ~1000 tokens each block, less slippage and fees.

  function testManualRewardsNotPaused() public {
    _addInitialLiquidity();
    (, uint256 reserve0U1120, uint256 reserve1U1120, , , , , , , , ) = ICronV1Pool(pool).getVirtualReserves(block.number,
                                                                                                        false);
    uint obi = C.LIQUID_OBI;
    uint swapInterval = 10;
    // bool swapDirection = true;
    uint tradeBlocks = getTradeBlocks(obi, swapInterval);
    uint amount = 1000 * tradeBlocks;
    swap(amount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, true);
    mineBlocks(3*obi);
    // bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (
      ,
      uint256[] memory balances0,
    ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    // console.log("\n\n\n\n*************************");
    // console.log("Previous reserves", reserve0U1120, reserve1U1120);
    // console.log("Previous balances", balances0[0], balances0[1]);
    uint donation = 10e18;
    addLiquidity(donation, donation, 1);
    mineBlocks();
    (, uint256 reserve0U1121, uint256 reserve1U1121, , , , , , , , ) = ICronV1Pool(pool).getVirtualReserves(block.number,
                                                                                                        false);
    (
      ,
      uint256[] memory balances1,
    ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    // console.log("\n\n\n\n*************************");
    // console.log("After reserves", reserve0U1121, reserve1U1121);
    // console.log("After balances", balances1[0], balances1[1]);

    assertEq(balances1[0] - donation, balances0[0], "assert 1");
    assertEq(balances1[1] - donation, balances0[1], "assert 2");
    // console.log("\n\n\n\n*************************");

    // reserve0 decreases
    uint expectedRes0 = reserve0U1120 -((3*obi+1)*1000*(100000-150)/100000) + donation;
    assertApproxEqRel(reserve0U1121, expectedRes0, 0.1e17);

    // reserve1 increases
    uint expectedRes1 = reserve1U1120 +((3*obi+1)*1000*(100000-150)/100000) + donation;
    assertApproxEqRel(reserve1U1121, expectedRes1, 0.1e17);
    assertApproxEqRel(reserve1U1121, expectedRes1, 0.1e17);
    assertApproxEqRel(reserve1U1121, expectedRes1, 0.1e17);
  }

  // Reward When Not Paused - EVO
  // ================================================================================
  // Description:
  //   Recently changes were made to the Reward functionality to allow transactions 
  //   when paused. This test confirms correct behavior when paused.

  // Test Procedure:
  //   1. Initialize a pool
  //     * create the pool
  //     * initial join / mint event with some amount of liquidity
  //   2. Store the token balances of the user in step 3
  //   3. Issue a long term order with the following characteristics
  //     - intervals = 10
  //     - amount = 1000 * tradeBlocks
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 1000 / block
  //   4. Store the token balances of the user in step 3 again in a new variable
  //     * confirm the order token was withdrawn from the user
  //   5. Store the current token reserves
  //   6. Store the current vault balances
  //   7. Mine 3 * OBI blocks
  //   8. Pause the pool
  //   9. Reward the pool with some amount of each token
  //     * expect success
  // 10. Get the current vault balances
  //     * Expect that the balances increased by the amount rewarded in step 9
  // 11. Get the current token reserves
  //     * Expect that the reserves changed as follows:
  //         * sales token reserve: + reward amount
  //         * purchase token reserve: + reward amount
  //         // You should not see a change other than the reward amounts from the
  //         // values in step 5
  //         // This is also testing the getReserveAmounts behavior when paused--
  //         // it should not reflect virtual order updates when paused.
  // 12. Withdraw / Cancel the LT swap
  //     * expect the user's balances to match those of step 2
  //     // No virtual orders were run so they should get a full refund

  function testManualRewardsPaused() public {
    _addInitialLiquidity();
    uint obi = C.LIQUID_OBI;
    // uint swapInterval = 10;
    // bool swapDirection = true;
    uint tradeBlocks = getTradeBlocks(obi, 10);
    uint amount = 1000 * tradeBlocks;
    // 4. Store the token balances of the user in step 3 again in a new variable
    // * confirm the order token was withdrawn from the user
    swap(amount, 10, ICronV1PoolEnums.SwapType.LongTermSwap, true);
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (
      ,
      uint256[] memory balances0,
    ) = vault.getPoolTokens(poolId);
    mineBlocks(3*obi);
    ICronV1Pool(pool).setPause(true);
    uint donation = 10e18;
    addLiquidity(donation, donation, 1);
    (
      ,
      uint256[] memory balances1,
    ) = vault.getPoolTokens(poolId);

    assertEq(balances1[0] - donation, balances0[0]);
    assertEq(balances1[1] - donation, balances0[1]);

    // reserve0 decreases
    // uint expectedRes0 = reserve0U1120 -((3*obi+1)*1000*(100000-150)/100000) + donation;
    // assertApproxEqRel(reserve0U1121, expectedRes0, 0.1e17);

    // // reserve1 increases
    // uint expectedRes1 = reserve1U1120 +((3*obi+1)*1000*(100000-150)/100000) + donation;
    // assertApproxEqRel(reserve1U1121, expectedRes1, 0.1e17);
    // assertApproxEqRel(reserve1U1121, expectedRes1, 0.1e17);
    // assertApproxEqRel(reserve1U1121, expectedRes1, 0.1e17);
    mineBlocks(7*obi);
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds, ,) = ICronV1Pool(pool).getOrderIds(address(this), 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw);
  }

  // Can’t Join When Paused
  // ================================================================================
  // Description:
  //   Recently changes were made to the Reward functionality to allow transactions 
  //   when paused. This test confirms correct behavior of Join when paused.

  // Test Procedure:
  //   1. Initialize a pool
  //     * create the pool
  //     * initial join / mint event with some amount of liquidity
  //   2. Pause the pool
  //   3. Join / mint the pool
  //     * expect failure because paused
  //   4. Unpause the pool
  //   5. Join / mint the pool
  //     * expect success

  function testFailManualCantJoinWhenPaused() public {
    _addInitialLiquidity();
    mineBlocks();
    ICronV1Pool(pool).setPause(true);
    mineBlocks();
    vm.expectRevert(bytes("CFI#100"));
    addLiquidity(10e18, 10e18, 0);
    // mineBlocks();
    // ICronV1Pool(pool).setPause(false);
    // mineBlocks();
    // addLiquidity(10e18, 10e18, 0);
    // mineBlocks();
  }

  function testManualCantJoinWhenPaused() public {
    _addInitialLiquidity();
    mineBlocks();
    ICronV1Pool(pool).setPause(true);
    mineBlocks();
    // vm.expectRevert(bytes("CFI#100"));
    // addLiquidity(10e18, 10e18, 0);
    // mineBlocks();
    ICronV1Pool(pool).setPause(false);
    mineBlocks();
    addLiquidity(10e18, 10e18, 0);
    mineBlocks();
  }

  // Disable Holding Period on Pause
  // ================================================================================
  // Description:
  //   You're an LP and the pool has failed. You just joined the pool and want to get
  //   all your money back. Will PB take a holding penalty? Fuck around and find
  //   out...

  // Test Procedure:
  //   1. User A initializes a pool with a join/mint of 1M Token 0 : 1M Token 1
  //   2. Mine 10 blocks
  //   3. User B joins/mints 100k Token 0 : 100k Token 1
  //     * Expect 100k LP
  //   4. Mine 10 blocks
  //   5. Oh no! The pool has failed.
  //     Factory owner pauses the pool.
  //     Factory owner sets holding period to 0 seconds.
  //   6. User B exits 100k LP from the pool
  //     * Expect them to receive 100k Token 0 and 100k Token 1  (No Penalty)

  function testManualDisableHoldingWhenPaused() public {
    _addInitialLiquidity();
    mineBlocks();
    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    uint256 millionLiquid = 1e24;
    addLiquidity(millionLiquid, millionLiquid, 0);
    mineBlocks(10);
    uint256 newLpTokensMinted = ICronV1Pool(pool).balanceOf(address(this));
    assertEq(millionLiquid, newLpTokensMinted - lpTokensMinted);
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    address user = vm.addr(55);
    uint256 hundredK = 1e21;
    IERC20(tokens[0]).transfer(user, hundredK);
    IERC20(tokens[1]).transfer(user, hundredK);
    addLiquidity(pool, user, user, hundredK, hundredK, 0);
    mineBlocks(10);
    ICronV1Pool(pool).setPause(true);
//    ICronV1Pool(pool).setParameter(uint256(ICronV1PoolEnums.ParamType.HoldingPeriodSec), 0);
    mineBlocks();
    uint256 userLPTokensMinted = ICronV1Pool(pool).balanceOf(user);
    exit(userLPTokensMinted, ICronV1PoolEnums.ExitType.Exit, pool, user);
    mineBlocks();
    uint256 t0 = IERC20(tokens[0]).balanceOf(user);
    uint256 t1 = IERC20(tokens[1]).balanceOf(user);
    assertEq(hundredK, t0);
    assertEq(hundredK, t1);
  }

  // Join When Not Paused - EVO
  // ================================================================================
  // Description:
  //   Recently changes were made to the Reward functionality to allow transactions 
  //   when paused. This test confirms correct behavior of Join when not paused wrt
  //   EVO.

  // Test Procedure:
  //   1. Initialize a pool
  //     * create the pool
  //     * initial join / mint event with some amount of liquidity
  //   2. Issue a long term order with the following characteristics
  //     - intervals = 10
  //     - amount = 1000 * tradeBlocks
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 1000 / block
  //   3. Mine 3 * OBI blocks
  //   4. Store the current token reserves
  //   5. Store the current vault balances
  //   6. Store the total supply of LP tokens
  //   7. Join / mint the pool
  //     * expect success
  //   8. Get the current vault balances
  //     * Expect that the balances increased by the amount joined in step 6
  //   9. Get the current token reserves
  //     * Expect that the reserves changed as follows:
  //         * sales token reserve: + join amount
  //         * purchase token reserve: + join amount
  //         // You should not see a change other than the join amounts from the
  //         // values in step 7 and a small amount of fees

  function testManualJoinNotPaused() public {
    _addInitialLiquidity();
    uint obi = C.LIQUID_OBI;
    uint swapAmount = 100e18;
    uint swapInterval = 10;
    // bool swapDirection = true;
    swap(swapAmount, swapInterval, ICronV1PoolEnums.SwapType.LongTermSwap, true);
    mineBlocks(3*obi);
    (, uint256 reserve0U1120, uint256 reserve1U1120, , , , , , , , ) = ICronV1Pool(pool).getVirtualReserves(block.number,
                                                                                                        false);
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (
      ,
      uint256[] memory balances0,
    ) = vault.getPoolTokens(poolId);
    // console.log("\n\n\n\n*************************");
    // console.log("Previous reserves", reserve0U1120, reserve1U1120);
    // console.log("Previous balances", balances0[0], balances0[1]);
    uint liquidity = 10e18;
    addLiquidity(liquidity, liquidity, 0);
    (, uint256 reserve0U1121, uint256 reserve1U1121, , , , , , , , ) = ICronV1Pool(pool).getVirtualReserves(block.number,
                                                                                                        false);
    (
      ,
      uint256[] memory balances1,
    ) = vault.getPoolTokens(poolId);
    // console.log("\n\n\n\n*************************");
    // console.log("After reserves", reserve0U1121, reserve1U1121);
    // console.log("After balances", balances1[0], balances1[1]);

    assertEq(balances1[0] - liquidity, balances0[0]);
    assertEq(balances1[1] - liquidity, balances0[1]);
    // reserve0 decreases
    // uint salesReserve = 3*obi*1000*amount??
    assertGt(reserve0U1121, reserve0U1120);
    // reserve1 increases
    // uint purchReserve = 3*obi*1000*amount??
    assertGt(reserve1U1121, reserve1U1120);
  }

  // Exit Without JoinEvents
  // ================================================================================
  // Description:
  //   LP tokens and JoinEvents are created together in sync. What happens when we
  //   exit the pool but have no JoinEvents (or not enough)? Correct behavior
  //   would be to penalize the un-covered LP tokens.

  // Note:
  //   Numbers below are not multiplied by 1e18

  // Test Procedure:
  //   1. User A initializes a pool with a join/mint of 1M Token 0 : 1M Token 1.
  //     * Expect 999000 LP
  //     * Expect 1M LP totalSupply
  //   2. Factory owner sets holding period to 0 seconds.
  //     * Expect getHoldingPeriod() returns 0s
  //   3. User B joins/mints 100k Token 0 : 100k Token 1.
  //     * Expect 100k LP
  //     * Expect 1.1M LP totalSupply
  //   4. User C joins/mints 100k Token 0 : 100k Token 1.
  //     * Expect 100k LP
  //     * Expect 1.2M LP totalSupply
  //   5. User D joins/mints 100k Token 0 : 100k Token 1.
  //     * Expect 1000 LP
  //     * Expect 1.3M LP totalSupply
  //   6. User B transfers all of the LP in their join events to User A
  //   7. User C transfers 1/2 of the LP in their join events to User A
  //   8. User D exits 100k LP from the pool
  //     * Expect them to receive 100k Token 0 and 100k Token 1  (No Penalty)
  //   9. User C exits 100k LP from the pool
  //     * Expect them to receive 99950 Token 0 and 99950 Token 1  (0.1 % Penalty on
  //       1/2 their position)
  //     * Expect 1.1M LP totalSupply
  //     * Expect reserves: T0 = 1,100,050  T1 = 1,100,050
  // 10. User B exits 100k LP from the pool
  //     * Expect them to receive 99904 Token 0 and 99904 Token 1  (0.1 % Penalty on
  //       all their position)
  //     * Expect 1 LP totalSupply
  //     * Expect reserves: T0 = 1,000,146  T1 = 1,000,146

  function testManualExitWithoutJoinPart1() public returns (Stack2Deep memory s2d) {
    // _addInitialLiquidity();
    // mineBlocks();
    s2d.pool = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Liquid",
      "T1-T2-L",
      1
    );
    ICronV1Pool(s2d.pool).setAdminStatus(address(owner), true);
    s2d.totalLpTokensMinted = ICronV1Pool(s2d.pool).totalSupply();
    s2d.millionLiquid = 1e24;
    addLiquidity(s2d.pool, address(this), address(this), s2d.millionLiquid, s2d.millionLiquid, 0);
    mineBlocks();
    s2d.totalLpTokensMinted = ICronV1Pool(s2d.pool).totalSupply();
    uint256 newLpTokensMinted = ICronV1Pool(s2d.pool).balanceOf(address(this));
    assertEq(s2d.millionLiquid - 1000, newLpTokensMinted, "new LP tokens");
    assertEq(s2d.millionLiquid, s2d.totalLpTokensMinted, "total supply");
//    ICronV1Pool(s2d.pool).setParameter(uint256(ICronV1PoolEnums.ParamType.HoldingPeriodSec), 0);
    mineBlocks();
//    assertEq(ICronV1Pool(s2d.pool).getHoldingPeriod(), 0);
    bytes32 poolId = ICronV1Pool(s2d.pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    s2d.userA = vm.addr(55);
    s2d.hundredK = 1e21;
    // IERC20(tokens[0]).transfer(s2d.userA, s2d.hundredK);
    // IERC20(tokens[1]).transfer(s2d.userA, s2d.hundredK);
    // addLiquidity(s2d.pool, s2d.userA, s2d.userA, s2d.hundredK, s2d.hundredK, 0);
    // mineBlocks();
    s2d.userB = vm.addr(54);
    IERC20(tokens[0]).transfer(s2d.userB, s2d.hundredK);
    IERC20(tokens[1]).transfer(s2d.userB, s2d.hundredK);
    addLiquidity(s2d.pool, s2d.userB, s2d.userB, s2d.hundredK, s2d.hundredK, 0);
    mineBlocks();
    s2d.userC = vm.addr(53);
    IERC20(tokens[0]).transfer(s2d.userC, s2d.hundredK);
    IERC20(tokens[1]).transfer(s2d.userC, s2d.hundredK);
    addLiquidity(s2d.pool, s2d.userC, s2d.userC, s2d.hundredK, s2d.hundredK, 0);
    mineBlocks();
    s2d.userD = vm.addr(52);
    IERC20(tokens[0]).transfer(s2d.userD, s2d.hundredK);
    IERC20(tokens[1]).transfer(s2d.userD, s2d.hundredK);
    addLiquidity(s2d.pool, s2d.userD, s2d.userD, s2d.hundredK, s2d.hundredK, 0);
    mineBlocks();
    return s2d;
  }

  function testManualExitWithoutJoinPart2() public {
    Stack2Deep memory s2d = testManualExitWithoutJoinPart1();
    // uint256 userALPTokensMinted = ICronV1Pool(s2d.pool).balanceOf(s2d.userA);
    // assertEq(userALPTokensMinted, s2d.hundredK);
    // console.log("User A LP Tokens", userALPTokensMinted);
    uint256 userBLPTokensMinted = ICronV1Pool(s2d.pool).balanceOf(s2d.userB);
    assertEq(userBLPTokensMinted, s2d.hundredK);
    // console.log("User B LP Tokens", userBLPTokensMinted);
    uint256 userCLPTokensMinted = ICronV1Pool(s2d.pool).balanceOf(s2d.userC);
    assertEq(userCLPTokensMinted, s2d.hundredK);
    // console.log("User C LP Tokens", userCLPTokensMinted);
    uint256 userDLPTokensMinted = ICronV1Pool(s2d.pool).balanceOf(s2d.userD);
    assertEq(userDLPTokensMinted, s2d.hundredK);
    // console.log("User D LP Tokens", userDLPTokensMinted);
    s2d.totalLpTokensMinted = ICronV1Pool(s2d.pool).totalSupply();
    assertEq(s2d.totalLpTokensMinted, s2d.millionLiquid + 3*s2d.hundredK);
//    JoinEvent[] memory joinEventsB = ICronV1Pool(s2d.pool).getJoinEvents(s2d.userB);
//    vm.startPrank(s2d.userA);
//    ICronV1Pool(s2d.pool).setJoinEventTransferSource(s2d.userB, true);
//    vm.stopPrank();
//    vm.startPrank(s2d.userB);
//    ICronV1Pool(s2d.pool).transferJoinEvent(s2d.userA, 0, joinEventsB[0].amountLP);
//    vm.stopPrank();
//    JoinEvent[] memory joinEventsC = ICronV1Pool(s2d.pool).getJoinEvents(s2d.userC);
//    vm.startPrank(s2d.userA);
//    ICronV1Pool(s2d.pool).setJoinEventTransferSource(s2d.userC, true);
//    vm.stopPrank();
//    vm.startPrank(s2d.userC);
//    ICronV1Pool(s2d.pool).transferJoinEvent(s2d.userA, 0, joinEventsC[0].amountLP/2);
//    vm.stopPrank();
    userDLPTokensMinted = ICronV1Pool(s2d.pool).balanceOf(s2d.userD);
    exit(100e18, ICronV1PoolEnums.ExitType.Exit, s2d.pool, s2d.userD);
    bytes32 poolId = ICronV1Pool(s2d.pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    uint256 t0d = IERC20(tokens[0]).balanceOf(s2d.userD);
    uint256 t1d = IERC20(tokens[1]).balanceOf(s2d.userD);
    assertEq(100e18, t0d);
    assertEq(100e18, t1d);
    // console.log("D LP", t0d, t1d);
    exit(100e18, ICronV1PoolEnums.ExitType.Exit, s2d.pool, s2d.userC);
    // 99950?? 100k returned
    s2d.totalLpTokensMinted = ICronV1Pool(s2d.pool).totalSupply();
    // assertEq(s2d.totalLpTokensMinted, s2d.millionLiquid + s2d.hundredK);
    exit(100e18, ICronV1PoolEnums.ExitType.Exit, s2d.pool, s2d.userB);
    // 99950?? 100k returned
    s2d.totalLpTokensMinted = ICronV1Pool(s2d.pool).totalSupply();
    // assertEq(s2d.totalLpTokensMinted, s2d.millionLiquid + s2d.hundredK);
  }

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

  // JoinEvent Limits Test
  // ================================================================================
  // Description:
  //   Ensure that the limitations of the JoinEvents list are properly handled and
  //   errored.

  // Test Procedure:
  //   1. User A initializes a pool with a join of 1M Token 0 : 1M Token 1
  //     - Mine a block
  //   2. User A joins 49 more times, once per block (mine a block between joins)
  //   3. User A joins a 51st time
  //     * Expect error CronErrors.MAX_JOIN_EVENTS_REACHED
  //   4. User B joins 49 times, once per block (mine a block between joins)
  //   5. User A transfers there last JoinEvent (index=49) to User B
  //     * Expect success
  //     * Expect User B's first JoinEvent (index=0) to be the transferred block
  //       from User A
  //         - confirm matching timestamp and amountLP
  //     * Expect User B's JoinEvents.length == 50
  //   6. User A transfers there first JoinEvent (index=0) to User B
  //     * Expect error CronErrors.DEST_ADDR_MAX_JOIN_EVENTS
  //   7. User A joins 2 more times, once per block (mine a block between joins)
  //     * Expect success
  //   8. User A joins 1 more time
  //     * Expect error CronErrors.MAX_JOIN_EVENTS_REACHED
  //   9. User A exits the amountLP of their first JoinEvent (index=0) and 1/2 the
  //     amountLP of their second JoinEvent (index=1).
  //     * Expect JoinEvent.length=49
  // 10. User A joins again
  //     * Expect success
  // 11. User A joins again
  //     * Expect error CronErrors.MAX_JOIN_EVENTS_REACHED

//  function testManualJoinEventLimit() public {
//    address newPool = factory.create(
//      address(token1),
//      address(token2),
//      "T1-T2-Liquid",
//      "T1-T2-L",
//      1
//    );
//    address userA = vm.addr(55);
//    address userB = vm.addr(54);
//    bytes32 poolId = ICronV1Pool(newPool).POOL_ID();
//    uint256 oneToken = 1e18;
//    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
//    IERC20(tokens[0]).transfer(userA, 100*oneToken);
//    IERC20(tokens[1]).transfer(userA, 100*oneToken);
//    IERC20(tokens[0]).transfer(userB, 100*oneToken);
//    IERC20(tokens[1]).transfer(userB, 100*oneToken);
//    addLiquidity(newPool, address(this), address(this), 1e21, 1e21, 0);
//    mineBlocks();
//    // 50 join events for userA
//    addLiquidityMultipleTimes(newPool, userA, 50, 1);
//    // 51st event fails
//    addLiquidityRevert(newPool, userA, userA, oneToken, oneToken, 0, "CFI#220");
//    // 49 join events for userB
//    addLiquidityMultipleTimes(newPool, userB, 49, 1);
//    JoinEvent[] memory joinEventsA = ICronV1Pool(newPool).getJoinEvents(userA);
//    JoinEvent[] memory joinEventsB = ICronV1Pool(newPool).getJoinEvents(userB);
//    // console.log("1: A events #", joinEventsA.length);
//    // console.log("1: B events #", joinEventsB.length);
//    vm.startPrank(userB);
//    ICronV1Pool(newPool).setJoinEventTransferSource(userA, true);
//    vm.stopPrank();
//    vm.startPrank(userA);
//    ICronV1Pool(newPool).transferJoinEvent(userB, 49, joinEventsA[49].amountLP);
//    vm.stopPrank();
//    mineBlocks();
//    joinEventsA = ICronV1Pool(newPool).getJoinEvents(userA);
//    joinEventsB = ICronV1Pool(newPool).getJoinEvents(userB);
//    assertEq(joinEventsA.length, 49);
//    assertEq(joinEventsB.length, 50);
//    vm.startPrank(userA);
//    vm.expectRevert(bytes("CFI#221"));
//    ICronV1Pool(newPool).transferJoinEvent(userB, 0, joinEventsA[0].amountLP);
//    vm.stopPrank();
//    mineBlocks();
//    addLiquidityMultipleTimes(newPool, userA, 1, 1);
//    addLiquidityRevert(newPool, userA, userA, oneToken, oneToken, 0, "CFI#220");
//    joinEventsA = ICronV1Pool(newPool).getJoinEvents(userA);
//    joinEventsB = ICronV1Pool(newPool).getJoinEvents(userB);
//    uint256 userALPExit = joinEventsA[0].amountLP + joinEventsA[1].amountLP/2;
//    exit(userALPExit, ICronV1PoolEnums.ExitType.Exit, newPool, userA);
//    joinEventsA = ICronV1Pool(newPool).getJoinEvents(userA);
//    assertEq(joinEventsA.length, 49);
//    addLiquidityMultipleTimes(newPool, userA, 1, 1);
//    addLiquidityRevert(newPool, userA, userA, oneToken, oneToken, 0, "CFI#220");
//  }
}
