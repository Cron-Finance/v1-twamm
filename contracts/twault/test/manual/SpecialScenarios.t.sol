pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "../HelperContract.sol";
import { ExecVirtualOrdersMem } from "../../interfaces/Structs.sol";

contract SpecialScenarios is HelperContract {
  // Assumptions
  // Price of ETH: 10 DAI
  // No fees

  TestToken dai;
  address lip0;
  address lip1;
  address trd0;
  address trd1;
  address arb0;
  address arb1;
  address pool0;

  function setUp() public {
    // liquidity providers
    lip0 = makeAddr("lip0");
    lip1 = makeAddr("lip1");
    // long term traders
    trd0 = makeAddr("trd0");
    trd1 = makeAddr("trd1");
    // arbitrageurs
    arb0 = vm.addr(10);
    arb1 = vm.addr(11);
    // dai token
    dai = new TestToken("Dai", "DAI", 1000000e18);
    // set helper labels for traces
    vm.label(owner, "owner");
    vm.label(lip0, "lip0");
    vm.label(lip1, "lip1");
    vm.label(trd0, "trd0");
    vm.label(trd1, "trd1");
    vm.label(arb0, "arb0");
    vm.label(arb1, "arb1");
    vm.label(address(dai), "0-DAI");
    vm.label(address(weth), "1-WETH");
    // give lps, traders, and arbs tokens
    weth.mint(owner, 1000000e18);
    weth.transferFrom(owner, lip0, 1000e18);
    weth.transferFrom(owner, lip1, 1000e18);
    weth.transferFrom(owner, arb0, 1000e18);
    weth.transferFrom(owner, arb1, 1000e18);
    weth.transferFrom(owner, trd0, 5000e18);
    weth.transferFrom(owner, trd1, 5000e18);
    deal(address(dai), owner, 10000e18);
    deal(address(dai), lip0, 10000e18);
    deal(address(dai), lip1, 10000e18);
    deal(address(dai), arb0, 100000e18);
    deal(address(dai), arb1, 100000e18);
    deal(address(dai), trd0, 150000e18);
    deal(address(dai), trd1, 150000e18);
    mineBlocks(1);
    // create TWAMM pool
    pool0 = factory.create(
      address(dai),
      address(weth),
      "DAI/WETH",
      "DAI/WETH",
      1
    );
    vm.label(address(pool0), "pool0");
    mineBlocks(1);
  }

  // [ ]  Zero Liquidity Scenario
  //   1. Mint initial liquidity (or more than one mint)
  //   2. Burn all liquidity
  //   3. Is minimum liquidity still locked up?
  //   4. What happens to operations on the pool? (swap, ltswap)
  function testSpecialManualZeroLiquidityScenario() public {
    // add liquidity to the pool
    addLiquidity(pool0, lip0, lip0, 1000e18, 100e18, 0);
    addLiquidity(pool0, lip1, lip1, 1000e18, 100e18, 0);
    // check prices before trades are executed
    // _reserveCheck(1);
    // burn initial mints liquidity
    uint256 lpTokensMinted0 = ICronV1Pool(pool0).balanceOf(lip0);
    exit(lpTokensMinted0, ICronV1PoolEnums.ExitType.Exit, pool0, lip0);
    // burn LP 1's liquidity, approximately half of the pool
    uint256 lpTokensMinted1 = ICronV1Pool(pool0).balanceOf(lip1);
    exit(lpTokensMinted1, ICronV1PoolEnums.ExitType.Exit, pool0, lip1);
    mineBlocks(1);
    // check minimum liquidity still locked up
    (, uint256 reserve0, uint256 reserve1, , , , , , , , ) = ICronV1Pool(pool0).getVirtualReserves(block.number,
                                                                                                        false);
    // _assertTolerance(reserve0, 1000, 1);
    // _assertTolerance(reserve1, 100, 1);
    assertGt(uint256(reserve0), 1000);
    assertGt(uint256(reserve1), 100);
    // try different swaps and ensure they are issued properly
    ICronV1Pool(pool0).setAdminStatus(address(owner), true);
    ICronV1Pool(pool0).setArbitragePartner(arb0, address(arbPartners));
    // ICronV1Pool(pool0).updateArbitrageList();
    swapPoolAddr(1000, uint256(arb0), ICronV1PoolEnums.SwapType.PartnerSwap, address(dai), pool0, arb0);
    swapPoolAddr(100, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(weth), pool0, arb1);
    swapPoolAddr(1e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(dai), pool0, trd1);
  }

  // [ ]  Initial Mint after huge inactivity
  //   1. Deploy a new pool.
  //   2. Mine a large number of intervals (i.e. 2k or more, OBI = 10)
  //   3. Perform initial mint
  //   4. Can you run a swap? How much gas does it consume?  
  //      (Might be a lot b/c executing virtual orders for intervals from original last virtual order block (LVBO)).

  function testSpecialManualMintAfterLargeInactivityScenario() public {
    // mine 2000 blocks
    mineBlocks(2000);
    testSpecialManualEvenOpposingSwapsNoArbitrage();
  }

  // [ ]  Proceeds Shift Scenario
  //   1. Run an LT swap to completion
  //   2. ST swap to massively move the reserves in the opposite direction.
  //   3. Does this change the expected payout from step #1
  function testSpecialManualEvenLTSwapWithLargeShortTermSwap() public {
    // add liquidity to the pool
    addLiquidity(pool0, lip0, lip0, 1000e18, 100e18, 0);
    addLiquidity(pool0, lip1, lip1, 1000e18, 100e18, 0);
    // give partner status to arbitrageurs
    ICronV1Pool(pool0).setAdminStatus(address(owner), true);
    ICronV1Pool(pool0).setArbitragePartner(arb0, address(arbPartners));
    // ICronV1Pool(pool0).updateArbitrageList();
    // check prices before trades are executed
    // _reserveCheck(1);
    // check trader token balances before trade
    uint preDaiBalTrd0 = dai.balanceOf(trd0);
    // issue two long term swaps in opposing directions for same intervals
    // 1_000 ETH <> 10_000 DAI over 100 blocks
    swapPoolAddr(1000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(weth), pool0, trd0);
    // run 10 iterations
    for (uint i = 0; i < 10; i++) {
      // check prices after 10 blocks are mined
      // _reserveCheck(10);
    }
    mineBlocks(1);
    // ST swap to massively move the reserves in the opposite direction.
    // trade 10000 DAI -> ETH
    swapPoolAddr(10000e18, uint256(arb0), ICronV1PoolEnums.SwapType.PartnerSwap, address(dai), pool0, arb0);
    // withdraw order proceeds for both wallets
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds,,) = ICronV1Pool(pool0).getOrderIds(trd0, 0, maxOrderIds);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd0);
    mineBlocks(1);
    // check trader token balances after trade
    uint postDaiBalTrd0 = dai.balanceOf(trd0);
    // confirm tokens have been transferred to correct wallets
    assertGt(postDaiBalTrd0 - preDaiBalTrd0, 38e14);
  }

  // This test has 2 opposing trades with even amounts 
  // and no arbitrages to correct asset prices.
  // Trader 0: 1K ETH <> 10K DAI
  // Trader 1: 10K DAI <> 1K ETH
  function testSpecialManualEvenOpposingSwapsNoArbitrage() public {
    // add liquidity to the pool
    addLiquidity(pool0, lip0, lip0, 1000e18, 100e18, 0);
    addLiquidity(pool0, lip1, lip1, 1000e18, 100e18, 0);
    // check prices before trades are executed
    // _reserveCheck(1);
    // check trader token balances before trade
    uint preDaiBalTrd0 = dai.balanceOf(trd0);
    uint preWethBalTrd1 = weth.balanceOf(trd1);
    // issue two long term swaps in opposing directions for same intervals
    // 1_000 ETH <> 10_000 DAI over 100 blocks
    swapPoolAddr(1000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(weth), pool0, trd0);
    // 10_000 DAI <> 1_000 ETH over 100 blocks
    swapPoolAddr(10000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(dai), pool0, trd1);
    // run 10 iterations
    // for (uint i = 0; i < 10; i++) {
      // check prices after 10 blocks are mined
      // _reserveCheck(10);
    // }
    mineBlocks(1);
    // withdraw order proceeds for both wallets
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds0,,) = ICronV1Pool(pool0).getOrderIds(trd0, 0, maxOrderIds);
    (uint[] memory orderIds1,,) = ICronV1Pool(pool0).getOrderIds(trd1, 0, maxOrderIds);
    exit(orderIds0[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd0);
    exit(orderIds1[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd1);
    mineBlocks(1);
    // check trader token balances after trade
    uint postDaiBalTrd0 = dai.balanceOf(trd0);
    uint postWethBalTrd1 = weth.balanceOf(trd1);
    // confirm tokens have been transferred to correct wallets
    assertGt(postDaiBalTrd0 - preDaiBalTrd0, 38e14);
    assertGt(postWethBalTrd1 - preWethBalTrd1, 33e15);
  }

  // This test has 2 opposing trades with even amounts 
  // half way through burn half the liquidity
  // and no arbitrages to correct asset prices.
  // Trader 0: 1K ETH <> 10K DAI
  // Trader 1: 10K DAI <> 1K ETH
  function testSpecialManualEvenOpposingSwapsNoArbitrageHalfLiquidity() public {
    // add liquidity to the pool
    addLiquidity(pool0, lip0, lip0, 1000e18, 100e18, 0);
    addLiquidity(pool0, lip1, lip1, 1000e18, 100e18, 0);
    // check prices before trades are executed
    // _reserveCheck(1);
    // check trader token balances before trade
    uint preDaiBalTrd0 = dai.balanceOf(trd0);
    uint preWethBalTrd1 = weth.balanceOf(trd1);
    // issue two long term swaps in opposing directions for same intervals
    // 1_000 ETH <> 10_000 DAI over 100 blocks
    swapPoolAddr(1000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(weth), pool0, trd0);
    // 10_000 DAI <> 1_000 ETH over 100 blocks
    swapPoolAddr(10000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(dai), pool0, trd1);
    // run 5 iterations
    // for (uint i = 0; i < 5; i++) {
      // check prices after 10 blocks are mined
      // _reserveCheck(10);
    // }
    // burn LP 0's liquidity, approximately half of the pool
    uint256 lpTokensMinted = ICronV1Pool(pool0).balanceOf(lip0);
    exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit, pool0, lip0);
    // run 5 iterations
    // for (uint i = 0; i < 5; i++) {
      // check prices after 10 blocks are mined
      // _reserveCheck(10);
    // }
    mineBlocks(1);
    // withdraw order proceeds for both wallets
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds0,,) = ICronV1Pool(pool0).getOrderIds(trd0, 0, maxOrderIds);
    (uint[] memory orderIds1,,) = ICronV1Pool(pool0).getOrderIds(trd1, 0, maxOrderIds);
    exit(orderIds0[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd0);
    exit(orderIds1[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd1);
    mineBlocks(1);
    // check trader token balances after trade
    uint postDaiBalTrd0 = dai.balanceOf(trd0);
    uint postWethBalTrd1 = weth.balanceOf(trd1);
    // confirm tokens have been transferred to correct wallets
    assertGt(postDaiBalTrd0 - preDaiBalTrd0, 38e14);
    assertGt(postWethBalTrd1 - preWethBalTrd1, 33e15);
  }

  // This test has 2 opposing trades with even amounts 
  // and no arbitrages to correct asset prices.
  // burn all the liquidity before withdrawal
  // Trader 0: 1K ETH <> 10K DAI
  // Trader 1: 10K DAI <> 1K ETH
  function testSpecialManualEvenOpposingSwapsNoArbitrageFullLiquidity() public {
    // add liquidity to the pool
    addLiquidity(pool0, lip0, lip0, 1000e18, 100e18, 0);
    addLiquidity(pool0, lip1, lip1, 1000e18, 100e18, 0);
    // check prices before trades are executed
    // _reserveCheck(1);
    // check trader token balances before trade
    uint preDaiBalTrd0 = dai.balanceOf(trd0);
    uint preWethBalTrd1 = weth.balanceOf(trd1);
    // issue two long term swaps in opposing directions for same intervals
    // 1_000 ETH <> 10_000 DAI over 100 blocks
    swapPoolAddr(1000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(weth), pool0, trd0);
    // 10_000 DAI <> 1_000 ETH over 100 blocks
    swapPoolAddr(10000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(dai), pool0, trd1);
    // run 5 iterations
    // for (uint i = 0; i < 10; i++) {
      // check prices after 10 blocks are mined
      // _reserveCheck(10);
    // }
    mineBlocks(1);
    // burn LP 0's liquidity, approximately half of the pool
    uint256 lpTokensMinted0 = ICronV1Pool(pool0).balanceOf(lip0);
    exit(lpTokensMinted0, ICronV1PoolEnums.ExitType.Exit, pool0, lip0);
    // burn LP 1's liquidity, approximately half of the pool
    uint256 lpTokensMinted1 = ICronV1Pool(pool0).balanceOf(lip1);
    exit(lpTokensMinted1, ICronV1PoolEnums.ExitType.Exit, pool0, lip1);
    mineBlocks(1);
    // withdraw order proceeds for both wallets
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds0,,) = ICronV1Pool(pool0).getOrderIds(trd0, 0, maxOrderIds);
    (uint[] memory orderIds1,,) = ICronV1Pool(pool0).getOrderIds(trd1, 0, maxOrderIds);
    exit(orderIds0[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd0);
    exit(orderIds1[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd1);
    mineBlocks(1);
    // check trader token balances after trade
    uint postDaiBalTrd0 = dai.balanceOf(trd0);
    uint postWethBalTrd1 = weth.balanceOf(trd1);
    // confirm tokens have been transferred to correct wallets
    assertGt(postDaiBalTrd0 - preDaiBalTrd0, 38e14);
    assertGt(postWethBalTrd1 - preWethBalTrd1, 66e15);
  }

  // This test has 2 opposing trades with even amounts 
  // and arbitrages to correct asset prices.
  // Trader 0: 1K ETH <> 10K DAI
  // Trader 1: 10K DAI <> 1K ETH
  function testSpecialManualEvenOpposingSwapsArbitrage() public {
    // add liquidity to the pool
    addLiquidity(pool0, lip0, lip0, 1000e18, 100e18, 0);
    addLiquidity(pool0, lip1, lip1, 1000e18, 100e18, 0);
    // give partner status to arbitrageurs
    ICronV1Pool(pool0).setAdminStatus(address(owner), true);
    ICronV1Pool(pool0).setArbitragePartner(arb0, address(arbPartners));
    ICronV1Pool(pool0).setArbitragePartner(arb1, address(arbPartners));
    // ICronV1Pool(pool0).updateArbitrageList();
    // check prices before trades are executed
    // _reserveCheck(1);
    // check trader token balances before trade
    uint preDaiBalTrd0 = dai.balanceOf(trd0);
    uint preWethBalTrd1 = weth.balanceOf(trd1);
    // issue two long term swaps in opposing directions for same intervals
    // 1_000 ETH <> 10_000 DAI over 100 blocks
    swapPoolAddr(1000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(weth), pool0, trd0);
    // 10_000 DAI <> 1_000 ETH over 100 blocks
    swapPoolAddr(10000e18, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(dai), pool0, trd1);
    // run 10 iterations
    for (uint i = 0; i < 10; i++) {
      // check prices after 10 blocks are mined
      // _reserveCheck(10);
      // arbitrage pools to keep reserves in line
      // trade 1000 DAI -> ETH
      swapPoolAddr(1000e18, uint256(arb0), ICronV1PoolEnums.SwapType.PartnerSwap, address(dai), pool0, arb0);
      // trade 100 ETH -> DAI
      swapPoolAddr(100e18, uint256(arb1), ICronV1PoolEnums.SwapType.PartnerSwap, address(weth), pool0, arb1);
    }
    mineBlocks(1);
    // withdraw order proceeds for both wallets
    uint256 maxOrderIds = 100;
    (uint[] memory orderIds0,,) = ICronV1Pool(pool0).getOrderIds(trd0, 0, maxOrderIds);
    (uint[] memory orderIds1,,) = ICronV1Pool(pool0).getOrderIds(trd1, 0, maxOrderIds);
    exit(orderIds0[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd0);
    exit(orderIds1[0], ICronV1PoolEnums.ExitType.Withdraw, pool0, trd1);
    mineBlocks(1);
    // check trader token balances after trade
    uint postDaiBalTrd0 = dai.balanceOf(trd0);
    uint postWethBalTrd1 = weth.balanceOf(trd1);
    // confirm tokens have been transferred to correct wallets
    assertGt(postDaiBalTrd0 - preDaiBalTrd0, 201314795715612579);
    assertGt(postWethBalTrd1 - preWethBalTrd1, 54103595710299444);
  }

  function _reserveCheck(
    uint256 _mineInterval
  ) internal returns (uint112, uint112) {

    // check prices after 10 blocks are mined
    mineBlocks(_mineInterval);
    (, uint256 reserve0, uint256 reserve1, , , , , , , , ) = ICronV1Pool(pool0).getVirtualReserves(block.number,
                                                                                                        false);
    console.log("Block Number", block.number);
    console.log("Reserve0:", reserve0);
    console.log("Reserve1:", reserve1);
    console.log("T0 Price:", reserve0/reserve1);
    console.log("T1 Price:", reserve1/reserve0);
    return (uint112(reserve0), uint112(reserve1));
  }

  function _assertTolerance(uint256 value, uint256 expected, uint256 tolerance) internal {
    assertLe(value, expected+tolerance);
    if (tolerance > expected) {
      assertGe(value, 0);
    } else {
      assertGe(value, expected-tolerance);
    }
  }
}
