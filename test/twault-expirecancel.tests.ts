import { expect } from "chai"

import { waffle } from "hardhat"
import { createSnapshot, restoreSnapshot } from "./helpers/snapshots"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers";

import { ReserveType, TokenPairAmtType, OracleState, SwapObjects } from "./helpers/types"
import { clearNextOrderId,
         Swap,
         SwapManager,
         VaultTwammPoolAPIHelper } from "./helpers/vaultTwammPoolAPIHelper"
import { PoolModel } from "./model_v2/vaultTwammPool"
import { LTSwapParams } from "./model_v1/types"
import { scaleUp,
         getLastBlockNumber,
         mineBlocks } from "./helpers/misc"      
import { PoolType, getBlockInterval } from "../scripts/utils/contractMgmt"

import { deployCommonContracts } from './common';
import {clear} from "console";

// Logging:
const ds = require("../scripts/utils/debugScopes");
const log = ds.getLog("twault-cancel");

const ZERO = BigNumber.from(0)

// Equal initial liquidity for both token 0 & 1 of 1M tokens (accounting for 18 decimals).
const TOKEN0_DECIMALS = 18;
const TOKEN1_DECIMALS = 18;
const INITIAL_LIQUIDITY_0 = scaleUp(1_000_000n, TOKEN0_DECIMALS);
const INITIAL_LIQUIDITY_1 = scaleUp(1_000_000n, TOKEN1_DECIMALS);

describe("Cron-Fi TWAMM Pool Cancel Test", function ()
{
  let owner: SignerWithAddress,
      addr1: SignerWithAddress;

  let oracleSamples: OracleState[]

  let poolHelper: VaultTwammPoolAPIHelper;
  let swapMgr: SwapManager;

  let poolModel: PoolModel;
    
  // Contracts for testing into local vars:
  let token0AssetContract: any;
  let token1AssetContract: any;
  let balancerVaultContract: any;
  let poolContract: any;

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
    const avgP0 = (tsDiff.gt(0)) ? (end.p0.sub(start.p0)).div(tsDiff) : NaN
    const avgP1 = (tsDiff.gt(0)) ? (end.p1.sub(start.p1)).div(tsDiff) : NaN
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
              `    avg p0=${avgP0}\n` +
              `    avg p1=${avgP1}\n`);
  }

  const getOracleStateFromStruct = (oracleStruct: any): OracleState => {
    const { timestamp, token0U256F112, token1U256F112 } = oracleStruct
    return {
      p0: token0U256F112,
      p1: token1U256F112,
      timeStampSec: timestamp
    }
  }

  const sampleOracle = async(): Promise<OracleState> => {
    const oracle = getOracleStateFromStruct(await poolContract.getPriceOracle())
    oracleSamples.push(oracle)

    return oracle
  }

  // Converts types
  const _getReserveAmounts = async(poolContract: any, blockNumber?: number): Promise<ReserveType> => {
    blockNumber = (blockNumber != undefined) ? blockNumber : await getLastBlockNumber() + 1;
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
    clearNextOrderId();
    await createSnapshot(waffle.provider);
    const result = await deployCommonContracts();
    BLOCK_INTERVAL = result.BLOCK_INTERVAL
    owner = result.owner;
    addr1 = result.addr1
    poolHelper = result.poolHelper
    swapMgr = result.swapMgr
    poolModel = result.poolModel
    token0AssetContract = result.token0AssetContract
    token1AssetContract = result.token1AssetContract
    balancerVaultContract = result.balancerVaultContract
    poolContract = result.poolContract

    oracleSamples = []
  })

  after(function () {
    restoreSnapshot(waffle.provider);
  })

  describe("Cancel after order expiry should behave correctly", function() {
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

    const intervals = 3
    let swap: Swap;
    let swapAmtPerBlock: BigNumber
    let swapParams: LTSwapParams
    let swapObjects: SwapObjects;
    let tradeBlocks: number;
    let orderMineBlock: number

    it ("should allow a 3 interval LT swap of 1 T0 per block", async function() {
      tradeBlocks = await getTradeBlocks(intervals)
      swapAmtPerBlock = scaleUp(1n, TOKEN0_DECIMALS)
      const swapAmt = swapAmtPerBlock.mul(tradeBlocks)

      swap = swapMgr.newSwap0To1()
      swapObjects = await swap.longTerm(swapAmt, intervals, addr1)

      // Note that swap params emmulates the state of the virtual order, but has to use the block
      // number after the order is mined or you get a mismatch
      orderMineBlock = await getLastBlockNumber()

      // Update the pool model to show the amount deposited into Balancer Vault
      swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, orderMineBlock, swapAmt, intervals)
    })

    it ("should not allow a cancel after order expired", async function() {
      // Mine all the way through the order:
      //
      let lastBlock = await getLastBlockNumber()
      const blocksToMine = swapParams.swapExpiryBlock - lastBlock
      expect(blocksToMine).to.be.gt(0)
      await mineBlocks(blocksToMine)

      // Confirm that the order we're trying to cancel has expired:
      //
      const orderIdObj = await poolContract.getOrderIds(addr1.address, 0, 10)
      expect(orderIdObj.numResults).to.eq(1)
      const order = await poolContract.getOrder(orderIdObj.orderIds[0])
      lastBlock = await getLastBlockNumber()
      expect(order.orderExpiry).to.be.lte(lastBlock)

      // Try to cancel the order
      //
      await expect(swap.cancelLongTerm()).to.be.revertedWith("CFI#227")
    })

    it ("should allow withdraw of the order", async function() {
      await swap.withdrawLongTerm()
    })
  })

  describe("Cancel after order expiry with EVO should behave correctly", function() {
    const intervals = 2
    let swap: Swap;
    let swapAmtPerBlock: BigNumber
    let swapParams: LTSwapParams
    let swapObjects: SwapObjects;
    let tradeBlocks: number;
    let orderMineBlock: number

    it ("should allow a 2 interval LT swap of 1 T1 per block", async function() {
      tradeBlocks = await getTradeBlocks(intervals)
      swapAmtPerBlock = scaleUp(1n, TOKEN1_DECIMALS)
      const swapAmt = swapAmtPerBlock.mul(tradeBlocks)

      swap = swapMgr.newSwap1To0()
      swapObjects = await swap.longTerm(swapAmt, intervals, addr1)

      // Note that swap params emmulates the state of the virtual order, but has to use the block
      // number after the order is mined or you get a mismatch
      orderMineBlock = await getLastBlockNumber()

      // Update the pool model to show the amount deposited into Balancer Vault
      swapParams = poolModel.ltSwap1To0(BLOCK_INTERVAL, orderMineBlock, swapAmt, intervals)
    })

    it ("should run to order expiry and permit EVO", async function() {
      // Mine all the way through the order:
      //
      let lastBlock = await getLastBlockNumber()
      const blocksToMine = swapParams.swapExpiryBlock - lastBlock
      expect(blocksToMine).to.be.gt(0)
      await mineBlocks(blocksToMine)

      // Confirm that the order we're trying to cancel has expired:
      //
      const orderIdObj = await poolContract.getOrderIds(addr1.address, 0, 10)
      expect(orderIdObj.numResults).to.eq(2)
      const order = await poolContract.getOrder(orderIdObj.orderIds[1])
      lastBlock = await getLastBlockNumber()
      expect(order.orderExpiry).to.be.lte(lastBlock)

      // Run EVO:
      //
      await poolContract.executeVirtualOrdersToBlock(lastBlock)
      await mineBlocks()
    })

    it ("should not allow a cancel after order expired", async function() {
      // Try to cancel the order
      //
      await expect(swap.cancelLongTerm()).to.be.revertedWith("CFI#227")
    })

    it ("should allow withdraw of the order", async function() {
      await swap.withdrawLongTerm()
    })
  })
})


