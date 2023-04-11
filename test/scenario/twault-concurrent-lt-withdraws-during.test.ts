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
  
describe("LT Swap with withdraw then cancel after",  function () {
  const swapT0Amt40k = scaleUp(40_000n, TOKEN0_DECIMALS)
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
      const swapObjectsT0 = await swapT0.longTerm(swapT0Amt40k, intervals, addr1, doSwap)
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
      poolModel.updateVaultReserves({ reserve0: vaultReserves.reserve0.add(swapT0Amt40k),
                                      reserve1: vaultReserves.reserve1.add(swapT1Amt6k) })
      
      // Note that swap params emmulates the state of the virtual order, but has to use the block
      // number after the order is mined or you get a mismatch
      let blockNumber = await getBlockNumber()
      ltSwapParamsAddr1T0toT1 = PoolModel.getLongTermSwapParameters(BLOCK_INTERVAL,
                                                                    blockNumber,
                                                                    swapT0Amt40k,
                                                                    intervals)
      ltSwapParamsAddr2T1toT0 = PoolModel.getLongTermSwapParameters(BLOCK_INTERVAL,
                                                                    blockNumber,
                                                                    swapT1Amt6k,
                                                                    intervals)
      lastVirtualOrderBlock = blockNumber
      // log.debug("\n\nLVOB:\n" +
      // "================================================================================\n" +
      // `LVBO: ${lastVirtualOrderBlock}\n` +
      // `Current Block: ${await getBlockNumber()}\n\n\n`)

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
  })

  describe ("Long-term swap withdraw checks 1", async function () {
  
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
    it ("should allow the swap user to withdraw funds", async function() {
      await swapT0.withdrawLongTerm()
    })

    it ("should contain correct reserves after mining the withdraw order", async function() {
      // Update modelled values:
      const blockNumber = await getBlockNumber()
      const proceeds = poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                                            ltSwapParamsAddr2T1toT0.sellingRate,
                                                            lastVirtualOrderBlock,
                                                            blockNumber,
                                                            BLOCK_INTERVAL);
      expectProceedsAddr1T1 = proceeds.token1
      expectProceedsAddr2T0 = proceeds.token0
      lastVirtualOrderBlock = blockNumber
      // log.debug("\n\nLVOB:\n" +
      // "================================================================================\n" +
      // `LVBO: ${lastVirtualOrderBlock}\n` +
      // `Current Block: ${await getBlockNumber()}\n\n\n`)

      const { vaultReserves, twammReserves } = poolModel.getAllReserves()
      // The withdraw is the first interaction with the pool to cause virtual order
      // execution. Now we expect to see:
      //    - The twamm reserves gain Swap.MIN_SWAP_AMT and update to show the complete
      //      amount sold to the pool in reserves and the amount exchanged gone
      //      from the pool.
      //    - The twamm reserve state to match the twamm reserves.
      //    - The vault reserves change to gain Swap.MIN_SWAP_AMT and lose the proceeds
      //      of the swap being withdrawn.
      poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                        reserve1: vaultReserves.reserve1.sub(expectProceedsAddr1T1) } )
      poolModel.updateTwammReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                        reserve1: twammReserves.reserve1 } )
      poolModel.updateTwammStateReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                            reserve1: twammReserves.reserve1 } )

      // TODO: Understand the differences below (probably rounding methodology).
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })

    it ("should give the swap customer the correct long-term swap proceeds", async function () {
      let balChangeT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1Addr1)
      let tolerance = DEV_TOLERANCE   // TODO: Understand the difference (probably rounding methodology).
      expect(balChangeT1).to.be.closeTo(expectProceedsAddr1T1,
                                        tolerance,
                                        "LT Swap Customer Didn't Receive Expected T1")
      prevBalT1Addr1 = expectProceedsAddr1T1
    })

    it ("should have the correct fees collected", async function() {
      await checkFees(poolContract, poolModel)
    })

    // // Differs from Check Fees by being independent of the model's calculations
    // // of fees and just using raw math below.
    // it ("should capture the expected balancer protocol fees", async function() {
    //   const feeLTBP = poolModel.getPoolFeeLT()
    //   const expectedFeeT0 = (swapT0Amt40k.mul(feeLTBP)).div(BP)
    //   const expectedBalFeeT0 = (expectedFeeT0.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

    //   const balFeeChangeT0 = (await poolContract.token0BalancerFees()).sub(initialBalFeesToken0)
    //   const tolerance = 0
    //   expect(balFeeChangeT0).to.be.closeTo(expectedBalFeeT0, tolerance)
    // })
  })

  describe ("Long-term swap withdraw checks 2", async function () {
  
    it ("should contain correct reserves about 1/2 way through the order", async function() {
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

    it ("should allow the swap user to withdraw funds", async function() {
      await swapT0.withdrawLongTerm()
    })

    it ("should contain correct reserves after mining the withdraw order", async function() {
      // Update modelled values:
      const blockNumber = await getBlockNumber()
      const proceeds = poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                                            ltSwapParamsAddr2T1toT0.sellingRate,
                                                            lastVirtualOrderBlock,
                                                            blockNumber,
                                                            BLOCK_INTERVAL);
      expectProceedsAddr1T1 = proceeds.token1
      expectProceedsAddr2T0 = proceeds.token0
      lastVirtualOrderBlock = blockNumber
      // log.debug("\n\nLVOB:\n" +
      // "================================================================================\n" +
      // `LVBO: ${lastVirtualOrderBlock}\n` +
      // `Current Block: ${await getBlockNumber()}\n\n\n`)

      const { vaultReserves, twammReserves } = poolModel.getAllReserves()
      // The withdraw is the first interaction with the pool to cause virtual order
      // execution. Now we expect to see:
      //    - The twamm reserves gain Swap.MIN_SWAP_AMT and update to show the complete
      //      amount sold to the pool in reserves and the amount exchanged gone
      //      from the pool.
      //    - The twamm reserve state to match the twamm reserves.
      //    - The vault reserves change to gain Swap.MIN_SWAP_AMT and lose the proceeds
      //      of the swap being withdrawn.
      poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                        reserve1: vaultReserves.reserve1.sub(expectProceedsAddr1T1) } )
      poolModel.updateTwammReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                        reserve1: twammReserves.reserve1 } )
      poolModel.updateTwammStateReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                            reserve1: twammReserves.reserve1 } )

      // TODO: Understand the differences below (probably rounding methodology).
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })

    it ("should give the swap customer the correct long-term swap proceeds", async function () {
      let balChangeT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1Addr1)
      let tolerance = DEV_TOLERANCE   // TODO: Understand the difference (probably rounding methodology).
      expect(balChangeT1).to.be.closeTo(expectProceedsAddr1T1,
                                        tolerance,
                                        "LT Swap Customer Didn't Receive Expected T1")
      prevBalT1Addr1 = expectProceedsAddr1T1.add(prevBalT1Addr1)
    })

    it ("should have the correct fees collected", async function() {
      await checkFees(poolContract, poolModel)
    })

    // // Differs from Check Fees by being independent of the model's calculations
    // // of fees and just using raw math below.
    // it ("should capture the expected balancer protocol fees", async function() {
    //   const feeLTBP = poolModel.getPoolFeeLT()
    //   const expectedFeeT0 = (swapT0Amt40k.mul(feeLTBP)).div(BP)
    //   const expectedBalFeeT0 = (expectedFeeT0.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

    //   const balFeeChangeT0 = (await poolContract.token0BalancerFees()).sub(initialBalFeesToken0)
    //   const tolerance = 0
    //   expect(balFeeChangeT0).to.be.closeTo(expectedBalFeeT0, tolerance)
    // })
  })

  describe ("Long-term swap withdraw checks 3", async function () {
    it ("should contain correct reserves about 3/4 way through the order", async function() {
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

    it ("should allow the swap user to withdraw funds", async function() {
      await swapT0.withdrawLongTerm()
    })

    it ("should contain correct reserves after mining the withdraw order", async function() {
      // Update modelled values:
      const blockNumber = await getBlockNumber()
      const proceeds = poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                                            ltSwapParamsAddr2T1toT0.sellingRate,
                                                            lastVirtualOrderBlock,
                                                            blockNumber,
                                                            BLOCK_INTERVAL);
      expectProceedsAddr1T1 = proceeds.token1
      expectProceedsAddr2T0 = proceeds.token0
      lastVirtualOrderBlock = blockNumber
      // log.debug("\n\nLVOB:\n" +
      // "================================================================================\n" +
      // `LVBO: ${lastVirtualOrderBlock}\n` +
      // `Current Block: ${await getBlockNumber()}\n\n\n`)

      const { vaultReserves, twammReserves } = poolModel.getAllReserves()
      // The withdraw is the first interaction with the pool to cause virtual order
      // execution. Now we expect to see:
      //    - The twamm reserves gain Swap.MIN_SWAP_AMT and update to show the complete
      //      amount sold to the pool in reserves and the amount exchanged gone
      //      from the pool.
      //    - The twamm reserve state to match the twamm reserves.
      //    - The vault reserves change to gain Swap.MIN_SWAP_AMT and lose the proceeds
      //      of the swap being withdrawn.
      poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                        reserve1: vaultReserves.reserve1.sub(expectProceedsAddr1T1) } )
      poolModel.updateTwammReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                        reserve1: twammReserves.reserve1 } )
      poolModel.updateTwammStateReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                            reserve1: twammReserves.reserve1 } )

      // TODO: Understand the differences below (probably rounding methodology).
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })

    it ("should give the swap customer the correct long-term swap proceeds", async function () {
      let balChangeT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1Addr1)
      let tolerance = DEV_TOLERANCE   // TODO: Understand the difference (probably rounding methodology).
      expect(balChangeT1).to.be.closeTo(expectProceedsAddr1T1,
                                        tolerance,
                                        "LT Swap Customer Didn't Receive Expected T1")
      prevBalT1Addr1 = expectProceedsAddr1T1.add(prevBalT1Addr1)
    })

    it ("should have the correct fees collected", async function() {
      await checkFees(poolContract, poolModel)
    })

    // // Differs from Check Fees by being independent of the model's calculations
    // // of fees and just using raw math below.
    // it ("should capture the expected balancer protocol fees", async function() {
    //   const feeLTBP = poolModel.getPoolFeeLT()
    //   const expectedFeeT0 = (swapT0Amt40k.mul(feeLTBP)).div(BP)
    //   const expectedBalFeeT0 = (expectedFeeT0.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

    //   const balFeeChangeT0 = (await poolContract.token0BalancerFees()).sub(initialBalFeesToken0)
    //   const tolerance = 0
    //   expect(balFeeChangeT0).to.be.closeTo(expectedBalFeeT0, tolerance)
    // })
  })

  describe ("Long-term swap withdraw checks after", function () {
    it ("should contain correct reserves after order finished", async function() {
      // Mine 1/4 of the way after the order
      const { swapLengthBlocks } = ltSwapParamsAddr1T0toT1
      const orderBlocks50Pct = Math.floor(swapLengthBlocks / 2)
      await mineBlocks(orderBlocks50Pct)

      // log.debug("\n\nFinal model update:\n" +
      //           "================================================================================\n" +
      //           `Trade Length:  ${ltSwapParamsAddr1T0toT1.swapExpiryBlock - ltSwapParamsAddr1T0toT1.swapStartBlock}\n` +
      //           `Model Update Length: ${ltSwapParamsAddr1T0toT1.swapExpiryBlock - lastVirtualOrderBlock}\n` +
      //           `LVBO: ${lastVirtualOrderBlock}\n` +
      //           `Start Block: ${ltSwapParamsAddr1T0toT1.swapStartBlock}\n` +
      //           `End Block: ${ltSwapParamsAddr1T0toT1.swapExpiryBlock}\n` +
      //           `Current Block: ${await getBlockNumber()}\n\n\n`)
      // Use poolModel's TWAMM approximation for comparison (note, this is not using
      // values from the contract under test):
      const { token0, token1 } =
      await poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                                  ltSwapParamsAddr2T1toT0.sellingRate,
                                                  lastVirtualOrderBlock,
                                                  ltSwapParamsAddr1T0toT1.swapExpiryBlock,
                                                  BLOCK_INTERVAL)
      expectProceedsAddr2T0 = token0
      expectProceedsAddr1T1 = token1

      // Update modelled values:
      const { vaultReserves, twammReserves } = poolModel.getAllReserves()
      
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
      
      // Undo the last change to the model (we need to do this if we haven't executed a
      // virtual order or the model will drift significantly from the contract b/c the
      // results change if you calculate reserves at different points in time)
      poolModel.undo()
    })

  //   it ("should allow the swap user to withdraw funds", async function() {
  //     await swapT0.withdrawLongTerm()
  //   })

  //   it ("should contain correct reserves after mining the withdraw order", async function() {
  //     // Update modelled values:
  //     const blockNumber = await getBlockNumber()
  //     const proceeds = poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
  //                                                           ltSwapParamsAddr2T1toT0.sellingRate,
  //                                                           lastVirtualOrderBlock,
  //                                                           blockNumber,
  //                                                           BLOCK_INTERVAL);
  //     expectProceedsAddr1T1 = proceeds.token1
  //     expectProceedsAddr2T0 = proceeds.token0
  //     lastVirtualOrderBlock = blockNumber

  //     const { vaultReserves, twammReserves } = poolModel.getAllReserves()
  //     // The withdraw is the first interaction with the pool to cause virtual order
  //     // execution. Now we expect to see:
  //     //    - The twamm reserves gain Swap.MIN_SWAP_AMT and update to show the complete
  //     //      amount sold to the pool in reserves and the amount exchanged gone
  //     //      from the pool.
  //     //    - The twamm reserve state to match the twamm reserves.
  //     //    - The vault reserves change to gain Swap.MIN_SWAP_AMT and lose the proceeds
  //     //      of the swap being withdrawn.
  //     poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.add(Swap.MIN_SWAP_AMT),
  //                                      reserve1: vaultReserves.reserve1.sub(expectProceedsAddr1T1) } )
  //     poolModel.updateTwammReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
  //                                      reserve1: twammReserves.reserve1 } )
  //     poolModel.updateTwammStateReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
  //                                           reserve1: twammReserves.reserve1 } )

  //     // TODO: Understand the differences below (probably rounding methodology).
  //     const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
  //     compareReserveData(reserveData)
  //   })

  //   it ("should give the swap customer the correct long-term swap proceeds", async function () {
  //     let balChangeT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1Addr1)
  //     let tolerance = DEV_TOLERANCE   // TODO: Understand the difference (probably rounding methodology).
  //     expect(balChangeT1).to.be.closeTo(expectProceedsAddr1T1,
  //                                       tolerance,
  //                                       "LT Swap Customer Didn't Receive Expected T1")
  //   })

  //   it ("should have the correct fees collected", async function() {
  //     await checkFees(poolContract, poolModel)
  //   })

  //   // // Differs from Check Fees by being independent of the model's calculations
  //   // // of fees and just using raw math below.
  //   // it ("should capture the expected balancer protocol fees", async function() {
  //   //   const feeLTBP = poolModel.getPoolFeeLT()
  //   //   const expectedFeeT0 = (swapT0Amt40k.mul(feeLTBP)).div(BP)
  //   //   const expectedBalFeeT0 = (expectedFeeT0.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

  //   //   const balFeeChangeT0 = (await poolContract.token0BalancerFees()).sub(initialBalFeesToken0)
  //   //   const tolerance = 0
  //   //   expect(balFeeChangeT0).to.be.closeTo(expectedBalFeeT0, tolerance)
  //   // })
  })
})