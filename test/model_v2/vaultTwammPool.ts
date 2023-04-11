import { BigNumber } from "ethers";

import { TokenPairAmtType, ReserveType } from "../helpers/types";
import { BalMath, sqrt } from "./../model_v1/math"
import { PoolType } from "scripts/utils/contractMgmt";
import { LTSwapParams, STFeeType, LTFeeType, ModelStateType } from "./types"
import { ModelState } from "./state";

const ds = require("../../scripts/utils/debugScopes");
const log = ds.getLog("pool-model");



const ZERO = BigNumber.from(0)

export const BALANCER_FEE = BigNumber.from(500000000000000000n)
export const DENOMINATOR_FP18 = BigNumber.from(10n ** 18n)

function poolTypeToFeeKey(poolType: PoolType): string {
  switch (poolType) {
    case PoolType.Stable:
      return "STABLE";
    case PoolType.Liquid:
      return "LIQUID";
    case PoolType.Volatile:
      return "VOLATILE";
    default:
      return "NO_FEE"
  }
}

export const BP = BigNumber.from(100000);            // Basis Points (Total)
export const POOL_FEE_ST_BP: any = {
  STABLE: BigNumber.from(10),
  LIQUID: BigNumber.from(50),
  VOLATILE: BigNumber.from(100),
  NO_FEE: ZERO
}
export const POOL_FEE_ST_PARTNER_BP: any = {
  STABLE: BigNumber.from(5),
  LIQUID: BigNumber.from(25),
  VOLATILE: BigNumber.from(50),
  NO_FEE: ZERO
}
export const POOL_FEE_LT_BP: any = {
  STABLE: BigNumber.from(30),
  LIQUID: BigNumber.from(150),
  VOLATILE: BigNumber.from(300),
  NO_FEE: ZERO
}


export class PoolModel {
  static VERSION = 2;
  static MIN_LIQUIDITY = BigNumber.from(1000)

  constructor(poolType: PoolType) {
    this._modelState.push(ModelState.getZeroObj())
    this._index = 0

    this._lpTokenSupply = BigNumber.from(0)
    this._lpHolders = {}
    this._poolType = poolType;

    this._collectBalancerFees = true
    this._collectCronFiFees = false

    const feeKey = poolTypeToFeeKey(poolType)
    this.stFee = POOL_FEE_ST_BP[feeKey]
    this.partnerFee = POOL_FEE_ST_PARTNER_BP[feeKey]
    this.ltFee = POOL_FEE_LT_BP[feeKey]

    this.feeSharesLP = BigNumber.from(2)
  }

  undo() {
    if (this._index > 0) {
      this._modelState.pop()
      this._index--
    }
  }

  setCollectBalancerFees(collect: boolean): void {
    this._collectBalancerFees = collect
  }

  setCollectCronFiFees(collect: boolean): void {
    this._collectCronFiFees = collect
  }

  setShortTermFee(feeBP: BigNumber): void {
    this.stFee = feeBP
  }

  setPartnerFee(feeBP: BigNumber): void {
    this.partnerFee = feeBP
  }

  setLongTermFee(feeBP: BigNumber): void {
    this.ltFee = feeBP
  }

  setFeeSharesLP(feeShares: BigNumber): void {
    this.feeSharesLP = feeShares
  }

  initialMint(minter: string, token0: BigNumber, token1: BigNumber): BigNumber
  {
    let allReserves = { reserve0: token0, reserve1: token1 }
    this._updateModelState(allReserves)

    this._lpTokenSupply = sqrt(token0.mul(token1))
    this._lpHolders["0"] = PoolModel.MIN_LIQUIDITY
    this._lpHolders[minter] = this._lpTokenSupply.sub(PoolModel.MIN_LIQUIDITY)

    return this._lpHolders[minter]
  }

  donate(donation: TokenPairAmtType): void
  {
    this._addReserves(donation)
  }

  reward(rewards: TokenPairAmtType): void
  {
    this._addReserves(rewards)
  }

  _addReserves(rewards: TokenPairAmtType): void
  {
    const index = this._index
    const {vault} = this._modelState[index]

    // Update the reserves (important to do this AFTER computing lpTokensMin)
    // Note: A mint operation is when balancer collects their fees, so we zero
    //       them in the model and subtract them from the vault balances.
    let vaultReserves = { reserve0: (vault.reserve0.add(rewards.token0)),
                          reserve1: (vault.reserve1.add(rewards.token1)) }
    this._updateModelState( vaultReserves )
  }

  // TODO: this breaks the undo model. Need to also update lpTokenSupply when updating
  //       reserves.  Ignore for now
  //       - would also be problematic for undoing the token holders map
  //       - probably need a proper full undo solution
  mint(minter: string, token0: BigNumber, token1: BigNumber): BigNumber
  {
    const index = this._index
    const {vault, balFee} = this._modelState[index]
    const twammView = this.getTwammReserves()

    // Determine how many LP tokens to mint:
    const lpTokens0 = BalMath.divDown(token0.mul(this._lpTokenSupply), twammView.reserve0)
    const lpTokens1 = BalMath.divDown(token1.mul(this._lpTokenSupply), twammView.reserve1)

    const lpTokensMin = (lpTokens0.lt(lpTokens1)) ? lpTokens0 : lpTokens1
    this._lpTokenSupply = this._lpTokenSupply.add(lpTokensMin)
    this._lpHolders[minter] = lpTokensMin
    
    // Update the reserves (important to do this AFTER computing lpTokensMin)
    // Note: A mint operation is when balancer collects their fees, so we zero
    //       them in the model and subtract them from the vault balances.
    let vaultReserves = { reserve0: (vault.reserve0.add(token0)).sub(balFee.token0),
                          reserve1: (vault.reserve1.add(token1)).sub(balFee.token1) }
    const balancerFees = { token0: ZERO, token1: ZERO }                           
    this._updateModelState(vaultReserves, undefined, undefined, balancerFees)

    return lpTokensMin
  }

  // TODO: this breaks the undo model for similar reasons as mint above.
  // TODO: should check on reducing lpHolders using sub (i.e. does the value exist
  //       otherwise will get crash.  <-- not worrying now for testing)
  burn(burner: string, 
       tokenLP: BigNumber,
       penalizedLP?: BigNumber,
       penaltyBP?: BigNumber): TokenPairAmtType
  {
    const index = this._index
    const {vault, balFee} = this._modelState[index]
    const twammView = this.getTwammReserves()

    let token0 = BalMath.divDown(twammView.reserve0.mul(tokenLP), this._lpTokenSupply)
    let token1 = BalMath.divDown(twammView.reserve1.mul(tokenLP), this._lpTokenSupply)
    if (penalizedLP && penaltyBP && !penalizedLP.eq(ZERO) && !penaltyBP.eq(ZERO)) {
      const penalty0 = (penaltyBP.mul(BalMath.divUp(penalizedLP.mul(token0), tokenLP)))
                       .div(BP)
      const penalty1 = (penaltyBP.mul(BalMath.divUp(penalizedLP.mul(token1), tokenLP)))
                       .div(BP)
      token0 = token0.sub(penalty0)
      token1 = token1.sub(penalty1)
    }
    
    // Update the reserves (important to do this AFTER computing token0 and token1)
    // Note: A burn operation is when balancer collects their fees, so we zero
    //       them in the model and subtract them from the vault balances.
    let vaultReserves = { reserve0: (vault.reserve0.sub(token0)).sub(balFee.token0),
                          reserve1: (vault.reserve1.sub(token1)).sub(balFee.token1) }
    const balancerFees = { token0: ZERO, token1: ZERO }                           
    this._updateModelState(vaultReserves, undefined, undefined, balancerFees)

    this._lpTokenSupply = this._lpTokenSupply.sub(tokenLP)
    this._lpHolders[burner] = this._lpHolders[burner].sub(tokenLP)
    return { token0, token1 }
  }

  // Note: modified contract to only remit fees in exit as done previously.
  //
  // TODO: consider pushing/merging this call into the mint/burn functions
   remitBalancerFees(): void
   {
     // Note: Operations occuring from the onExit callback are when balancer fees are
     //       remitted, so we zero those fees in the model and subtract them from the
     //       vault balances.
     const index = this._index
     const {vault, balFee} = this._modelState[index]
     let vaultReserves = { reserve0: vault.reserve0.sub(balFee.token0),
                           reserve1: vault.reserve1.sub(balFee.token1) }
     const balancerFees = { token0: ZERO, token1: ZERO }                           
     this._updateModelState(vaultReserves, undefined, undefined, balancerFees)
   }

  // ST = Short-Term Swap
  _computeSwapFeesST(tokenIn: BigNumber, partner: boolean): STFeeType
  {
    let poolFeeBP = (partner) ? this.getPoolFeeSTPartner() : this.getPoolFeeST()

    const grossFee = BalMath.divUp(tokenIn.mul(poolFeeBP), BP)
    const tokenInLessFees = tokenIn.sub(grossFee)

    const balancerFee = (this._collectBalancerFees) ?
      BalMath.divUp(grossFee.mul(BALANCER_FEE), DENOMINATOR_FP18) : ZERO

    const lpFee = grossFee.sub(balancerFee)

    return {
      tokenInLessFees,
      balancerFee,
      lpFee
    }
  }

  partnerSwap0To1(amtT0: BigNumber): BigNumber
  {
    return this.swap0To1(amtT0, true)
  }

  partnerSwap1To0(amtT1: BigNumber): BigNumber
  {
    return this.swap1To0(amtT1, true)
  }

  swap0To1(amtT0: BigNumber, partner=false): BigNumber
  {
    const index = this._index
    const feeObj = this._computeSwapFeesST(amtT0, partner)
    const {vault, balFee} = this._modelState[index]
    const twammView = this.getTwammReserves()

    // Compute AMM Math
    const k = twammView.reserve0.mul(twammView.reserve1)
    let nextTwammReserve0 = twammView.reserve0.add(feeObj.tokenInLessFees)
    const nextTwammReserve1 = BalMath.divDown(k, nextTwammReserve0)
    const proceedsT1 = twammView.reserve1.sub(nextTwammReserve1)

    // Update Reserves
    const vaultReserves = { reserve0: vault.reserve0.add(amtT0),
                            reserve1: vault.reserve1.sub(proceedsT1) }
    const balancerFees = { token0: balFee.token0.add(feeObj.balancerFee),
                           token1: balFee.token1 }
    this._updateModelState(vaultReserves, undefined, undefined, balancerFees)

    return proceedsT1
  }
  
  swap1To0(amtT1: BigNumber, partner=false): BigNumber
  {
    const index = this._index
    const feeObj = this._computeSwapFeesST(amtT1, partner)
    const {vault, balFee} = this._modelState[index]
    const twammView = this.getTwammReserves()

    // Compute AMM Math
    const k = twammView.reserve0.mul(twammView.reserve1)
    const nextTwammReserve1 = twammView.reserve1.add(feeObj.tokenInLessFees)
    const nextTwammReserve0 = BalMath.divDown(k, nextTwammReserve1)
    const proceedsT0 = twammView.reserve0.sub(nextTwammReserve0)
    
    // Update Reserves
    let vaultReserves = { reserve0: vault.reserve0.sub(proceedsT0),
                          reserve1: vault.reserve1.add(amtT1) }
    const balancerFees = { token0: balFee.token0,
                           token1: balFee.token1.add(feeObj.balancerFee) }
    this._updateModelState(vaultReserves, undefined, undefined, balancerFees)

    return proceedsT0
  }

  ltSwap0To1 = (orderBlockInterval: number,
                currentBlock: number,
                swapAmount: BigNumber,
                swapIntervals: number): LTSwapParams =>
  {
    // Update the vault balances and order accounting:
    //
    const {vault, orders } = this._modelState[this._index]

    //   Calculate the actual swap amount (truncation makes it less than or equal to
    //   the specified swap amount):
    //
    const swapParams = 
      PoolModel.getLongTermSwapParameters(orderBlockInterval, currentBlock, swapAmount, swapIntervals) 
    const actualSwapAmount = swapParams.sellingRate.mul(swapParams.swapLengthBlocks)

    const vaultReserves = { reserve0: vault.reserve0.add(swapAmount),
                            reserve1: vault.reserve1 }
    const orderAccounting = { token0: orders.token0.add(actualSwapAmount),
                              token1: orders.token1 }

    this._updateModelState(vaultReserves, orderAccounting)

    return swapParams
  }

  ltSwap1To0 = (orderBlockInterval: number,
                currentBlock: number,
                swapAmount: BigNumber,
                swapIntervals: number): LTSwapParams =>
  {
    // Update the vault balances and order accounting:
    //
    const {vault, orders } = this._modelState[this._index]

    //   Calculate the actual swap amount (truncation makes it less than or equal to
    //   the specified swap amount):
    //
    const swapParams = 
      PoolModel.getLongTermSwapParameters(orderBlockInterval, currentBlock, swapAmount, swapIntervals) 
    const actualSwapAmount = swapParams.sellingRate.mul(swapParams.swapLengthBlocks)

    const vaultReserves = { reserve0: vault.reserve0,
                            reserve1: vault.reserve1.add(swapAmount) }
    const orderAccounting = { token0: orders.token0,
                              token1: orders.token1.add(actualSwapAmount) }

    this._updateModelState(vaultReserves, orderAccounting)

    return swapParams
  }

  // LT = Short-Term Swap
  _computeSwapFeesLT(tokenIn: BigNumber): LTFeeType
  {
    let poolFeeBP = this.getPoolFeeLT()

    const grossFee = BalMath.divUp(tokenIn.mul(poolFeeBP), BP)
    const tokenInLessFees = tokenIn.sub(grossFee)

    let lpFee = ZERO
    let balancerFee = ZERO
    let cronFiFee = ZERO
    
    const ONE_FP18 = BigNumber.from(10n ** 18n)
    if (this._collectCronFiFees) {
      const feeShare = BalMath.divDown(grossFee.mul(this.getPoolFeeShareLT()), DENOMINATOR_FP18)
      // LPs get 2 shares, CronFi gets 1
      lpFee = feeShare.shl(this.getPoolFeeShiftLT())
      cronFiFee = feeShare
      balancerFee = grossFee.sub(lpFee.add(cronFiFee))
    } else {
      const LP_FEE = this._collectBalancerFees ? ONE_FP18.sub(BALANCER_FEE) : ONE_FP18
      lpFee = BalMath.divDown(grossFee.mul(LP_FEE), DENOMINATOR_FP18)
      balancerFee = grossFee.sub(lpFee)
    }

    return {
      tokenInLessFees,
      balancerFee,
      cronFiFee,
      lpFee
    }
  }
  
  twammReserveConcurrentSwap(salesRateT0: BigNumber,
                             salesRateT1: BigNumber,
                             lastVirtualOrderBlock: number,
                             currentBlock: number,
                             orderBlockInterval: number,
                             fraxApproximation = true): TokenPairAmtType
  {
    const index = this._index
    let amtsOut: TokenPairAmtType = { token0: ZERO, token1: ZERO }
    const {orders, proceeds, balFee, cronFiFee} = this._modelState[index]
    const updatedOrders = {
      token0: orders.token0,
      token1: orders.token1
    }
    const twammView = this.getTwammReserves()

    let twammReserve0 = twammView.reserve0
    let twammReserve1 = twammView.reserve1
    let balancerFee0 =  balFee.token0
    let balancerFee1 = balFee.token1
    let cronFiFee0 = cronFiFee.token0
    let cronFiFee1 = cronFiFee.token1

    // Adaptation of libTwamm executeVirtualOrdersUntilCurrentBlock and
    // executeVirtualTradesAndOrderExpiries below:
    //
    let expiryBlock = lastVirtualOrderBlock -
                      (lastVirtualOrderBlock % orderBlockInterval) +
                      orderBlockInterval
    
    while (expiryBlock < currentBlock) {
      { // executeVirtualTradesAndOrderExpiries in this block:
        const blockNumberIncrement = BigNumber.from(expiryBlock - lastVirtualOrderBlock)

        const token0SellAmt = salesRateT0.mul(blockNumberIncrement)
        const token1SellAmt = salesRateT1.mul(blockNumberIncrement)

        const feeObjT0 = this._computeSwapFeesLT(token0SellAmt)
        const feeObjT1 = this._computeSwapFeesLT(token1SellAmt)
            
        balancerFee0 = balancerFee0.add(feeObjT0.balancerFee)
        balancerFee1 = balancerFee1.add(feeObjT1.balancerFee)
        cronFiFee0 = cronFiFee0.add(feeObjT0.cronFiFee)
        cronFiFee1 = cronFiFee1.add(feeObjT1.cronFiFee)

        updatedOrders.token0 = updatedOrders.token0.sub(token0SellAmt)
        updatedOrders.token1 = updatedOrders.token1.sub(token1SellAmt)

        // Next part assumes both sales rates always > 0
        if (fraxApproximation) {
          if (token0SellAmt.eq(ZERO) && token1SellAmt.eq(ZERO)) {
            // No-op
          } else if (token0SellAmt.eq(ZERO)) {
            // CPAMM formula for sale of T1 -> T0.
            twammReserve1 = twammReserve1.add(feeObjT1.tokenInLessFees)
            const outToken0 = BalMath.divDown(twammReserve0.mul(feeObjT1.tokenInLessFees), twammReserve1)
            twammReserve0 = twammReserve0.sub(outToken0)

            amtsOut.token0 = amtsOut.token0.add(outToken0)
          } else if (token1SellAmt.eq(ZERO)) {
            // CPAMM formula for sale of T0 -> T1.
            twammReserve0 = twammReserve0.add(feeObjT0.tokenInLessFees)
            const outToken1 = BalMath.divDown(twammReserve1.mul(feeObjT0.tokenInLessFees), twammReserve0)
            twammReserve1 = twammReserve1.sub(outToken1)

            amtsOut.token1 = amtsOut.token1.add(outToken1)
          } else {
            // Early FRAX TWAMM update struction:
//            const k = twammReserve0.mul(twammReserve1)
//            const sum0 = twammReserve0.add(feeObjT0.tokenInLessFees)
//            const sum1 = twammReserve1.add(feeObjT1.tokenInLessFees)
//            twammReserve1 = (twammReserve0.mul(sum1)).div(sum0)
//            twammReserve0 = k.div(twammReserve1)
            
            // Rearranged struction using Kurt Barry's symmetrical update:
            const sum0 = twammReserve0.add(feeObjT0.tokenInLessFees)
            const sum1 = twammReserve1.add(feeObjT1.tokenInLessFees)
            const ammEnd0 = BalMath.divDown(twammReserve1.mul(sum0), sum1)
            const ammEnd1 = BalMath.divDown(twammReserve0.mul(sum1), sum0)
            twammReserve0 = ammEnd0
            twammReserve1 = ammEnd1

            // Relatively confident no underflow here, but adding this check
            // to be sure:
            const outToken0 = sum0.sub(twammReserve0)
            const outToken1 = sum1.sub(twammReserve1)
            if (twammReserve0.gt(sum0) ||
                twammReserve1.gt(sum1) ||
                outToken0.lt(ZERO) ||
                outToken1.lt(ZERO)) {
              throw `twammReservesConcurrentSwap: one or more frax approximation output is less than zero or` +
                    `their computation underflowed (twammReserveN - sumN):\n` +
                    `  outToken0:             ${outToken0}\n` +
                    `    sum0:           ${sum0}\n` +
                    `    twammReserve0:  ${twammReserve0}\n` +
                    `  outToken1:             ${outToken1}\n` +
                    `    sum1:           ${sum1}\n` +
                    `    twammReserve1:  ${twammReserve1}\n`
            }
            amtsOut.token0 = amtsOut.token0.add(outToken0)
            amtsOut.token1 = amtsOut.token1.add(outToken1)
          }

          // NOTE: Order is important here, don't move these above the output calc.
          twammReserve0 = twammReserve0.add(feeObjT0.lpFee)
          twammReserve1 = twammReserve1.add(feeObjT1.lpFee)
        } else {
          // TODO: vanilla Paradigm TWAMM
        }

        lastVirtualOrderBlock = expiryBlock
      }


      expiryBlock += orderBlockInterval
    }

    if (lastVirtualOrderBlock != currentBlock) {
      expiryBlock = currentBlock

      { // executeVirtualTradesAndOrderExpiries in this block:
        const blockNumberIncrement = BigNumber.from(expiryBlock - lastVirtualOrderBlock)

        const token0SellAmt = salesRateT0.mul(blockNumberIncrement)
        const token1SellAmt = salesRateT1.mul(blockNumberIncrement)
        
        const feeObjT0 = this._computeSwapFeesLT(token0SellAmt)
        const feeObjT1 = this._computeSwapFeesLT(token1SellAmt)
        balancerFee0 = balancerFee0.add(feeObjT0.balancerFee)
        balancerFee1 = balancerFee1.add(feeObjT1.balancerFee)
        cronFiFee0 = cronFiFee0.add(feeObjT0.cronFiFee)
        cronFiFee1 = cronFiFee1.add(feeObjT1.cronFiFee)

        updatedOrders.token0 = updatedOrders.token0.sub(token0SellAmt)
        updatedOrders.token1 = updatedOrders.token1.sub(token1SellAmt)
        
        // Next part assumes both sales rates always > 0
        if (fraxApproximation) {
          if (token0SellAmt.eq(ZERO) && token1SellAmt.eq(ZERO)) {
            // No-op
          } else if (token0SellAmt.eq(ZERO)) {
            // CPAMM formula for sale of T1 -> T0.
            twammReserve1 = twammReserve1.add(feeObjT1.tokenInLessFees)
            const outToken0 = BalMath.divDown(twammReserve0.mul(feeObjT1.tokenInLessFees), twammReserve1)
            twammReserve0 = twammReserve0.sub(outToken0)

            amtsOut.token0 = amtsOut.token0.add(outToken0)
          } else if (token1SellAmt.eq(ZERO)) {
            // CPAMM formula for sale of T0 -> T1.
            twammReserve0 = twammReserve0.add(feeObjT0.tokenInLessFees)
            const outToken1 = BalMath.divDown(twammReserve1.mul(feeObjT0.tokenInLessFees), twammReserve0)
            twammReserve1 = twammReserve1.sub(outToken1)

            amtsOut.token1 = amtsOut.token1.add(outToken1)
          } else {
            // Early FRAX TWAMM update struction:
//            const k = twammReserve0.mul(twammReserve1)
//            const sum0 = twammReserve0.add(feeObjT0.tokenInLessFees)
//            const sum1 = twammReserve1.add(feeObjT1.tokenInLessFees)
//            twammReserve1 = (twammReserve0.mul(sum1)).div(sum0)
//            twammReserve0 = k.div(twammReserve1)

            // Rearranged struction using Kurt Barry's symmetrical update:
            const sum0 = twammReserve0.add(feeObjT0.tokenInLessFees)
            const sum1 = twammReserve1.add(feeObjT1.tokenInLessFees)
            const ammEnd0 = BalMath.divDown(twammReserve1.mul(sum0), sum1)
            const ammEnd1 = BalMath.divDown(twammReserve0.mul(sum1), sum0)
            twammReserve0 = ammEnd0
            twammReserve1 = ammEnd1

            // Relatively confident no underflow here, but adding this check
            // to be sure:
            const outToken0 = sum0.sub(twammReserve0)
            const outToken1 = sum1.sub(twammReserve1)
            if (twammReserve0.gt(sum0) ||
                twammReserve1.gt(sum1) ||
                outToken0.lt(ZERO) ||
                outToken1.lt(ZERO)) {
              throw `twammReservesConcurrentSwap: one or more frax approximation output is less than zero or` +
                    `their computation underflowed (twammReserveN - sumN):\n` +
                    `  outToken0:             ${outToken0}\n` +
                    `    sum0:           ${sum0}\n` +
                    `    twammReserve0:  ${twammReserve0}\n` +
                    `  outToken1:             ${outToken1}\n` +
                    `    sum1:           ${sum1}\n` +
                    `    twammReserve1:  ${twammReserve1}\n`
            }
            amtsOut.token0 = amtsOut.token0.add(outToken0)
            amtsOut.token1 = amtsOut.token1.add(outToken1)

            // NOTE: Order is important here, don't move these above the output calc.
          }
          twammReserve0 = twammReserve0.add(feeObjT0.lpFee)
          twammReserve1 = twammReserve1.add(feeObjT1.lpFee)
        } else {
          // TODO: vanilla Paradigm TWAMM
        }

        lastVirtualOrderBlock = expiryBlock
      }
    }

    // Update Accounting (Orders & Proceeds)
    const balancerFees = { token0: balancerFee0, token1: balancerFee1 }
    const cronFiFees = { token0: cronFiFee0, token1: cronFiFee1 }
    const updatedProceeds = {
      token0: proceeds.token0.add(amtsOut.token0),
      token1: proceeds.token1.add(amtsOut.token1)
    } 
    this._updateModelState(undefined, updatedOrders, updatedProceeds, balancerFees, cronFiFees)

    return amtsOut
  }

  getLpTokenSupply(): BigNumber {
    return this._lpTokenSupply
  }

  balanceOfLpToken(address: string): BigNumber {
    return this._lpHolders[address]
  }

  getPoolBalance(balanceType: string): TokenPairAmtType {
    const currState = this._modelState[this._index]
    switch (balanceType) {
      case 'vault':
        return {
          token0: currState.vault.reserve0,
          token1: currState.vault.reserve1
        }
        break;

      case 'orders':
        return {
          token0: currState.orders.token0,
          token1: currState.orders.token1
        }
        break;

      case 'proceeds':
        return {
          token0: currState.proceeds.token0,
          token1: currState.proceeds.token1
        }
        break;

      case 'balFees':
        return {
          token0: currState.balFee.token0,
          token1: currState.balFee.token1
        }
        break;

      case 'cronFees':
        return {
          token0: currState.cronFiFee.token0,
          token1: currState.cronFiFee.token1
        }
        break;

      case 'reserves':
        const twammReserves = this.getTwammReserves()
        return {
          token0: twammReserves.reserve0,
          token1: twammReserves.reserve1
        }
        break;
    
      default:
        throw new Error('Unsupported Balance Type')
        break;
    }
  }

  // TODO: change this naming to balances (vault balances)
  getVaultReserves(): ReserveType {
    return this._modelState[this._index].vault
  }
  
  getTwammReserves(): ReserveType {
    const modelState = this._modelState[this._index]

    return {
      reserve0: modelState.vault.reserve0.sub( modelState.orders.token0
                                               .add(modelState.proceeds.token0)
                                               .add(modelState.balFee.token0)
                                               .add(modelState.cronFiFee.token0) ),
      reserve1: modelState.vault.reserve1.sub( modelState.orders.token1
                                               .add(modelState.proceeds.token1)
                                               .add(modelState.balFee.token1)
                                               .add(modelState.cronFiFee.token1) )
    }
  }

  getTwammStateReserves(): ReserveType {
    log.error("Deprecated method 'getTwammStateReserves' - update your test! Returning zero reserves.")
    return { reserve0: ZERO, reserve1: ZERO }
  }

  getBalancerFees(): TokenPairAmtType {
    return this._modelState[this._index].balFee
  }
  
  getCronFiFees(): TokenPairAmtType {
    return this._modelState[this._index].cronFiFee
  }

  getOrders(): TokenPairAmtType {
    return this._modelState[this._index].orders
  }
  
  getProceeds(): TokenPairAmtType {
    return this._modelState[this._index].proceeds
  }

  getAllReserves(): {vaultReserves: ReserveType, twammReserves: ReserveType} {
    const modelState = this._modelState[this._index]
    return {
      vaultReserves: modelState.vault,
      twammReserves: this.getTwammReserves()
    }
  }

  getPoolType(): PoolType
  {
    return this._poolType
  }

  getPoolFeeST(): BigNumber
  {
    return this.stFee
  }

  getPoolFeeSTPartner(): BigNumber
  {
    return this.partnerFee
  }

  getPoolFeeLT(): BigNumber
  {
    return this.ltFee
  }

  getPoolFeeShareLT(): BigNumber
  {
    const ONE_FP18 = BigNumber.from(10n ** 18n)

    const lpFee = (this._collectBalancerFees) ? ONE_FP18.sub(BALANCER_FEE) : ONE_FP18;
    return (this._collectCronFiFees) ? lpFee.div(this.feeSharesLP.add(1n)) : ZERO;
  }

  getPoolFeeShiftLT(): number
  {
    if (this.feeSharesLP.eq(2)) {
      return 1
    } else if (this.feeSharesLP.eq(4)) {
      return 2
    } else if (this.feeSharesLP.eq(8)) {
      return 3
    } else if (this.feeSharesLP.eq(16)) {
      return 4
    }

    throw new Error(`Invalid fee share value to convert to shift: ${this.feeSharesLP}`)
  }

  /* These next three methods pop the specified 
   * reserve type onto the reserves and copy the 
   * previous values for the unspecified reserves
   * forward.  For instance, updating the vault 
   * reserves pushes the new values onto the vault
   * reserves stack while the previous values of
   * twamm reserves and twamm state reserves are
   * pushed on their respective stacks.
   * 
   * This action permits calls to the 'undo' command
   * to revert reserve modifications across the board.
   */
  updateVaultReserves(vaultReserves: ReserveType): void {
    this._updateModelState(vaultReserves)
  }

  updateOrders(orders: TokenPairAmtType): void {
    this._updateModelState(undefined, orders)
  }

  updateProceeds(proceeds: TokenPairAmtType): void {
    this._updateModelState(undefined, undefined, proceeds)
  }
  
  // TODO: Replace next two methods when all tests run clean and updated to model v2
  updateTwammReserves(twammReserves: ReserveType): void {
    log.error(`TODO: replace updateTwammReserves in test! Ignoring call.`)
  }

  updateTwammStateReserves(twammStateReserves: ReserveType): void {
    log.error(`TODO: replace updateTwammStateReserves in test! Ignoring call.`)
  }

  updateBalancerFees(balancerFees: TokenPairAmtType): void {
    this._updateModelState(undefined, undefined, undefined, balancerFees)
  }
  
  updateCronFiFees(cronFiFees: TokenPairAmtType): void {
    this._updateModelState(undefined, undefined, undefined, undefined, cronFiFees)
  }

  _updateModelState(vaultReserves?: ReserveType,
                    orders?: TokenPairAmtType,
                    proceeds?: TokenPairAmtType,
                    balancerFees?: TokenPairAmtType,
                    cronFiFees?: TokenPairAmtType): void
  {
    const modelState = this._modelState[this._index]
    const nextModelState = ModelState.copyObj(modelState)

    if (vaultReserves) {
      nextModelState.vault.reserve0 = vaultReserves.reserve0
      nextModelState.vault.reserve1 = vaultReserves.reserve1
    }
    if (orders) {
      nextModelState.orders.token0 = orders.token0
      nextModelState.orders.token1 = orders.token1
    }
    if (proceeds) {
      nextModelState.proceeds.token0 = proceeds.token0
      nextModelState.proceeds.token1 = proceeds.token1
    }
    if (balancerFees) {
      nextModelState.balFee.token0 = balancerFees.token0
      nextModelState.balFee.token1 = balancerFees.token1
    }
    if (cronFiFees) {
      nextModelState.cronFiFee.token0 = cronFiFees.token0
      nextModelState.cronFiFee.token1 = cronFiFees.token1
    }
    
    this._modelState.push(nextModelState)
    this._index++
  }


  dumpStatus(tag = ''): void {
    const index = this._index
    const modelState = this._modelState[index]
    const { vault, orders, proceeds, balFee, cronFiFee } = modelState
    const twammView = this.getTwammReserves()
    console.log(`Pool Model Status:     ${tag}\n` +
                `----------------------------------------\n` +
                `index:                 ${index}\n` +
                `LP supply:             ${this._lpTokenSupply}\n` +
                `Vault Reserve0:        ${vault.reserve0}\n` +
                `Vault Reserve1:        ${vault.reserve1}\n` +
                `Orders T0:             ${orders.token0}\n` +
                `Orders T1:             ${orders.token1}\n` +
                `Proceeds T0:           ${proceeds.token0}\n` +
                `Proceeds T1:           ${proceeds.token1}\n` +
                `Twamm Reserve0:        ${twammView.reserve0}\n` +
                `Twamm Reserve1:        ${twammView.reserve1}\n` +
                `Balancer Fees0:        ${balFee.token0}\n` +
                `Balancer Fees1:        ${balFee.token1}\n` +
                `CronFi Fees0:          ${cronFiFee.token0}\n` +
                `CronFi Fees1:          ${cronFiFee.token1}\n` )
  }

  // Note: Assumes currentBlock is the start of the swap.
  //
  static getLongTermSwapParameters = (orderBlockInterval: number,
                                      currentBlock: number,
                                      swapAmount: BigNumber | BigInt | number,
                                      swapIntervals: number): LTSwapParams =>
  {
    const prevExpiryBlock = currentBlock - (currentBlock % orderBlockInterval)    // lastExpiryBlock
    const swapExpiryBlock = orderBlockInterval * (swapIntervals + 1) + prevExpiryBlock
    const swapLengthBlocks = swapExpiryBlock - currentBlock

    const sellingRate = BigNumber.from(swapAmount).div(BigNumber.from(swapLengthBlocks))

    return {
      swapLengthBlocks,
      swapStartBlock: currentBlock,
      swapExpiryBlock,
      sellingRate
    }
  }

  private _index = 0
  private _modelState: ModelStateType[] = []

  private stFee: BigNumber
  private partnerFee: BigNumber
  private ltFee: BigNumber
  private feeSharesLP: BigNumber

  private _lpTokenSupply: BigNumber
  private _lpHolders: {[index: string]: BigNumber}
  private _poolType: PoolType

  private _collectBalancerFees: boolean
  private _collectCronFiFees: boolean
}
