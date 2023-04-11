/**
 * IMPORTANT: Test Philosophy for this Safety Regression
 * 
 * All comparison to values in the pool should be calculated independently from the pool's values and
 * functions to ensure an independent confirmation of results and results within tolerances specified.
 * 
 * This is accomplished by using the PoolModel class, which provides a lightweight model of the pool
 * values and basic operations (i.e. CPAMM arithmetic based verification of isolated single sided LT swaps).
 * 
 * IMPORTANT: These tests are meant to be run in order. Do not change their order or results may
 *            become invalid / incorrect.
 *
 */
import { expect } from "chai"

import { ethers, waffle } from "hardhat"
import { createSnapshot, restoreSnapshot } from "./helpers/snapshots"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers";

import { ReserveType, TokenPairAmtType, OracleState } from "./helpers/types"
import { clearNextOrderId,
         Swap,
         SwapManager,
         getNextOrderId,
         VaultTwammPoolAPIHelper} from "./helpers/vaultTwammPoolAPIHelper"
import { PoolModel,
         BP,
         BALANCER_FEE,
         DENOMINATOR_FP18 } from "./model_v2/vaultTwammPool"
import { LTSwapParams } from "./model_v1/types"
import { scaleUp,
         getLastBlockNumber,
         mineBlocks,
         getReserveData,
         compareReserveData,
         checkFees, 
         getBalanceData,
         testBalanceData} from "./helpers/misc"      
import { PoolType, ParamType } from "../scripts/utils/contractMgmt"

import { deployCommonContracts } from './common';
import { BalMath } from "./model_v1/math";

// Logging:
const ds = require("../scripts/utils/debugScopes");
const log = ds.getLog("twault-safety");

const NULL_ADDR = "0x0000000000000000000000000000000000000000";
const ZERO = BigNumber.from(0)

const MAX_100_RESULTS = BigNumber.from(100)

// Equal initial liquidity for both token 0 & 1 of 10k tokens (accounting for 18 decimals).
const TOKEN0_DECIMALS = 18;
const TOKEN1_DECIMALS = 18;
const INITIAL_LIQUIDITY_0 = scaleUp(10_000n, TOKEN0_DECIMALS);
const INITIAL_LIQUIDITY_1 = scaleUp(10_000n, TOKEN1_DECIMALS);

const DEV_TOLERANCE = 20;   // allowable difference during development

function boolToBN(value: boolean): BigNumber {
  return (value) ? BigNumber.from(1) : ZERO;
}

function ratiosNearlyEqual(numeratorA: BigNumber,
                           denominatorA: BigNumber,
                           numeratorB: BigNumber,
                           denominatorB: BigNumber,
                           tolerance = BigNumber.from(1_000_000_000_000_000_000n) // 1e18
                          ): boolean
{
  // Integer comparison to find out if two ratios are within 1/tolerance of eachother, from:
  //
  //    |  numeratorA       numeratorB  |          1
  //    | ------------  -  ------------ |  <=  ---------
  //    | denominatorA     denominatorB |      tolerance
  //
  return tolerance.mul((numeratorA.mul(denominatorB)).sub(numeratorB.mul(denominatorA)).abs())
         .lte(denominatorA.mul(denominatorB))
}

describe("TWAULT (TWAMM Balancer Vault) Regression Safety Suite", function ()
{
  let owner: SignerWithAddress,
      addr1: SignerWithAddress,
      addr2: SignerWithAddress,
      addr3: SignerWithAddress,
      admin1: SignerWithAddress,
      admin2: SignerWithAddress,
      partnerBloxRoute: SignerWithAddress,
      partnerX: SignerWithAddress,
      arbitrageur1: SignerWithAddress,
      arbitrageur2: SignerWithAddress,
      arbitrageur3: SignerWithAddress,
      arbitrageur4: SignerWithAddress,
      arbitrageur5: SignerWithAddress,
      feeAddr1: SignerWithAddress,
      feeAddr2: SignerWithAddress,
      addrs: SignerWithAddress[];

  let oracleSamples: OracleState[]

  let poolHelper: VaultTwammPoolAPIHelper;
  let swapMgr: SwapManager;

  let poolModel: PoolModel;
    
  // Contracts for testing into local vars:
  let token0AssetContract: any;
  let token1AssetContract: any;
  let balancerVaultContract: any;
  let poolContract: any;
  let arbitrageListContract: any;
  let arbitrageListContract2: any;

  let BLOCK_INTERVAL: number

  const getVaultBalances = async(): Promise<TokenPairAmtType> => {
    const t0Data = await balancerVaultContract.getPoolTokenInfo(poolHelper.getPoolId(),
                                                                token0AssetContract.address)
    const t1Data = await balancerVaultContract.getPoolTokenInfo(poolHelper.getPoolId(),
                                                                token1AssetContract.address)
    return {
      token0: t0Data.cash.add(t0Data.managed),
      token1: t1Data.cash.add(t1Data.managed)
    }
  }

  // Reserve variables for testing
  // let vpr: ReserveType;     // Vault Pool Reserves (What balancer thinks the pool's reserves are).
  // let psr: ReserveType;     // Pool State Reserves (The last reserves written to the pool's state).
  // let pr: ReserveType;      // Pool Reserves (The pool's notion of the reserves after executing virtual orders).

  // TODO: move this method to an appropriate file / area
  const dumpContractAccounting = async(tag?: string): Promise<any> =>
  {
    const _tag = (tag==undefined) ? '' : `(${tag})`
    const vaultBalances = await getVaultBalances();
    const viewReserves = await _getReserveAmounts(poolContract)
    
    const orders = await poolContract.getOrderAmounts();
    const proceeds = await poolContract.getProceedAmounts();
    const balancerFees = await poolContract.getBalancerFeeAmounts();
    const cronFiFees = await poolContract.getCronFeeAmounts();

    const salesRates = await poolContract.getSalesRates();
    
    const token0TwammRes = vaultBalances.token0.sub(
                              orders.orders0U112.add(
                                proceeds.proceeds0U112.add(
                                  balancerFees.balFee0U96.add(
                                    cronFiFees.cronFee0U96))));

    const token1TwammRes = vaultBalances.token1.sub(
                              orders.orders1U112.add(
                                proceeds.proceeds1U112.add(
                                  balancerFees.balFee1U96.add(
                                    cronFiFees.cronFee1U96))));

    log.debug(`\nPool Accounting State: ${_tag}\n` +
              `--------------------------------------------------\n` +
              `Block Num:             ${await getLastBlockNumber()}\n` +
              `LP supply:             ${await poolContract.totalSupply()}\n` +
              `Vault Reserve0:        ${vaultBalances.token0}\n` +
              `Vault Reserve1:        ${vaultBalances.token1}\n` +
              `Orders T0:             ${orders.orders0U112}\n` +
              `Orders T1:             ${orders.orders1U112}\n` +
              `Proceeds T0:           ${proceeds.proceeds0U112}\n` +
              `Proceeds T1:           ${proceeds.proceeds1U112}\n` +
              `Twamm Diff Reserve0:   ${await token0TwammRes}\n` +
              `Twamm Diff Reserve1:   ${await token1TwammRes}\n` +
              `Twamm View Reserve0:   ${viewReserves.reserve0}\n` +
              `Twamm View Reserve1:   ${viewReserves.reserve1}\n` +
              `Collect Balancer Fees: ${await poolContract.isCollectingBalancerFees()}\n` +
              `Balancer Fees0:        ${balancerFees.balFee0U96}\n` +
              `Balancer Fees1:        ${balancerFees.balFee1U96}\n` +
              `CronFi Fees0:          ${cronFiFees.cronFee0U96}\n` +
              `CronFi Fees1:          ${cronFiFees.cronFee1U96}\n` +
              `Sales Rate 0:          ${salesRates.salesRate0U112}\n` +
              `Sales Rate 1:          ${salesRates.salesRate1U112}\n`)
  }

  const dumpOracleCompare = (start: OracleState, end: OracleState, tag?: string) => {
    const _tag = (tag==undefined) ? '' : `(${tag})`
    const tsDiff = end.timeStampSec.sub(start.timeStampSec);
    log.debug(`\nOracle Diff: ${_tag}\n` +
              `--------------------------------------------------\n` +
              `start:\n` +
              `    p0=${start.p0}\n` +
              `    p1=${start.p1}\n` +
              `    ts=${start.timeStampSec}\n` +
              `\n` +
              `end:\n` +
              `    p0=${end.p0}\n` +
              `    p1=${end.p1}\n` +
              `    ts=${end.timeStampSec}\n` +
              `\n` +
              `diff:\n`+
              `    end-start p0=${end.p0.sub(start.p0)}\n` +
              `    end-start p1=${end.p1.sub(start.p1)}\n` +
              `    end-start ts=${tsDiff}\n` +
              `\n` +
              `avg:\n`+
              `    avg p0=${(end.p0.sub(start.p0)).div(tsDiff)}\n` +
              `    avg p1=${(end.p1.sub(start.p1)).div(tsDiff)}\n`);
  }

  const sampleOracle = async(): Promise<OracleState> => {
    const { timestamp, token0U256F112, token1U256F112 } = await poolContract.getPriceOracle()
    const oracle = {
      p0: token0U256F112,
      p1: token1U256F112,
      timeStampSec: timestamp
    }
    oracleSamples.push(oracle)

    return oracle
  }

  // Converts types
  const _getReserveAmounts = async(poolContract: any, blockNumber?: number): Promise<ReserveType> => {
    blockNumber = (blockNumber != undefined) ? blockNumber : await getLastBlockNumber();
    const vrResult = await poolContract.callStatic.getVirtualReserves(blockNumber, false)
    return {
      reserve0: vrResult.token0ReserveU112,
      reserve1: vrResult.token1ReserveU112
    }
  }

  before(async function () 
  {
    clearNextOrderId()
    await createSnapshot(waffle.provider);
    const result = await deployCommonContracts();
    BLOCK_INTERVAL = result.BLOCK_INTERVAL
    owner = result.owner;
    addr1 = result.addr1
    addr2 = result.addr2
    addr3 = result.addr3
    admin1 = result.admin1
    admin2 = result.admin2
    partnerBloxRoute = result.partnerBloxRoute
    partnerX = result.partnerX,
    arbitrageur1 = result.arbitrageur1
    arbitrageur2 = result.arbitrageur2
    arbitrageur3 = result.arbitrageur3
    arbitrageur4 = result.arbitrageur4
    arbitrageur5 = result.arbitrageur5
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
    arbitrageListContract = result.arbitrageListContract
    arbitrageListContract2 = result.arbitrageListContract2

    oracleSamples = []
  })

  after(function () {
    restoreSnapshot(waffle.provider);
  })

  describe("Initialization checks", function() {
    it ("should initially have last virtual order block = 0", async function() {
      const lvob = await poolContract.getLastVirtualOrderBlock()
      expect(lvob).to.eq(0,
        "Last virtual order block should be zero before initial join."
      )
    })

    it ("should have zero values for price oracles before initial join", async function() {
      const oracle = await sampleOracle()

      expect(oracle.p0).to.equal(ZERO)
      expect(oracle.p1).to.equal(ZERO)
      expect(oracle.timeStampSec).to.equal(ZERO)
    })
  })

  describe("Initial liquidity join checks", function () {
    it ("should join / mint initial liquidity", async function () {
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
    
    it ("should have initial liquidity values in price oracles after initial join", async function() {
      const oracle = await sampleOracle()
      
      expect(oracle.p0).to.eq(0)
      expect(oracle.p1).to.eq(0)
    })

    it ("should contain the provided liquidity", async function () {
      // Check the results of the initial join:
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

  describe ("Basic short-term swap checks", function () {
    let reserveSample: ReserveType

    describe ("Swap 1k Token 0 for Token 1", function () {
      let prevBalT1: BigNumber
      let expectedProceedsT1: BigNumber

      it ("should have the same oracle timestamp still", async function() {
        const lastTimeStampSec = oracleSamples[oracleSamples.length - 1].timeStampSec

        const startOracle = await sampleOracle()
        expect(startOracle.timeStampSec).to.eq(
          lastTimeStampSec,
          "Oracle timestamp should not have changed"
        )
      })

      it ("should perform the swap without error", async function() {
        prevBalT1 = await token1AssetContract.balanceOf(addr1.address)

        // Capture the reserves and timestamp for later comparison to
        // Oracle values (oracles capture the reserves before a transaction)
        reserveSample = await _getReserveAmounts(poolContract)
        
        const swapAmt1k = scaleUp(1_000n, TOKEN0_DECIMALS)
        const swap = swapMgr.newSwap0To1()
        await swap.shortTerm(swapAmt1k, addr1)
        
        expectedProceedsT1 = poolModel.swap0To1(swapAmt1k)
      })

      it ("should contain the correct reserves", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })
      
      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
      
      it ("should give the swap customer the correct proceeds", async function() {
        let balChangeT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1)
        let tolerance = DEV_TOLERANCE
        expect(balChangeT1).to.be.closeTo(expectedProceedsT1, tolerance)
      })

      it ("should have the correct fees collected", async function() {
        await checkFees(poolContract, poolModel)
      })

      it ("should have correct oracle price updates", async function() {
        // Manual Oracle Value Calculation Using Last Sample
        const lastSample = oracleSamples[oracleSamples.length - 1]
        const oracle = await sampleOracle()

        const timeElapsedSec = oracle.timeStampSec.sub(lastSample.timeStampSec)
        const p0 = lastSample.p0.add( ((reserveSample.reserve1.shl(112))
                                       .div(reserveSample.reserve0)).mul(timeElapsedSec) )
        const p1 = lastSample.p1.add( ((reserveSample.reserve0.shl(112))
                                       .div(reserveSample.reserve1)).mul(timeElapsedSec) )

        const roundingTolerance = BigNumber.from(1)
        expect(oracle.p0).to.be.closeTo(p0, roundingTolerance)
        expect(oracle.p1).to.be.closeTo(p1, roundingTolerance)
      })

      it ("should have the correct oracle average price", async function() {
        // The price is not yet changed in the oracle and thus the 
        // price wrt to each token should be 1:

        const secondLastSample = oracleSamples[oracleSamples.length - 2]
        const lastSample = oracleSamples[oracleSamples.length - 1]

        const timeElapsed = lastSample.timeStampSec.sub(secondLastSample.timeStampSec)
        const avgP0 = ((lastSample.p0.sub(secondLastSample.p0)).div(timeElapsed)).shr(112)
        const avgP1 = ((lastSample.p1.sub(secondLastSample.p1)).div(timeElapsed)).shr(112)

        expect(avgP0).to.eq(1,
          "Equal asset pool unchanged should have average price wrt to opposing token = 1"
        )
        expect(avgP1).to.eq(1,
          "Equal asset pool unchanged should have average price wrt to opposing token = 1"
        )
      })
    })

    describe ("Swap 0.00000003 Token 1 for Token 0", function () {
      let prevBalT0: BigNumber
      let expectedProceedsT0: BigNumber

      it ("should perform the swap without error", async function() {
        prevBalT0 = await token0AssetContract.balanceOf(addr1.address)
        
        // Capture the reserves and timestamp for later comparison to
        // Oracle values (oracles capture the reserves before a transaction)
        reserveSample = await _getReserveAmounts(poolContract)

        const swapAmt3em8 = scaleUp(3n, TOKEN1_DECIMALS-8)  // 8th decimal place in 18 decimals means scale
                                                            // to up 10 decimals.
                                                            // This use case is BTC (8 decimal places)
        const swap = swapMgr.newSwap1To0()
        const swapObjects = await swap.shortTerm(swapAmt3em8, addr1)

        expectedProceedsT0 = poolModel.swap1To0(swapAmt3em8)
      })

      it ("should contain the correct reserves", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
       
      it ("should give the swap customer the correct proceeds", async function() {
        let balChangeT0 = (await token0AssetContract.balanceOf(addr1.address)).sub(prevBalT0)
        let tolerance = DEV_TOLERANCE
        expect(balChangeT0).to.be.closeTo(expectedProceedsT0, tolerance)
      })

      it ("should have the correct fees collected", async function() {
        await checkFees(poolContract, poolModel)
      })

      it ("should have correct oracle price updates", async function() {
        // Manual Oracle Value Calculation Using Last Sample
        const lastSample = oracleSamples[oracleSamples.length - 1]
        const oracle = await sampleOracle()

        const timeElapsedSec = oracle.timeStampSec.sub(lastSample.timeStampSec)
        const p0 = lastSample.p0.add( ((reserveSample.reserve1.shl(112))
                                       .div(reserveSample.reserve0)).mul(timeElapsedSec) )
        const p1 = lastSample.p1.add( ((reserveSample.reserve0.shl(112))
                                       .div(reserveSample.reserve1)).mul(timeElapsedSec) )

        const roundingTolerance = BigNumber.from(1)
        expect(oracle.p0).to.be.closeTo(p0, roundingTolerance)
        expect(oracle.p1).to.be.closeTo(p1, roundingTolerance)
      })
    })
  })

  describe ("Basic long-term swap checks", function () {
    describe("Swap 40k Token 0 for Token 1 in 4 intervals", function () {
      const swapAmt40k = scaleUp(40_000n, TOKEN0_DECIMALS)
      let prevBalT1: BigNumber
      let swapParams: LTSwapParams
      let lastVirtualOrderBlock: number
      let initialBalFeesToken0: BigNumber
      let swap: Swap
      let orderMineBlock: number
      let ltSwapProceedsPart1: any

      it ("should issue the long-term swap order without error", async function() {
        prevBalT1 = await token1AssetContract.balanceOf(addr1.address)

        let intervals = 4
        swap = swapMgr.newSwap0To1()
        const swapObjects = await swap.longTerm(swapAmt40k, intervals, addr1)

        // Note that swap params emmulates the state of the virtual order, but has to use the block
        // number after the order is mined or you get a mismatch
        orderMineBlock= await getLastBlockNumber()

        // Update the pool model to show the amount deposited into Balancer Vault
        swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, orderMineBlock, swapAmt40k, intervals)
        lastVirtualOrderBlock = orderMineBlock

        // Capture the current contract fees to do a simple sanity check for correctness.
        const balancerFees = await poolContract.getBalancerFeeAmounts()
        initialBalFeesToken0 = balancerFees.balFee0U96
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

      it ("should show the correct next order id and orders for addr1", async function() {
        const nextOrderId = await poolContract.getOrderIdCount()
        expect(nextOrderId).to.eq(BigNumber.from(1))

        const result = await poolContract.getOrderIds(addr1.address, ZERO, MAX_100_RESULTS)
        expect(result.numResults).to.eq(1)
        expect(result.orderIds.length).to.eq(MAX_100_RESULTS) 
        expect(result.orderIds[0]).to.eq(BigNumber.from(0))
        const orderInfo = await poolContract.connect(addr1).getOrder(result.orderIds[0])
        expect(orderInfo.owner).to.eq(addr1.address)
        expect(orderInfo.token0To1).to.eq(true)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
       
      it ("should have the correct fees immediately after mining the order", async function() {
        await checkFees(poolContract, poolModel)
      })
      
      it ("should contain the correct reserves one block after mining the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.
        await mineBlocks()

        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                             BigNumber.from(0),
                                             lastVirtualOrderBlock,
                                             await getLastBlockNumber(),
                                             BLOCK_INTERVAL)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })

      it ("should contain correct reserves about half way through the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.

        // Mine about 1/2 way through the rest of the order:
        const blockNumber = await getLastBlockNumber()
        let numBlocksToMine = Math.floor((swapParams.swapExpiryBlock - blockNumber) / 2)
        await mineBlocks(numBlocksToMine)
        
        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                             BigNumber.from(0),
                                             lastVirtualOrderBlock,
                                             await getLastBlockNumber(),
                                             BLOCK_INTERVAL)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })

// Commented out describe block b/c out-of-order execution due to async. TODO:
// remedy or remove.
//      describe("Get sales rate ending testing", async function() {
        it ("should return the sales rate at the order end", async function() {
          const expiryBlock = swapParams.swapExpiryBlock;
          const {salesRateEndingPerBlock0U112, salesRateEndingPerBlock1U112} =
            await poolContract.getSalesRatesEndingPerBlock(expiryBlock);

          expect(salesRateEndingPerBlock0U112).to.eq(
            swapParams.sellingRate,
            "Sales rate ending at expiry should equal the order sales rate."
          )
        })

        it ("should return zero at other times", async function() {
          const expiryBlock = swapParams.swapExpiryBlock;
          const before = await poolContract.getSalesRatesEndingPerBlock(expiryBlock-1);
          const after= await poolContract.getSalesRatesEndingPerBlock(expiryBlock+1);

          expect(before.salesRateEndingPerBlock0U112).to.eq(
            ZERO, "Sales rate not ending at expiry should be zero.")
          expect(before.salesRateEndingPerBlock1U112).to.eq(
            ZERO, "Sales rate not ending at expiry should be zero.")
          expect(after.salesRateEndingPerBlock0U112).to.eq(
            ZERO, "Sales rate not ending at expiry should be zero.")
          expect(after.salesRateEndingPerBlock1U112).to.eq(
            ZERO, "Sales rate not ending at expiry should be zero.")
        })
//      })

// Commented out describe block b/c out-of-order execution due to async. TODO:
// remedy or remove.
//      describe("Advanced getVirtualReserves testing", async function() {
        it ("should return the current block data if the lvob is specified", async function() {
          const lvob = await poolContract.getLastVirtualOrderBlock();
          const currentBlock = await getLastBlockNumber()

          const atLVOB = await poolContract.callStatic.getVirtualReserves(lvob, false);
          const atCurr = await poolContract.callStatic.getVirtualReserves(currentBlock, false);

          expect(lvob).to.not.eq(
            currentBlock, 
            "Last virtual order block should not be the current block after mining."
          )

          expect(atLVOB.blockNumber).to.eq(currentBlock, 
            "Asking for reserves at the LVOB should return the current block's reserves",
          )

          expect(atLVOB.blockNumber).to.eq(atCurr.blockNumber)
          expect(atLVOB.token0ReserveU112).to.eq(atCurr.token0ReserveU112);
          expect(atLVOB.token1ReserveU112).to.eq(atCurr.token1ReserveU112);
        })

        it ("should reflect the sales rate minus fee difference in consecutive blocks", async function() {
          const currentBlock = await getLastBlockNumber()
          const atMineP1 = await poolContract.callStatic.getVirtualReserves(orderMineBlock + 1, false);
          const atMineP2 = await poolContract.callStatic.getVirtualReserves(orderMineBlock + 2, false);

          const salesRateT0 = swapParams.sellingRate
          const grossFee = (150n * salesRateT0.toBigInt()) / 100000n
          const balancerFee = grossFee / 2n
          const expectedDifference = salesRateT0.sub(balancerFee)

          expect(atMineP1.blockNumber).to.eq(orderMineBlock+1)
          expect(atMineP2.blockNumber).to.eq(orderMineBlock+2)

          expect(atMineP2.token0ReserveU112).to.be.closeTo(
            atMineP1.token0ReserveU112.add(expectedDifference), 
            1, // tolerance
            "reserve0 one block apart should differ by the sales rate minus balancer fees"
          )
        })
        
        it ("should return the current block data if a future block is specified", async function() {
          const currentBlock = await getLastBlockNumber()
          const futureBlock = currentBlock + 1;

          const atCurr = await poolContract.callStatic.getVirtualReserves(currentBlock, false);
          const atFutr = await poolContract.callStatic.getVirtualReserves(futureBlock, false);

          expect(atFutr.blockNumber).to.eq(currentBlock, 
            "Asking for reserves in the future should return the current block's reserves",
          )

          expect(atFutr.blockNumber).to.eq(atCurr.blockNumber)
          expect(atFutr.token0ReserveU112).to.eq(atCurr.token0ReserveU112);
          expect(atFutr.token1ReserveU112).to.eq(atCurr.token1ReserveU112);
        })
//      })

// Commented out describe block b/c out-of-order execution due to async. TODO:
// remedy or remove.
//      describe ("Advanced Oracle testing", async function() {
        it ("should have correct oracle prices after executeVirtualOrdersToBlock (< current block)", async function() {
          // Grab the current state of the oracle:
          //
          let oracle = await sampleOracle();
          let lvob = await poolContract.getLastVirtualOrderBlock();

          // Execute virtual orders to the next block:
          //
          let nextBlock = lvob.add(1);
          const reservesAtBlock = await poolContract.callStatic.getVirtualReserves(nextBlock, false)
          expect(reservesAtBlock.blockNumber).to.eq(nextBlock,
            "Virtual reserves retrieved for the wrong block.");
          await poolContract.executeVirtualOrdersToBlock(nextBlock);
          
          await mineBlocks();

          // Grab the updated state of the oracle and ensure correct results:
          //
          let oracle2 = await sampleOracle();
          let lvob2 = await poolContract.getLastVirtualOrderBlock();

          expect(lvob2).to.be.eq(nextBlock,
            "The last virtual order block should be the last block EVO was run to.")
          expect(oracle2.timeStampSec).to.be.eq(oracle.timeStampSec.add(12),
            "Time stamps should be 12 sec. apart for consecutive blocks.");

          // Calculate the expected price difference of the oracle:
          //
          const expectedP0 =
            oracle.p0.add(
              ((reservesAtBlock.token1ReserveU112.shl(112))
               .div(reservesAtBlock.token0ReserveU112))
              .mul(12)
            )
          const expectedP1 = 
            oracle.p1.add(
              ((reservesAtBlock.token0ReserveU112.shl(112))
               .div(reservesAtBlock.token1ReserveU112))
              .mul(12)
            )
          expect(oracle2.p0).to.eq(expectedP0)
          expect(oracle2.p1).to.eq(expectedP1)

          // Update the model to match the EVO to block call on the pool
          // contract above:
          //
          ltSwapProceedsPart1 = poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                                                     BigNumber.from(0),
                                                                     lastVirtualOrderBlock,
                                                                     nextBlock,
                                                                     BLOCK_INTERVAL)
          lastVirtualOrderBlock = nextBlock
        })

        it ("should contain correct reserves after EVO to block", async function() {
          poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                               BigNumber.from(0),
                                               lastVirtualOrderBlock,
                                               await getLastBlockNumber(),
                                               BLOCK_INTERVAL)

          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)

          poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
        })

//      })

      it ("should contain correct reserves all the way through the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.

        // Mine through the rest of the order:
        const blockNumber = await getLastBlockNumber()
        let numBlocksToMine = swapParams.swapExpiryBlock - blockNumber
        await mineBlocks(numBlocksToMine)
        
        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                             BigNumber.from(0),
                                             lastVirtualOrderBlock,
                                             swapParams.swapExpiryBlock,
                                             BLOCK_INTERVAL)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
        
        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })

      describe ("Long-term swap withdraw checks", function () {
        let expectedProceedsT1: BigNumber
        let initialVaultReserveT0: BigNumber

        it ("should allow the swap user to withdraw funds", async function() {
          const vaultBalances = await getVaultBalances();
          initialVaultReserveT0 = vaultBalances.token0;

          await swap.withdrawLongTerm()
        })

        it ("should contain correct reserves after mining the withdraw order", async function() {
          // Update modelled values:
          const ltSwapProceedsPart2 = 
            poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                                 BigNumber.from(0),
                                                 lastVirtualOrderBlock,
                                                 swapParams.swapExpiryBlock,
                                                 BLOCK_INTERVAL)
          expectedProceedsT1 = ltSwapProceedsPart1.token1.add(ltSwapProceedsPart2.token1)
          
          const { vaultReserves } = poolModel.getAllReserves()
          const proceeds = poolModel.getProceeds() 
          // The withdraw is the second interaction with the pool since the
          // initial order and the first since the executeVirtualOrdersToBlock
          // call above. Now we expect to see:
          //    - The vault reserves change to gain Swap.MIN_SWAP_AMT and lose the proceeds
          //      of the swap being withdrawn.
          //    - The proceeds accounting drained of the proceeds received
          //    - The twamm reserves gain Swap.MIN_SWAP_AMT and update to show the complete
          //      amount sold to the pool in reserves and the amount exchanged gone
          //      from the pool. (No update needed here - it's implicit for differential reserves).
          poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                           reserve1: vaultReserves.reserve1.sub(expectedProceedsT1) } )
          poolModel.updateProceeds( { token0: proceeds.token0,
                                      token1: proceeds.token1.sub(expectedProceedsT1) } )
          poolModel.remitBalancerFees();
          
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
         
        it ("should give the swap customer the correct long-term swap proceeds", async function () {
          let balChangeT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1)
          let tolerance = DEV_TOLERANCE
          expect(balChangeT1).to.be.closeTo(expectedProceedsT1,
                                            tolerance,
                                            "LT Swap Customer Didn't Receive Expected T1")
        })

        it ("should have the correct fees collected", async function() {
          await checkFees(poolContract, poolModel)
        })

        // Differs from Check Fees by being independent of the model's calculations
        // of fees and just using raw math below.
        it ("should capture the expected balancer protocol fees", async function() {
          const feeLTBP = poolModel.getPoolFeeLT()
          const expectedFeeT0 = (swapAmt40k.mul(feeLTBP)).div(BP)
          const expectedBalFeeT0 = (expectedFeeT0.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

          // Balancer fees are remitted when the LT swap is withdrawn and the
          // pool state zeros the balancer fees counted. To figure out how much
          // balancer fee T0 was removed, we need to apply the following
          // equation:
          //
          //   totalBalFeeT0 = vaultReserveT0[before] - vaultReserveT0[after]
          //
          // To fiture out how much balancer fee was computed for the LT trade,
          // we need to apply the following equation:
          //
          //   balFeeTradeLT_T0 = totalBalFeeT0 + initialBalFeesToken0
          //
          const vaultBalances = await getVaultBalances();
          const balFeeTradeT0 = initialVaultReserveT0.sub(vaultBalances.token0.add(initialBalFeesToken0));
          const tolerance = 4
          expect(balFeeTradeT0).to.be.closeTo(expectedBalFeeT0, tolerance)
        })
        
        it ("should contain zero balancer fees", async function() {
          const balancerFees = await poolContract.getBalancerFeeAmounts()
          expect(balancerFees.balFee0U96).to.eq(ZERO);
          expect(balancerFees.balFee1U96).to.eq(ZERO);
        })
      })
    })

    describe("Swap 0.000,000,000,007 Token 1 for Token 0 in 6 intervals", function () {
      const swapAmt7em12 = scaleUp(7n, TOKEN1_DECIMALS-12)    // 12th decimal place means scale up 6 decimals
                                                              // This use case is largely impractical but 
                                                              // exercises small number capabilites
      let prevBalT0: BigNumber
      let prevBalT1: BigNumber
      let swapParams: LTSwapParams
      let lastVirtualOrderBlock: number
      let blocksElapsedBeforeCancel: number
      let initialBalFeesToken1: number
      let swap: Swap

      it ("should have the correct fees collected before mining the transaction", async function() {
        await checkFees(poolContract, poolModel)
      })

      it ("should issue the long-term swap order without error", async function() {
        let intervals = 6
        
        swap = swapMgr.newSwap1To0()
        await swap.longTerm(swapAmt7em12, intervals, addr1)
        
        // Capture the swap customer's T0 and T1 balances after issuing the swap (to
        // compare against the cancel refund and withdraw values):
        // IMPORTANT - Capture these after the swap, not before--otherwise the math and accounting
        //             need to change.
        prevBalT0 = await token0AssetContract.balanceOf(addr1.address)
        prevBalT1 = await token1AssetContract.balanceOf(addr1.address)
        
        // Note that swap params emmulates the state of the virtual order, but has to use the block
        // number after the order is mined or you get a mismatch
        let blockNumber = await getLastBlockNumber()

        // Update the pool model to show the amount deposited into Balancer Vault
        swapParams = poolModel.ltSwap1To0(BLOCK_INTERVAL, blockNumber, swapAmt7em12, intervals)
        lastVirtualOrderBlock = blockNumber

        // Capture the current contract fees to do a simple sanity check for correctness.
        const balancerFees = await poolContract.getBalancerFeeAmounts()
        initialBalFeesToken1 = balancerFees.balFee1U96
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
      
      it ("should show the correct next order id and orders for addr1", async function() {
        const nextOrderId = await poolContract.getOrderIdCount()
        expect(nextOrderId).to.eq(BigNumber.from(2))

        const result = await poolContract.getOrderIds(addr1.address, ZERO, MAX_100_RESULTS)
        expect(result.numResults).to.eq(2)
        expect(result.orderIds.length).to.eq(MAX_100_RESULTS)
        expect(result.orderIds[1]).to.eq(BigNumber.from(1))
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
         
      it ("should have the correct fees collected immediately after mining the order", async function() {
        await checkFees(poolContract, poolModel)
      })

      it ("should contain correct reserves about half way through the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.

        // Mine about 1/2 way through the rest of the order:
        const blockNumber = await getLastBlockNumber()
        let numBlocksToMine = Math.floor((swapParams.swapExpiryBlock - blockNumber) / 2)
        await mineBlocks(numBlocksToMine)
        
        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(BigNumber.from(0),
                                             swapParams.sellingRate,
                                             lastVirtualOrderBlock,
                                             await getLastBlockNumber(),
                                             BLOCK_INTERVAL)

        const FEE_DIVUP_TOLERANCE = 105     // Testing by changing fee calculation to divDown instead of
                                            // divUp showed that this deviation is a result of biasing
                                            // fee calculation rounding to the pool. (Applies to
                                            // view reserve0 comparison)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })

      describe ("Long-term swap cancel checks", function () {
        let refundT1: BigNumber
        let expectedRefundT1: BigNumber
        let expectedProceedsT0: BigNumber
        let initialVaultReserveT1: BigNumber

        describe ("Long-term swap cancel", function () {
          it ("should allow the swap user to cancel the order", async function() {
            const vaultBalances = await getVaultBalances();
            initialVaultReserveT1 = vaultBalances.token1;

            await swap.cancelLongTerm()
          })

          it ("should contain correct reserves after cancelling the long-term order", async function() {
            // Compute the refund and partial proceeds:
            const blockNumber = await getLastBlockNumber()
            let blocksRemain = swapParams.swapExpiryBlock - blockNumber
            expectedRefundT1 = swapParams.sellingRate.mul(BigNumber.from(blocksRemain))
            blocksElapsedBeforeCancel = blockNumber - swapParams.swapStartBlock

            // Update the model to compare view function values
            const ltSwapProceeds = poolModel.twammReserveConcurrentSwap(BigNumber.from(0),
                                                                        swapParams.sellingRate,
                                                                        lastVirtualOrderBlock,
                                                                        blockNumber,
                                                                        BLOCK_INTERVAL)
            lastVirtualOrderBlock = blockNumber
            expectedProceedsT0 = ltSwapProceeds.token0
            
            // The model changes as follows:
            //    - The vault reserves change to lose the refund of the swap being withdrawn and
            //      any proceeds purchased.
            //    - The orders lose the refund amount.
            //    - The proceeds lose the partial purchase amount.
            //    - The twamm reserves update to show the
            //      amount sold to the pool in reserves and the amount exchanged gone
            //      from the pool.
            const { vaultReserves } = poolModel.getAllReserves()
            const orders = poolModel.getOrders() 
            const proceeds = poolModel.getProceeds() 
            poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.sub(expectedProceedsT0),
                                             reserve1: vaultReserves.reserve1.sub(expectedRefundT1) })
            poolModel.updateOrders( { token0: orders.token0,
                                      token1: orders.token1.sub(expectedRefundT1) } )
            poolModel.updateProceeds( { token0: proceeds.token0.sub(expectedProceedsT0),
                                        token1: proceeds.token1 } )
            poolModel.remitBalancerFees()

            const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
            compareReserveData(reserveData)
          })
            
          it ("should contain the correct balances", async function() {
            const balanceData = await getBalanceData(poolHelper, poolModel)
            testBalanceData(balanceData, DEV_TOLERANCE)
          })
              
          it ("should refund the correct amount after cancelling the long-term order", async function() {
            refundT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1)
            let tolerance = DEV_TOLERANCE
            expect(refundT1).to.be.closeTo(expectedRefundT1,
                                              tolerance,
                                              "LT Swap Customer Didn't Receive Expected T1 Refund")
          })

          it ("should transfer the correct partial proceeds after cancelling the long-term order", async function() {
            let balChangeT0 = (await token0AssetContract.balanceOf(addr1.address)).sub(prevBalT0)
            let tolerance = DEV_TOLERANCE
            expect(balChangeT0).to.be.closeTo(expectedProceedsT0,
                                              tolerance,
                                              "LT Swap Customer Didn't Receive Expected T0 Proceeds")
          })

          it ("should have the correct fees collected", async function() {
            await checkFees(poolContract, poolModel)
          })

          // Differs from Check Fees by being independent of the model's calculations
          // of fees and just using raw math below.
          it ("should capture the expected balancer protocol fees", async function() {
            const feeLTBP = poolModel.getPoolFeeLT()
            const soldAmtT1 = swapParams.sellingRate.mul(BigNumber.from(blocksElapsedBeforeCancel))
            const expectedFeeT1 = (soldAmtT1.mul(feeLTBP)).div(BP)
            const expectedBalFeeT1 = (expectedFeeT1.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

            // Balancer fees are remitted on the cancel transaction. To compute
            // the balancer fees, the following equation is applied:
            //
            //   balFeeTradeLT_T1 = vaultReserveT1[before]
            //                      - vaultReserveT1[after] 
            //                      - refundT1
            //                      + initialBalFeesT1 
            //
            const vaultBalances = await getVaultBalances();
            const ballFeeTradeT1 = initialVaultReserveT1
                                   .sub(vaultBalances.token1)
                                   .sub(refundT1)
                                   .add(initialBalFeesToken1)
            const tolerance = 3
            expect(ballFeeTradeT1).to.be.closeTo(expectedBalFeeT1, tolerance)
          })

          it ("should contain zero balancer fees", async function() {
            const balancerFees = await poolContract.getBalancerFeeAmounts()
            expect(balancerFees.balFee0U96).to.eq(ZERO);
            expect(balancerFees.balFee1U96).to.eq(ZERO);
          })
        })
      })
    })
  })

  describe ("Provide (Join, Mint) / Remove (Exit, Burn) Liquidity Checks", function() {
    describe ("Provide liquidity, 3kT0:??T1, (mint, join) checks", function () {
      let newLiquidity: TokenPairAmtType
      let prevBalT0: BigNumber
      let prevBalT1: BigNumber
      let prevBalLP: BigNumber
      let lpTokensMinted: BigNumber
      let modelLpTokensMinted: BigNumber
      let mintTimeStamp: BigNumber

      it ("should have the correct fees collected before minting liquidity", async function() {
        await checkFees(poolContract, poolModel)
      })

      it ("should allow the user to provide 3kT0:??T1 liquidity (mint, join the pool)", async function() {
        // Figure out the ratio of tokens to add to the pool, given an investment of 3k token0
        const pr = await poolHelper.getPoolReserves()
        const token0 = scaleUp(3_000n, TOKEN0_DECIMALS)
        const token1 = token0.mul(pr.reserve1).div(pr.reserve0)
        newLiquidity = { token0, token1 }
        
        // Transfer the tokens to the customer's wallet and approve them for the vault contract:
        await token0AssetContract.connect(owner).transfer(addr2.address, newLiquidity.token0);
        await token1AssetContract.connect(owner).transfer(addr2.address, newLiquidity.token1);
        await token0AssetContract.connect(addr2).approve(balancerVaultContract.address, newLiquidity.token0);
        await token1AssetContract.connect(addr2).approve(balancerVaultContract.address, newLiquidity.token1);
        let joinObjects = await poolHelper.getJoinObjects(newLiquidity.token0, newLiquidity.token1);
        await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)

        prevBalT0 = await token0AssetContract.balanceOf(addr2.address)
        prevBalT1 = await token1AssetContract.balanceOf(addr2.address)
        prevBalLP = await poolContract.balanceOf(addr2.address)

        // Join the pool (mint, add liquidity):
        await balancerVaultContract.connect(addr2).joinPool(
          poolHelper.getPoolId(),
          addr2.address,
          addr2.address,
          joinObjects.joinStruct
        )
        const block = await ethers.provider.getBlock(await getLastBlockNumber())
        mintTimeStamp = BigNumber.from(block.timestamp);
        await mineBlocks();

        // Update the pool model
        //
        //   Update expected model values to account for Balancer Fee collection
        //   TODO: make this a convenience on the model (i.e. updateForJoin/Exit)
        //   IMPORTANT: if you get these balances for a check after pool model mint
        //              your checks will mismatch because the poolModel mint clears
        //              balancer fees.
        const vaultReserves = poolModel.getVaultReserves()
        poolModel.remitBalancerFees()
        poolModel.updateBalancerFees( { token0: BigNumber.from(0), token1: BigNumber.from(0) } )
        modelLpTokensMinted = poolModel.mint(addr2.address, newLiquidity.token0, newLiquidity.token1)
      })

      it ("should contain the correct supply of LP tokens", async function() {
        let lpSupply = await poolContract.totalSupply()
        const tolerance = DEV_TOLERANCE
        expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
      })

      it ("should contain the correct reserves after liquidity has been provided", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
         
      it ("should transfer the correct number of tokens from the customer", async function() {
        const balChangeT0 = prevBalT0.sub(await token0AssetContract.balanceOf(addr2.address))
        const balChangeT1 = prevBalT1.sub(await token1AssetContract.balanceOf(addr2.address))
        expect(balChangeT0).to.eq(newLiquidity.token0)
        expect(balChangeT1).to.eq(newLiquidity.token1)
      })

      it ("should transfer the correct number of LP tokens to the customer", async function() {
        lpTokensMinted = (await poolContract.balanceOf(addr2.address)).sub(prevBalLP)
        const tolerance = DEV_TOLERANCE
        expect(lpTokensMinted).to.be.closeTo(modelLpTokensMinted, DEV_TOLERANCE)
      })

      it ("should have the correct fees collected after minting liquidity (NONE)", async function() {
        await checkFees(poolContract, poolModel)
      })
    })
    
    describe ("Remove liquidity, 500LP, (burn, exit) checks", function () {
      let tokensLP: BigNumber
      let prevLpSupply: BigNumber

      let prevBalT0: BigNumber
      let prevBalT1: BigNumber
      let prevBalLP: BigNumber

      let modelTokensReturned: TokenPairAmtType

      it ("should allow the user to remove 300LP liquidity (burn, exit the pool)", async function() {
        tokensLP = scaleUp(300n, await poolContract.decimals())
        prevLpSupply = await poolContract.totalSupply()

        // Approve liquidity tokens to burn:
        // TODO: is this needed / correct approval process? <-- try without next line?
        await poolContract.connect(addr1).approve(balancerVaultContract.address, tokensLP);

        prevBalT0 = await token0AssetContract.balanceOf(addr1.address)
        prevBalT1 = await token1AssetContract.balanceOf(addr1.address)
        prevBalLP = await poolContract.balanceOf(addr1.address)

        // Exit the pool (burn, remove liquidity):
        const exitRequest = await poolHelper.getExitRequest(tokensLP)
        await balancerVaultContract.connect(addr1).exitPool(
          poolHelper.getPoolId(),
          addr1.address,
          addr1.address,
          exitRequest
        )
        await mineBlocks()

        // Update the pool model
        const penalizedLP = BigNumber.from(0);
        // NOTE: converting penaltyBP to BigNumber here b/c uint16 in Solidity
        // returns a number instead of a BigNumber in the implicitly created
        // getter or ts/js interfacing.
        const penaltyBP = BigNumber.from(0);
        modelTokensReturned = poolModel.burn(addr1.address, tokensLP, penalizedLP, penaltyBP)
      })

      it ("should burn the correct number of LP tokens", async function() {
        const lpSupply = await poolContract.totalSupply()
        const tolerance = DEV_TOLERANCE
        expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), DEV_TOLERANCE)

        const lpSupplyIdeal = prevLpSupply.sub(tokensLP)
        expect(lpSupply).to.eq(lpSupplyIdeal)
      })

      it ("should contain the correct reserves after liquidity has been removed", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
         
      it ("should transfer the correct number of tokens to the customer", async function() {
        const transferredT0 = (await token0AssetContract.balanceOf(addr1.address)).sub(prevBalT0)
        const transferredT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1)
        const tolerance = DEV_TOLERANCE
        expect(transferredT0).to.be.closeTo(modelTokensReturned.token0, tolerance)
        expect(transferredT1).to.be.closeTo(modelTokensReturned.token1, tolerance)
      })

      it ("should transfer the correct number of LP tokens from the customer", async function() {
        const balanceLP = await poolContract.balanceOf(addr1.address)
        const idealBalanceLP = prevBalLP.sub(tokensLP)
        expect(balanceLP).to.eq(idealBalanceLP)
      })

      it ("should have the correct fees collected after burning liquidity", async function() {
        await checkFees(poolContract, poolModel)
      })

    })
  })

  describe ("Advanced long-term swap checks", function () {
    describe("Opposing unbalanced LT Swaps:  6k T1 -> T0 20 intervals, 6k T0 -> T1 20 intervals", function () {
      // Unbalanced b/c 6k:6k is 1:1, but the pool reserves are not 1:1 so we expect the
      // reserves to drift and slippage to be present b/c there's no arbing here.

      // TODO: compare against idealized single swap slippage
      // TODO: compare against idealized TWAMM algo (both paradigm and frax approx with high precision arith)
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

      it ("should issue the long-term swap orders without error", async function () {
        prevBalT1Addr1 = await token1AssetContract.balanceOf(addr1.address)
        prevBalT0Addr2 = await token0AssetContract.balanceOf(addr2.address)

        swapT0 = swapMgr.newSwap0To1()
        swapT1 = swapMgr.newSwap1To0()
        const intervals = 20
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
        
        // Note that swap params emmulates the state of the virtual order, but has to use the block
        // number after the order is mined or you get a mismatch
        let blockNumber = await getLastBlockNumber()
        
        // Update the pool model to show the amount deposited into Balancer Vault
        ltSwapParamsAddr1T0toT1 = poolModel.ltSwap0To1(BLOCK_INTERVAL,
                                                       blockNumber,
                                                       swapT0Amt6k,
                                                       intervals)
        ltSwapParamsAddr2T1toT0 = poolModel.ltSwap1To0(BLOCK_INTERVAL,
                                                       blockNumber,
                                                       swapT1Amt6k,
                                                       intervals)
        lastVirtualOrderBlock = blockNumber

        const balancerFees = await poolContract.getBalancerFeeAmounts()
        initialBalFeesToken0 = balancerFees.balFee0U96
        initialBalFeesToken1 = balancerFees.balFee1U96
      })

      it ("should contain the correct reserves immediately after mining the orders", async function() {
        //  TODO: Add the following checks to this part:
        //          - sales rate
        //          - order direction
        //          - expiry
        //          - Check events for order id
        
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should show the correct next order id and orders for addr1", async function() {
        const nextOrderId = await poolContract.getOrderIdCount()
        expect(nextOrderId).to.eq(BigNumber.from(4))

        const result = await poolContract.getOrderIds(addr1.address, ZERO, MAX_100_RESULTS)
        expect(result.numResults).to.eq(3)
        expect(result.orderIds.length).to.eq(MAX_100_RESULTS)
        expect(result.orderIds[2]).to.eq(BigNumber.from(2))
      })
      
      it ("should show the correct next order id and orders for addr2", async function() {
        const result = await poolContract.getOrderIds(addr2.address, ZERO, MAX_100_RESULTS)
        expect(result.numResults).to.eq(1)
        expect(result.orderIds.length).to.eq(MAX_100_RESULTS)
        expect(result.orderIds[0]).to.eq(BigNumber.from(3))
      })

      it ("shouldn't fail or revert if an address has no orders", async function() {
        const maxResults = BigNumber.from(1000);
        const result = await poolContract.getOrderIds(arbitrageur5.address, ZERO, maxResults)
        expect(result.numResults).to.eq(0)
        expect(result.orderIds.length).to.eq(maxResults)
      })
     
      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
          
      it ("should have the correct fees immediately after mining the orders", async function() {
        await checkFees(poolContract, poolModel)
      })
      
      it ("should contain the correct reserves one block after mining the orders", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.
        await mineBlocks()

        // Use poolModel's TWAMM approximation for comparison (note, this is not using
        // values from the contract under test):
        poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                              ltSwapParamsAddr2T1toT0.sellingRate,
                                              lastVirtualOrderBlock,
                                              await getLastBlockNumber(),
                                              BLOCK_INTERVAL)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        // Undo the last change to the model (we need to do this if we haven't executed a
        // virtual order or the model will drift significantly from the contract b/c the
        // results change if you calculate reserves at different points in time)
        poolModel.undo()
      })

      it ("should have the correct sales rates one block after mining the orders", async function() {
        // Sales Rate Calculation Below:
        //
        //   amount_in = 6000 * (10 ** 18)
        //   intervals = 20
        //   OBI = 300 (Liquid Pool)
        //   last_expiry_block = block_number - (block_number % OBI)
        //   order_expiry = OBI * (intervals + 1) + last_expiry_block
        //   trade_blocks = order_expiry - block_number
        //                = (OBI * (intervals + 1) + last_expiry_block) - block_number
        //                = (300 * (20 + 1) + (block_number - (block_number % 300))) - block_number
        //                = (6300 + block_number - (block_number % 300)) - block_number
        //                = 6300 - 0..299
        //   salesRate = amount_in / trade_blocks
        //   salesRateMin = amount_in / 6300
        //                = 952380952380952380
        //   salesRateMax = amount_in / 6001
        //                = 999833361106482252n

        const salesRateMin = Number(952380952380952380n);
        const salesRateMax = Number(999833361106482252n);
        const salesRates = await poolContract.getSalesRates();
        expect(Number(salesRates.salesRate0U112)).to.be.within(
          salesRateMin,
          salesRateMax
        );
        expect(Number(salesRates.salesRate1U112)).to.be.within(
          salesRateMin,
          salesRateMax
        );
      })
      
      it ("should contain correct reserves about 1/4 way through the orders", async function() {
        // Mine about 1/4 of the way through the order
        const { swapLengthBlocks } = ltSwapParamsAddr1T0toT1
        const orderBlocks25Pct = Math.floor(swapLengthBlocks / 4)
        await mineBlocks(orderBlocks25Pct)

        // Use poolModel's TWAMM approximation for comparison (note, this is not using
        // values from the contract under test):
        poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                              ltSwapParamsAddr2T1toT0.sellingRate,
                                              lastVirtualOrderBlock,
                                              await getLastBlockNumber(),
                                              BLOCK_INTERVAL)
        
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        // Undo the last change to the model (we need to do this if we haven't executed a
        // virtual order or the model will drift significantly from the contract b/c the
        // results change if you calculate reserves at different points in time)
        poolModel.undo()
      })
      
      it ("should contain correct reserves about 1/2 way through the orders", async function() {
        // Mine another 1/4 of the way through the order to get to nearly 1/2 way
        const { swapLengthBlocks } = ltSwapParamsAddr1T0toT1
        const orderBlocks25Pct = Math.floor(swapLengthBlocks / 4)
        await mineBlocks(orderBlocks25Pct)

        // Use poolModel's TWAMM approximation for comparison (note, this is not using
        // values from the contract under test):
        poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                             ltSwapParamsAddr2T1toT0.sellingRate,
                                             lastVirtualOrderBlock,
                                             await getLastBlockNumber(),
                                             BLOCK_INTERVAL)
        
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        // Undo the last change to the model (we need to do this if we haven't executed a
        // virtual order or the model will drift significantly from the contract b/c the
        // results change if you calculate reserves at different points in time)
        poolModel.undo()
      })
      
      it ("should contain correct reserves about 3/4 way through the orders", async function() {
        // Mine another 1/4 of the way through the order to get to about 3/4 way through
        const { swapLengthBlocks } = ltSwapParamsAddr1T0toT1
        const orderBlocks25Pct = Math.floor(swapLengthBlocks / 4)
        await mineBlocks(orderBlocks25Pct)

        // Use poolModel's TWAMM approximation for comparison (note, this is not using
        // values from the contract under test):
        poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                              ltSwapParamsAddr2T1toT0.sellingRate,
                                              lastVirtualOrderBlock,
                                              await getLastBlockNumber(),
                                              BLOCK_INTERVAL)
        
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
        
        // Undo the last change to the model (we need to do this if we haven't executed a
        // virtual order or the model will drift significantly from the contract b/c the
        // results change if you calculate reserves at different points in time)
        poolModel.undo()
      })
      
      it ("should contain correct reserves all the way through the orders", async function() {
        // Mine to get all the way through the order
        let currentBlock = await getLastBlockNumber()
        const { swapExpiryBlock } = ltSwapParamsAddr1T0toT1
        const blocksToMine = swapExpiryBlock - currentBlock
        await mineBlocks(blocksToMine)

        // Use poolModel's TWAMM approximation for comparison (note, this is not using
        // values from the contract under test):
        poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                              ltSwapParamsAddr2T1toT0.sellingRate,
                                              lastVirtualOrderBlock,
                                              await getLastBlockNumber(),
                                              BLOCK_INTERVAL)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
        
        // Undo the last change to the model (we need to do this if we haven't executed a
        // virtual order or the model will drift significantly from the contract b/c the
        // results change if you calculate reserves at different points in time)
        poolModel.undo()
      })

      describe ("Opposing Balanced LT Swap withdraw checks", function () {
        let initialVaultBalances: TokenPairAmtType;
        let proceedsT0: BigNumber;
        let proceedsT1: BigNumber;

        it ("should allow the first swap user to withdraw funds", async function() {
          initialVaultBalances = await getVaultBalances()

          await swapT0.withdrawLongTerm()
        })
        
        it ("should contain correct reserves after mining the first withdraw order", async function() {
          // Update modelled values:
          //   The withdraw order causes execution of virtual orders so we redo the TWAMM
          //   approximation in the model, but DO NOT undo it this time, instead using the
          //   reserves and proceeds from that order to update the model reserves. (note, 
          //   this is not using values from the contract under test)
          //
          //   We expect to see:
          //    - The vault reserves gain Swap.MIN_SWAP_AMT and lose the proceeds of the
          //      first LT swap being withdrawn.
          //    - The proceeds accounting loses the proceeds withdrawn (token1)
          //    - The twamm reserves gain Swap.MIN_SWAP_AMT and update to show the completed
          //      LT swap sales to the pool and the proceeds removed.
          //      (No update needed here - it's implicit for differential reserves).
          //
          //   Note we don't use the current block for this calculation, instead opting for
          //   the swapExpiryBlock and the previous lastVirtualOrderBlock
          const { token0, token1 } =
            poolModel.twammReserveConcurrentSwap(ltSwapParamsAddr1T0toT1.sellingRate,
                                                 ltSwapParamsAddr2T1toT0.sellingRate,
                                                 lastVirtualOrderBlock,
                                                 ltSwapParamsAddr1T0toT1.swapExpiryBlock,
                                                 BLOCK_INTERVAL)
          expectProceedsAddr2T0 = token0
          expectProceedsAddr1T1 = token1

          const { vaultReserves } = poolModel.getAllReserves()
          const proceeds = poolModel.getProceeds()

          // Could also compare TWAMM order proceeds using state difference methodology below
          // to compare model's rounding error etc. for computing outputs in function above:  (TODO)
          // Twamm reserve state hasn't changed in our model yet and can be used with the
          // twamm reserve (view function result modelling) to get expected proceeds:
          //
          //   expectedProceedsT1 = twammStateReserves.reserve1.sub(twammReserves.reserve1)

          // Update the last virtual order block to match the previous withdraw order:
          lastVirtualOrderBlock = await getLastBlockNumber()
          
          poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                           reserve1: vaultReserves.reserve1.sub(expectProceedsAddr1T1) })
          poolModel.updateProceeds( { token0: proceeds.token0,
                                      token1: proceeds.token1.sub(expectProceedsAddr1T1) } )
          poolModel.remitBalancerFees()

          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })
        
        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
            
        it ("should give the first swap customer correct long-term swap proceeds", async function () {
          proceedsT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1Addr1)
          let tolerance = DEV_TOLERANCE
          expect(proceedsT1).to.be.closeTo(expectProceedsAddr1T1,
                                           tolerance,
                                           "LT Swap Customer Didn't Receive Expected T1")
        })

        it ("should have the correct fees after the withdraw order", async function() {
          await checkFees(poolContract, poolModel)
        })
        
        it ("should allow the second swap user to withdraw funds", async function() {
          await swapT1.withdrawLongTerm()
        })
        
        it ("should contain correct reserves after mining the second withdraw order", async function() {
          // Update modelled values:
          //   The withdraw order causes execution of virtual orders, but there are no active
          //   orders so no need to excercise the models TWAMM approximation.
          //
          //   We expect to see:
          //    - The vault reserves gain Swap.MIN_SWAP_AMT and lose the proceeds of the
          //      second LT swap being withdrawn.
          //    - The proceeds accounting loses the proceeds withdrawn (token0)
          //    - The twamm reserves gain Swap.MIN_SWAP_AMT.
          //
          const { vaultReserves } = poolModel.getAllReserves()
          const proceeds = poolModel.getProceeds()

          // Update the last virtual order block to match the recent withdraw order:
          lastVirtualOrderBlock = await getLastBlockNumber()
          
          poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.sub(expectProceedsAddr2T0),
                                           reserve1: vaultReserves.reserve1.add(Swap.MIN_SWAP_AMT) })
          poolModel.updateProceeds( { token0: proceeds.token0.sub(expectProceedsAddr2T0),
                                      token1: proceeds.token1 } )
          poolModel.remitBalancerFees()

          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })
       
        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })

        it ("should give the second swap customer correct long-term swap proceeds", async function () {
          proceedsT0 = (await token0AssetContract.balanceOf(addr2.address)).sub(prevBalT0Addr2)
          let tolerance = DEV_TOLERANCE   // TODO: Understand the difference (probably rounding methodology).
                                          //       Can see this is likely rounding as the vault reserve differs by
                                          //       this much (and it's to the vault's benefit).
          expect(proceedsT0).to.be.closeTo(expectProceedsAddr2T0,
                                           tolerance,
                                           "LT Swap Customer Didn't Receive Expected T0")
        })

        it ("should have the correct fees after the second withdraw order", async function() {
          await checkFees(poolContract, poolModel)
        })

        // Differs from Check Fees by being independent of the model's calculations
        // of fees and just using raw math below.
        it ("should capture the expected balancer protocol fees", async function() {
          // Balancer fees are remtitted on each withdraw above. To compute the
          // balancer fees the following equation is applied:
          //
          // balFeeTradeLT_Tn = vaultReserveTn[before]
          //                    - vaultReserveTn[after]
          //                    - proceedsTn
          //                    + initialBalFeesTn
          //

          const feeLTBP = poolModel.getPoolFeeLT()
          

          const soldAmtT0 =
            ltSwapParamsAddr1T0toT1.sellingRate.mul(BigNumber.from(ltSwapParamsAddr1T0toT1.swapLengthBlocks))
          const expectedFeeT0 = (soldAmtT0.mul(feeLTBP)).div(BP)
          const expectedBalFeeT0 = (expectedFeeT0.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)
          
          const vaultBalances = await getVaultBalances();
          const balFeeT0 = initialVaultBalances.token0
                           .sub(vaultBalances.token0)
                           .sub(proceedsT0)
                           .add(initialBalFeesToken0)
          let tolerance = 10
          expect(balFeeT0).to.be.closeTo(expectedBalFeeT0, tolerance)


          const soldAmtT1 = 
            ltSwapParamsAddr2T1toT0.sellingRate.mul(BigNumber.from(ltSwapParamsAddr2T1toT0.swapLengthBlocks))
          const expectedFeeT1 = (soldAmtT1.mul(feeLTBP)).div(BP)
          const expectedBalFeeT1 = (expectedFeeT1.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

          const balFeeT1 = initialVaultBalances.token1
                           .sub(vaultBalances.token1)
                           .sub(proceedsT1)
                           .add(initialBalFeesToken1)
          tolerance = 10
          expect(balFeeT1).to.be.closeTo(expectedBalFeeT1, tolerance)
        })
      })
    })
  })

  describe ("Administrator & Factory Owner Positive Checks", function () {
    it("should already have an administrator on construction", async function () {
      const isAdmin1Default = await poolContract.iAdminAddrMap(admin1.address)
      expect(isAdmin1Default).to.eq(true)
    }) 

    it("should allow an administrator to be added", async function () {
      let isAdmin2AnAdmin = await poolContract.iAdminAddrMap(admin2.address)
      expect(isAdmin2AnAdmin).to.eq(false)

      await poolContract.connect(owner).setAdminStatus(admin2.address, true)
      await mineBlocks();

      isAdmin2AnAdmin = await poolContract.iAdminAddrMap(admin2.address)
      expect(isAdmin2AnAdmin).to.eq(true)
    }) 

    it("should allow an administrator to be removed", async function () {
      let isAdmin1Admin = await poolContract.iAdminAddrMap(admin1.address)
      expect(isAdmin1Admin).to.eq(true)

      await poolContract.connect(owner).setAdminStatus(admin1.address, false)
      await mineBlocks();

      isAdmin1Admin = await poolContract.iAdminAddrMap(admin1.address)
      expect(isAdmin1Admin).to.eq(false)
    }) 

    it("should allow an arb partner to be added", async function () {
      let partnerListContractAddr = await poolContract.iPartnerContractAddrMap(partnerBloxRoute.address)
      expect(partnerListContractAddr).to.eq(NULL_ADDR)

      await poolContract.connect(admin2).setArbitragePartner(
        partnerBloxRoute.address,
        arbitrageListContract.address
      );
      await mineBlocks();

      partnerListContractAddr = await poolContract.iPartnerContractAddrMap(partnerBloxRoute.address)
      expect(partnerListContractAddr).to.eq(arbitrageListContract.address)
    }) 

    it("should allow an arb partner to be removed", async function () {
      let partnerListContractAddr = await poolContract.iPartnerContractAddrMap(partnerBloxRoute.address)
      expect(partnerListContractAddr).to.eq(arbitrageListContract.address)

      await poolContract.connect(admin2).setArbitragePartner(
        partnerBloxRoute.address,
        NULL_ADDR
      );
      await mineBlocks();

      partnerListContractAddr = await poolContract.iPartnerContractAddrMap(partnerBloxRoute.address)
      expect(partnerListContractAddr).to.eq(NULL_ADDR)
    }) 

    it("should allow a fee address to be set", async function () {
      let currentFeeAddr = await poolContract.iFeeAddr()
      expect(currentFeeAddr).to.eq(NULL_ADDR)

      await poolContract.connect(owner).setFeeAddress(feeAddr1.address)
      await mineBlocks()

      currentFeeAddr = await poolContract.iFeeAddr()
      expect(currentFeeAddr).to.eq(feeAddr1.address)
    })

    describe ("Pause Functionality Checks", function () {
      let tokensLP: BigNumber

      it("should allow an administrator to pause", async function () {
        let pauseValue = await poolContract.isPaused()
        expect(pauseValue).to.eq(false)

        await poolContract.connect(admin2).setPause(true)
        await mineBlocks()

        pauseValue = await poolContract.isPaused()
        expect(pauseValue).to.eq(true)
      }) 

      it("should not allow short term swaps when paused", async function() {
        const swapAmt1k = scaleUp(1_000n, TOKEN0_DECIMALS)
        const swap = swapMgr.newSwap0To1()
        await expect(swap.shortTerm(swapAmt1k, addr1)).to.be.revertedWith('CFI#100')
      })

      it("should not allow partner swaps when paused", async function() {
        // First add a partner (none at this phase of testing)
        await poolContract.connect(admin2).setArbitragePartner(
          partnerBloxRoute.address,
          arbitrageListContract.address
        );
        await mineBlocks();

        // Now try and partner swap
        const swapAmt1k = scaleUp(1_000n, TOKEN0_DECIMALS)
        const swap = swapMgr.newSwap0To1()
        await expect(swap.partnerSwap(swapAmt1k, arbitrageur4, partnerBloxRoute)).to.be.revertedWith('CFI#100')
      })

      it("should not allow long term swaps when paused", async function() {
        const swapAmt40k = scaleUp(40_000n, TOKEN0_DECIMALS)
        let intervals = 4
        const swap = swapMgr.newSwap0To1()
        await expect(swap.longTerm(swapAmt40k, intervals, addr1)).to.be.revertedWith('CFI#100')
      })

      it("should not allow joins (minting) when paused", async function() {
        // Figure out the ratio of tokens to add to the pool, given an investment of 3k token0
        const pr = await poolHelper.getPoolReserves()
        const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
        const token1 = token0.mul(pr.reserve1).div(pr.reserve0)
        const newLiquidity = { token0, token1 }
        
        // Transfer the tokens to the customer's wallet and approve them for the vault contract:
        await token0AssetContract.connect(owner).transfer(addr2.address, newLiquidity.token0);
        await token1AssetContract.connect(owner).transfer(addr2.address, newLiquidity.token1);
        await token0AssetContract.connect(addr2).approve(balancerVaultContract.address, newLiquidity.token0);
        await token1AssetContract.connect(addr2).approve(balancerVaultContract.address, newLiquidity.token1);
        let joinObjects = await poolHelper.getJoinObjects( newLiquidity.token0, newLiquidity.token1);
        await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)

        // Join the pool (mint, add liquidity):
        await expect( balancerVaultContract.connect(addr2)
                                           .joinPool( poolHelper.getPoolId(),
                                                      addr2.address,
                                                      addr2.address,
                                                      joinObjects.joinStruct)
                    ).to.be.revertedWith('CFI#100')
        // await mineBlocks();
      })
      
      it ("should allow exits (burning) when paused", async function() {
        tokensLP = scaleUp(10n, await poolContract.decimals())
        
        // Approve liquidity tokens to burn:
        // TODO: is this needed / correct approval process? <-- try without next line?
        await poolContract.connect(addr1).approve(balancerVaultContract.address, tokensLP);

        // Exit the pool (burn, remove liquidity):
        const exitRequest = await poolHelper.getExitRequest(tokensLP)
        await balancerVaultContract.connect(addr1).exitPool(
          poolHelper.getPoolId(),
          addr1.address,
          addr1.address,
          exitRequest
        )
        await mineBlocks()

        // Update the pool model
        const penalizedLP = BigNumber.from(0);
        // NOTE: converting penaltyBP to BigNumber here b/c uint16 in Solidity
        // returns a number instead of a BigNumber in the implicitly created
        // getter or ts/js interfacing.
        const penaltyBP = BigNumber.from(0);
        poolModel.burn(addr1.address, tokensLP, penalizedLP, penaltyBP)
      })

      it ("should contain the correct reserves after the paused exit", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
         
      it("should allow an administrator to unpause", async function () {
        let pauseValue = await poolContract.isPaused()
        expect(pauseValue).to.eq(true)

        await poolContract.connect(admin2).setPause(false)
        await mineBlocks()

        pauseValue = await poolContract.isPaused()
        expect(pauseValue).to.eq(false)
      }) 
    })
  })

  describe ("Administrator Negative Checks", function () {
    // TODO: I tried to handle this test with by capturing the receipt (instead of
    //       auto-mining which hardhat/chai appears to be designed for). Unfortunately
    //       the expect doesn't seem to work with that. Just waiting on the receipt
    //       causes a throw that grinds chai to a halt.
    //       See if we can find a way to extract the revert from the receipt. <-- TODO
    it("shouldn't allow an administrator to be added by a non-admin", async function () {
      let isAdmin1Admin = await poolContract.iAdminAddrMap(admin1.address)
      expect(isAdmin1Admin).to.eq(false)

      const addrsToTry = [feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]
      for (const addr of addrsToTry) {
        await poolContract.connect(addr).setAdminStatus(admin1.address, true)
        await mineBlocks();

        isAdmin1Admin = await poolContract.iAdminAddrMap(admin1.address)
        expect(isAdmin1Admin).to.eq(false)
      }
    }) 

    it("shouldn't allow an administrator to be removed by a non-admin", async function () {
      let isAdmin2AnAdmin = await poolContract.iAdminAddrMap(admin2.address)
      expect(isAdmin2AnAdmin).to.eq(true)

      const addrsToTry = [feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]
      for (const addr of addrsToTry) {
        await poolContract.connect(addr).setAdminStatus(admin2.address, false)
        await mineBlocks();

        isAdmin2AnAdmin = await poolContract.iAdminAddrMap(admin2.address)
        expect(isAdmin2AnAdmin).to.eq(true)
      }
    }) 

    it("shouldn't allow an arb partner to be added by a non-admin", async function () {
      let partnerXArbListAddr = await poolContract.iPartnerContractAddrMap(partnerX.address)
      expect(partnerXArbListAddr).to.eq(NULL_ADDR)

      const addrsToTry = [feeAddr1, partnerBloxRoute, addr1]
      for (const addr of addrsToTry) {
        await poolContract.connect(addr).setArbitragePartner(
          partnerX.address,
          arbitrageListContract2.address
        )
        await mineBlocks();

        partnerXArbListAddr = await poolContract.iPartnerContractAddrMap(partnerX.address)
        expect(partnerXArbListAddr).to.eq(NULL_ADDR)
      }
    }) 

    it("shouldn't allow an arb partner to be removed by a non-admin", async function () {
      // Now test:
      let partnerBloxRoutArbListAddr = await poolContract.iPartnerContractAddrMap(partnerBloxRoute.address)
      expect(partnerBloxRoutArbListAddr).to.eq(arbitrageListContract.address)

      const addrsToTry = [feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]
      for (const addr of addrsToTry) {
        await poolContract.connect(addr).setArbitragePartner(
          partnerBloxRoute.address,
          NULL_ADDR
        )
        await mineBlocks();

        partnerBloxRoutArbListAddr = await poolContract.iPartnerContractAddrMap(partnerBloxRoute.address)
        expect(partnerBloxRoutArbListAddr).to.eq(arbitrageListContract.address)
      }
    }) 

    it("shouldn't allow a fee address to be set by a non-factory owner", async function () {
      let currentFeeAddr = await poolContract.iFeeAddr()
      expect(currentFeeAddr).to.eq(feeAddr1.address)

      const addrsToTry = [admin2, feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]
      for (const addr of addrsToTry) {
        await poolContract.connect(addr).setFeeAddress(feeAddr2.address)
        await mineBlocks();

        currentFeeAddr = await poolContract.iFeeAddr()
        expect(currentFeeAddr).to.eq(feeAddr1.address)
      }
    })

    it ("should allow a factory owner to unset the fee address", async function() {
      // IMPORTANT: This must be run / happen b/c of the fee address remains set after here, tests below
      //            will break as they expect fee address to be unset.
      let currentFeeAddr = await poolContract.iFeeAddr()
      expect(currentFeeAddr).to.eq(feeAddr1.address)

      await poolContract.connect(owner).setFeeAddress(NULL_ADDR)
      await mineBlocks()

      currentFeeAddr = await poolContract.iFeeAddr()
      expect(currentFeeAddr).to.eq(NULL_ADDR)
    })


    describe ("Pause Negative Functionality Checks", function () {
      it("shouldn't allow a non-administrator to pause", async function () {
        let paused = await poolContract.isPaused()
        expect(paused).to.eq(false)

        const addrsToTry = [owner, feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]
        for (const addr of addrsToTry) {
          await poolContract.connect(addr).setPause(true)
          await mineBlocks();

          paused = await poolContract.isPaused()
          expect(paused).to.eq(false)
        }
      }) 

      it("shouldn't allow a non-administrator to unpause", async function () {
        // First pause the contract:
        await poolContract.connect(admin2).setPause(true)
        await mineBlocks();

        // Now test:
        let paused = await poolContract.isPaused()
        expect(paused).to.eq(true)

        const addrsToTry = [owner, feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]
        for (const addr of addrsToTry) {
          await poolContract.connect(addr).setPause(true)
          await mineBlocks();

          paused = await poolContract.isPaused()
          expect(paused).to.eq(true)
        }

        // Now unpause the contract
        await poolContract.connect(admin2).setPause(false)
        await mineBlocks();
      }) 
    })
  })

  describe("Partner Fee Checks", function() {
    it("should fail if a non partner calls partner swap", async function() {
      const addrsToTry = [feeAddr1, addr2]
      for (const addr of addrsToTry) {
        // Set up the objects for the transaction:
        const swapAmt1k = scaleUp(1_000n, TOKEN0_DECIMALS)
        const swap = swapMgr.newSwap0To1()
        const performSwap = false 
        const swapObjects = await swap.partnerSwap(swapAmt1k, addr, partnerBloxRoute, performSwap)

        // Manually mine the transaction and capture it so we can get the receipt to 
        // ensure it fails:
        const { swapStruct, fundStruct, limitOutAmt, deadlineSec } = swapObjects
        await expect(balancerVaultContract
                     .connect(addr)
                     .swap(swapStruct,
                           fundStruct,
                           limitOutAmt,
                           deadlineSec)).to.be.revertedWith('CFI#005')
        
        // TODO: When time--understand why this transaction reverts and can use chai while
        //       all the admin setting ones need to capture a receipt and fail in a try-catch
        //       block (suspect it's return value vs void)
      }
    })

    describe("Partner Swap 1k Token 0 to Token 1", function() {
      let prevBalT1: BigNumber
      let expectedProceedsT1: BigNumber

      // TODO: interface change broke some of the test idea here. Add test 
      //       to ensure arb partner not in their own list can't partner swap.
      it("shouldn't allow a partner's arbitrageur to call partner swap", async function() {
        prevBalT1 = await token1AssetContract.balanceOf(arbitrageur4.address)

        const swapAmt1k = scaleUp(1_000n, TOKEN0_DECIMALS)
        const swap = swapMgr.newSwap0To1()
        await swap.partnerSwap(swapAmt1k, arbitrageur4, partnerBloxRoute)
        
        expectedProceedsT1 = poolModel.partnerSwap0To1(swapAmt1k)
      })

      it ("should contain the correct reserves", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })
     
      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
          
      it ("should give the swap customer the correct proceeds", async function() {
        let balChangeT1 = (await token1AssetContract.balanceOf(arbitrageur4.address)).sub(prevBalT1)
        let tolerance = DEV_TOLERANCE
        expect(balChangeT1).to.be.closeTo(expectedProceedsT1, tolerance)
      })

      it ("should have the correct fees collected", async function() {
        await checkFees(poolContract, poolModel)
      })
    })

    describe("Partner Swap 483 Token 1 to Token 0", function() {
      let prevBalT0: BigNumber
      let expectedProceedsT0: BigNumber

      it("should allow a partner's arbitrageur to call partner swap", async function() {
        prevBalT0 = await token0AssetContract.balanceOf(arbitrageur5.address)

        const swapAmt483 = scaleUp(483n, TOKEN1_DECIMALS)
        const swap = swapMgr.newSwap1To0()
        const swapObjects = await swap.partnerSwap(swapAmt483, arbitrageur5, partnerBloxRoute)

        expectedProceedsT0 = poolModel.partnerSwap1To0(swapAmt483)
      })

      it ("should contain the correct reserves", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })
     
      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
          
      it ("should give the swap customer the correct proceeds", async function() {
        let balChangeT0 = (await token0AssetContract.balanceOf(arbitrageur5.address)).sub(prevBalT0)
        let tolerance = DEV_TOLERANCE
        expect(balChangeT0).to.be.closeTo(expectedProceedsT0, tolerance)
      })

      it ("should have the correct fees collected", async function() {
        await checkFees(poolContract, poolModel)
      })
    })
  })

  describe("Advanced Pause Functionality Tests", function() {
    // Need to confirm that LT swaps can be cancelled or withdrawn from when a pool is paused.
    // Basic coverage is the following 2 scenarios, which will be tested sequentially, not
    // concurrently:
    //   1. No EVO cancellation (cancellation of lt swap before any virtual orders have executed.)
    //   2. EVO cancellation (cancellation after some virtual orders executed before pause)
    //   3. Completed swap, then pause withdraw

    describe("No EVO cancellation scenario", function() {
      const swapAmt10k = scaleUp(10_000n, TOKEN0_DECIMALS)
      let swap: Swap
      let afterSwapAddr1BalanceT0: BigNumber
      let swapParams: LTSwapParams

      it ("Should allow an LT swap cancellation after pausing", async function() {
        // a) Issue LT Swap
        let intervals = 4
        swap = swapMgr.newSwap0To1()
        const swapObjects = await swap.longTerm(swapAmt10k, intervals, addr1)
        afterSwapAddr1BalanceT0 = await token0AssetContract.balanceOf(addr1.address)
        swapParams = PoolModel.getLongTermSwapParameters(BLOCK_INTERVAL,
                                                         await getLastBlockNumber(),
                                                         swapAmt10k,
                                                         intervals)

        // b) mine a few blocks
        await mineBlocks(2 * BLOCK_INTERVAL)

        // c) pause
        await poolContract.connect(admin2).setPause(true)
        await mineBlocks()

        // d) Issue cancel - expect full refund (no EVO run)
        await swap.cancelLongTerm()
      })
      
      it ("Should contain the correct reserves after cancellation", async function() {
        // No need to update the model as the pause / cancel makes all this effectively a no-op, however
        // rounding error results in a difference larger than DEV_TOLERANCE (38, so we simulate the
        // rounding error and update the pool model).
        let vaultRoundingErrorT0 = swapAmt10k.sub(swapParams.sellingRate.mul(swapParams.swapLengthBlocks))
        const vaultReserves = poolModel.getVaultReserves()
        poolModel.updateVaultReserves({ reserve0: vaultReserves.reserve0.add(vaultRoundingErrorT0),
                                        reserve1: vaultReserves.reserve1 })
        poolModel.remitBalancerFees()
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })
     
      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
          
      it ("should refund the correct amount after cancelling the long-term order", async function() {
        // The rounding error due to the swap amount chosen and the number of blocks in the
        // actual trade can result in differences on the order of > 100e-18. The following calculation
        // approximates that difference for comparison purposes.
        const actualSwapAmt = swapParams.sellingRate.mul(BigNumber.from(swapParams.swapLengthBlocks))
        const tolerance = swapAmt10k.sub(actualSwapAmt)   // Accounts for truncation error in sales rate.

        const afterSwapCancelAddr1BalanceT0 = await token0AssetContract.balanceOf(addr1.address)
        const refundT0 = afterSwapCancelAddr1BalanceT0.sub(afterSwapAddr1BalanceT0)
        expect(refundT0).to.be.closeTo(swapAmt10k, tolerance)
      })
      
      it ("Should allow pool operation to resume", async function() {
        // f) resume
        await poolContract.connect(admin2).setPause(false)
        await mineBlocks()
      })

      it ("Shouldn't allow cancellation a second time on the cancelled order.", async function() {
        // g) Issue cancel again - expect fail (order ended--owner set to
        //    NULL_ADDR, so original owner is no longer owner).
        await expect(swap.cancelLongTerm()).to.be.revertedWith('CFI#011')
      })
    })

    describe("EVO cancellation scenario", function() {
      const swapAmt2_3k = scaleUp(2_300n, TOKEN0_DECIMALS)
      let swap: Swap
      let afterSwapAddr2BalanceT1: BigNumber
      let afterSwapAddr2BalanceT0: BigNumber
      let expectedRefundT1: BigNumber
      let swapParams: LTSwapParams
      let swapProceeds: TokenPairAmtType
      let lvbo: number

      it ("Should contain the correct reserves before test", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
         
      it ("Should have matching reserves after an EVO on an active LT swap", async function() {
        // a) Issue LT Swap
        let intervals = 5
        swap = swapMgr.newSwap1To0()
        const swapObjects = await swap.longTerm(swapAmt2_3k, intervals, addr2)
        afterSwapAddr2BalanceT0 = await token0AssetContract.balanceOf(addr2.address)
        afterSwapAddr2BalanceT1 = await token1AssetContract.balanceOf(addr2.address)

        lvbo = await getLastBlockNumber()
        // Update the pool model to show the amount deposited into Balancer Vault
        swapParams = poolModel.ltSwap1To0(BLOCK_INTERVAL, lvbo, swapAmt2_3k, intervals)

        // b) mine a few intervals through the order
        await mineBlocks(Math.floor(intervals/2) * BLOCK_INTERVAL)
        
        // c) execute virtual orders
        await poolContract.connect(addr2).executeVirtualOrdersToBlock(0)    // EVO to current block
        await mineBlocks()
        lvbo = await getLastBlockNumber()

        // Update the model to match the EVO run
        swapProceeds = poolModel.twammReserveConcurrentSwap(BigNumber.from(0),
                                                            swapParams.sellingRate,
                                                            swapParams.swapStartBlock,
                                                            lvbo,
                                                            BLOCK_INTERVAL)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("Should allow LT swap cancellation after pausing subsequent to an EVO", async function() {
        // d) pause
        await poolContract.connect(admin2).setPause(true)
        await mineBlocks()

        // e) Issue cancel - expect partial refund (no EVO run)
        await swap.cancelLongTerm()

        // Update the model to match the cancel refund:
        //    - The vault reserves change to lose the refund of the swap being withdrawn
        //      and any partial proceeds of the transaction.
        //    - The orders lose the refund amount.
        //    - The proceeds lose the proceed amount.
        //    - The twamm reserves update to show the amount sold to the pool in reserves and the
        //      amount exchanged gone from the pool. (No update needed here - it's implicit for
        //      differential reserves).
        const blocksRemain = swapParams.swapExpiryBlock - lvbo 
        expectedRefundT1 = swapParams.sellingRate.mul(BigNumber.from(blocksRemain))

        const vaultReserves = poolModel.getVaultReserves()
        const orders = poolModel.getOrders()
        const proceeds = poolModel.getProceeds() 
        poolModel.updateVaultReserves({ reserve0: vaultReserves.reserve0.sub(swapProceeds.token0),
                                        reserve1: vaultReserves.reserve1.sub(expectedRefundT1) })
        poolModel.updateOrders( { token0: orders.token0,
                                  token1: orders.token1.sub(expectedRefundT1) } )
        poolModel.updateProceeds( { token0: proceeds.token0.sub(swapProceeds.token0),
                                    token1: proceeds.token1 } )
        poolModel.remitBalancerFees()
      })

      it ("Should contain the correct reserves after cancellation", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should refund the correct amount after cancelling the long-term order", async function() {
        const afterSwapCancelAddr2BalanceT1 = await token1AssetContract.balanceOf(addr2.address)
        const refundT1 = afterSwapCancelAddr2BalanceT1.sub(afterSwapAddr2BalanceT1)
        const tolerance = 0   // Rounding error from sales rate
        expect(refundT1).to.be.closeTo(expectedRefundT1, tolerance)
      })

      it ("should transfer the correct proceeds after cancel withdrawing the long-term order", async function() {
        const afterSwapCancelAddr2BalanceT0 = await token0AssetContract.balanceOf(addr2.address)
        const proceedsT0 = afterSwapCancelAddr2BalanceT0.sub(afterSwapAddr2BalanceT0)
        const tolerance = 9 // Rounding error from sales rate
        expect(proceedsT0).to.be.closeTo(swapProceeds.token0, tolerance)
      })
 
      it ("Should allow pool operation to resume", async function() {
      // g) resume
        await poolContract.connect(admin2).setPause(false)
        await mineBlocks()
      })

      it ("Shouldn't allow cancellation a second time on the cancelled order.", async function() {
        // h) Issue cancel again - expect fail (order ended--owner set to
        //    NULL_ADDR, so original owner is no longer owner).
        await expect(swap.cancelLongTerm()).to.be.revertedWith('CFI#011')
      })

      it ("Should contain the correct reserves after resuming operation", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
    })
  })

  describe("Completed swap, then pause withdraw", function() {
    const swapAmt500 = scaleUp(500n, TOKEN0_DECIMALS)
    let swap: Swap
    let afterSwapAddr1BalanceT1: BigNumber
    let swapParams: LTSwapParams
    let swapProceeds: TokenPairAmtType
    let proceedsT1: BigNumber

    it ("Should allow issuing an LT swap", async function() {
      // a) Issue LT Swap
      let intervals = 2 
      swap = swapMgr.newSwap0To1()
      const swapObjects = await swap.longTerm(swapAmt500, intervals, addr1)
      afterSwapAddr1BalanceT1 = await token1AssetContract.balanceOf(addr1.address)

      // Update the pool model to show the amount deposited into Balancer Vault
      swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL,
                                        await getLastBlockNumber(),
                                        swapAmt500,
                                        intervals)
    })
    
    it ("Should contain the correct reserves after mining the order", async function() {
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })
   
    it ("should contain the correct balances", async function() {
      const balanceData = await getBalanceData(poolHelper, poolModel)
      testBalanceData(balanceData, DEV_TOLERANCE)
    })
        
    it ("Should contain the correct reserves after mining through the order", async function() {
      // b) mine to the end of the virtual order and then some
      const some = 5;
      await mineBlocks(swapParams.swapLengthBlocks + some)
      
      // Update the model to match the EVO run and completed LT swap
      swapProceeds = poolModel.twammReserveConcurrentSwap( swapParams.sellingRate,
                                                           BigNumber.from(0),
                                                           swapParams.swapStartBlock,
                                                           swapParams.swapExpiryBlock,
                                                           BLOCK_INTERVAL)

      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })

    it ("Should contain the correct reserves after an EVO", async function() {
      // c) execute virtual orders
      await poolContract.connect(addr2).executeVirtualOrdersToBlock(0)    // EVO to current block
      await mineBlocks()
      
      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })
   
    it ("should contain the correct balances", async function() {
      const balanceData = await getBalanceData(poolHelper, poolModel)
      testBalanceData(balanceData, DEV_TOLERANCE)
    })
        
    it ("Should contain the correct reserves after pausing", async function() {
      // d) pause
      await poolContract.connect(admin2).setPause(true)
      await mineBlocks()

      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })
   
    it ("should contain the correct balances", async function() {
      const balanceData = await getBalanceData(poolHelper, poolModel)
      testBalanceData(balanceData, DEV_TOLERANCE)
    })
        
    it ("Should allow an LT swap withdraw after pausing", async function() {
      // e) Issue lt swap withdraw
      await swap.withdrawLongTerm()
    })

    it ("Should contain the correct reserves after withdrawing, while paused", async function() {
      const afterSwapWithdrawAddr1BalanceT1 = await token1AssetContract.balanceOf(addr1.address)
      proceedsT1 = afterSwapWithdrawAddr1BalanceT1.sub(afterSwapAddr1BalanceT1)

      // Update the model to match the withdraw
      const vaultReserves = poolModel.getVaultReserves()
      const proceeds = poolModel.getProceeds()
      poolModel.updateVaultReserves({ reserve0: vaultReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                      reserve1: vaultReserves.reserve1.sub(swapProceeds.token1) })
      poolModel.updateProceeds( { token0: proceeds.token0,
                                  token1: proceeds.token1.sub(swapProceeds.token1) } )
      poolModel.remitBalancerFees()

      const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
      compareReserveData(reserveData)
    })
   
    it ("should contain the correct balances", async function() {
      const balanceData = await getBalanceData(poolHelper, poolModel)
      testBalanceData(balanceData, DEV_TOLERANCE)
    })
        
    it ("should withdraw the correct amount from the completed long-term order", async function() {
      const tolerance = 2    // Rounding error from sales rate and penalty on burns.
      expect(proceedsT1).to.be.closeTo(swapProceeds.token1, tolerance)
    })
    
    it ("Shouldn't allow withdraw a second time on the completed, withdrawn order, while paused.", async function() {
      // g) Issue cancel again - expect fail (order ended--owner set to
      //    NULL_ADDR, so original owner is no longer owner).
      await expect(swap.withdrawLongTerm()).to.be.revertedWith('CFI#011')
    })

    it ("Shouldn't allow cancellation on the completed order, while paused.", async function() {
      // h) Issue cancel again - expect fail (order ended--owner set to
      //    NULL_ADDR, so original owner is no longer owner).
      await expect(swap.cancelLongTerm()).to.be.revertedWith('CFI#011')
    })

    it ("Should allow pool operation to resume", async function() {
      // f) resume
      await poolContract.connect(admin2).setPause(false)
      await mineBlocks()
    })

    it ("Shouldn't allow withdraw a second time on the completed, withdrawn order, after resume.", async function() {
      // g) Issue cancel again - expect fail (order ended--owner set to
      //    NULL_ADDR, so original owner is no longer owner).
      await expect(swap.withdrawLongTerm()).to.be.revertedWith('CFI#011')
    })

    it ("Shouldn't allow cancellation on the completed order, after resume.", async function() {
      // h) Issue cancel again - expect fail (order ended--owner set to
      //    NULL_ADDR, so original owner is no longer owner).
      await expect(swap.cancelLongTerm()).to.be.revertedWith('CFI#011')
    })
  })

  describe("Reward Functionality checks", function () {
    describe("Reward functionality", function () {
      describe("Single Sided Reward functionality", function () {
        let rewardAmts: TokenPairAmtType
        let prevLpSupply: BigNumber

        it ("Should allow a reward of 0.5 Token 0", async function() {
          const rewardAmt5em1 = scaleUp(5n, TOKEN1_DECIMALS-1)  // 1st decimal place in 18 decimals means scale
                                                                // up 17 decimals.
          const token1 = BigNumber.from(0)
          rewardAmts = { token0: rewardAmt5em1, token1 }

          // Transfer the token's to the customer's wallet and approve them for the vault contract:
          await token0AssetContract.connect(owner).transfer(addr2.address, rewardAmts.token0);
          await token0AssetContract.connect(addr2).approve(balancerVaultContract.address, rewardAmts.token0);
          let rewardObjs = await poolHelper.getRewardObjects(rewardAmts.token0, rewardAmts.token1);
          await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)

          // Capture the previous LP supply
          prevLpSupply = await poolContract.totalSupply()
        
          // Reward the pool:
          await balancerVaultContract.connect(addr2).joinPool(
            poolHelper.getPoolId(),
            addr2.address,
            addr2.address,
            rewardObjs.joinStruct
          )
          await mineBlocks();

          // Update the pool model
          //
          poolModel.reward(rewardAmts)
        })
        
        it ("Should contain the same supply of LP tokens from before the reward", async function() {
          let lpSupply = await poolContract.totalSupply()
          expect(lpSupply).to.be.equal(prevLpSupply)

          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
        })
        
        it ("Should contain the correct reserves after the reward", async function () {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
           
        it ("Should allow a reward of 0.00000001 Token 1", async function() {
          const swapAmt1em8 = scaleUp(1n, TOKEN1_DECIMALS-8)  // 8th decimal place in 18 decimals means scale
                                                              // up 10 decimals.
                                                              // This use case is BTC (8 decimal places)
          const token0 = BigNumber.from(0)
          rewardAmts = { token0, token1: swapAmt1em8 }

          // Transfer the token's to the customer's wallet and approve them for the vault contract:
          await token1AssetContract.connect(owner).transfer(addr2.address, rewardAmts.token1);
          await token1AssetContract.connect(addr2).approve(balancerVaultContract.address, rewardAmts.token1);
          let rewardObjs = await poolHelper.getRewardObjects(rewardAmts.token0, rewardAmts.token1);
          await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)

          // Capture the previous LP supply
          prevLpSupply = await poolContract.totalSupply()
        
          // Reward the pool:
          await balancerVaultContract.connect(addr2).joinPool(
            poolHelper.getPoolId(),
            addr2.address,
            addr2.address,
            rewardObjs.joinStruct
          )
          await mineBlocks();

          // Update the pool model
          //
          poolModel.reward(rewardAmts)
        })

        it ("Should contain the same supply of LP tokens from before the reward", async function() {
          let lpSupply = await poolContract.totalSupply()
          expect(lpSupply).to.be.equal(prevLpSupply)

          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
        })
        
        it ("Should contain the correct reserves after the reward", async function () {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
      })
      
      describe("Two Sided Reward functionality", function () {
        let rewardAmts: TokenPairAmtType
        let prevReserves: ReserveType
        let prevLpSupply: BigNumber

        it ("Should allow rewarding of 1 Token 0 to Token 1 at current pool ratio", async function() {
          // Figure out the ratio of Token1 to add for 1k Token0:
          const pr = await poolHelper.getPoolReserves()
          const token0 = scaleUp(1n, TOKEN0_DECIMALS)
          const token1 = token0.mul(pr.reserve1).div(pr.reserve0)
          rewardAmts = { token0, token1 }

          // Transfer the token's to the customer's wallet and approve them for the vault contract:
          await token0AssetContract.connect(owner).transfer(addr2.address, rewardAmts.token0);
          await token1AssetContract.connect(owner).transfer(addr2.address, rewardAmts.token1);
          await token0AssetContract.connect(addr2).approve(balancerVaultContract.address, rewardAmts.token0);
          await token1AssetContract.connect(addr2).approve(balancerVaultContract.address, rewardAmts.token1);
          let rewardObjs = await poolHelper.getRewardObjects(rewardAmts.token0, rewardAmts.token1);
          await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)

          // Capture the previous LP supply & reserves
          prevReserves = await _getReserveAmounts(poolContract)
          prevLpSupply = await poolContract.totalSupply()

          // Reward the pool:
          await balancerVaultContract.connect(addr2).joinPool(
            poolHelper.getPoolId(),
            addr2.address,
            addr2.address,
            rewardObjs.joinStruct
          )
          await mineBlocks();

          // Update the pool model
          //
          poolModel.reward(rewardAmts)
        })

        it ("Should contain the same supply of LP tokens from before the reward", async function() {
          let lpSupply = await poolContract.totalSupply()
          expect(lpSupply).to.be.equal(prevLpSupply)

          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
        })

        it ("Should contain the correct reserves after the reward", async function () {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
           
        it ("Should have the same price ratio from before the reward", async function() {
          const reserves = await _getReserveAmounts(poolContract)

          expect(ratiosNearlyEqual(prevReserves.reserve0,
                                   prevReserves.reserve1,
                                   reserves.reserve0,
                                   reserves.reserve1)).to.be.equal(true, "Before/after reserve ratios not within tolerance.")
        })
      })
    })
  })

  describe("Fee Kill Switch Tests", function() {
    describe("Fee Kill Switch Permissions", function() {
      it ("shound not let non-factory owner users toggle the fee kill switch.", async function() {
        for (const addr of [admin2, feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]) {
          const collectBalancerFeesBefore = await poolContract.isCollectingBalancerFees()

          await poolContract.connect(addr).setCollectBalancerFees(boolToBN(!collectBalancerFeesBefore))
          await mineBlocks()

          const collectBalancerFeesAfter = await poolContract.isCollectingBalancerFees()
          expect(collectBalancerFeesAfter).to.eq(collectBalancerFeesBefore)
        }
      })

      it ("should let factory owner toggle the fee kill switch.", async function() {
        for (const value of [false, true]) {
          await poolContract.connect(owner).setCollectBalancerFees(value)
          await mineBlocks()

          const collectBalancerFees = await poolContract.isCollectingBalancerFees()
          expect(collectBalancerFees).to.eq(value)
        }
      })
    })

    describe("Fee Kill Switch Behavior", function() {
      describe("Short Term Swap", function() {
        it ("should stop accumulating Balancer fees for a short term swap", async function () {
          const balFeesBefore = await poolContract.getBalancerFeeAmounts()

          // Disable Balancer Fees
          await poolContract.connect(owner).setCollectBalancerFees(false)
          await mineBlocks()

          // Perform a Swap
          const swapAmt2k = scaleUp(2_000n, TOKEN0_DECIMALS)
          const swap = swapMgr.newSwap0To1()
          await swap.shortTerm(swapAmt2k, addr1)

          // Ensure Balancer Fees Not Collected
          const balFeesAfter = await poolContract.getBalancerFeeAmounts()

          expect(balFeesAfter.balFee0U96).to.eq(balFeesBefore.balFee0U96, "Balancer fees for token0 shouldn't be collected.")
          expect(balFeesAfter.balFee1U96).to.eq(balFeesBefore.balFee1U96, "Balancer fees for token1 shouldn't be collected.")

          // Update the model
          poolModel.setCollectBalancerFees(false)
          poolModel.swap0To1(swapAmt2k)
        })

        it ("should contain the correct supply of LP tokens", async function() {
          let lpSupply = await poolContract.totalSupply()
          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
        })

        it ("should contain the correct reserves", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
           
        it ("should resume accumulating Balancer fees for a short term swap", async function () {
          const balFeesBefore = await poolContract.getBalancerFeeAmounts()
          
          // Enable Balancer Fees
          await poolContract.connect(owner).setCollectBalancerFees(true)
          await mineBlocks()

          // Perform a Swap
          const swapAmt2k = scaleUp(2_000n, TOKEN1_DECIMALS)
          const swap = swapMgr.newSwap1To0()
          await swap.shortTerm(swapAmt2k, addr1)

          // Ensure Balancer Fees Collected
          const stFeeBP = await poolContract.getShortTermFeePoints()
          const BP = BigNumber.from(100000)
          const balFee = await poolContract.getBalancerFee()
          const balFeeDenominator = scaleUp(1n, 18n)

          const expectedBalFeesAdded = {
            token0: BigNumber.from(0),
            token1: BalMath.divDown(BalMath.divUp(swapAmt2k.mul(stFeeBP), BP).mul(balFee), balFeeDenominator)
          }

          const balFeesAfter = await poolContract.getBalancerFeeAmounts()
          const balFeesAdded = {
            token0: balFeesAfter.balFee0U96.sub(balFeesBefore.balFee0U96),
            token1: balFeesAfter.balFee1U96.sub(balFeesBefore.balFee1U96)
          }
          let tolerance = 1n
          expect(balFeesAdded.token0).to.be.closeTo(expectedBalFeesAdded.token0, tolerance)
          expect(balFeesAdded.token1).to.be.closeTo(expectedBalFeesAdded.token1, tolerance)

          // Update the model
          poolModel.setCollectBalancerFees(true)
          poolModel.swap1To0(swapAmt2k)
        })

        it ("should contain the correct supply of LP tokens", async function() {
          let lpSupply = await poolContract.totalSupply()
          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
        })

        it ("should contain the correct reserves", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
      })

      describe("Long Term Swap 100k T0->T1 in 10 intervals", function() {
        const swapAmt100k = scaleUp(100_000n, TOKEN0_DECIMALS)
        let swapParams: LTSwapParams
        let swap: Swap
        let lastVirtualOrderBlock: number
        let initBalancerFees: any

        it ("should issue an LT swap", async function() {
          const intervals = 10
          swap = swapMgr.newSwap0To1()
          const swapObjects = await swap.longTerm(swapAmt100k, intervals, addr1)

          // Note that swap params emmulates the state of the virtual order, but has to use the block
          // number after the order is mined or you get a mismatch
          let blockNumber = await getLastBlockNumber()
          lastVirtualOrderBlock = blockNumber

          // Update the pool model to show the amount deposited into Balancer Vault
          swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, blockNumber, swapAmt100k, intervals)

          initBalancerFees = await poolContract.getBalancerFeeAmounts()
        })

        it ("should contain the correct supply of LP tokens", async function() {
          let lpSupply = await poolContract.totalSupply()
          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
        })

        it ("should contain the correct reserves", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
           
        it ("should stop accumulating Balancer fees during a long term swap", async function () {
          // Now turn off balancer fee collection and mine 1/4 of teh order's blocks, then run
          // virtual order execution and ensure that no additional balancer fees were collected:

          // Disable Balancer Fees:
          await poolContract.connect(owner).setCollectBalancerFees(false)
          poolModel.setCollectBalancerFees(false)

          // Mine 1/4 of the order's of blocks:
          const { swapLengthBlocks } = swapParams
          const oneQuarterBlocks = Math.floor(swapLengthBlocks / 4)
          await mineBlocks(oneQuarterBlocks)

          // Run execute virtual orders (to cement the lack of fee collection for
          // balancer so we can get the updated state showing no fees collected):
          await poolContract.executeVirtualOrdersToBlock(0)
          await mineBlocks()

          // Update the model
          poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                               BigNumber.from(0),
                                               lastVirtualOrderBlock,
                                               await getLastBlockNumber(),
                                               BLOCK_INTERVAL)
          
          // Update the LVOB stored accounting for EVO call
          lastVirtualOrderBlock = await getLastBlockNumber()

          // Ensure that no balancer fees were collected
          const balFeesAfter = await poolContract.getBalancerFeeAmounts()
          expect(balFeesAfter.balFee0U96).to.be.equal(initBalancerFees.balFee0U96)
          expect(balFeesAfter.balFee1U96).to.be.equal(initBalancerFees.balFee1U96)
        })

        it ("should contain the correct supply of LP tokens", async function() {
          let lpSupply = await poolContract.totalSupply()
          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
        })

        it ("should contain the correct reserves", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
           
        it ("should resume accumulating Balancer fees during a long term swap", async function () {
          // We now re-enable balancer fee collection and mine the rest of the order. We should 
          // observe a proportional collection of balancer fees because virtual orders was 
          // executed 1/4 of the way through the order without collecting balancer fees:
          await poolContract.connect(owner).setCollectBalancerFees(true)
          poolModel.setCollectBalancerFees(true)

          // Mine the rest of the order's blocks:
          let blockNumber = await getLastBlockNumber()
          const numBlocksToMine = swapParams.swapExpiryBlock - blockNumber

          await mineBlocks(numBlocksToMine)
          blockNumber = await getLastBlockNumber()

          // Run execute virtual orders to cement the balancer fee collection into state
          // for comparison (no view function to run EVO and get virtual balancer fees):
          await poolContract.executeVirtualOrdersToBlock(0)
          await mineBlocks()

          // Update the model
          poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                              BigNumber.from(0),
                                              lastVirtualOrderBlock,
                                              blockNumber,
                                              BLOCK_INTERVAL)

          // Ensure that balancer fees were collected:
          const token0SoldDuringFees = BigNumber.from(numBlocksToMine).mul(swapParams.sellingRate)
          const ltFeeBP = await poolContract.getLongTermFeePoints()
          const BP = BigNumber.from(100000)
          const balFee = await poolContract.getBalancerFee()
          const balFeeDenominator = scaleUp(1n, 18n)
          const expectedBalFeesAdded = {
            token0: BalMath.divDown(BalMath.divUp(token0SoldDuringFees.mul(ltFeeBP), BP).mul(balFee), balFeeDenominator),
            token1: BigNumber.from(0)
          }

          const balFeesAfter = await poolContract.getBalancerFeeAmounts()
          const balFeesAdded = {
            token0: balFeesAfter.balFee0U96.sub(initBalancerFees.balFee0U96),
            token1: balFeesAfter.balFee1U96.sub(initBalancerFees.balFee1U96)
          }

          let tolerance = 10n
          expect(balFeesAdded.token0).to.be.closeTo(expectedBalFeesAdded.token0, tolerance)
          expect(balFeesAdded.token1).to.be.closeTo(expectedBalFeesAdded.token1, tolerance)
        })

        it ("should contain the correct supply of LP tokens", async function() {
          let lpSupply = await poolContract.totalSupply()
          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
        })

        it ("should contain the correct reserves", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
      })
    })
  })

  describe("Cronfi Fee Advanced Tests", function() {
    describe("Cronfi Fee Collection Enable / Disable During Concurrent LT Swap", function() {
      let cfFeesBefore: any
      let swapT0: Swap
      let swapT1: Swap
      let swapParamsT0: LTSwapParams
      let swapParamsT1: LTSwapParams
      let lastVirtualOrderBlock: number

      it ("should setup concurrent opposing 5k LT swaps over 5 intervals", async function () {
        // Issue a concurrent LT Swap:
        swapT0 = swapMgr.newSwap0To1()
        swapT1 = swapMgr.newSwap1To0()
        const intervals = 5
        const doSwap = false
        const swapAmtT05k = scaleUp(5_000n, TOKEN0_DECIMALS)
        const swapAmtT15k = scaleUp(5_000n, TOKEN1_DECIMALS)
        const swapObjectsT0 = await swapT0.longTerm(swapAmtT05k, intervals, addr1, doSwap)
        const swapObjectsT1 = await swapT1.longTerm(swapAmtT15k, intervals, addr2, doSwap)
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
        
        // Note that swap params emmulates the state of the virtual order, but has to use the block
        // number after the order is mined or you get a mismatch
        let blockNumber = await getLastBlockNumber()
        
        // Update the pool model to show the amount deposited into Balancer Vault
        swapParamsT0 = poolModel.ltSwap0To1(BLOCK_INTERVAL,
                                            blockNumber,
                                            swapAmtT05k,
                                            intervals)
        swapParamsT1 = poolModel.ltSwap1To0(BLOCK_INTERVAL,
                                            blockNumber,
                                            swapAmtT15k,
                                            intervals)
        lastVirtualOrderBlock = blockNumber

        cfFeesBefore = await poolContract.getCronFeeAmounts()
      })
      
      it ("should contain the correct supply of LP tokens", async function() {
        let lpSupply = await poolContract.totalSupply()
        const tolerance = DEV_TOLERANCE
        expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
      })

      it ("should contain the correct reserves immediately after mining the orders", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
         
      it ("should have the correct fees immediately after mining the orders", async function() {
        await checkFees(poolContract, poolModel)
      })

      it ("should not accumulate CronFi fees when the feeTo address is the NULL ADDRESS", async function () {
        // Mine 1/2 way through the order, not collecting cron fi fees and run execute virtual
        // orders to store the fees collected in state. Ensure the cron fi fees collected are zero.
        const numBlocksToMine = Math.floor((swapParamsT0.swapExpiryBlock - lastVirtualOrderBlock) / 2)
        await mineBlocks(numBlocksToMine)

        // Run execute virtual orders to cement the CronFi fee collection into state
        // for comparison (no view function to run EVO and get virtual CronFi fees):
        await poolContract.connect(addr2).executeVirtualOrdersToBlock(0)    // EVO to current block
        await mineBlocks()
        const blockNumber = await getLastBlockNumber()
        
        // Update the model
        poolModel.twammReserveConcurrentSwap(swapParamsT0.sellingRate,
                                             swapParamsT1.sellingRate,
                                             lastVirtualOrderBlock,
                                             blockNumber,
                                             BLOCK_INTERVAL)
        lastVirtualOrderBlock = blockNumber

        // Ensure that no CronFi fees were collected:
        const cfFees = await poolContract.getCronFeeAmounts()
        expect(cfFees.cronFee0U96).to.be.equal(cfFeesBefore.cronFee0U96)
        expect(cfFees.cronFee1U96).to.be.equal(cfFeesBefore.cronFee1U96)
      })

      it ("should contain the correct supply of LP tokens", async function() {
        let lpSupply = await poolContract.totalSupply()
        expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), DEV_TOLERANCE)
      })
      
      it ("should contain the correct reserves 1/2 way through the order after an EVO", async function() {
        const tolerance = 27
        const reserveData = await getReserveData(poolHelper, poolModel, tolerance)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        const tolerance = 27
        testBalanceData(balanceData, tolerance)
      })

      it ("should indicate CronFi fees are not being collected when asked", async function () {
        const collecting: boolean = await poolContract.isCollectingCronFees()
        expect(collecting).to.be.equal(false);
      })
         
      it ("should accumulate CronFi fees when the feeTo address is not the NULL ADDRESS", async function () {
        // Capture Initial Balancer Fees to remove in later comparison
        const initBalFees = await poolContract.getBalancerFeeAmounts()
        
        // Now set the feeTo address and mine through the rest of the order. Then run execute virtual orders
        // to confirm that the CronFi fees were collected:
        await poolContract.connect(owner).setFeeAddress(feeAddr1.address)

        let blockNumber = await getLastBlockNumber()
        const numBlocksToMine = Math.floor(swapParamsT0.swapExpiryBlock - blockNumber)
        await mineBlocks(numBlocksToMine)
        blockNumber = await getLastBlockNumber()
        
        // Run execute virtual orders to cement the CronFi fee collection into state
        // for comparison (no view function to run EVO and get virtual CronFi fees):
        await poolContract.connect(addr2).executeVirtualOrdersToBlock(0)    // EVO to current block
        await mineBlocks()

        // Update the model
        poolModel.setCollectCronFiFees(true)
        poolModel.twammReserveConcurrentSwap(swapParamsT0.sellingRate,
                                             swapParamsT1.sellingRate,
                                             lastVirtualOrderBlock,
                                             blockNumber,
                                             BLOCK_INTERVAL)
        lastVirtualOrderBlock = blockNumber
        
        // Ensure that CronFi & Balancer fees were collected properly:
        //
        // Note: important to check Balancer fees as that indirectly checks LP
        // reinvestment as well.
        //
        const token0SoldDuringCFees = BigNumber.from(numBlocksToMine).mul(swapParamsT0.sellingRate)
        const token1SoldDuringCFees = BigNumber.from(numBlocksToMine).mul(swapParamsT1.sellingRate)

        const ltFeeBP = await poolContract.getLongTermFeePoints()
        const balFee = await poolContract.getBalancerFee()
        const BP = BigNumber.from(100000)
        const balFeeDenominator = scaleUp(1n, 18n)

        const expectedGrossFees = {
          token0: BalMath.divUp(token0SoldDuringCFees.mul(ltFeeBP), BP),
          token1: BalMath.divUp(token1SoldDuringCFees.mul(ltFeeBP), BP),
        }
        
        // Balancer Fees:
        //
        const expectedBalFee = {
          token0: BalMath.divDown(expectedGrossFees.token0.mul(balFee), balFeeDenominator),
          token1: BalMath.divDown(expectedGrossFees.token1.mul(balFee), balFeeDenominator),
        }
        const totalBalFees = await poolContract.getBalancerFeeAmounts()
        const incrementalBalFees = {
          token0: totalBalFees.balFee0U96.sub(initBalFees.balFee0U96),
          token1: totalBalFees.balFee1U96.sub(initBalFees.balFee1U96)
        }
        let tolerance = 13n
        expect(incrementalBalFees.token0, "Balancer Fee Mismatch").to.be.closeTo(expectedBalFee.token0, tolerance)
        expect(incrementalBalFees.token1, "Balancer Fee Mismatch").to.be.closeTo(expectedBalFee.token1, tolerance)

        // CronFi Fees:
        //
        const feeShare = BigNumber.from(3)
        const expectedFeeShare = {
          token0: BalMath.divUp(expectedGrossFees.token0.sub(expectedBalFee.token0), feeShare),
          token1: BalMath.divUp(expectedGrossFees.token1.sub(expectedBalFee.token1), feeShare)
        }
        
        const expectedCronFee = {
          token0: expectedFeeShare.token0,
          token1: expectedFeeShare.token1
        }
        const cronFees = await poolContract.getCronFeeAmounts()
        tolerance = 4n
        expect(cronFees.cronFee0U96, "CronFi Fee Mismatch").to.be.closeTo(expectedCronFee.token0, tolerance)
        expect(cronFees.cronFee1U96, "CronFi Fee Mismatch").to.be.closeTo(expectedCronFee.token1, tolerance)
      })
      
      it ("should indicate CronFi fees ARE are being collected when asked", async function () {
        const collecting: boolean = await poolContract.isCollectingCronFees()
        expect(collecting).to.be.equal(true);
      })

      it ("should contain the correct supply of LP tokens", async function() {
        let lpSupply = await poolContract.totalSupply()
        const tolerance = DEV_TOLERANCE
        expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
      })

      it ("should contain the correct all the way through the order after an EVO", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
    })

    describe("CronFi Fee Withdraw Permission Checks", function () {
      describe("Negative Tests", function() {
        it ("should not permit the collection of CronFi fees by addresses other than the feeTo address", async function () {
          for (const signerAddr of [admin2, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]) {
            // Build a withdraw request and mine it:
            const withdrawExitObj = await poolHelper.getCronFiFeeWithdrawExitObjects()
            const vaultContract = poolHelper.getVaultContract()
            await expect ( vaultContract.connect(signerAddr).exitPool( poolHelper.getPoolId(),
                                                                      signerAddr.address,
                                                                      signerAddr.address,
                                                                      withdrawExitObj )
                        ).to.be.revertedWith("CFI#007");
          }
        })
      })

      describe("Positive Withdraw Test", function() {
        let cronFeesAtStart: any
        let feeAddrBalancesAtStart: TokenPairAmtType

        it ("should permit the collection of CronFi fees by the feeTo address", async function () {
          // Grab the CronFi fees and fee address balances at the start of the test
          cronFeesAtStart = await poolContract.getCronFeeAmounts()
          feeAddrBalancesAtStart = {
            token0: await token0AssetContract.balanceOf(feeAddr1.address),
            token1: await token1AssetContract.balanceOf(feeAddr1.address)
          }

          // Build a withdraw request and mine it:
          const withdrawExitObj = await poolHelper.getCronFiFeeWithdrawExitObjects()
          const vaultContract = poolHelper.getVaultContract()
          await vaultContract.connect(feeAddr1).exitPool( poolHelper.getPoolId(),
                                                          feeAddr1.address,
                                                          feeAddr1.address,
                                                          withdrawExitObj )
          await mineBlocks()

          // Update the model
          const vaultReserves = poolModel.getVaultReserves()
          const cronFiFees = poolModel.getCronFiFees()
          poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.sub(cronFiFees.token0),
                                           reserve1: vaultReserves.reserve1.sub(cronFiFees.token1) })
          poolModel.updateCronFiFees( { token0: ZERO, token1: ZERO })
          poolModel.remitBalancerFees()
        })

        it ("should contain the correct reserves", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })

        it ("should have zero CronFi fees in the pool contract", async function () {
          const cronFeesAfter = await poolContract.getCronFeeAmounts()
          expect(cronFeesAfter.cronFee0U96).to.be.equal(ZERO)
          expect(cronFeesAfter.cronFee1U96).to.be.equal(ZERO)
        })

        it ("should have transferred CronFi fees to balances in the fee address", async function () {
          const feeAddrBalances = {
            token0: await token0AssetContract.balanceOf(feeAddr1.address),
            token1: await token1AssetContract.balanceOf(feeAddr1.address)
          }

          expect(feeAddrBalances.token0).to.not.equal(feeAddrBalancesAtStart.token0)
          expect(feeAddrBalances.token1).to.not.equal(feeAddrBalancesAtStart.token1)

          expect(feeAddrBalances.token0).to.be.equal(feeAddrBalancesAtStart.token0.add(cronFeesAtStart.cronFee0U96))
          expect(feeAddrBalances.token1).to.be.equal(feeAddrBalancesAtStart.token1.add(cronFeesAtStart.cronFee1U96))
        })
      })
    })
  })

  describe ("Advanced LP  join event Transfer Tests", function() {
    describe ("Functionality Tests", function() {
      let newLiquidity: TokenPairAmtType
      let mintTimeStamp: BigNumber

      it ("should mint liquidity with the new holding period", async function() {
          // Figure out the ratio of tokens to add to the pool, given an investment of 3k token0
          const pr = await poolHelper.getPoolReserves()
          const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
          const token1 = token0.mul(pr.reserve1).div(pr.reserve0)
          newLiquidity = { token0, token1 }

          // Transfer the tokens to the customer's wallet and approve them for the vault contract:
          await token0AssetContract.connect(owner).transfer(addr3.address, newLiquidity.token0);
          await token1AssetContract.connect(owner).transfer(addr3.address, newLiquidity.token1);
          await token0AssetContract.connect(addr3).approve(balancerVaultContract.address, newLiquidity.token0);
          await token1AssetContract.connect(addr3).approve(balancerVaultContract.address, newLiquidity.token1);
          let joinObjects = await poolHelper.getJoinObjects(newLiquidity.token0, newLiquidity.token1);
          await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)

          // Join the pool (mint, add liquidity):
          await balancerVaultContract.connect(addr3).joinPool(
            poolHelper.getPoolId(),
            addr3.address,
            addr3.address,
            joinObjects.joinStruct
          )
          const block = await ethers.provider.getBlock(await getLastBlockNumber())
          mintTimeStamp = BigNumber.from(block.timestamp);
          await mineBlocks();

          // Update the pool model
          //
          //   Update expected model values to account for Balancer Fee collection
          //   TODO: make this a convenience on the model (i.e. updateForJoin/Exit)
          //   IMPORTANT: if you get these balances for a check after pool model mint
          //              your checks will mismatch because the poolModel mint clears
          //              balancer fees.
          const vaultReserves = poolModel.getVaultReserves()
          const balancerFees = poolModel.getBalancerFees()
          poolModel.updateVaultReserves( { reserve0: vaultReserves.reserve0.sub(balancerFees.token0),
                                          reserve1: vaultReserves.reserve1.sub(balancerFees.token1) } )
          poolModel.updateBalancerFees( { token0: BigNumber.from(0), token1: BigNumber.from(0) } )
          poolModel.mint(addr3.address, newLiquidity.token0, newLiquidity.token1)
      })

      it ("should contain the correct supply of LP tokens", async function() {
        let lpSupply = await poolContract.totalSupply()
        const tolerance = DEV_TOLERANCE
        expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
      })

      it ("should contain the correct reserves after liquidity has been provided", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
 
      describe ("should penalize early liquidation with the new holding penalty", function() {
        let tokensLP: BigNumber
        let prevLpSupply: BigNumber

        let prevBalT0: BigNumber
        let prevBalT1: BigNumber
        let prevBalLP: BigNumber

        let modelTokensReturned: TokenPairAmtType

        it ("should allow the user to remove 100LP liquidity (burn, exit the pool)", async function() {
          tokensLP = scaleUp(100n, await poolContract.decimals())
          prevLpSupply = await poolContract.totalSupply()

          // Approve liquidity tokens to burn:
          // TODO: is this needed / correct approval process? <-- try without next line?
          await poolContract.connect(addr3).approve(balancerVaultContract.address, tokensLP);

          prevBalT0 = await token0AssetContract.balanceOf(addr3.address)
          prevBalT1 = await token1AssetContract.balanceOf(addr3.address)
          prevBalLP = await poolContract.balanceOf(addr3.address)

          // Exit the pool (burn, remove liquidity):
          const exitRequest = await poolHelper.getExitRequest(tokensLP)
          await balancerVaultContract.connect(addr3).exitPool(
            poolHelper.getPoolId(),
            addr3.address,
            addr3.address,
            exitRequest
          )
          await mineBlocks()

          // Update the pool model
          const penalizedLP = BigNumber.from(0);
          // NOTE: converting penaltyBP to BigNumber here b/c uint16 in Solidity
          // returns a number instead of a BigNumber in the implicitly created
          // getter or ts/js interfacing.
          const penaltyBP = BigNumber.from(0)
          modelTokensReturned = poolModel.burn(addr3.address, tokensLP, penalizedLP, penaltyBP)
        })

        it ("should burn the correct number of LP tokens", async function() {
          const lpSupply = await poolContract.totalSupply()
          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), DEV_TOLERANCE)

          const lpSupplyIdeal = prevLpSupply.sub(tokensLP)
          expect(lpSupply).to.eq(lpSupplyIdeal)
        })

        it ("should contain the correct reserves after liquidity has been removed", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
          
        it ("should transfer the correct number of tokens to the customer", async function() {
          const transferredT0 = (await token0AssetContract.balanceOf(addr3.address)).sub(prevBalT0)
          const transferredT1 = (await token1AssetContract.balanceOf(addr3.address)).sub(prevBalT1)
          const tolerance = DEV_TOLERANCE
          expect(transferredT0).to.be.closeTo(modelTokensReturned.token0, tolerance)
          expect(transferredT1).to.be.closeTo(modelTokensReturned.token1, tolerance)
        })

        it ("should transfer the correct number of LP tokens from the customer", async function() {
          const balanceLP = await poolContract.balanceOf(addr3.address)
          const idealBalanceLP = prevBalLP.sub(tokensLP)
          expect(balanceLP).to.eq(idealBalanceLP)
        })

        it ("should have the correct fees collected after burning liquidity", async function() {
          await checkFees(poolContract, poolModel)
        })
      })

      describe ("shouldn't penalize liquidity that satisifes the holding period", function() {
        let tokensLP: BigNumber
        let prevLpSupply: BigNumber

        let prevBalT0: BigNumber
        let prevBalT1: BigNumber
        let prevBalLP: BigNumber

        let modelTokensReturned: TokenPairAmtType

        it ("should allow the user to remove 200LP liquidity (burn, exit the pool)", async function() {
          tokensLP = scaleUp(200n, await poolContract.decimals())
          prevLpSupply = await poolContract.totalSupply()

          prevBalT0 = await token0AssetContract.balanceOf(addr1.address)
          prevBalT1 = await token1AssetContract.balanceOf(addr1.address)
          prevBalLP = await poolContract.balanceOf(addr1.address)

          // Exit the pool (burn, remove liquidity):
          const exitRequest = await poolHelper.getExitRequest(tokensLP)
          await balancerVaultContract.connect(addr1).exitPool(
            poolHelper.getPoolId(),
            addr1.address,
            addr1.address,
            exitRequest
          )
          await mineBlocks()

          // Update the pool model
          const penalizedLP = BigNumber.from(0);
          // NOTE: converting penaltyBP to BigNumber here b/c uint16 in Solidity
          // returns a number instead of a BigNumber in the implicitly created
          // getter or ts/js interfacing.
          const penaltyBP = BigNumber.from(0)
          modelTokensReturned = poolModel.burn(addr1.address, tokensLP, penalizedLP, penaltyBP)
        })

        it ("should burn the correct number of LP tokens", async function() {
          const lpSupply = await poolContract.totalSupply()
          const tolerance = DEV_TOLERANCE
          expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), DEV_TOLERANCE)

          const lpSupplyIdeal = prevLpSupply.sub(tokensLP)
          expect(lpSupply).to.eq(lpSupplyIdeal)
        })

        it ("should contain the correct reserves after liquidity has been removed", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
          
        it ("should transfer the correct number of tokens to the customer", async function() {
          const transferredT0 = (await token0AssetContract.balanceOf(addr1.address)).sub(prevBalT0)
          const transferredT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1)
          const tolerance = DEV_TOLERANCE
          expect(transferredT0).to.be.closeTo(modelTokensReturned.token0, tolerance)
          expect(transferredT1).to.be.closeTo(modelTokensReturned.token1, tolerance)
        })

        it ("should transfer the correct number of LP tokens from the customer", async function() {
          const balanceLP = await poolContract.balanceOf(addr1.address)
          const idealBalanceLP = prevBalLP.sub(tokensLP)
          expect(balanceLP).to.eq(idealBalanceLP)
        })

        it ("should have the correct fees collected after burning liquidity", async function() {
          await checkFees(poolContract, poolModel)
        })
      })
    })
  })
  
  describe ("Configurable Fee Tests", function() {
    let oldShortTermFee: BigNumber
    let oldPartnerFee: BigNumber
    let oldLongTermFee: BigNumber

    describe ("Permission, Access and Bounds Tests", function() {
      it ("should not allow non-administrators to change short term swap fees", async function() {
        oldShortTermFee = await poolContract.getShortTermFeePoints()
        const newFeeBP = 600 // 0.6%

        for (const addr of [feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]) {
          await poolContract.connect(addr).setParameter(ParamType.SwapFeeBP, newFeeBP)
          await mineBlocks()

          const feeBP = await poolContract.getShortTermFeePoints()
          expect(feeBP).to.not.eq(newFeeBP)
          expect(feeBP).to.eq(oldShortTermFee)
        }
      })

      it ("should not allow non-administrators to change partner swap fees", async function() {
        oldPartnerFee = await poolContract.getPartnerFeePoints()
        const newFeeBP = 700 // 0.7%

        for (const addr of [feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]) {
          await poolContract.connect(addr).setParameter(ParamType.PartnerFeeBP, newFeeBP)
          await mineBlocks()

          const feeBP = await poolContract.getPartnerFeePoints()
          expect(feeBP).to.not.eq(newFeeBP)
          expect(feeBP).to.eq(oldPartnerFee)
        }
      })

      it ("should not allow non-administrators to change long term swap fees", async function() {
        oldLongTermFee = await poolContract.getLongTermFeePoints()
        const newFeeBP = 800 // 0.8%

        for (const addr of [feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]) {
          await poolContract.connect(addr).setParameter(ParamType.LongSwapFeeBP, newFeeBP)
          await mineBlocks()

          const feeBP = await poolContract.getLongTermFeePoints()
          expect(feeBP).to.not.eq(newFeeBP)
          expect(feeBP).to.eq(oldLongTermFee)
        }
      })

      it ("should allow administrators to change short term swap fees", async function() {
        const newFeeBP = 350 // 0.350%

        await poolContract.connect(admin2).setParameter(ParamType.SwapFeeBP, newFeeBP)
        await mineBlocks()

        const feeBP = await poolContract.getShortTermFeePoints()
        expect(feeBP).to.not.eq(oldShortTermFee)
        expect(feeBP).to.eq(newFeeBP)
      })

      it ("should allow administrators to change partner swap fees", async function() {
        const newFeeBP = 400 // 0.400%

        await poolContract.connect(admin2).setParameter(ParamType.PartnerFeeBP, newFeeBP)
        await mineBlocks()

        const feeBP = await poolContract.getPartnerFeePoints()
        expect(feeBP).to.not.eq(oldPartnerFee)
        expect(feeBP).to.eq(newFeeBP)
      })

      it ("should allow administrators to change long term swap fees", async function() {
        const newFeeBP = 450 // 0.450%

        await poolContract.connect(admin2).setParameter(ParamType.LongSwapFeeBP, newFeeBP)
        await mineBlocks()

        const feeBP = await poolContract.getLongTermFeePoints()
        expect(feeBP).to.not.eq(oldLongTermFee)
        expect(feeBP).to.eq(newFeeBP)
      })

      it ("should not allow administrators to change short term swap fees beyond maximum", async function() {
        const shortTermFeeBefore = await poolContract.getShortTermFeePoints()

        const maxShortTermFeeBP = BigNumber.from(1000)
        const excessFeeBP = maxShortTermFeeBP.add(1n)
        await poolContract.connect(admin2).setParameter(ParamType.SwapFeeBP, excessFeeBP)
        await mineBlocks()

        const feeBP = await poolContract.getShortTermFeePoints()
        expect(feeBP).to.not.eq(excessFeeBP)
        expect(feeBP).to.eq(shortTermFeeBefore)
      })

      it ("should not allow administrators to change partner swap fees beyond maximum", async function() {
        const partnerFeeBefore = await poolContract.getPartnerFeePoints()

        const maxPartnerFeeBP = BigNumber.from(1000)
        const excessFeeBP = maxPartnerFeeBP.add(1n)
        await poolContract.connect(admin2).setParameter(ParamType.PartnerFeeBP, excessFeeBP)
        await mineBlocks()

        const feeBP = await poolContract.getPartnerFeePoints()
        expect(feeBP).to.not.eq(excessFeeBP)
        expect(feeBP).to.eq(partnerFeeBefore)
      })

      it ("should not allow administrators to change long term swap fees beyond maximum", async function() {
        const longTermFeeBefore = await poolContract.getLongTermFeePoints()

        const maxLongTermFeeBP = BigNumber.from(1000)
        const excessFeeBP = maxLongTermFeeBP.add(1n)
        await poolContract.connect(admin2).setParameter(ParamType.LongSwapFeeBP, excessFeeBP)
        await mineBlocks()

        const feeBP = await poolContract.getLongTermFeePoints()
        expect(feeBP).to.not.eq(excessFeeBP)
        expect(feeBP).to.eq(longTermFeeBefore)
      })
    })

    describe ("ST Fee Configuration Tests", function() {
      const maxShortTermFeeBP = BigNumber.from(1000)

      let prevBalT1: BigNumber
      let expectedProceedsT1: BigNumber

      it ("should allow setting of a new short term fee by an admin", async function() {
          await poolContract.connect(admin2).setParameter(ParamType.SwapFeeBP, maxShortTermFeeBP)
          await mineBlocks()

          poolModel.setShortTermFee(maxShortTermFeeBP)
      })

      it ("should perform the swap without error", async function() {
        prevBalT1 = await token1AssetContract.balanceOf(addr1.address)

        const swapAmt5k = scaleUp(5_000n, TOKEN0_DECIMALS)
        const swap = swapMgr.newSwap0To1()
        await swap.shortTerm(swapAmt5k, addr1)
        
        expectedProceedsT1 = poolModel.swap0To1(swapAmt5k)
      })

      it ("should contain the correct reserves", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })
      
      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
      
      it ("should give the swap customer the correct proceeds", async function() {
        let balChangeT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1)
        let tolerance = DEV_TOLERANCE
        expect(balChangeT1).to.be.closeTo(expectedProceedsT1, tolerance)
      })

      it ("should have the correct fees collected", async function() {
        await checkFees(poolContract, poolModel)
      })
   })

   describe ("Partner Fee Configuration Tests", function() {
      const newPartnerFeeBP =  BigNumber.from(500)

      let prevBalT1: BigNumber
      let expectedProceedsT1: BigNumber

      it ("should allow setting of a new partner fee by an admin", async function() {
          await poolContract.connect(admin2).setParameter(ParamType.PartnerFeeBP, newPartnerFeeBP)
          await mineBlocks()

          poolModel.setPartnerFee(newPartnerFeeBP)
      })

      it("should allow a partner to call partner swap", async function() {
        prevBalT1 = await token1AssetContract.balanceOf(arbitrageur4.address)

        const swapAmt50k = scaleUp(50000n, TOKEN0_DECIMALS)
        const swap = swapMgr.newSwap0To1()
        const swapObjects = await swap.partnerSwap(swapAmt50k, arbitrageur4, partnerBloxRoute)

        expectedProceedsT1 = poolModel.partnerSwap0To1(swapAmt50k)
      })

      it ("should contain the correct reserves", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })
     
      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
          
      it ("should give the swap customer the correct proceeds", async function() {
        let balChangeT1 = (await token1AssetContract.balanceOf(arbitrageur4.address)).sub(prevBalT1)
        let tolerance = DEV_TOLERANCE
        expect(balChangeT1).to.be.closeTo(expectedProceedsT1, tolerance)
      })

      it ("should have the correct fees collected", async function() {
        await checkFees(poolContract, poolModel)
      })
    })
   
    describe ("LT Fee Configuration Tests", function() {
      const newLongTermFeeBP = BigNumber.from(750)

      const swapAmt150k = scaleUp(150_000n, TOKEN1_DECIMALS)
      let swapParams: LTSwapParams
      let lastVirtualOrderBlock: number
      let initialBalFeesToken1: BigNumber
      let swap: Swap
      
      it ("should allow setting of a new long term fee by an admin", async function() {
          await poolContract.connect(admin2).setParameter(ParamType.LongSwapFeeBP, newLongTermFeeBP)
          await mineBlocks()

          poolModel.setLongTermFee(newLongTermFeeBP)
      })

      it ("should issue the long-term swap order without error", async function() {
        // Capture the current contract fees to do a simple sanity check for correctness.
        const balancerFees = await poolContract.getBalancerFeeAmounts()
        initialBalFeesToken1 = balancerFees.balFee1U96

        let intervals = 10
        swap = swapMgr.newSwap1To0()
        const swapObjects = await swap.longTerm(swapAmt150k, intervals, addr3)

        // Note that swap params emmulates the state of the virtual order, but has to use the block
        // number after the order is mined or you get a mismatch
        let blockNumber = await getLastBlockNumber()

        // Update the pool model to show the amount deposited into Balancer Vault
        swapParams = poolModel.ltSwap1To0(BLOCK_INTERVAL, blockNumber, swapAmt150k, intervals)
        lastVirtualOrderBlock = blockNumber
      })

      it ("should contain the correct reserves immediately after mining the order", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })
       
      it ("should have the correct fees immediately after mining the order", async function() {
        await checkFees(poolContract, poolModel)
      })
      
      it ("should contain the correct reserves one block after mining the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.
        await mineBlocks()

        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(ZERO,
                                             swapParams.sellingRate,
                                             lastVirtualOrderBlock,
                                             await getLastBlockNumber(),
                                             BLOCK_INTERVAL)

        const tolerance = 23
        const reserveData = await getReserveData(poolHelper, poolModel, tolerance)
        compareReserveData(reserveData)

        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })

      it ("should contain correct reserves about half way through the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.

        // Mine about 1/2 way through the rest of the order:
        const blockNumber = await getLastBlockNumber()
        let numBlocksToMine = Math.floor((swapParams.swapExpiryBlock - blockNumber) / 2)
        await mineBlocks(numBlocksToMine)
        
        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(ZERO, 
                                             swapParams.sellingRate,
                                             lastVirtualOrderBlock,
                                             await getLastBlockNumber(),
                                             BLOCK_INTERVAL)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })
      
      it ("should contain correct reserves all the way through the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.

        // Mine through the rest of the order:
        const blockNumber = await getLastBlockNumber()
        let numBlocksToMine = swapParams.swapExpiryBlock - blockNumber
        await mineBlocks(numBlocksToMine)
        
        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(ZERO,
                                             swapParams.sellingRate,
                                             lastVirtualOrderBlock,
                                             await getLastBlockNumber(),
                                             BLOCK_INTERVAL)

        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
        
        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })

      it ("should contain the correct fees after executing virtual orders", async function() {
        lastVirtualOrderBlock = await getLastBlockNumber()
        await poolContract.connect(addr2).executeVirtualOrdersToBlock(0)    // EVO to current block
        await mineBlocks()
        
        // Update the model to match the EVO run
        let swapProceeds = poolModel.twammReserveConcurrentSwap(ZERO,
                                                                swapParams.sellingRate,
                                                                swapParams.swapStartBlock,
                                                                lastVirtualOrderBlock,
                                                                BLOCK_INTERVAL)

        await checkFees(poolContract, poolModel)
      })

      it ("should contain the correct reserves", async function() {
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should contain the correct balances", async function() {
        const balanceData = await getBalanceData(poolHelper, poolModel)
        testBalanceData(balanceData, DEV_TOLERANCE)
      })

      it ("should contain the expected additional balancer fees", async function () {
        const longTermFeeBP = await poolContract.getLongTermFeePoints()
        const actualSwapAmt = swapParams.sellingRate.mul(swapParams.swapLengthBlocks)
        const expectedFeesT1 = BalMath.divUp(actualSwapAmt.mul(longTermFeeBP), BP)
        const expectedBalFeesT1 = BalMath.divDown(expectedFeesT1.mul(BALANCER_FEE), DENOMINATOR_FP18)

        const balancerFees = await poolContract.getBalancerFeeAmounts()
        const balFeesChangeT1 = (balancerFees.balFee1U96).sub(initialBalFeesToken1)
        // TODO: Understand why this difference.  The model is tracking this accurately, but
        //       the calculation above is underestimating by a sizable amount.  (#FeeIssue)
        //       - Suspect iterative rounding, but this number still seems too high.
        const tolerance = 2283
        expect(balFeesChangeT1).to.be.closeTo(expectedBalFeesT1, tolerance)
      })
    })

    describe ("CronFi LT Fee Share Configuration Tests", function() {
      let oldFeeShift: BigNumber

      describe ("Permission, Access and Bounds Tests", function() {
        it ("should not allow non-factory owner to change Cron-Fi Fee Shift", async function() {
          oldFeeShift = await poolContract.getFeeShift()
          expect(oldFeeShift).to.eq(BigNumber.from(1n))   // Ensure it's the default and we're not
                                                          // setting it to it's current value

          const newFeeShift = BigNumber.from(4n)        // corresponds to feeShare -> 16
          const newFeeShift_U4 = BigNumber.from(4n)
          for (const addr of [admin2, feeAddr1, partnerBloxRoute, arbitrageur1, arbitrageur4, addr1]) {
            await poolContract.connect(addr).setFeeShift(newFeeShift)
            await mineBlocks()

            const feeShift = await poolContract.getFeeShift()
            expect(feeShift).to.not.eq(newFeeShift_U4)
            expect(feeShift).to.eq(oldFeeShift)
          }
        })

        it ("should allow factory owner to change Cron-Fi Fee Shift", async function() {
          const newFeeShift = BigNumber.from(3n)         // corresponds to feeShare -> 8
          const newFeeShift_U4 = BigNumber.from(3n)

          await poolContract.connect(owner).setFeeShift(newFeeShift)
          await mineBlocks()

          const feeShift = await poolContract.getFeeShift()
          expect(feeShift).to.not.eq(oldFeeShift)
          expect(feeShift).to.eq(newFeeShift_U4)
        })

        it ("should not allow factory owner to change Cron-Fi Fee Shift to unsupported amounts", async function() {
          const currentFeeShift = await poolContract.getFeeShift()

          for (const unsupportedFeeShift of [0, 5, 7, 9, 15, 17]) {
            await poolContract
                  .connect(owner)
                  .setFeeShift(BigNumber.from(unsupportedFeeShift))
            await mineBlocks()

            const feeShift = await poolContract.getFeeShift()
            expect(
              feeShift, 
              `Allowed unsupported fee shift ${unsupportedFeeShift}`
            ).to.eq(currentFeeShift)
          }
        })
      })

      describe ("Functionality Tests", function() {
        const newFeeShares = BigNumber.from(8)
        const newFeeShift = BigNumber.from(3)

        const swapAmt150k = scaleUp(150_000n, TOKEN0_DECIMALS)
        let swapParams: LTSwapParams
        let lastVirtualOrderBlock: number
        let initialBalFeesToken0: BigNumber
        let initialCronFiFeesToken0: BigNumber
        let swap: Swap

        it ("should allow fee shares to be set by a factory owner", async function() {
          await poolContract.connect(owner).setFeeShift(newFeeShift)
          await mineBlocks()

          poolModel.setFeeSharesLP(newFeeShares)
        })

        it ("should issue the long-term swap order without error", async function() {
          // Capture the current contract fees to do a simple sanity check for correctness.
          const balancerFees = await poolContract.getBalancerFeeAmounts()
          const cronFiFees = await poolContract.getCronFeeAmounts()
          initialBalFeesToken0 = balancerFees.balFee0U96
          initialCronFiFeesToken0 = cronFiFees.cronFee0U96

          let intervals = 10
          swap = swapMgr.newSwap0To1()
          const swapObjects = await swap.longTerm(swapAmt150k, intervals, addr3)

          // Note that swap params emmulates the state of the virtual order, but has to use the block
          // number after the order is mined or you get a mismatch
          let blockNumber = await getLastBlockNumber()
          
          // Update the pool model to show the amount deposited into Balancer Vault
          swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, blockNumber, swapAmt150k, intervals)
          lastVirtualOrderBlock = blockNumber
        })

        it ("should contain the correct reserves immediately after mining the order", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })
        
        it ("should have the correct fees immediately after mining the order", async function() {
          await checkFees(poolContract, poolModel)
        })
        
        it ("should contain the correct reserves one block after mining the order", async function() {
          // The vault and state reserves remain unchanged, only the view function (twamm reserves)
          // reserves should change.
          await mineBlocks()

          // Update the model to compare view function values, then undo
          poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                               ZERO,
                                               lastVirtualOrderBlock,
                                               await getLastBlockNumber(),
                                               BLOCK_INTERVAL)

          const tolerance = 28
          const reserveData = await getReserveData(poolHelper, poolModel, tolerance)
          compareReserveData(reserveData)

          poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
        })

        it ("should contain correct reserves about half way through the order", async function() {
          // The vault and state reserves remain unchanged, only the view function (twamm reserves)
          // reserves should change.

          // Mine about 1/2 way through the rest of the order:
          const blockNumber = await getLastBlockNumber()
          let numBlocksToMine = Math.floor((swapParams.swapExpiryBlock - blockNumber) / 2)
          await mineBlocks(numBlocksToMine)
          
          // Update the model to compare view function values, then undo
          poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                               ZERO,
                                               lastVirtualOrderBlock,
                                               await getLastBlockNumber(),
                                               BLOCK_INTERVAL)

          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)

          poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
        })
        
        it ("should contain correct reserves all the way through the order", async function() {
          // The vault and state reserves remain unchanged, only the view function (twamm reserves)
          // reserves should change.

          // Mine through the rest of the order:
          const blockNumber = await getLastBlockNumber()
          let numBlocksToMine = swapParams.swapExpiryBlock - blockNumber
          await mineBlocks(numBlocksToMine)
          
          // Update the model to compare view function values, then undo
          poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                               ZERO,
                                               lastVirtualOrderBlock,
                                               await getLastBlockNumber(),
                                               BLOCK_INTERVAL)

          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
          
          poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
        })

        it ("should contain the correct fees after executing virtual orders", async function() {
          lastVirtualOrderBlock = await getLastBlockNumber()
          await poolContract.connect(addr2).executeVirtualOrdersToBlock(0)    // EVO to current block
          await mineBlocks()
          
          // Update the model to match the EVO run
          let swapProceeds = poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                                                  ZERO,
                                                                  swapParams.swapStartBlock,
                                                                  lastVirtualOrderBlock,
                                                                  BLOCK_INTERVAL)

          await checkFees(poolContract, poolModel)
        })

        it ("should contain the correct reserves", async function() {
          const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
          compareReserveData(reserveData)
        })

        it ("should contain the correct balances", async function() {
          const balanceData = await getBalanceData(poolHelper, poolModel)
          testBalanceData(balanceData, DEV_TOLERANCE)
        })

        it ("should contain the expected additional balancer fees", async function () {
          const ltFeeBP = await poolContract.getLongTermFeePoints()
          const actualSwapAmt = swapParams.sellingRate.mul(swapParams.swapLengthBlocks)
          const expectedFeesT0 = (actualSwapAmt.mul(ltFeeBP)).div(BP)
          const expectedBalFeesT0 = (expectedFeesT0.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

          const balancerFees = await poolContract.getBalancerFeeAmounts()
          const balFeesChangeT0 = (balancerFees.balFee0U96).sub(initialBalFeesToken0)

          // TODO: Understand why this difference.  The model is tracking this accurately, but
          //       the calculation above is underestimating by a sizable amount.  (#FeeIssue)
          //       - Suspect iterative rounding, but this number still seems too high.
          const tolerance = 5713n 
          expect(balFeesChangeT0).to.be.closeTo(expectedBalFeesT0, tolerance)
        })

        it ("should contain the expected amount of cron fees", async function () {
          const ltFeeBP = await poolContract.getLongTermFeePoints()
          const actualSwapAmt = swapParams.sellingRate.mul(swapParams.swapLengthBlocks)
          const expectedFeesT0 = (actualSwapAmt.mul(ltFeeBP)).div(BP)
          const expectedCronAndLPFees = (expectedFeesT0.mul(DENOMINATOR_FP18.sub(BALANCER_FEE)))
                                        .div(DENOMINATOR_FP18)
          const expectedCronFees = expectedCronAndLPFees.div(newFeeShares.add(1n))

          const cronFiFees = await poolContract.getCronFeeAmounts()
          const cronFiFeesChangeT0 = (cronFiFees.cronFee0U96).sub(initialCronFiFeesToken0)

          // TODO: Understand why this difference.  The model is tracking this accurately, but
          //       the calculation above is underestimating by a sizable amount.  (#FeeIssue)
          //       - Suspect iterative rounding, but this number still seems high.
          const tolerance = 634n
          expect(cronFiFeesChangeT0).to.be.closeTo(expectedCronFees, tolerance)
        })
      })
    })
  })
  
  describe ("Miscellaneous Tests", function() {
    it ("should not allow a pool join with a null address recipient", async function() {
        // Figure out the ratio of tokens to add to the pool, given an investment of 3k token0
        const pr = await poolHelper.getPoolReserves()
        const token0 = scaleUp(3_000n, TOKEN0_DECIMALS)
        const token1 = token0.mul(pr.reserve1).div(pr.reserve0)
        const newLiquidity = { token0, token1 }
        
        // Transfer the tokens to the customer's wallet and approve them for the vault contract:
        await token0AssetContract.connect(owner).transfer(addr2.address, newLiquidity.token0);
        await token1AssetContract.connect(owner).transfer(addr2.address, newLiquidity.token1);
        await token0AssetContract.connect(addr2).approve(balancerVaultContract.address, newLiquidity.token0);
        await token1AssetContract.connect(addr2).approve(balancerVaultContract.address, newLiquidity.token1);
        let joinObjects = await poolHelper.getJoinObjects(newLiquidity.token0, newLiquidity.token1);
        await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)

        // Join the pool (mint, add liquidity):
        await expect(balancerVaultContract.connect(addr2).joinPool(
          poolHelper.getPoolId(),
          addr2.address,
          NULL_ADDR,    // recipient
          joinObjects.joinStruct
        )).to.be.revertedWith('CFI#226')
    })
  })
})
