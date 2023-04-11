// (c) Copyright 2022, Bad Pumpkin Inc. All Rights Reserved
//
import { BigNumber } from "ethers";

import { TokenPairAmtType, ReserveType } from "../helpers/types";
import { BalMath, sqrt } from "./math"
import { PoolType } from "scripts/utils/contractMgmt";
import { LTSwapParams, STFeeType, ModelStateType } from "./types"
import { ModelState } from "./state";

const ds = require("../../scripts/utils/debugScopes");
const log = ds.getLog("pool-model");



const ZERO = BigNumber.from(0)

export const BALANCER_FEE = BigNumber.from(500000000000000000n)
export const DENOMINATOR_FP18 = BigNumber.from(10n ** 18n)

export const BP = BigNumber.from(100000);            // Basis Points (Total)
export const POOL_FEE_ST_BP = {
  STABLE: BigNumber.from(10),
  LIQUID: BigNumber.from(50),
  VOLATILE: BigNumber.from(100),
  NO_FEE: ZERO
}
export const POOL_FEE_ST_PARTNER_BP = {
  STABLE: BigNumber.from(5),
  LIQUID: BigNumber.from(25),
  VOLATILE: BigNumber.from(50),
  NO_FEE: ZERO
}
export const POOL_FEE_LT_BP = {
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
  }

  undo() {
    if (this._index > 0) {
      this._modelState.pop()
      this._index--
    }
  }

  initialMint(minter: string, token0: BigNumber, token1: BigNumber): BigNumber
  {
    let allReserves = { reserve0: token0, reserve1: token1 }
    this._updateModelState(allReserves, allReserves, allReserves)

    this._lpTokenSupply = sqrt(token0.mul(token1))
    this._lpHolders["0"] = PoolModel.MIN_LIQUIDITY
    this._lpHolders[minter] = this._lpTokenSupply.sub(PoolModel.MIN_LIQUIDITY)

    return this._lpHolders[minter]
  }

  // TODO: this breaks the undo model. Need to also update lpTokenSupply when updating
  //       reserves.  Ignore for now
  //       - would also be problematic for undoing the token holders map
  //       - probably need a proper full undo solution
  mint(minter: string, token0: BigNumber, token1: BigNumber): BigNumber
  {
    const index = this._index
    const {vault, twammState, twammView, balFee} = this._modelState[index]

    // Determine how many LP tokens to mint:
    // const lpTokens0 = (token0.mul(this._lpTokenSupply)).div(this._twammReserve0[index])
    // const lpTokens1 = (token1.mul(this._lpTokenSupply)).div(this._twammReserve1[index])
    const lpTokens0 = BalMath.divDown(token0.mul(this._lpTokenSupply), twammView.reserve0)
    const lpTokens1 = BalMath.divDown(token1.mul(this._lpTokenSupply), twammView.reserve1)

    const lpTokensMin = (lpTokens0.lt(lpTokens1)) ? lpTokens0 : lpTokens1
    this._lpTokenSupply = this._lpTokenSupply.add(lpTokensMin)
    this._lpHolders[minter] = lpTokensMin
    
    // Update the reserves (important to do this AFTER computing lpTokensMin)
    const balancerFees0 = balFee.token0
    const balancerFees1 = balFee.token1
    let vaultReserves = { reserve0: (vault.reserve0.add(token0)).sub(balancerFees0),
                          reserve1: (vault.reserve1.add(token1)).sub(balancerFees1) }
    let twammReserves = { reserve0: twammView.reserve0.add(token0),
                          reserve1: twammView.reserve1.add(token1)}
    let twammStateReserves = { reserve0: twammState.reserve0.add(token0),
                               reserve1: twammState.reserve1.add(token1) }
    const balancerFees = { token0: ZERO, token1: ZERO }                           
    this._updateModelState(vaultReserves, twammReserves, twammStateReserves, balancerFees)

    return lpTokensMin
  }

  // TODO: this breaks the undo model for similar reasons as mint above.
  // TODO: should check on reducing lpHolders using sub (i.e. does the value exist
  //       otherwise will get crash.  <-- not worrying now for testing)
  burn(burner: string, tokenLP: BigNumber): TokenPairAmtType
  {
    const index = this._index
    const {vault, twammState, twammView, balFee} = this._modelState[index]

    // const token0 = (twammView.reserve0.mul(tokenLP)).div(this._lpTokenSupply)
    // const token1 = (twammView.reserve1.mul(tokenLP)).div(this._lpTokenSupply)
    const token0 = BalMath.divDown(twammView.reserve0.mul(tokenLP), this._lpTokenSupply)
    const token1 = BalMath.divDown(twammView.reserve1.mul(tokenLP),this._lpTokenSupply)
    
    // Update the reserves (important to do this AFTER computing token0 and token1)
    const balancerFees0 = balFee.token0
    const balancerFees1 = balFee.token1
    let vaultReserves = { reserve0: (vault.reserve0.sub(token0)).sub(balancerFees0),
                          reserve1: (vault.reserve1.sub(token1)).sub(balancerFees1) }
    let twammReserves = { reserve0: twammView.reserve0.sub(token0),
                          reserve1: twammView.reserve1.sub(token1)}
    let twammStateReserves = { reserve0: twammState.reserve0.sub(token0),
                               reserve1: twammState.reserve1.sub(token1) }
    const balancerFees = { token0: ZERO, token1: ZERO }                           
    this._updateModelState(vaultReserves, twammReserves, twammStateReserves, balancerFees)

    this._lpTokenSupply = this._lpTokenSupply.sub(tokenLP)
    this._lpHolders[burner] = this._lpHolders[burner].sub(tokenLP)
    return { token0, token1 }
  }

  // ST = Short-Term Swap
  _computeSwapFeesST(tokenIn: BigNumber, partner: boolean): STFeeType
  {
    let poolFeeBP = (partner) ? this.getPoolFeeSTPartner() : this.getPoolFeeST()

    // const grossFee = (tokenIn.mul(poolFeeBP)).div(BP)
    const grossFee = BalMath.divUp(tokenIn.mul(poolFeeBP), BP)
    const tokenInLessFees = tokenIn.sub(grossFee)

    // const balancerFee = (grossFee.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)
    const balancerFee = BalMath.divUp(grossFee.mul(BALANCER_FEE), DENOMINATOR_FP18)
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
    const {vault, twammView, balFee} = this._modelState[index]

    // Compute AMM Math
    let twammReserve0 = twammView.reserve0
    let twammReserve1 = twammView.reserve1
    const k = twammReserve0.mul(twammReserve1)
    let nextTwammReserve0 = twammReserve0.add(feeObj.tokenInLessFees)
    // const nextTwammReserve1 = k.div(nextTwammReserve0)
    const nextTwammReserve1 = BalMath.divDown(k, nextTwammReserve0)
    const proceedsT1 = twammReserve1.sub(nextTwammReserve1)

    // Update Reserves
    const vaultReserves = { reserve0: vault.reserve0.add(amtT0),
                            reserve1: vault.reserve1.sub(proceedsT1) }
    const otherReserves = { reserve0: nextTwammReserve0.add(feeObj.lpFee),
                            reserve1: nextTwammReserve1 }
    const balancerFees = { token0: balFee.token0.add(feeObj.balancerFee),
                           token1: balFee.token1 }
    this._updateModelState(vaultReserves, otherReserves, otherReserves, balancerFees)

    return proceedsT1
  }
  
  swap1To0(amtT1: BigNumber, partner=false): BigNumber
  {
    const index = this._index
    const feeObj = this._computeSwapFeesST(amtT1, partner)
    const {vault, twammView, balFee} = this._modelState[index]

    // Compute AMM Math
    let twammReserve0 = twammView.reserve0
    let twammReserve1 = twammView.reserve1
    const k = twammReserve0.mul(twammReserve1)
    const nextTwammReserve1 = twammReserve1.add(feeObj.tokenInLessFees)
    // const nextTwammReserve0 = k.div(nextTwammReserve1)
    const nextTwammReserve0 = BalMath.divDown(k, nextTwammReserve1)
    const proceedsT0 = twammReserve0.sub(nextTwammReserve0)
    
    // Update Reserves
    let vaultReserves = { reserve0: vault.reserve0.sub(proceedsT0),
                          reserve1: vault.reserve1.add(amtT1) }
    let otherReserves = { reserve0: nextTwammReserve0,
                          reserve1: nextTwammReserve1.add(feeObj.lpFee) }
    const balancerFees = { token0: balFee.token0,
                           token1: balFee.token1.add(feeObj.balancerFee) }
    this._updateModelState(vaultReserves, otherReserves, otherReserves, balancerFees)

    return proceedsT0
  }

  // LT = Short-Term Swap
  _computeSwapFeesLT(tokenIn: BigNumber): STFeeType
  {
    let poolFeeBP = this.getPoolFeeLT()

    // const grossFee = (tokenIn.mul(poolFeeBP)).div(BP)
    const grossFee = BalMath.divUp(tokenIn.mul(poolFeeBP), BP)
    const tokenInLessFees = tokenIn.sub(grossFee)

    const ONE_FP18 = BigNumber.from(10n ** 18n)
    const LP_FEE = ONE_FP18.sub(BALANCER_FEE)
    const lpFee = BalMath.divUp(grossFee.mul(LP_FEE), DENOMINATOR_FP18)
    const balancerFee = grossFee.sub(lpFee)
    // const balancerFee = (grossFee.mul(BALANCER_FEE)).div(DENOMINATOR_FP18)

    return {
      tokenInLessFees,
      balancerFee,
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
    const {vault, twammState, twammView, balFee} = this._modelState[index]

    let twammReserve0 = twammView.reserve0
    let twammReserve1 = twammView.reserve1
    let balancerFee0 =  balFee.token0
    let balancerFee1 = balFee.token1

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

        // Next part assumes both sales rates always > 0
        if (fraxApproximation) {
          if (token0SellAmt.eq(ZERO) && token1SellAmt.eq(ZERO)) {
            // No-op
          } else if (token0SellAmt.eq(ZERO)) {
            // CPAMM formula for sale of T1 -> T0.
            twammReserve1 = twammReserve1.add(feeObjT1.tokenInLessFees)
            const outToken0 = (twammReserve0.mul(feeObjT1.tokenInLessFees)).div(twammReserve1)
            twammReserve0 = twammReserve0.sub(outToken0)

            amtsOut.token0 = amtsOut.token0.add(outToken0)
          } else if (token1SellAmt.eq(ZERO)) {
            // CPAMM formula for sale of T0 -> T1.
            twammReserve0 = twammReserve0.add(feeObjT0.tokenInLessFees)
            const outToken1 = (twammReserve1.mul(feeObjT0.tokenInLessFees)).div(twammReserve0)
            twammReserve1 = twammReserve1.sub(outToken1)

            amtsOut.token1 = amtsOut.token1.add(outToken1)
          } else {
            const k = twammReserve0.mul(twammReserve1)
            const sum0 = twammReserve0.add(feeObjT0.tokenInLessFees)
            const sum1 = twammReserve1.add(feeObjT1.tokenInLessFees)
            twammReserve1 = (twammReserve0.mul(sum1)).div(sum0)
            twammReserve0 = k.div(twammReserve1)

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

    // Dead code?
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

        // Next part assumes both sales rates always > 0
        if (fraxApproximation) {
          if (token0SellAmt.eq(ZERO) && token1SellAmt.eq(ZERO)) {
            // No-op
          } else if (token0SellAmt.eq(ZERO)) {
            // CPAMM formula for sale of T1 -> T0.
            twammReserve1 = twammReserve1.add(feeObjT1.tokenInLessFees)
            const outToken0 = (twammReserve0.mul(feeObjT1.tokenInLessFees)).div(twammReserve1)
            twammReserve0 = twammReserve0.sub(outToken0)

            amtsOut.token0 = amtsOut.token0.add(outToken0)
          } else if (token1SellAmt.eq(ZERO)) {
            // CPAMM formula for sale of T0 -> T1.
            twammReserve0 = twammReserve0.add(feeObjT0.tokenInLessFees)
            const outToken1 = (twammReserve1.mul(feeObjT0.tokenInLessFees)).div(twammReserve0)
            twammReserve1 = twammReserve1.sub(outToken1)

            amtsOut.token1 = amtsOut.token1.add(outToken1)
          } else {
            const k = twammReserve0.mul(twammReserve1)
            const sum0 = twammReserve0.add(feeObjT0.tokenInLessFees)
            const sum1 = twammReserve1.add(feeObjT1.tokenInLessFees)
            twammReserve1 = (twammReserve0.mul(sum1)).div(sum0)
            twammReserve0 = k.div(twammReserve1)

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

    // Update Reserves
    const twammReserves = { reserve0: twammReserve0, reserve1: twammReserve1}
    const balancerFees = { token0: balancerFee0, token1: balancerFee1 }
    this._updateModelState(undefined, twammReserves, undefined, balancerFees)

    return amtsOut
  }

  getLpTokenSupply(): BigNumber {
    return this._lpTokenSupply
  }

  balanceOfLpToken(address: string): BigNumber {
    return this._lpHolders[address]
  }

  getVaultReserves(): ReserveType {
    return this._modelState[this._index].vault
  }
  
  getTwammReserves(): ReserveType {
    return this._modelState[this._index].twammView
  }

  getTwammStateReserves(): ReserveType {
    return this._modelState[this._index].twammState
  }

  getBalancerFees(): TokenPairAmtType {
    return this._modelState[this._index].balFee
  }
  
  getCronFiFees(): TokenPairAmtType {
    return this._modelState[this._index].cronFiFee
  }

  getAllReserves(): {vaultReserves: ReserveType, twammReserves: ReserveType, twammStateReserves: ReserveType} {
    const modelState = this._modelState[this._index]
    return {
      vaultReserves: modelState.vault,
      twammReserves: modelState.twammView,
      twammStateReserves: modelState.twammState
    }
  }

  getPoolType(): PoolType
  {
    return this._poolType
  }

  getPoolFeeST(): BigNumber
  {
    let poolFeeBP = BigNumber.from(0);
    switch(this._poolType) {
      case PoolType.Stable:
        poolFeeBP = POOL_FEE_ST_BP.STABLE
        break
      case PoolType.Liquid:
        poolFeeBP = POOL_FEE_ST_BP.LIQUID
        break
      case PoolType.Volatile:
        poolFeeBP = POOL_FEE_ST_BP.VOLATILE
        break

      default:
        throw new Error(`Invalid pool type ${this._poolType}`)
        break;
    }

    return poolFeeBP
  }

  getPoolFeeSTPartner(): BigNumber
  {
    let poolFeeBP = BigNumber.from(0);
    switch(this._poolType) {
      case PoolType.Stable:
        poolFeeBP = POOL_FEE_ST_PARTNER_BP.STABLE
        break
      case PoolType.Liquid:
        poolFeeBP = POOL_FEE_ST_PARTNER_BP.LIQUID
        break
      case PoolType.Volatile:
        poolFeeBP = POOL_FEE_ST_PARTNER_BP.VOLATILE
        break

      default:
        throw new Error(`Invalid pool type ${this._poolType}`)
        break;
    }

    return poolFeeBP
  }

  getPoolFeeLT(): BigNumber
  {
    let poolFeeBP = BigNumber.from(0);
    switch(this._poolType) {
      case PoolType.Stable:
        poolFeeBP = POOL_FEE_LT_BP.STABLE
        break
      case PoolType.Liquid:
        poolFeeBP = POOL_FEE_LT_BP.LIQUID
        break
      case PoolType.Volatile:
        poolFeeBP = POOL_FEE_LT_BP.VOLATILE
        break

      default:
        throw new Error(`Invalid pool type ${this._poolType}`)
        break;
    }

    return poolFeeBP
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
  
  updateTwammReserves(twammReserves: ReserveType): void {
    this._updateModelState(undefined, twammReserves)
  }

  updateTwammStateReserves(twammStateReserves: ReserveType): void {
    this._updateModelState(undefined, undefined, twammStateReserves)
  }

  updateBalancerFees(balancerFees: TokenPairAmtType): void {
    this._updateModelState(undefined, undefined, undefined, balancerFees)
  }
  
  updateCronFiFees(cronFiFees: TokenPairAmtType): void {
    this._updateModelState(undefined, undefined, undefined, undefined, cronFiFees)
  }

  _updateModelState(vaultReserves?: ReserveType,
                  twammReserves?: ReserveType,
                  twammStateReserves?: ReserveType,
                  balancerFees?: TokenPairAmtType,
                  cronFiFees?: TokenPairAmtType): void {
    const modelState = this._modelState[this._index]
    const nextModelState = ModelState.copyObj(modelState)
    if (vaultReserves) {
      nextModelState.vault.reserve0 = vaultReserves.reserve0
      nextModelState.vault.reserve1 = vaultReserves.reserve1
    }
    if (twammStateReserves) {
      nextModelState.twammState.reserve0 = twammStateReserves.reserve0
      nextModelState.twammState.reserve1 = twammStateReserves.reserve1
    }
    if (twammReserves) {
      nextModelState.twammView.reserve0 = twammReserves.reserve0
      nextModelState.twammView.reserve1 = twammReserves.reserve1
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
    const { vault, twammState, twammView, balFee, cronFiFee } = modelState
    console.log(`Pool Model Status:     ${tag}\n` +
                `----------------------------------------\n` +
                `index:                 ${index}\n` +
                `LP supply:             ${this._lpTokenSupply}\n` +
                `Vault Reserve0:        ${vault.reserve0}\n` +
                `Vault Reserve1:        ${vault.reserve1}\n` +
                `Twamm Reserve0:        ${twammView.reserve0}\n` +
                `Twamm Reserve1:        ${twammView.reserve1}\n` +
                `Twamm State Reserve0:  ${twammState.reserve0}\n` +
                `Twamm State Reserve1:  ${twammState.reserve1}\n` +
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

  private _lpTokenSupply: BigNumber
  private _lpHolders: {[index: string]: BigNumber}
  private _poolType: PoolType
}