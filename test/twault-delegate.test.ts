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

import { ReserveType, TokenPairAmtType, OracleState, SwapObjects } from "./helpers/types"
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
import { PoolType, ParamType, getBlockInterval } from "../scripts/utils/contractMgmt"

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
const INITIAL_LIQUIDITY_0 = scaleUp(10_000_000n, TOKEN0_DECIMALS);
const INITIAL_LIQUIDITY_1 = scaleUp(10_000_000n, TOKEN1_DECIMALS);

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

describe("Cron-Fi TWAMM DAO and Delegate LT Swap Role Tests", function ()
{
  let owner: SignerWithAddress,
      addr1: SignerWithAddress,
      DAO: SignerWithAddress,
      delegate: SignerWithAddress,
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
      addrs: SignerWithAddress[],
      nullAddr: SignerWithAddress;

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
    let evoMem: any
    ({evoMem, blockNumber} = await poolContract.callStatic.getVirtualReserves(blockNumber, false))
    return {
      reserve0: evoMem.token0ReserveU112,
      reserve1: evoMem.token1ReserveU112
    }
  }

  const getTradeBlocks = async (intervals: number, obi?: number): Promise<number> => {
    if (obi == undefined) {
      const POOL_TYPE = PoolType.Liquid
      obi = getBlockInterval(POOL_TYPE);
    }

    const blockNumber = await getLastBlockNumber() + 1
    const lastExpiryBlock = blockNumber - (blockNumber % obi)
    const orderExpiry = obi * (intervals + 1) + lastExpiryBlock
    return orderExpiry - blockNumber
  }

  before(async function () 
  {
    clearNextOrderId()
    await createSnapshot(waffle.provider);
    const result = await deployCommonContracts();
    BLOCK_INTERVAL = result.BLOCK_INTERVAL
    owner = result.owner;
    addr1 = result.addr1
    DAO = result.addr2
    delegate = result.addr3
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

    nullAddr = await ethers.getSigner(NULL_ADDR);

    oracleSamples = []
  })

  after(function () {
    restoreSnapshot(waffle.provider);
  })

  describe("Setup", function () {
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
  })

  describe("DAO LT-Swap Role Capability Checks", function() {
    const intervals = 3
    let swap: Swap;
    let swapAmtPerBlock: BigNumber
    let swapParams: LTSwapParams
    let swapObjects: SwapObjects;
    let tradeBlocks: number;
    let orderMineBlock: number

    it ("should issue an LT swap for 1 token per block of T0 for T1", async function() {
      tradeBlocks = await getTradeBlocks(intervals)
      swapAmtPerBlock = scaleUp(1n, TOKEN0_DECIMALS)
      const swapAmt = swapAmtPerBlock.mul(tradeBlocks)

      swap = swapMgr.newSwap0To1()
      swapObjects = await swap.longTerm(swapAmt, intervals, DAO)

      // Note that swap params emmulates the state of the virtual order, but has to use the block
      // number after the order is mined or you get a mismatch
      orderMineBlock = await getLastBlockNumber()

      // Update the pool model to show the amount deposited into Balancer Vault
      swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, orderMineBlock, swapAmt, intervals)
    })

    it ("should allow the DAO to withdraw part way through order", async function() {
      const blocksToMine = swapParams.swapLengthBlocks / 2
      await mineBlocks(blocksToMine);

      const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
      await swap.withdrawLongTerm()
      const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
      expect(afterBalT1).to.be.gt(prevBalT1)
    })
    
    it ("should allow the DAO to withdraw to another address part way through order", async function() {
      const blocksToMine = 10;
      await mineBlocks(blocksToMine);

      const prevBalT1 = await token1AssetContract.balanceOf(arbitrageur1.address)
      await swap.withdrawLongTerm(swap.getOrderId(), DAO, arbitrageur1)
      const afterBalT1 = await token1AssetContract.balanceOf(arbitrageur1.address)
      expect(afterBalT1).to.be.gt(prevBalT1)
    })
    
    it ("should allow the DAO to cancel the order", async function() {
      const blocksToMine = 10;
      await mineBlocks(blocksToMine);

      const prevBalT0 = await token0AssetContract.balanceOf(DAO.address)
      const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
      await swap.cancelLongTerm()
      const afterBalT0 = await token0AssetContract.balanceOf(DAO.address)
      const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
      expect(afterBalT0).to.be.gt(prevBalT0)
      expect(afterBalT1).to.be.gt(prevBalT1)
    })
    
    it ("should issue another LT swap for 1 token per block of T0 for T1", async function() {
      tradeBlocks = await getTradeBlocks(intervals)
      swapAmtPerBlock = scaleUp(1n, TOKEN0_DECIMALS)
      const swapAmt = swapAmtPerBlock.mul(tradeBlocks)

      swap = swapMgr.newSwap0To1()
      swapObjects = await swap.longTerm(swapAmt, intervals, DAO)

      // Note that swap params emmulates the state of the virtual order, but has to use the block
      // number after the order is mined or you get a mismatch
      orderMineBlock = await getLastBlockNumber()

      // Update the pool model to show the amount deposited into Balancer Vault
      swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, orderMineBlock, swapAmt, intervals)
    })
    
    it ("should allow the DAO to cancel the order, sending funds to another address", async function() {
      const blocksToMine = swapParams.swapLengthBlocks / 2
      await mineBlocks(blocksToMine);

      const prevBalT0 = await token0AssetContract.balanceOf(arbitrageur2.address)
      const prevBalT1 = await token1AssetContract.balanceOf(arbitrageur2.address)
      await swap.cancelLongTerm(swap.getOrderId(), DAO, arbitrageur2)
      const afterBalT0 = await token0AssetContract.balanceOf(arbitrageur2.address)
      const afterBalT1 = await token1AssetContract.balanceOf(arbitrageur2.address)
      expect(afterBalT0).to.be.gt(prevBalT0)
      expect(afterBalT1).to.be.gt(prevBalT1)
    })
  })

  describe("Delegate LT-Swap Role Capability Checks", function() {
    const intervals = 3
    let swap: Swap;
    let swapAmtPerBlock: BigNumber
    let swapParams: LTSwapParams
    let swapObjects: SwapObjects;
    let tradeBlocks: number;
    let orderMineBlock: number

    it ("should issue an LT swap for 1 token per block of T0 for T1", async function() {
      tradeBlocks = await getTradeBlocks(intervals)
      swapAmtPerBlock = scaleUp(1n, TOKEN0_DECIMALS)
      const swapAmt = swapAmtPerBlock.mul(tradeBlocks)

      swap = swapMgr.newSwap0To1()
      swapObjects = await swap.longTerm(swapAmt, intervals, DAO, true, true, delegate)

      // Note that swap params emmulates the state of the virtual order, but has to use the block
      // number after the order is mined or you get a mismatch
      orderMineBlock = await getLastBlockNumber()

      // Update the pool model to show the amount deposited into Balancer Vault
      swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, orderMineBlock, swapAmt, intervals)
    })

    it ("should allow the Delegate to withdraw part way through the order", async function() {
      const blocksToMine = swapParams.swapLengthBlocks / 2
      await mineBlocks(blocksToMine);

      const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
      const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
      await swap.withdrawLongTerm(swap.getOrderId(), delegate, DAO)
      const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
      const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
      expect(afterBalT1).to.be.gt(prevBalT1)
      expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
    })

    it ("should not allow the Delegate to withdraw to the Delegate address part way through the order", async function() {
      const blocksToMine = 10
      await mineBlocks(blocksToMine);
      
      const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
      const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
      await expect(swap.withdrawLongTerm(swap.getOrderId(), delegate, delegate)).to.be.revertedWith("CFI#010")
      const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
      const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
      expect(afterBalT1).to.be.eq(prevBalT1)
      expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
    })

    it ("should not allow the Delegate to withdraw to another address part way through the order", async function() {
      for (const destAddr of [owner, arbitrageur5, admin1]) {
        const blocksToMine = 10
        await mineBlocks(blocksToMine);
        
        const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
        const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
        const destPrevBalT1 = await token1AssetContract.balanceOf(destAddr.address)
        await expect(swap.withdrawLongTerm(swap.getOrderId(), delegate, destAddr)).to.be.revertedWith("CFI#010")
        const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
        const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
        const destAfterBalT1 = await token1AssetContract.balanceOf(destAddr.address)
        expect(afterBalT1).to.be.eq(prevBalT1)
        expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
        expect(destAfterBalT1).to.be.eq(destPrevBalT1)
      }
    })
    
    it ("should not allow the Delegate to cancel to the Delegate address part way through the order", async function() {
      const blocksToMine = 10
      await mineBlocks(blocksToMine);
      
      const prevBalT0 = await token1AssetContract.balanceOf(DAO.address)
      const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
      const delegatePrevBalT0 = await token1AssetContract.balanceOf(delegate.address)
      const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
      await expect(swap.cancelLongTerm(swap.getOrderId(), delegate, delegate)).to.be.revertedWith("CFI#010")
      const afterBalT0 = await token1AssetContract.balanceOf(DAO.address)
      const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
      const delegateAfterBalT0 = await token1AssetContract.balanceOf(delegate.address)
      const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
      expect(afterBalT0).to.be.eq(prevBalT0)
      expect(afterBalT1).to.be.eq(prevBalT1)
      expect(delegateAfterBalT0).to.be.eq(delegatePrevBalT0)
      expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
    })

    it ("should not allow the Delegate to cancel to another address part way through the order", async function() {
      for (const destAddr of [owner, arbitrageur5, admin1]) {
        const blocksToMine = 10
        await mineBlocks(blocksToMine);
        
        const prevBalT0 = await token1AssetContract.balanceOf(DAO.address)
        const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
        const delegatePrevBalT0 = await token1AssetContract.balanceOf(delegate.address)
        const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
        const destPrevBalT0 = await token1AssetContract.balanceOf(destAddr.address)
        const destPrevBalT1 = await token1AssetContract.balanceOf(destAddr.address)
        await expect(swap.cancelLongTerm(swap.getOrderId(), delegate, destAddr)).to.be.revertedWith("CFI#010")
        const afterBalT0 = await token1AssetContract.balanceOf(DAO.address)
        const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
        const delegateAfterBalT0 = await token1AssetContract.balanceOf(delegate.address)
        const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
        const destAfterBalT0 = await token1AssetContract.balanceOf(destAddr.address)
        const destAfterBalT1 = await token1AssetContract.balanceOf(destAddr.address)
        expect(afterBalT0).to.be.eq(prevBalT0)
        expect(afterBalT1).to.be.eq(prevBalT1)
        expect(delegateAfterBalT0).to.be.eq(delegatePrevBalT0)
        expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
        expect(destAfterBalT0).to.be.eq(destPrevBalT0)
        expect(destAfterBalT1).to.be.eq(destPrevBalT1)
      }
    })
    
    it ("should allow the Delegate to cancel part way through the order", async function() {
      const blocksToMine = 10
      await mineBlocks(blocksToMine);
      
      const prevBalT0 = await token1AssetContract.balanceOf(DAO.address)
      const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
      const delegatePrevBalT0 = await token1AssetContract.balanceOf(delegate.address)
      const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
      await swap.cancelLongTerm(swap.getOrderId(), delegate, DAO)
      const afterBalT0 = await token1AssetContract.balanceOf(DAO.address)
      const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
      const delegateAfterBalT0 = await token1AssetContract.balanceOf(delegate.address)
      const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
      expect(afterBalT0).to.be.gt(prevBalT0)
      expect(afterBalT1).to.be.gt(prevBalT1)
      expect(delegateAfterBalT0).to.be.eq(delegatePrevBalT0)
      expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
    })
  })
  
  describe("Other Address Capability Checks", function() {
    const intervals = 3
    let swap: Swap;
    let swapAmtPerBlock: BigNumber
    let swapParams: LTSwapParams
    let swapObjects: SwapObjects;
    let tradeBlocks: number;
    let orderMineBlock: number

    it ("should issue an LT swap for 1 token per block of T0 for T1", async function() {
      tradeBlocks = await getTradeBlocks(intervals)
      swapAmtPerBlock = scaleUp(1n, TOKEN0_DECIMALS)
      const swapAmt = swapAmtPerBlock.mul(tradeBlocks)

      swap = swapMgr.newSwap0To1()
      swapObjects = await swap.longTerm(swapAmt, intervals, DAO)

      // Note that swap params emmulates the state of the virtual order, but has to use the block
      // number after the order is mined or you get a mismatch
      orderMineBlock = await getLastBlockNumber()

      // Update the pool model to show the amount deposited into Balancer Vault
      swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, orderMineBlock, swapAmt, intervals)
    })

    it ("should not allow non Delegate or DAO addresses to withdraw part way through the order", async function() {
      for (const senderAddr of [owner, arbitrageur1, admin1, nullAddr]) {
        const blocksToMine = 10
        await mineBlocks(blocksToMine);
        
        const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
        const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
        const destPrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
        await expect(swap.withdrawLongTerm(swap.getOrderId(), senderAddr, DAO)).to.be.revertedWith("CFI#008")
        const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
        const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
        const destAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
        expect(afterBalT1).to.be.eq(prevBalT1)
        expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
        expect(destAfterBalT1).to.be.eq(destPrevBalT1)
      }
    })
    
    it ("should not allow non Delegate or DAO addresses to withdraw to another address part way through the order", async function() {
      for (const senderAddr of [owner, arbitrageur1, admin1, nullAddr]) {
        for (const destAddr of [owner, arbitrageur5, delegate]) {
          const blocksToMine = 10
          await mineBlocks(blocksToMine);
          
          const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
          const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
          const destPrevBalT1 = await token1AssetContract.balanceOf(destAddr.address)
          await expect(swap.withdrawLongTerm(swap.getOrderId(), senderAddr, destAddr)).to.be.revertedWith("CFI#010")
          const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
          const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
          const destAfterBalT1 = await token1AssetContract.balanceOf(destAddr.address)
          expect(afterBalT1).to.be.eq(prevBalT1)
          expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
          expect(destAfterBalT1).to.be.eq(destPrevBalT1)
        }
      }
    })
    
    it ("should not allow non Delegate or DAO addresses to cancel part way through the order", async function() {
      for (const senderAddr of [owner, arbitrageur5, admin1, nullAddr]) {
        const blocksToMine = 10
        await mineBlocks(blocksToMine);
        
        const prevBalT0 = await token1AssetContract.balanceOf(DAO.address)
        const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
        const delegatePrevBalT0 = await token1AssetContract.balanceOf(delegate.address)
        const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
        await expect(swap.cancelLongTerm(swap.getOrderId(), senderAddr, DAO)).to.be.revertedWith("CFI#008")
        const afterBalT0 = await token1AssetContract.balanceOf(DAO.address)
        const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
        const delegateAfterBalT0 = await token1AssetContract.balanceOf(delegate.address)
        const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
        expect(afterBalT0).to.be.eq(prevBalT0)
        expect(afterBalT1).to.be.eq(prevBalT1)
        expect(delegateAfterBalT0).to.be.eq(delegatePrevBalT0)
        expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
      }
    })
    
    it ("should not allow non Delegate or DAO addresses to cancel to another address part way through the order", async function() {
      for (const senderAddr of [owner, arbitrageur5, admin1, nullAddr]) {
        for (const destAddr of [owner, arbitrageur5, delegate]) {
          const blocksToMine = 10
          await mineBlocks(blocksToMine);
          
          const prevBalT0 = await token1AssetContract.balanceOf(DAO.address)
          const prevBalT1 = await token1AssetContract.balanceOf(DAO.address)
          const delegatePrevBalT0 = await token1AssetContract.balanceOf(delegate.address)
          const delegatePrevBalT1 = await token1AssetContract.balanceOf(delegate.address)
          const destPrevBalT0 = await token1AssetContract.balanceOf(destAddr.address)
          const destPrevBalT1 = await token1AssetContract.balanceOf(destAddr.address)
          await expect(swap.cancelLongTerm(swap.getOrderId(), senderAddr, destAddr)).to.be.revertedWith("CFI#010")
          const afterBalT0 = await token1AssetContract.balanceOf(DAO.address)
          const afterBalT1 = await token1AssetContract.balanceOf(DAO.address)
          const delegateAfterBalT0 = await token1AssetContract.balanceOf(delegate.address)
          const delegateAfterBalT1 = await token1AssetContract.balanceOf(delegate.address)
          const destAfterBalT0 = await token1AssetContract.balanceOf(destAddr.address)
          const destAfterBalT1 = await token1AssetContract.balanceOf(destAddr.address)
          expect(afterBalT0).to.be.eq(prevBalT0)
          expect(afterBalT1).to.be.eq(prevBalT1)
          expect(delegateAfterBalT0).to.be.eq(delegatePrevBalT0)
          expect(delegateAfterBalT1).to.be.eq(delegatePrevBalT1)
          expect(destAfterBalT0).to.be.eq(destPrevBalT0)
          expect(destAfterBalT1).to.be.eq(destPrevBalT1)
        }
      }
    })
  })
})
