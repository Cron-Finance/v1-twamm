import { expect } from "chai"

import { ethers, waffle, network } from "hardhat"
import { createSnapshot, restoreSnapshot } from "../helpers/snapshots"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers";

import { Swap,
         SwapManager,
         getNextOrderId,
         VaultTwammPoolAPIHelper } from "../helpers/vaultTwammPoolAPIHelper"
import { PoolModel,
         BP,
         BALANCER_FEE,
         DENOMINATOR_FP18 } from "../model_v1/vaultTwammPool"
import { LTSwapParams } from "../model_v1/types"
import { scaleUp,
         getBlockNumber,
         mineBlocks,
         deployBalancerVault,
         getReserveData,
         compareReserveData,
         checkFees } from "../helpers/misc"
import { deployCommonContracts } from '../common';

// Logging:
const ds = require("../../scripts/utils/debugScopes");
const log = ds.getLog("twault-safety");

// Equal initial liquidity for both token 0 & 1 of 10k tokens (accounting for 18 decimals).
const TOKEN0_DECIMALS = 18;
const TOKEN1_DECIMALS = 18;
const INITIAL_LIQUIDITY_0 = scaleUp(10_000n, TOKEN0_DECIMALS);
const INITIAL_LIQUIDITY_1 = scaleUp(10_000n, TOKEN1_DECIMALS);
const ERC20BatchApproveAmt = ethers.utils.parseUnits( "10000000000" );    // 10B

const DEV_TOLERANCE = 20;   // allowable difference during development

describe("LT Swap with cancel then withdraw after", async function () {
  const swapT0Amt6k = scaleUp(6_000n, TOKEN0_DECIMALS)
  const swapT1Amt6k = scaleUp(6_000n, TOKEN1_DECIMALS)
  let prevBalT1Addr1: BigNumber
  let prevBalT0Addr2: BigNumber
  let ltSwapParamsAddr1T0toT1: LTSwapParams
  let ltSwapParamsAddr2T1toT0: LTSwapParams
  let expectProceedsAddr1T1: BigNumber
  let expectProceedsAddr2T0: BigNumber
  let lastVirtualOrderBlock: number
  let initialBalFeesToken0: BigNumber
  let initialBalFeesToken1: BigNumber
  let swapT0: Swap
  let swapT1: Swap
  let expectedRefundT0: BigNumber
  let expectedProceedsT1: BigNumber
  let blocksElapsedBeforeCancel: number

  let BLOCK_INTERVAL: number
  
  let owner: SignerWithAddress,
      addr1: SignerWithAddress,
      addr2: SignerWithAddress,
      admin1: SignerWithAddress,
      admin2: SignerWithAddress,
      partner1: SignerWithAddress,
      partner2: SignerWithAddress,
      partner3: SignerWithAddress,
      feeAddr1: SignerWithAddress,
      feeAddr2: SignerWithAddress,
      addrs: SignerWithAddress[];

  let poolHelper: VaultTwammPoolAPIHelper;
  let swapMgr: SwapManager;

  let poolModel: PoolModel;
    
  // Contracts for testing into local vars:
  let token0AssetContract: any;
  let token1AssetContract: any;
  let balancerVaultContract: any;
  let poolContract: any;

  before(async function () 
  {
    await createSnapshot(waffle.provider);
    const result = await deployCommonContracts();
    BLOCK_INTERVAL = result.BLOCK_INTERVAL
    owner = result.owner;
    addr1 = result.addr1
    addr2 = result.addr2
    admin1 = result.admin1
    admin2 = result.admin2
    partner1 = result.partner1
    partner2 = result.partner2
    partner3 = result.partner3
    feeAddr1 = result.feeAddr1
    feeAddr2 = result.feeAddr2
    addrs = result.addrs
    poolHelper = result.poolHelper
    swapMgr = result.swapMgr
    poolModel = result.poolModel
    token0AssetContract = result.token0AssetContract
    token1AssetContract = result.token1AssetContract
    balancerVaultContract = result.balancerVaultContract
    poolContract = result.poolContract
  })

    
  after(async function () {
    await restoreSnapshot(waffle.provider);
  })

  describe("Initial liquidity mint checks", function () {
    it ("should mint initial liquidity", async function () {
      await token0AssetContract.connect(owner).transfer(addr1.address, INITIAL_LIQUIDITY_0);
      await token1AssetContract.connect(owner).transfer(addr1.address, INITIAL_LIQUIDITY_1);
      let joinObjects = await poolHelper.getJoinObjects( INITIAL_LIQUIDITY_0, INITIAL_LIQUIDITY_1 );
      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, joinObjects.token0Amt);
      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, joinObjects.token1Amt);
      await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)
      //
      // Provide initial liquidity:
      await balancerVaultContract.connect(addr1).joinPool(
        poolHelper.getPoolId(),
        addr1.address,
        addr1.address,
        joinObjects.joinStruct
      )
      await mineBlocks();

      poolModel.initialMint(addr1.address, INITIAL_LIQUIDITY_0, INITIAL_LIQUIDITY_1)
    })

    it ("should contain the provided liquidity", async function () {
      // Check the results of the initial mint:
      const pr = await poolHelper.getPoolReserves()
      expect(pr.reserve0).to.eq(INITIAL_LIQUIDITY_0);
      expect(pr.reserve1).to.eq(INITIAL_LIQUIDITY_1);
    })

    it ("should have total supply matching geometric mean of the provided liquidity", async function () {
      // Should see the geometric mean of the initial liquidities as the total supply of the pool:
      const lpSupply = await poolContract.totalSupply()
      expect(lpSupply).to.eq(poolModel.getLpTokenSupply())
    })

    it ("should provide correct number of LP tokens to initial liquidity provider", async function () {
      // Should see the first liquidity provider get 1k minus the total supply (the
      // 1k goes to the minimum liquidity div by zero prevention adapted from UNI V2).
      const lpTokensMinted = await poolContract.balanceOf(addr1.address)
      expect(lpTokensMinted).to.eq(poolModel.balanceOfLpToken(addr1.address))
    })

    it ("should have the correct fees collected", async function() {
      await checkFees(poolContract, poolModel)
    })
  })

  describe ("Long-term swap order issuance and setup", async function () {
    it ("should issue the long-term swap orders without error", async function () {
      prevBalT1Addr1 = await token1AssetContract.balanceOf(addr1.address)
      prevBalT0Addr2 = await token0AssetContract.balanceOf(addr2.address)

      swapT0 = swapMgr.newSwap0To1()
      swapT1 = swapMgr.newSwap1To0()
      const intervals = 20     // 20 intervals * 10 OBI ~= 200 blocks (depends on start block)
      const doSwap = false
      const swapObjectsT0 = await swapT0.longTerm(swapT0Amt6k, intervals, addr1, doSwap)
      const swapObjectsT1 = await swapT1.longTerm(swapT1Amt6k, intervals, addr2, doSwap)
      // The approvals are done in the two lines above, which introduces one extra block of mining.
      // That's sufficient to introduce an error of 7e-18 to the balancer fees. Testing and doing
      // the approvals with the mining in a single block makes the error zero. It's likely a precision
      // issue with input rates for blocks vs the lvbo
      
      {
        const {swapStruct, fundStruct, limitOutAmt, deadlineSec} = swapObjectsT0
        await balancerVaultContract.connect(addr1).swap(swapStruct, fundStruct, limitOutAmt, deadlineSec)
      }
      {
        const {swapStruct, fundStruct, limitOutAmt, deadlineSec} = swapObjectsT1
        await balancerVaultContract.connect(addr2).swap(swapStruct, fundStruct, limitOutAmt, deadlineSec)
      }
      await mineBlocks()
      swapT0.setOrderId(getNextOrderId())
      swapT1.setOrderId(getNextOrderId())
      
      // Update the pool model to show the amount deposited into Balancer Vault
      const vaultReserves = poolModel.getVaultReserves()
      poolModel.updateVaultReserves({ reserve0: vaultReserves.reserve0.add(swapT0Amt6k),
                                      reserve1: vaultReserves.reserve1.add(swapT1Amt6k) })
      
      // Note that swap params emmulates the state of the virtual order, but has to use the block
      // number after the order is mined or you get a mismatch
      let blockNumber = await getBlockNumber()
      ltSwapParamsAddr1T0toT1 = PoolModel.getLongTermSwapParameters(BLOCK_INTERVAL,
                                                                    blockNumber,
                                                                    swapT0Amt6k,
                                                                    intervals)
      ltSwapParamsAddr2T1toT0 = PoolModel.getLongTermSwapParameters(BLOCK_INTERVAL,
                                                                    blockNumber,
                                                                    swapT1Amt6k,
                                                                    intervals)
      lastVirtualOrderBlock = blockNumber

      initialBalFeesToken0 = await poolContract.token0BalancerFees()
      initialBalFeesToken1 = await poolContract.token1BalancerFees()
    })

    it ("should contain the correct reserves immediately after mining the order", async function() {
      //  TODO: Add the following checks to this part:
      //          - sales rate
      //          - order direction
      //          - expiry
      //          - Check events for order id
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })
    
    it ("should have the correct fees immediately after mining the order", async function() {
      await checkFees(poolContract, poolModel)
    })
    
    it ("should contain the correct reserves one block after mining the order", async function() {
      // The vault and state reserves remain unchanged, only the view function (twamm reserves)
      // reserves should change.

      await mineBlocks()

      // Use poolModel's TWAMM approximation for comparison (note, this is not using
      // values from the contract under test):
      poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                            ltSwapParamsAddr2T1toT0.sellingRate,
                                            lastVirtualOrderBlock,
                                            await getBlockNumber(),
                                            BLOCK_INTERVAL)
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)

      // Undo the last change to the model (we need to do this if we haven't executed a
      // virtual order or the model will drift significantly from the contract b/c the
      // results change if you calculate reserves at different points in time)
      poolModel.undo()
    })
    
    it ("should contain correct reserves about 1/4 way through the order", async function() {
      // Mine about 1/4 of the way through the order
      const { swapLengthBlocks } = ltSwapParamsAddr1T0toT1
      const orderBlocks25Pct = Math.floor(swapLengthBlocks / 4)
      await mineBlocks(orderBlocks25Pct)

      // Use poolModel's TWAMM approximation for comparison (note, this is not using
      // values from the contract under test):
      poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                            ltSwapParamsAddr2T1toT0.sellingRate,
                                            lastVirtualOrderBlock,
                                            await getBlockNumber(),
                                            BLOCK_INTERVAL)
      
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
      
      // Undo the last change to the model (we need to do this if we haven't executed a
      // virtual order or the model will drift significantly from the contract b/c the
      // results change if you calculate reserves at different points in time)
      poolModel.undo()
    })
  })

  // Long term Swap T0 -> T1
  // Cancel the swap
  // Issue a cancel: T1 -> T0, T1 = 1, T0 = Refund, userData = cancelPart1
  // Issue a cancel withdraw: T0 -> T1, T0 = 1, T1 = Proceeds, userData = cancelPart2
  describe ("Long-term swap cancel part 1, refund unsold tokens", async function () {
    it ("should allow the swap user to cancel the order", async function() {
      await swapT0.cancelLongTerm()
    })

    it ("should contain correct reserves after cancelling the long-term order", async function() {
      // Compute the refund (can't do proceeds--need twamm update algorithm for the proceeds):
      const blockNumber = await getBlockNumber()
      let blocksRemain = ltSwapParamsAddr1T0toT1.swapExpiryBlock - blockNumber
      expectedRefundT0 = ltSwapParamsAddr1T0toT1.sellingRate.mul(BigNumber.from(blocksRemain))
      blocksElapsedBeforeCancel = blockNumber - ltSwapParamsAddr1T0toT1.swapStartBlock

      let blocksElapsed = ltSwapParamsAddr1T0toT1.swapLengthBlocks - blocksRemain
      const expectedSoldT0 = ltSwapParamsAddr1T0toT1.sellingRate.mul(blocksElapsed)

      // Need to update the model after cancel LT swap 0->1 for opposing concurrent swaps, expect:
      //   - vault reserves:  
      //        reserve0: loses refund amount
      //        reserve1: gains 1 to do operation
      //   - state & twamm reserves:
      //        reserve0: gains from the cancelled swap up to last block
      //                  sells proceeds from uncancelled lt swap to reward factor
      //        reserve1: gains 1 to do cancel operation
      //                  gains from the uncancelled lt swap
      //                  sells proceeds from cancelled swap to reward factor
      const amtsOut = poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                                            ltSwapParamsAddr2T1toT0.sellingRate,
                                                            lastVirtualOrderBlock,
                                                            blockNumber,
                                                            BLOCK_INTERVAL);
      expectedProceedsT1 = amtsOut.token1
      lastVirtualOrderBlock = blockNumber
      
      // Update modelled values:
      const { vaultReserves, twammReserves } = poolModel.getAllReserves()

      // The cancel is the first interaction with the pool to cause virtual order execution
      // since this virtual order was placed. We expect to see:
      //    - The vault reserves change to gain minSwapAmt1 and lose the remaining amount 
      //      that would have been sold to the pool.
      //    - The twamm reserves gain minSwapAmt and update to show the partial amount sold
      //      to the pool along with amount exchanged removed from the pool.
      //    - The twamm reserve state to match the twamm reserves.
      //
      poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.sub(expectedRefundT0),
                                      reserve1: vaultReserves.reserve1.add(Swap.MIN_SWAP_AMT) })
      poolModel.updateTwammReserves({ reserve0: twammReserves.reserve0,
                                      reserve1: twammReserves.reserve1.add(Swap.MIN_SWAP_AMT) })
      poolModel.updateTwammStateReserves( { reserve0: twammReserves.reserve0,
                                            reserve1: twammReserves.reserve1.add(Swap.MIN_SWAP_AMT) })

      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })

    // Issue a cancel: T1 -> T0, T1 = 1, T0 = Refund, userData = cancelPart1
    it ("should refund the correct amount after cancelling the long-term order", async function() {
      let balChangeT0 = (await token0AssetContract.balanceOf(addr1.address)).sub(prevBalT0Addr2)  //#AC I don't know which prev balance this is supposed to be
      let tolerance = 0   // TODO: Understand the difference (probably rounding methodology).
      expect(balChangeT0).to.be.closeTo(expectedRefundT0,
                                        tolerance,
                                        "LT Swap Customer Didn't Receive Expected T1 Refund")
    })
    it ("should have the correct fees collected", async function() {
      await checkFees(poolContract, poolModel)
    })

    // Differs from Check Fees by being independent of the model's calculations
    // of fees and just using raw math below.
    // it ("should capture the expected balancer protocol fees", async function() {
    //   const feeLTBP = poolModel.getPoolFeeLT()
    //   const soldAmtT1 = ltSwapParamsAddr1T0toT1.sellingRate.mul(BigNumber.from(blocksElapsedBeforeCancel))
    //   const expectedFeeT1 = (soldAmtT1.mul(feeLTBP)).div(BP)
    //   const expectedBalFeeT1 = (expectedFeeT1.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

    //   const balFeeChangeT1 = (await poolContract.token1BalancerFees()).sub(initialBalFeesToken1)
    //   const tolerance = 1 
    //   expect(balFeeChangeT1).to.be.closeTo(expectedBalFeeT1, tolerance)
    // })
  })

  // Issue a cancel withdraw: T0 -> T1, T0 = 1, T1 = Proceeds, userData = cancelPart2
  describe ("Long-term swap cancel part 2, withdraw partial proceeds", async function () {
    it ("should allow the swap user to withdraw proceeds from the cancelled order", async function() {
      await swapT0.cancelLongTermPart2Proceeds()
    })

    it ("should contain correct reserves after cancelled order partial proceeds withdraw", async function() {
      // Update modelled values:
      const { vaultReserves, twammReserves, twammStateReserves } = poolModel.getAllReserves()

      // Issue a cancel withdraw: T0 -> T1, T0 = 1, T1 = Proceeds, userData = cancelPart2
      // Part 2 of cancellation will present the user with their proceeds from
      // partial sale, here's how we expect to see reserves change.
      //    - The vault reserves change to gain minSwapAmt1 and lose the proceeds from
      //      exchanging the token.
      //    - The twamm reserve state matches the twamm reserves.
      //    - Twamm reserves gain minSwapAmt. Twamm reserves continue to 
      //      reflect the ongoing swap/sale that was not cancelled 
      poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                      reserve1: vaultReserves.reserve1.sub(expectedProceedsT1) })
      poolModel.updateTwammReserves({ reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                      reserve1: twammReserves.reserve1 })
      poolModel.updateTwammStateReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                            reserve1: twammReserves.reserve1 })

      poolModel.twammReserveConcurrentSwap(BigNumber.from(0),
                                            ltSwapParamsAddr2T1toT0.sellingRate,
                                            lastVirtualOrderBlock,
                                            await getBlockNumber(),
                                            BLOCK_INTERVAL)

      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
      
    })

    it ("should transfer the correct partial proceeds after cancelling the long-term order", async function() {
      let balChangeT0 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT0Addr2)
      // prevBalT0Addr2 = await token0AssetContract.balanceOf(addr2.address)
      let tolerance = 5   // TODO: Understand the difference (probably rounding methodology).
      expect(balChangeT0).to.be.closeTo(expectedProceedsT1,
                                        tolerance,
                                        "LT Swap Customer Didn't Receive Expected T0 Proceeds")
    })
  })
})