import { expect } from "chai"

import { waffle } from "hardhat"
import { createSnapshot, restoreSnapshot } from "./helpers/snapshots"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers";

import { ReserveType, TokenPairAmtType, OracleState, SwapObjects } from "./helpers/types"
import { clearNextOrderId, Swap,
         SwapManager,
         VaultTwammPoolAPIHelper } from "./helpers/vaultTwammPoolAPIHelper"
import { PoolModel } from "./model_v2/vaultTwammPool"
import { LTSwapParams } from "./model_v1/types"
import { scaleUp,
         getLastBlockNumber,
         mineBlocks } from "./helpers/misc"      
import { PoolType, getBlockInterval } from "../scripts/utils/contractMgmt"

import { deployCommonContracts } from './common';

// Logging:
const ds = require("../scripts/utils/debugScopes");
const log = ds.getLog("twault-oracle");

const ZERO = BigNumber.from(0)

// Equal initial liquidity for both token 0 & 1 of 1M tokens (accounting for 18 decimals).
const TOKEN0_DECIMALS = 18;
const TOKEN1_DECIMALS = 18;
const INITIAL_LIQUIDITY_0 = scaleUp(1_000_000n, TOKEN0_DECIMALS);
const INITIAL_LIQUIDITY_1 = scaleUp(1_000_000n, TOKEN1_DECIMALS);


describe("Cron-Fi TWAMM Pool Oracle Test Suite", function ()
{
  let owner: SignerWithAddress,
      addr1: SignerWithAddress,
      addr2: SignerWithAddress;

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
    const vrResult = await poolContract.callStatic.getVirtualReserves(blockNumber, false)
    return {
      reserve0: vrResult.token0ReserveU112,
      reserve1: vrResult.token1ReserveU112
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
    addr2 = result.addr2
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

  describe("Pre-liquidity state checks", function() {
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

    it ("should match the virtual oracle, which should be zero at this block", async function() {
      const lastBlock = await getLastBlockNumber()
      const virtualOracle = await poolContract.callStatic.getVirtualPriceOracle(lastBlock)
      const virtualOracleState = getOracleStateFromStruct(virtualOracle)

      expect(virtualOracle.blockNumber).to.eq(
        lastBlock,
        "The specified block should be what is returned."
      );

      const oracle = oracleSamples[oracleSamples.length - 1];

      expect(virtualOracleState.timeStampSec).to.eq(oracle.timeStampSec)
      expect(virtualOracleState.p0).to.eq(oracle.p0);
      expect(virtualOracleState.p1).to.eq(oracle.p1)
    })
  })

  describe("Initial-liquidity state checks", function() {
    let initialJoinBlock: number =0 

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
      initialJoinBlock = await getLastBlockNumber()

      poolModel.initialMint(addr1.address, INITIAL_LIQUIDITY_0, INITIAL_LIQUIDITY_1)
    })
    
    it ("should initially have last virtual order block be the block number of the initial join", async function() {
      const lvob = await poolContract.getLastVirtualOrderBlock()
      expect(lvob).to.eq(initialJoinBlock,
        "Last virtual order block should be the block number of the initial join."
      )
    })
    
    it ("should have initial liquidity values in price oracles after initial join", async function() {
      const oracle = await sampleOracle()
      
      expect(oracle.p0).to.be.eq(0)
      expect(oracle.p1).to.be.eq(0)
    })

    it ("should have matching values in the virtual and actual oracle at this block", async function() {
      const lastBlock = await getLastBlockNumber()
      const virtualOracle = await poolContract.callStatic.getVirtualPriceOracle(lastBlock)
      const virtualOracleState = getOracleStateFromStruct(virtualOracle)

      expect(virtualOracle.blockNumber).to.eq(
        lastBlock,
        "The specified block should be what is returned."
      );

      const oracle = oracleSamples[oracleSamples.length - 1];

      expect(virtualOracleState.timeStampSec).to.eq(oracle.timeStampSec)
      expect(virtualOracleState.p0).to.eq(oracle.p0);
      expect(virtualOracleState.p1).to.eq(oracle.p1)
    })
  })

  describe("Short-term swap oracle price tracking checks", function() {
    it ("should have the correct oracle price after a 1k T0->T1 swap", async function() {
      const swapAmt1k = scaleUp(1_000n, TOKEN0_DECIMALS)
      const swap = swapMgr.newSwap0To1()
      await swap.shortTerm(swapAmt1k, addr1)
      
      poolModel.swap0To1(swapAmt1k)

      // The price oracle takes the price before the first transaction of a block, which in
      // this case is defined as the reserves after having run EVO, but not including our swap
      // above, so there should be no oracle price change (the numbers will change but the 
      // average price will not):
      //
      const prevOracle = oracleSamples[oracleSamples.length-1]
      const oracle = await sampleOracle()
      
      // Manual Oracle Value Calculation (add the analytical difference to the last sample 
      // for comparison):
      //
      const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
      const dp0 = ((INITIAL_LIQUIDITY_1.shl(112)).div(INITIAL_LIQUIDITY_0)).mul(timeElapsedSec)
      const dp1 = ((INITIAL_LIQUIDITY_0.shl(112)).div(INITIAL_LIQUIDITY_1)).mul(timeElapsedSec)
      const p0 = prevOracle.p0.add(dp0)
      const p1 = prevOracle.p1.add(dp1)

      expect(oracle.p0).to.eq(p0)
      expect(oracle.p1).to.eq(p1)

      // Average price of both assets relative to one another should be unity (the price 
      // before the swap took place was 1M : 1M, the effect of the swap is not yet 
      // factored into the Oracle):
      //
      const avgPrice0 = ((oracle.p0.sub(prevOracle.p0)).div(timeElapsedSec)).shr(112)
      const avgPrice1 = ((oracle.p1.sub(prevOracle.p1)).div(timeElapsedSec)).shr(112)

      expect(avgPrice0).to.eq(1)
      expect(avgPrice1).to.eq(1)
    })
    
    it ("should have the correct oracle price after a 10k T1->T0 swap", async function() {
      const paused = false
      const block = await getLastBlockNumber() + 1
      const resObj = await poolContract.callStatic.getVirtualReserves(block, paused)

      const swapAmt10k = scaleUp(10_000n, TOKEN1_DECIMALS)
      const swap = swapMgr.newSwap1To0()
      await swap.shortTerm(swapAmt10k, addr1)
      
      poolModel.swap1To0(swapAmt10k)

      // The price oracle will now reflect the reserves after the previous swap (b/c the 
      // oracle price is the price in the previous block to the first transaction in this
      // block, based on the post EVO reserve prices):
      //
      const prevOracle = oracleSamples[oracleSamples.length-1]
      const oracle = await sampleOracle()

      // Manual Oracle Value Calculation for comparison (difference plus last sample):
      //
      const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
      const reserve0 = resObj.token0ReserveU112
      const reserve1 = resObj.token1ReserveU112

      const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
      const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
      const p0 = prevOracle.p0.add(dp0)
      const p1 = prevOracle.p1.add(dp1)

      expect(oracle.p0).to.eq(p0)
      expect(oracle.p1).to.eq(p1)

      // Price explanation:
      //   Recall that the oracle price reflects the price before the first transaction of this 
      //   block. That means the price will only reflect the previous swap of 1k T0 --> T1.
      //
      //   Approximately 1k Token 0 enters the pool reserves and about 1k Token 1 leaves the pool.
      //   This means that Token 1 becomes more scarce than Token 0 in the pool, compared to the 
      //   previous reserves in the pool, thus it's price relative to Token 0 increases. Conversely,
      //   the value of Token 0 relative to Token 1 decreases.
      //
      // The price of token 0 measured in token 1 should have gone down, expect a value less 
      // than 1 (with 112-fractional bits).
      // Conversely the price of token1 measured in token0 should have gone up, expect a value 
      // greater than 1 (with 112-fractional bits).
      //
      const ONE_U256F112 = 1n << 112n;
      const avgPrice0 = ((oracle.p0.sub(prevOracle.p0)).div(timeElapsedSec))
      const avgPrice1 = ((oracle.p1.sub(prevOracle.p1)).div(timeElapsedSec))
      
      expect(avgPrice0).to.be.lt(ONE_U256F112)
      expect(avgPrice1).to.be.gt(ONE_U256F112)
    })

    it ("should have the correct oracle price after a 9k T0->T1 swap", async function() {
      const paused = false
      const block = await getLastBlockNumber() + 1
      const resObj = await poolContract.callStatic.getVirtualReserves(block, paused)

      const swapAmt9k = scaleUp(9_000n, TOKEN0_DECIMALS)
      const swap = swapMgr.newSwap0To1()
      await swap.shortTerm(swapAmt9k, addr1)
      
      poolModel.swap0To1(swapAmt9k)

      // The price oracle will now reflect the reserves after the previous swap (10k T1 --> T0,
      // b/c the oracle price is the price in the previous block to the first transaction in this
      // block, based on the post EVO reserve prices):
      //
      const prevOracle = oracleSamples[oracleSamples.length-1]
      const oracle = await sampleOracle()

      // Manual Oracle Value Calculation for comparison (difference plus last sample):
      //
      const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
      const reserve0 = resObj.token0ReserveU112
      const reserve1 = resObj.token1ReserveU112

      const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
      const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
      const p0 = prevOracle.p0.add(dp0)
      const p1 = prevOracle.p1.add(dp1)

      expect(oracle.p0).to.eq(p0)
      expect(oracle.p1).to.eq(p1)

      // The price is based on the change in the previous swap--not the most recent one. Since
      // way more token 1 was sold to the pool in the previous swap, we expect the price of 
      // token 0 measured in token 1 to increase above unity and the price of token 1 measured
      // in token 0 to decrease below unity:
      //
      const ONE_U256F112 = 1n << 112n;
      const avgPrice0 = ((oracle.p0.sub(prevOracle.p0)).div(timeElapsedSec))
      const avgPrice1 = ((oracle.p1.sub(prevOracle.p1)).div(timeElapsedSec))
      
      expect(avgPrice0).to.be.gt(ONE_U256F112)
      expect(avgPrice1).to.be.lt(ONE_U256F112)
    })

    it ("should have matching values in the virtual and actual oracle at this block", async function() {
      const lastBlock = await getLastBlockNumber()
      const virtualOracle = await poolContract.callStatic.getVirtualPriceOracle(lastBlock)
      const virtualOracleState = getOracleStateFromStruct(virtualOracle)

      expect(virtualOracle.blockNumber).to.eq(
        lastBlock,
        "The specified block should be what is returned."
      );

      const oracle = oracleSamples[oracleSamples.length - 1];

      expect(virtualOracleState.timeStampSec).to.eq(oracle.timeStampSec)
      expect(virtualOracleState.p0).to.eq(oracle.p0);
      expect(virtualOracleState.p1).to.eq(oracle.p1)
    })

    it ("should have the correct oracle price after running EVO", async function() {
      const paused = false
      let block = await getLastBlockNumber() + 1
      const resObj = await poolContract.callStatic.getVirtualReserves(block, paused)

      // We use 2 blocks to keep the comparisons the same as above--mine the two blocks 
      // and then execute virtual orders (there are none, but this will update the oracle)
      //
      await mineBlocks(2)
      block = await getLastBlockNumber() + 1
      await poolContract.executeVirtualOrdersToBlock(block)
      await mineBlocks()

      // The price oracle will now reflect the reserves after the previous swap of 9k T0 --> T1
      // (b/c the oracle price is the price in the previous block to the first transaction in this
      // block, based on the post EVO reserve prices):
      //
      const prevOracle = oracleSamples[oracleSamples.length-1]
      const oracle = await sampleOracle()

      // Manual Oracle Value Calculation for comparison (difference plus last sample):
      //
      const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
      const reserve0 = resObj.token0ReserveU112
      const reserve1 = resObj.token1ReserveU112

      const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
      const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
      const p0 = prevOracle.p0.add(dp0)
      const p1 = prevOracle.p1.add(dp1)

      expect(oracle.p0).to.eq(p0)
      expect(oracle.p1).to.eq(p1)

      // The price will be near unity, but will still favor token 1 because of slippage (even 
      // though a net amount of 10k of each token has now been swapped into the pool, slippage has
      // had a larger effect on the price of Token 0, which will be less than unity measured 
      // relative to Token 1):
      //
      const ONE_U256F112 = 1n << 112n;
      const avgPrice0 = ((oracle.p0.sub(prevOracle.p0)).div(timeElapsedSec))
      const avgPrice1 = ((oracle.p1.sub(prevOracle.p1)).div(timeElapsedSec))
      
      expect(avgPrice0).to.be.lt(ONE_U256F112)
      expect(avgPrice1).to.be.gt(ONE_U256F112)
    })

  })

  describe("Basic Oracle behavior expectation checks", function() {
    it ("should not significantly change the price to remove liquidity", async function() {
      // Have the original LP remove ~1/2 liquidity:
      //
      const lpTokens = await poolContract.balanceOf(addr1.address)
      const lpBurnTokens = (lpTokens.add(1000)).div(2) // We add 1k so we truly burn 1/2 the liquidity.
                                                       // (This accounts for minimum liquidity.)
      await poolContract.connect(addr1).approve(balancerVaultContract.address, lpBurnTokens);

      const exitRequest = await poolHelper.getExitRequest(lpBurnTokens)
      await balancerVaultContract.connect(addr1).exitPool(
        poolHelper.getPoolId(),
        addr1.address,
        addr1.address,
        exitRequest
      )
      await mineBlocks()

      
      // If we sample the oracle now, it will reflect the reserves before the exit request above,
      // so we need to mine a few blocks and run an execute virtual orders to update the Oracle
      // sample to consider the values from the exit request:
      //
      //   Note: We use 2 blocks to keep the comparisons the same as above--mine the two blocks 
      //         and then execute virtual orders (there are none, but this will update the oracle)
      //
      await mineBlocks(2)
      const block = await getLastBlockNumber() + 1
      await poolContract.executeVirtualOrdersToBlock(block)
      await mineBlocks()

      
      // Confirm that the oracle price across the new interval has not changed "significantly" 
      // since the previous interval's oracle price:
      //
      //   NOTE: "significantly" in this case is down to 112-33 fractional bits.  There is an 
      //         error that occurs at 79-fractional bits due to the fixed precision differences 
      //         from calculating the oracle increment due to the different reserve ratios.
      //
      //         Here is the scaled reserve ratio before liquidity is removed:
      //
      //           T0=1000081714840136374066726
      //           T1=999923268717589317184655
      //           ScaledRatioT0T1 = (T0 << 112) / T1
      //                           = 5193119620970792567227439383931398
      //
      //         And here is the scaled reserve ratio after liquidity is removed:
      //
      //           T0=500040857420068187033363
      //           T1=499961634358794658592328
      //           ScaledRatioT0T1' = (T0 << 112) / T1
      //                            = 5193119620970792567227434190413271
      //
      //         The fixed precision errors in arriving at the reserves after liquidity is 
      //         removed are magnified by 2 ** 112 bits before being divided by the 
      //         reserve of Token 1 (which itself may have fixed precision error). In this 
      //         example, the result is that the lower ~33 fractional bits of the 112
      //         fractional bits are in error:
      //
      //           error = ScaledRatioT0T1 - ScaledRatioT0T1'
      //                 = 5193518127
      //
      //           ErrorBits = ceil(log(abs(error))/log(2))
      //                     = ceil(log(abs(5193518127))/log(2))
      //                     = 33 bits
      //
      const prevPrevOracle = oracleSamples[oracleSamples.length-2]
      const prevOracle = oracleSamples[oracleSamples.length-1]
      const oracle = await sampleOracle()

      expect(oracle.timeStampSec).to.be.gt(prevOracle.timeStampSec)
      expect(prevOracle.timeStampSec).to.be.gt(prevPrevOracle.timeStampSec)

      const prevIntervalElapsedSec = prevOracle.timeStampSec.sub(prevPrevOracle.timeStampSec)
      const prevIntervalPrice0 = (prevOracle.p0.sub(prevPrevOracle.p0)).div(prevIntervalElapsedSec);
      const prevIntervalPrice1 = (prevOracle.p1.sub(prevPrevOracle.p1)).div(prevIntervalElapsedSec);

      const currIntervalElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
      const currIntervalPrice0 = (oracle.p0.sub(prevOracle.p0)).div(currIntervalElapsedSec)
      const currIntervalPrice1 = (oracle.p1.sub(prevOracle.p1)).div(currIntervalElapsedSec)

      const fractionalBitTolerance = 2n ** 32n
      expect(currIntervalPrice0).to.be.closeTo(prevIntervalPrice0, fractionalBitTolerance)
      expect(currIntervalPrice1).to.be.closeTo(prevIntervalPrice1, fractionalBitTolerance)


      // Ensure the price relative to unity is still correct.
      // The price will be near unity, but will still favor token 1 because of slippage (even 
      // though a net amount of 10k of each token has now been swapped into the pool, slippage has
      // had a larger effect on the price of Token 0, which will be less than unity measured 
      // relative to Token 1):
      //
      const ONE_U256F112 = 1n << 112n;
      expect(currIntervalPrice0).to.be.lt(ONE_U256F112)
      expect(currIntervalPrice1).to.be.gt(ONE_U256F112)
    })
    
    it ("should not significantly change the price to add liquidity", async function() {
      const paused = false
      let block = await getLastBlockNumber() + 1
      const resObj = await poolContract.callStatic.getVirtualReserves(block, paused)

      // Have the original LP add 3x the liquidity for a total of 4x current amount:
      //
      const newLiquidity = {
        token0: resObj.token0ReserveU112.mul(3),
        token1: resObj.token1ReserveU112.mul(3)
      }
      // a) Transfer the tokens to the customer's wallet and approve them for the vault contract:
      await token0AssetContract.connect(owner).transfer(addr1.address, newLiquidity.token0);
      await token1AssetContract.connect(owner).transfer(addr1.address, newLiquidity.token1);
      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, newLiquidity.token0);
      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, newLiquidity.token1);
      let joinObjects = await poolHelper.getJoinObjects(newLiquidity.token0, newLiquidity.token1);
      await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)

      // b) Join the pool (mint, add liquidity):
      await balancerVaultContract.connect(addr1).joinPool(
        poolHelper.getPoolId(),
        addr1.address,
        addr1.address,
        joinObjects.joinStruct
      )
      await mineBlocks();


      // If we sample the oracle now, it will reflect the reserves before the exit request above,
      // so we need to mine a few blocks and run an execute virtual orders to update the Oracle
      // sample to consider the values from the exit request:
      //
      //   Note: We use 2 blocks to keep the comparisons the same as above--mine the two blocks 
      //         and then execute virtual orders (there are none, but this will update the oracle)
      //
      await mineBlocks(2)
      block = await getLastBlockNumber() + 1
      await poolContract.executeVirtualOrdersToBlock(block)
      await mineBlocks()

      // Confirm that the oracle price across the new interval has not changed since the previous
      // interval's oracle price:
      //
      const prevPrevOracle = oracleSamples[oracleSamples.length-2]
      const prevOracle = oracleSamples[oracleSamples.length-1]
      const oracle = await sampleOracle()

      expect(oracle.timeStampSec).to.be.gt(prevOracle.timeStampSec)
      expect(prevOracle.timeStampSec).to.be.gt(prevPrevOracle.timeStampSec)

      const prevIntervalElapsedSec = prevOracle.timeStampSec.sub(prevPrevOracle.timeStampSec)
      const prevIntervalPrice0 = (prevOracle.p0.sub(prevPrevOracle.p0)).div(prevIntervalElapsedSec);
      const prevIntervalPrice1 = (prevOracle.p1.sub(prevPrevOracle.p1)).div(prevIntervalElapsedSec);

      const currIntervalElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
      const currIntervalPrice0 = (oracle.p0.sub(prevOracle.p0)).div(currIntervalElapsedSec)
      const currIntervalPrice1 = (oracle.p1.sub(prevOracle.p1)).div(currIntervalElapsedSec)

      const fractionalBitTolerance = 2n ** 32n
      expect(currIntervalPrice0).to.be.closeTo(prevIntervalPrice0, fractionalBitTolerance)
      expect(currIntervalPrice1).to.be.closeTo(prevIntervalPrice1, fractionalBitTolerance)


      // Ensure the price relative to unity is still correct.
      // The price will be near unity, but will still favor token 1 because of slippage (even 
      // though a net amount of 10k of each token has now been swapped into the pool, slippage has
      // had a larger effect on the price of Token 0, which will be less than unity measured 
      // relative to Token 1):
      //
      const ONE_U256F112 = 1n << 112n;
      expect(currIntervalPrice0).to.be.lt(ONE_U256F112)
      expect(currIntervalPrice1).to.be.gt(ONE_U256F112)
    })

    it ("should not change the oracle if EVO is run multiple times in one block", async function() {
      const paused = false
      let lastBlock = await getLastBlockNumber()
      const resObj = await poolContract.callStatic.getVirtualReserves(lastBlock, paused)

      let thisBlock = lastBlock + 1
      await poolContract.executeVirtualOrdersToBlock(thisBlock)
      await poolContract.executeVirtualOrdersToBlock(thisBlock)
      await poolContract.executeVirtualOrdersToBlock(thisBlock)
      await mineBlocks()

      // Confirm that the oracle price across the new interval has not changed since the previous
      // interval's oracle price (if there was a bug and the value is incremented inappropriately,
      // we would expect multiple increments of the oracle with no change in time elapsed:
      //
      const prevPrevOracle = oracleSamples[oracleSamples.length-2]
      const prevOracle = oracleSamples[oracleSamples.length-1]
      const oracle = await sampleOracle()

      expect(oracle.timeStampSec).to.be.gt(prevOracle.timeStampSec)
      expect(prevOracle.timeStampSec).to.be.gt(prevPrevOracle.timeStampSec)

      const prevIntervalElapsedSec = prevOracle.timeStampSec.sub(prevPrevOracle.timeStampSec)
      const prevIntervalPrice0 = (prevOracle.p0.sub(prevPrevOracle.p0)).div(prevIntervalElapsedSec);
      const prevIntervalPrice1 = (prevOracle.p1.sub(prevPrevOracle.p1)).div(prevIntervalElapsedSec);

      const currIntervalElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
      const currIntervalPrice0 = (oracle.p0.sub(prevOracle.p0)).div(currIntervalElapsedSec)
      const currIntervalPrice1 = (oracle.p1.sub(prevOracle.p1)).div(currIntervalElapsedSec)

      const fractionalBitTolerance = 0n
      expect(currIntervalPrice0).to.be.closeTo(prevIntervalPrice0, fractionalBitTolerance)
      expect(currIntervalPrice1).to.be.closeTo(prevIntervalPrice1, fractionalBitTolerance)


      // Ensure the price relative to unity is still correct.
      // The price will be near unity, but will still favor token 1 because of slippage (even 
      // though a net amount of 10k of each token has now been swapped into the pool, slippage has
      // had a larger effect on the price of Token 0, which will be less than unity measured 
      // relative to Token 1):
      //
      const ONE_U256F112 = 1n << 112n;
      expect(currIntervalPrice0).to.be.lt(ONE_U256F112)
      expect(currIntervalPrice1).to.be.gt(ONE_U256F112)

      // Ensure that the oracle increment is the expected amount for a single block update (manual 
      // comparison based on past sample instead of above average price comparison):
      //
      const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
      const reserve0 = resObj.token0ReserveU112
      const reserve1 = resObj.token1ReserveU112

      const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
      const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
      const p0 = prevOracle.p0.add(dp0)
      const p1 = prevOracle.p1.add(dp1)

      expect(oracle.p0).to.eq(p0)
      expect(oracle.p1).to.eq(p1)
    })
  })

  describe("Basic long-term oracle price tracking checks", function() {
    describe("should have the correct oracle price through a LT T0->T1 swap", function() {
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
        swapObjects = await swap.longTerm(swapAmt, intervals, addr1)

        // Note that swap params emmulates the state of the virtual order, but has to use the block
        // number after the order is mined or you get a mismatch
        orderMineBlock = await getLastBlockNumber()

        // Update the pool model to show the amount deposited into Balancer Vault
        swapParams = poolModel.ltSwap0To1(BLOCK_INTERVAL, orderMineBlock, swapAmt, intervals)
      })

      it ("should have the correct oracle price right after the LT swap is issued", async function() {
        // The oracle price after the LT swap is issued is the same as the last block (i.e. should be 
        // unchanged by the LT swap liquidity):
        const prevPrevOracle = oracleSamples[oracleSamples.length-2]
        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()

        expect(oracle.timeStampSec).to.be.gt(prevOracle.timeStampSec)
        expect(prevOracle.timeStampSec).to.be.gt(prevPrevOracle.timeStampSec)

        const prevIntervalElapsedSec = prevOracle.timeStampSec.sub(prevPrevOracle.timeStampSec)
        const prevIntervalPrice0 = (prevOracle.p0.sub(prevPrevOracle.p0)).div(prevIntervalElapsedSec);
        const prevIntervalPrice1 = (prevOracle.p1.sub(prevPrevOracle.p1)).div(prevIntervalElapsedSec);

        const currIntervalElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const currIntervalPrice0 = (oracle.p0.sub(prevOracle.p0)).div(currIntervalElapsedSec)
        const currIntervalPrice1 = (oracle.p1.sub(prevOracle.p1)).div(currIntervalElapsedSec)

        const fractionalBitTolerance = 0n
        expect(currIntervalPrice0).to.be.closeTo(prevIntervalPrice0, fractionalBitTolerance)
        expect(currIntervalPrice1).to.be.closeTo(prevIntervalPrice1, fractionalBitTolerance)
      })

      it ("should have the correct oracle price 10 blocks into the swap and match the virtualOracle", async function() {
        await mineBlocks(10)

        const paused = false
        let lastBlock = await getLastBlockNumber()
        const resObj = await poolContract.callStatic.getVirtualReserves(lastBlock, paused)

        const virtualOracle = await poolContract.callStatic.getVirtualPriceOracle(lastBlock)
        const virtualOracleState = getOracleStateFromStruct(virtualOracle)
        expect(virtualOracle.blockNumber).to.eq(
          lastBlock,
          "The specified block should be what is returned."
        );
        
        // To force the oracle to update to show the virtual order sales, we execute virtual 
        // orders to the last block (we do this to make the approximation match perfectly--the EVM 
        // wont let getVirtualReserves execute in the future as it's a view function (we could 
        // potentially re-write it to support that but time constraints prevent):
        //
        await poolContract.executeVirtualOrdersToBlock(lastBlock)
        await mineBlocks()

        // Compare the oracle sample update to what would be expected (assumes product 
        // reserves are and getVirtualReserves are operating correctly):
        //
        // a) Sample the oracle:
        //
        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()
        //
        // b) Calculate an approximation of the oracle price update:
        //
        const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const reserve0 = resObj.token0ReserveU112
        const reserve1 = resObj.token1ReserveU112

        const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
        const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
        const p0 = prevOracle.p0.add(dp0)
        const p1 = prevOracle.p1.add(dp1)

        expect(oracle.p0).to.eq(p0)
        expect(oracle.p1).to.eq(p1)

        // Compare the oracle and virtual oracles to ensure the virtual oracle predicts 
        // the value correctly:
        //
        expect(virtualOracleState.timeStampSec).to.eq(oracle.timeStampSec)
        expect(virtualOracleState.p0).to.eq(oracle.p0);
        expect(virtualOracleState.p1).to.eq(oracle.p1)
      })
      
      it ("should have the correct oracle price at the first block interval", async function() {
        // The first interval has not yet occured, use the OBI to mine to that block:
        //
        const POOL_TYPE = PoolType.Liquid
        const obi = getBlockInterval(POOL_TYPE);

        const firstBlockInterval = obi
        let lastBlock = await getLastBlockNumber()
        const blocksToMine = firstBlockInterval - lastBlock
        expect(blocksToMine).to.be.gt(0)

        await mineBlocks(blocksToMine)

        // Get reserves to compute the expected oracle update:
        //
        const paused = false
        lastBlock = await getLastBlockNumber()
        const resObj = await poolContract.callStatic.getVirtualReserves(lastBlock, paused)

        // To force the oracle to update to show the virtual order sales, we execute virtual 
        // orders to the last block (we do this to make the approximation match perfectly--the EVM 
        // wont let getVirtualReserves execute in the future as it's a view function (we could 
        // potentially re-write it to support that but time constraints prevent):
        //
        await poolContract.executeVirtualOrdersToBlock(lastBlock)
        await mineBlocks()

        // Compare the oracle sample update to what would be expected (assumes product 
        // reserves are and getVirtualReserves are operating correctly):
        //
        // a) Sample the oracle:
        //
        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()
        //
        // b) Calculate an approximation of the oracle price update:
        //
        const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const reserve0 = resObj.token0ReserveU112
        const reserve1 = resObj.token1ReserveU112

        const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
        const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
        const p0 = prevOracle.p0.add(dp0)
        const p1 = prevOracle.p1.add(dp1)

        expect(oracle.p0).to.eq(p0)
        expect(oracle.p1).to.eq(p1)
      })

      it ("should have the correct oracle price all the way through the swap", async function() {
        // This is the best test of the oracle for single sided LT swaps. Now that we've mined 
        // to the first interval, we mine through the other three intervals and compute the 
        // oracle differences for each interval and then add them together to get close to the 
        // expected amount (this confirms the oracle is tracking the trade at each interval and 
        // not just at the order end):
        //
        let lastBlock = await getLastBlockNumber()
        const blocksToMine = swapParams.swapExpiryBlock - lastBlock
        expect(blocksToMine).to.be.gt(0)
        await mineBlocks(blocksToMine)

        // Get the reserves to compute the expected oracle update at 
        // each interval:
        //
        const POOL_TYPE = PoolType.Liquid
        const obi = getBlockInterval(POOL_TYPE);
        const paused = false


        const interval2 = 2 * obi;
        const resObjInterval2 = await poolContract.callStatic.getVirtualReserves(interval2, paused)
        const reserve0I2 = resObjInterval2.token0ReserveU112
        const reserve1I2 = resObjInterval2.token1ReserveU112

        const interval3 = 3 * obi;
        const resObjInterval3 = await poolContract.callStatic.getVirtualReserves(interval3, paused)
        const reserve0I3 = resObjInterval3.token0ReserveU112
        const reserve1I3 = resObjInterval3.token1ReserveU112

        const interval4 = 4 * obi;
        const resObjInterval4 = await poolContract.callStatic.getVirtualReserves(interval4, paused)
        const reserve0I4 = resObjInterval4.token0ReserveU112
        const reserve1I4 = resObjInterval4.token1ReserveU112

        // To force the oracle to update to show the virtual order sales, we execute virtual 
        // orders to the last block of the order:
        //
        await poolContract.executeVirtualOrdersToBlock(interval4)
        await mineBlocks()

        // Compare the oracle sample update to what would be expected (assumes product 
        // reserves are and getVirtualReserves are operating correctly):
        //
        // a) Sample the oracle:
        //
        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()
        //
        // b) Calculate an approximation of the oracle price update:
        //
        //    The time elapsed is the same for all three intervals (12s x obi) = 3600
        const timeElapsedSec = obi * 12
        const dp0I2 = ((reserve1I2.shl(112)).div(reserve0I2)).mul(timeElapsedSec)
        const dp1I2 = ((reserve0I2.shl(112)).div(reserve1I2)).mul(timeElapsedSec)
        const dp0I3 = ((reserve1I3.shl(112)).div(reserve0I3)).mul(timeElapsedSec)
        const dp1I3 = ((reserve0I3.shl(112)).div(reserve1I3)).mul(timeElapsedSec)
        const dp0I4 = ((reserve1I4.shl(112)).div(reserve0I4)).mul(timeElapsedSec)
        const dp1I4 = ((reserve0I4.shl(112)).div(reserve1I4)).mul(timeElapsedSec)
        const p0 = prevOracle.p0.add(dp0I2).add(dp0I3).add(dp0I4)
        const p1 = prevOracle.p1.add(dp1I2).add(dp1I3).add(dp1I4)

        expect(oracle.p0).to.eq(p0)
        expect(oracle.p1).to.eq(p1)
      })

      it ("should have the correct price bias", async function() {
        // Lots of Token 0 was sold to the pool in the LT trade, ensure that the price oracle 
        // reflects this as a basic sanity check:
        //
        const prevOracle = oracleSamples[oracleSamples.length-2]
        const oracle = oracleSamples[oracleSamples.length-1]

        expect(oracle.timeStampSec).to.be.gt(prevOracle.timeStampSec)

        const currIntervalElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const currIntervalPrice0 = (oracle.p0.sub(prevOracle.p0)).div(currIntervalElapsedSec)
        const currIntervalPrice1 = (oracle.p1.sub(prevOracle.p1)).div(currIntervalElapsedSec)

        // Ensure the price relative to unity is still correct.
        const ONE_U256F112 = 1n << 112n;
        expect(currIntervalPrice0).to.be.lt(ONE_U256F112)
        expect(currIntervalPrice1).to.be.gt(ONE_U256F112)
      })
    })
    
    describe("should have the correct oracle price through concurrent LT swaps", function() {
      const swap0To1Intervals = 2;
      let swap0To1: Swap;
      let swap0To1AmtPerBlock: BigNumber;
      let swap0To1Params: LTSwapParams;
      let swap0To1Objects: SwapObjects;
      let swap0To1TradeBlocks: number;
      
      const swap1To0Intervals = 3;
      let swap1To0: Swap;
      let swap1To0AmtPerBlock: BigNumber;
      let swap1To0Params: LTSwapParams;
      let swap1To0Objects: SwapObjects;
      let swap1To0TradeBlocks: number;

      let orderMineBlock: number;
      let firstBlockInterval: number;

      it ("should reach steady state for oracle pricing before issuing LT swaps", async function() {
        const paused = false
        let lastBlock = await getLastBlockNumber()
        const resObj = await poolContract.callStatic.getVirtualReserves(lastBlock, paused)

        await mineBlocks()
        let block = await getLastBlockNumber() + 1
        await poolContract.executeVirtualOrdersToBlock(block)
        await mineBlocks()

        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()

        // Manual Oracle Value Calculation for comparison (difference plus last sample):
        //
        const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const reserve0 = resObj.token0ReserveU112
        const reserve1 = resObj.token1ReserveU112

        const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
        const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
        const p0 = prevOracle.p0.add(dp0)
        const p1 = prevOracle.p1.add(dp1)

        expect(oracle.p0).to.eq(p0)
        expect(oracle.p1).to.eq(p1)
      })

      it ("should issue opposing LT swaps of 1 token per block", async function() {
        swap0To1TradeBlocks = await getTradeBlocks(swap0To1Intervals)
        swap0To1AmtPerBlock = scaleUp(1n, TOKEN0_DECIMALS)
        const swap0To1Amt = swap0To1AmtPerBlock.mul(swap0To1TradeBlocks)
        swap0To1 = swapMgr.newSwap0To1()

        swap1To0TradeBlocks = await getTradeBlocks(swap1To0Intervals)
        swap1To0AmtPerBlock = scaleUp(2n, TOKEN0_DECIMALS)
        const swap1To0Amt = swap1To0AmtPerBlock.mul(swap1To0TradeBlocks)
        swap1To0 = swapMgr.newSwap1To0()

        const doSwap = false;
        swap0To1Objects = await swap0To1.longTerm(swap0To1Amt, swap0To1Intervals, addr1, doSwap)
        swap1To0Objects = await swap1To0.longTerm(swap1To0Amt, swap1To0Intervals, addr2, doSwap)

        {
          const {swapStruct, fundStruct, limitOutAmt, deadlineSec} = swap0To1Objects
          await balancerVaultContract.connect(addr1).swap(swapStruct, fundStruct, limitOutAmt, deadlineSec)
        }
        {
          const {swapStruct, fundStruct, limitOutAmt, deadlineSec} = swap1To0Objects
          await balancerVaultContract.connect(addr2).swap(swapStruct, fundStruct, limitOutAmt, deadlineSec)
        }
        await mineBlocks()

        // Note that swap params emmulates the state of the virtual order, but has to use the block
        // number after the order is mined or you get a mismatch
        let lastBlock = await getLastBlockNumber()
        
        // Update the pool model to show the amount deposited into Balancer Vault
        swap0To1Params = poolModel.ltSwap0To1(BLOCK_INTERVAL,
                                              lastBlock,
                                              swap0To1Amt,
                                              swap0To1Intervals)
        swap1To0Params = poolModel.ltSwap1To0(BLOCK_INTERVAL,
                                              lastBlock,
                                              swap1To0Amt,
                                              swap1To0Intervals)
        orderMineBlock = lastBlock
      })
      
      it ("should have the correct oracle price right after the LT swaps are issued", async function() {
        // The oracle price after the LT swaps are issued is the same as the last block (i.e. should be 
        // unchanged by the LT swaps liquidity):
        const prevPrevOracle = oracleSamples[oracleSamples.length-2]
        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()

        expect(oracle.timeStampSec).to.be.gt(prevOracle.timeStampSec)
        expect(prevOracle.timeStampSec).to.be.gt(prevPrevOracle.timeStampSec)

        const prevIntervalElapsedSec = prevOracle.timeStampSec.sub(prevPrevOracle.timeStampSec)
        const prevIntervalPrice0 = (prevOracle.p0.sub(prevPrevOracle.p0)).div(prevIntervalElapsedSec);
        const prevIntervalPrice1 = (prevOracle.p1.sub(prevPrevOracle.p1)).div(prevIntervalElapsedSec);

        const currIntervalElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const currIntervalPrice0 = (oracle.p0.sub(prevOracle.p0)).div(currIntervalElapsedSec)
        const currIntervalPrice1 = (oracle.p1.sub(prevOracle.p1)).div(currIntervalElapsedSec)
        
        const fractionalBitTolerance = 0n
        expect(currIntervalPrice0).to.be.closeTo(prevIntervalPrice0, fractionalBitTolerance)
        expect(currIntervalPrice1).to.be.closeTo(prevIntervalPrice1, fractionalBitTolerance)
      })

      it ("should have the correct oracle price 100 blocks into the swap", async function() {
        await mineBlocks(100)

        const paused = false
        let lastBlock = await getLastBlockNumber()
        const resObj = await poolContract.callStatic.getVirtualReserves(lastBlock, paused)
        
        const virtualOracle = await poolContract.callStatic.getVirtualPriceOracle(lastBlock)
        const virtualOracleState = getOracleStateFromStruct(virtualOracle)
        expect(virtualOracle.blockNumber).to.eq(
          lastBlock,
          "The specified block should be what is returned."
        );

        // To force the oracle to update to show the virtual order sales, we execute virtual 
        // orders to the last block (we do this to make the approximation match perfectly--the EVM 
        // wont let getVirtualReserves execute in the future as it's a view function (we could 
        // potentially re-write it to support that but time constraints prevent):
        //
        await poolContract.executeVirtualOrdersToBlock(lastBlock)
        await mineBlocks()

        // Compare the oracle sample update to what would be expected (assumes product 
        // reserves are and getVirtualReserves are operating correctly):
        //
        // a) Sample the oracle:
        //
        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()
        //
        // b) Calculate an approximation of the oracle price update:
        //
        const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const reserve0 = resObj.token0ReserveU112
        const reserve1 = resObj.token1ReserveU112

        const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
        const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
        const p0 = prevOracle.p0.add(dp0)
        const p1 = prevOracle.p1.add(dp1)

        expect(oracle.p0).to.eq(p0)
        expect(oracle.p1).to.eq(p1)

        // Compare the oracle and virtual oracles to ensure the virtual oracle predicts 
        // the value correctly:
        //
        expect(virtualOracleState.timeStampSec).to.eq(oracle.timeStampSec)
        expect(virtualOracleState.p0).to.eq(oracle.p0);
        expect(virtualOracleState.p1).to.eq(oracle.p1)
      })

      it ("should have the correct oracle price at the first block interval", async function() {
        // The first interval of the LT swaps have not yet occured, use the OBI to mine to that block:
        //
        const POOL_TYPE = PoolType.Liquid
        const obi = getBlockInterval(POOL_TYPE);

        let lastBlock = await getLastBlockNumber()
        firstBlockInterval = Math.floor(lastBlock - (lastBlock % obi)) + obi
        const blocksToMine = firstBlockInterval - lastBlock
        expect(blocksToMine).to.be.gt(0)

        await mineBlocks(blocksToMine)

        // Get reserves to compute the expected oracle update:
        //
        const paused = false
        lastBlock = await getLastBlockNumber()
        const resObj = await poolContract.callStatic.getVirtualReserves(lastBlock, paused)

        // To force the oracle to update to show the virtual order sales, we execute virtual 
        // orders to the last block (we do this to make the approximation match perfectly--the EVM 
        // wont let getVirtualReserves execute in the future as it's a view function (we could 
        // potentially re-write it to support that but time constraints prevent):
        //
        await poolContract.executeVirtualOrdersToBlock(lastBlock)
        await mineBlocks()

        // Compare the oracle sample update to what would be expected (assumes product 
        // reserves are and getVirtualReserves are operating correctly):
        //
        // a) Sample the oracle:
        //
        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()
        //
        // b) Calculate an approximation of the oracle price update:
        //
        const timeElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const reserve0 = resObj.token0ReserveU112
        const reserve1 = resObj.token1ReserveU112

        const dp0 = ((reserve1.shl(112)).div(reserve0)).mul(timeElapsedSec)
        const dp1 = ((reserve0.shl(112)).div(reserve1)).mul(timeElapsedSec)
        const p0 = prevOracle.p0.add(dp0)
        const p1 = prevOracle.p1.add(dp1)

        expect(oracle.p0).to.eq(p0)
        expect(oracle.p1).to.eq(p1)
      })

      it ("should have the correct oracle price all the way through the LT swaps", async function() {
        // This is the best test of the oracle for concurrent single sided LT swaps. Now that we've 
        // mined to the first interval of both swaps, we mine through the other three intervals 
        // and compute the oracle differences at each interval, adding them together to get close
        // to the expected amount (this confirms the oracle is tracking the trade at each interval and 
        // not just at the order end):
        //
        let lastBlock = await getLastBlockNumber()
        const blocksToMine = swap1To0Params.swapExpiryBlock - lastBlock
        expect(blocksToMine).to.be.gt(0)
        await mineBlocks(blocksToMine)

        // Get the reserves to compute the expected oracle update at 
        // each interval:
        //
        const POOL_TYPE = PoolType.Liquid
        const obi = getBlockInterval(POOL_TYPE);
        const paused = false


        const interval2 = firstBlockInterval + obi;
        const resObjInterval2 = await poolContract.callStatic.getVirtualReserves(interval2, paused)
        const reserve0I2 = resObjInterval2.token0ReserveU112
        const reserve1I2 = resObjInterval2.token1ReserveU112

        const interval3 = firstBlockInterval + 2 * obi;
        const resObjInterval3 = await poolContract.callStatic.getVirtualReserves(interval3, paused)
        const reserve0I3 = resObjInterval3.token0ReserveU112
        const reserve1I3 = resObjInterval3.token1ReserveU112

        const interval4 = firstBlockInterval + 3 * obi;
        const resObjInterval4 = await poolContract.callStatic.getVirtualReserves(interval4, paused)
        const reserve0I4 = resObjInterval4.token0ReserveU112
        const reserve1I4 = resObjInterval4.token1ReserveU112

        // To force the oracle to update to show the virtual order sales, we execute virtual 
        // orders to the last block of the order:
        //
        await poolContract.executeVirtualOrdersToBlock(interval4)
        await mineBlocks()

        // Compare the oracle sample update to what would be expected (assumes product 
        // reserves are and getVirtualReserves are operating correctly):
        //
        // a) Sample the oracle:
        //
        const prevOracle = oracleSamples[oracleSamples.length-1]
        const oracle = await sampleOracle()
        //
        // b) Calculate an approximation of the oracle price update:
        //
        //    The time elapsed is the same for all three intervals (12s x obi) = 3600
        const timeElapsedSec = obi * 12
        const dp0I2 = ((reserve1I2.shl(112)).div(reserve0I2)).mul(timeElapsedSec)
        const dp1I2 = ((reserve0I2.shl(112)).div(reserve1I2)).mul(timeElapsedSec)
        const dp0I3 = ((reserve1I3.shl(112)).div(reserve0I3)).mul(timeElapsedSec)
        const dp1I3 = ((reserve0I3.shl(112)).div(reserve1I3)).mul(timeElapsedSec)
        const dp0I4 = ((reserve1I4.shl(112)).div(reserve0I4)).mul(timeElapsedSec)
        const dp1I4 = ((reserve0I4.shl(112)).div(reserve1I4)).mul(timeElapsedSec)
        const p0 = prevOracle.p0.add(dp0I2).add(dp0I3).add(dp0I4)
        const p1 = prevOracle.p1.add(dp1I2).add(dp1I3).add(dp1I4)

        expect(oracle.p0).to.eq(p0)
        expect(oracle.p1).to.eq(p1)
      })

      it ("should have the correct price bias", async function() {
        // More Token 1 was sold to the pool than Token0 in the LT trades, shifting the price 
        // to make Token 1 cheaper than Token 0. Ensure that the price oracle 
        // reflects this as a basic sanity check:
        //
        const prevOracle = oracleSamples[oracleSamples.length-2]
        const oracle = oracleSamples[oracleSamples.length-1]

        expect(oracle.timeStampSec).to.be.gt(prevOracle.timeStampSec)

        const currIntervalElapsedSec = oracle.timeStampSec.sub(prevOracle.timeStampSec)
        const currIntervalPrice0 = (oracle.p0.sub(prevOracle.p0)).div(currIntervalElapsedSec)
        const currIntervalPrice1 = (oracle.p1.sub(prevOracle.p1)).div(currIntervalElapsedSec)

        // Ensure the price relative to unity is still correct.
        const ONE_U256F112 = 1n << 112n;
        expect(currIntervalPrice0).to.be.lt(ONE_U256F112)
        expect(currIntervalPrice1).to.be.gt(ONE_U256F112)
      })
    })
  })
})

