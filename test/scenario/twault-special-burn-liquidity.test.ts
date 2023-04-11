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
import { TokenPairAmtType } from "../helpers/types"

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
  
describe("Special scenario: mint, lt swap, burn liquidity, withdraw", function () {
  const swapAmt40k = scaleUp(40_000n, TOKEN0_DECIMALS)
  let prevBalT1: BigNumber
  let swapParams: LTSwapParams
  let lastVirtualOrderBlock: number
  let initialBalFeesToken0: BigNumber
  let swap: Swap

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

  describe("Mint, LT Swap, and burn liquidity", async function () {
    describe ("Provide liquidity, 3kT0:??T1, (mint, join) checks", function () {
      let newLiquidity: TokenPairAmtType
      let prevBalT0: BigNumber
      let prevBalT1: BigNumber
      let prevBalLP: BigNumber
      let lpTokensMinted: BigNumber
      let modelLpTokensMinted: BigNumber

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
        let joinObjects = await poolHelper.getJoinObjects( newLiquidity.token0, newLiquidity.token1);
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
        poolModel.updateBalancerFees( { token0: BigNumber.from(0), token1: BigNumber.from(1) } )
        modelLpTokensMinted = poolModel.mint(addr2.address, newLiquidity.token0, newLiquidity.token1)
      })

      it ("should contain the correct supply of LP tokens", async function() {
        let lpSupply = await poolContract.totalSupply()
        const tolerance = DEV_TOLERANCE
        expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), tolerance)
      })

      it ("should contain the correct reserves after liquidity has been provided", async function() {
        // TODO: Understand the differences below (probably rounding methodology).
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
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
    describe("Swap 40k Token 0 for Token 1 in 4 intervals", function () {
      it ("should issue the long-term swap order without error", async function() {
        prevBalT1 = await token1AssetContract.balanceOf(addr1.address)

        let intervals = 4     // 4 intervals * 10 OBI ~= 50 blocks (depends on start block)
        swap = swapMgr.newSwap0To1()
        const swapObjects = await swap.longTerm(swapAmt40k, intervals, addr1)

        // Update the pool model to show the amount deposited into Balancer Vault
        const vaultReserves = poolModel.getVaultReserves()
        poolModel.updateVaultReserves({ reserve0: vaultReserves.reserve0.add(swapAmt40k),
                                        reserve1: vaultReserves.reserve1 })

        // Note that swap params emmulates the state of the virtual order, but has to use the block
        // number after the order is mined or you get a mismatch
        let blockNumber = await getBlockNumber()
        swapParams = PoolModel.getLongTermSwapParameters(BLOCK_INTERVAL,
                                                          blockNumber,
                                                          swapAmt40k,
                                                          intervals)
        lastVirtualOrderBlock = blockNumber

        // Capture the current contract fees to do a simple sanity check for correctness.
        initialBalFeesToken0 = await poolContract.token0BalancerFees()
      })

      it ("should contain the correct reserves immediately after mining the order", async function() {
        //  TODO: Add the following checks to this part:
        //          - sales rate
        //          - order direction
        //          - expiry
        //          - Check events for order id

        // TODO: Understand the differences below (probably rounding methodology).
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

        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                              BigNumber.from(0),
                                              lastVirtualOrderBlock,
                                              await getBlockNumber(),
                                              BLOCK_INTERVAL)

        // TODO: Understand the differences below (probably rounding methodology).
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })
      
      it ("should contain correct reserves about half way through the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.

        // Mine about 1/2 way through the rest of the order:
        const blockNumber = await getBlockNumber()
        let numBlocksToMine = Math.floor((swapParams.swapExpiryBlock - blockNumber) / 2)
        await mineBlocks(numBlocksToMine)
        
        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                              BigNumber.from(0),
                                              lastVirtualOrderBlock,
                                              await getBlockNumber(),
                                              BLOCK_INTERVAL)

        // TODO: Understand the differences below (probably rounding methodology).
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)

        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })

      it ("should contain correct reserves all the way through the order", async function() {
        // The vault and state reserves remain unchanged, only the view function (twamm reserves)
        // reserves should change.

        // Mine through the rest of the order:
        const blockNumber = await getBlockNumber()
        let numBlocksToMine = swapParams.swapExpiryBlock - blockNumber
        await mineBlocks(numBlocksToMine)
        
        // Update the model to compare view function values, then undo
        poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                              BigNumber.from(0),
                                              lastVirtualOrderBlock,
                                              await getBlockNumber(),
                                              BLOCK_INTERVAL)

        // TODO: Understand the differences below (probably rounding methodology).
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
        
        poolModel.undo();   // <- undo state changes to model since we've not executed virtual orders yet
      })
    })
    describe ("Remove liquidity, 500LP, (burn, exit) checks", function () {
      let tokensLP: BigNumber
      let prevLpSupply: BigNumber

      let prevBalT0: BigNumber
      let prevBalT1: BigNumber
      let prevBalLP: BigNumber

      let modelTokensReturned: TokenPairAmtType

      it ("should allow the user to remove 500LP liquidity (burn, exit the pool)", async function() {
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
        modelTokensReturned = poolModel.burn(addr1.address, tokensLP)
      })

      it ("should burn the correct number of LP tokens", async function() {
        const lpSupply = await poolContract.totalSupply()
        const tolerance = DEV_TOLERANCE
        expect(lpSupply).to.be.closeTo(poolModel.getLpTokenSupply(), DEV_TOLERANCE)

        const lpSupplyIdeal = prevLpSupply.sub(tokensLP)
        expect(lpSupply).to.eq(lpSupplyIdeal)
      })

      it ("should contain the correct reserves after liquidity has been removed", async function() {
        // TODO: Understand the differences below (probably rounding methodology).
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
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

    describe ("Long-term swap withdraw checks", function () {
      let expectedProceedsT1: BigNumber

      it ("should allow the swap user to withdraw funds", async function() {
        await swap.withdrawLongTerm()
      })

      it ("should contain correct reserves after mining the withdraw order", async function() {
        // Update modelled values:
        const proceeds = poolModel.twammReserveConcurrentSwap(swapParams.sellingRate,
                                                              BigNumber.from(0),
                                                              lastVirtualOrderBlock,
                                                              swapParams.swapExpiryBlock,
                                                              BLOCK_INTERVAL)
        expectedProceedsT1 = proceeds.token1
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
                                          reserve1: vaultReserves.reserve1.sub(expectedProceedsT1) } )
        poolModel.updateTwammReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                          reserve1: twammReserves.reserve1 } )
        poolModel.updateTwammStateReserves( { reserve0: twammReserves.reserve0.add(Swap.MIN_SWAP_AMT),
                                              reserve1: twammReserves.reserve1 } )

        // TODO: Understand the differences below (probably rounding methodology).
        const reserveData = await getReserveData(poolHelper, poolModel, DEV_TOLERANCE)
        compareReserveData(reserveData)
      })

      it ("should give the swap customer the correct long-term swap proceeds", async function () {
        let balChangeT1 = (await token1AssetContract.balanceOf(addr1.address)).sub(prevBalT1)
        let tolerance = DEV_TOLERANCE   // TODO: Understand the difference (probably rounding methodology).
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

        const balFeeChangeT0 = (await poolContract.token0BalancerFees()).sub(initialBalFeesToken0)
        const tolerance = 2 
        expect(balFeeChangeT0).to.be.closeTo(expectedBalFeeT0, tolerance)
      })
    })
  })
}