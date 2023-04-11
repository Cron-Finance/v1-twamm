import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { Vault } from "typechain/contracts/twault/balancer-core-v2/vault/Vault";
import { CronV1Pool } from "typechain/contracts/twault/CronV1Pool";
import { TestERC20 } from "typechain/contracts/twault/helpers/TestERC20";

import { SwapKind } from "./batchSwap";
import { IVault } from "typechain/contracts/twault/balancer-core-v2/vault/interfaces/IVault";

import { ethers } from "hardhat"
import { BigNumber, BytesLike } from "ethers";

import { SwapType, ExitType, JoinType } from "../../scripts/utils/contractMgmt"
import { JoinObjects, SwapObjects, TokenPairAmtType } from "./types";
import { mineBlocks, getLastBlockNumber } from "./misc"      


// Logging:
const ds = require("../../scripts/utils/debugScopes");
const log = ds.getLog("VaultTwammPoolAPIHelper");

let _orderId = 0
export function getNextOrderId(): number
{
  return _orderId++
}

export function clearNextOrderId(): void
{
  _orderId = 0;
}

export class Swap {
  static MIN_SWAP_AMT = BigNumber.from(1)   // Needed to withdraw / cancel etc.

  constructor( poolHelper: VaultTwammPoolAPIHelper,
               token0Owner: SignerWithAddress,
               token1Owner: SignerWithAddress,
               direction0To1: boolean )
  {
    this._poolHelper = poolHelper
    this._direction0To1 = direction0To1
    this._token0Owner = token0Owner
    this._token1Owner = token1Owner
    this._orderId = -1
  }

  async _doSwapApprovals(direction0To1: boolean, sender: SignerWithAddress, amount: BigNumber): Promise<void> {
    const vaultContract = this._poolHelper.getVaultContract()
    const tokenContract = (direction0To1) ? this._poolHelper.getToken0Contract() :
                                            this._poolHelper.getToken1Contract()
    const tokenOwner = (direction0To1) ? this._token0Owner : this._token1Owner

    await tokenContract.connect(tokenOwner).transfer(sender.address, amount)
    await tokenContract.connect(sender).approve(vaultContract.address, amount)

    await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)
  }

  async _doSwap(swapObjects: SwapObjects, sender: SignerWithAddress): Promise<void>
  {
      const vaultContract = this._poolHelper.getVaultContract()
      const { swapStruct, fundStruct, limitOutAmt, deadlineSec } = swapObjects
      await vaultContract.connect(sender).swap(swapStruct, fundStruct, limitOutAmt, deadlineSec)
      await mineBlocks()
  }

  async _doExit(exitRequest: IVault.ExitPoolRequestStruct,
                sender: SignerWithAddress,
                recipient: SignerWithAddress): Promise<void>
  {
      const vaultContract = this._poolHelper.getVaultContract()
      await vaultContract.connect(sender).exitPool(
        this._poolHelper.getPoolId(),
        sender.address,
        recipient.address,
        exitRequest
      )
      await mineBlocks()
  }

  async shortTerm(amount: BigNumber,
                  sender: SignerWithAddress,
                  doSwap=true,
                  doApprovals=true): Promise<SwapObjects>
  {
    this._sender = sender
    const recipient = sender

    if (doApprovals) {
      await this._doSwapApprovals(this._direction0To1, sender, amount)
    }

    const swapObjects = this._direction0To1 ?  await this._poolHelper.getSwapObjects0To1(amount, sender, recipient) :
                                               await this._poolHelper.getSwapObjects1To0(amount, sender, recipient)

    if (doSwap) {
      await this._doSwap(swapObjects, sender)
    }

    return swapObjects
  }

  async partnerSwap(amount: BigNumber,
                    sender: SignerWithAddress,
                    partner: SignerWithAddress,
                    doSwap=true,
                    doApprovals=true): Promise<SwapObjects>
  {
    this._sender = sender
    const recipient = sender

    if (doApprovals) {
      await this._doSwapApprovals(this._direction0To1, sender, amount)
    }

    const swapObjects = this._direction0To1 ?  await this._poolHelper.getPartnerSwapObjects0To1(amount, sender, recipient, partner) :
                                               await this._poolHelper.getPartnerSwapObjects1To0(amount, sender, recipient, partner)

    if (doSwap) {
      await this._doSwap(swapObjects, sender)
    }

    return swapObjects
  }

  async kdaoSwap(amount: BigNumber,
                 sender: SignerWithAddress,
                 doSwap=true,
                 doApprovals=true): Promise<SwapObjects>
  {
    this._sender = sender
    const recipient = sender

    if (doApprovals) {
      await this._doSwapApprovals(this._direction0To1, sender, amount)
    }

    const swapObjects = this._direction0To1 ?  await this._poolHelper.getKeeperDaoSwapObjects0To1(amount, sender, recipient) :
                                               await this._poolHelper.getKeeperDaoSwapObjects1To0(amount, sender, recipient)

    if (doSwap) {
      await this._doSwap(swapObjects, sender)
    }

    return swapObjects
  }


  async longTerm(amount: BigNumber,
                 intervals: number,
                 sender: SignerWithAddress,
                 doSwap=true,
                 doApprovals=true,
                 recipient?: SignerWithAddress): Promise<SwapObjects>
  {
    this._sender = sender

    if (!recipient) {
      recipient = sender
    }

    if (doApprovals) {
      await this._doSwapApprovals(this._direction0To1, sender, amount)
    }

    const swapObjects = this._direction0To1 ? 
      await this._poolHelper.getLTSwapObjects0To1(amount, intervals, sender, recipient) : 
      await this._poolHelper.getLTSwapObjects1To0(amount, intervals, sender, recipient)
    
    if (doSwap) {
      await this._doSwap(swapObjects, sender)
      this._orderId = getNextOrderId()
    }
    
    return swapObjects
  }

  async withdrawLongTerm(orderId?: number,
                         sender?: SignerWithAddress,
                         recipient?: SignerWithAddress,
                         doWithdraw=true): Promise<IVault.ExitPoolRequestStruct>
  {
    if (orderId === undefined) {
      orderId = this._orderId
      if (orderId === undefined || orderId === -1) {
        throw new Error('No order id provided or set in Swap instance.')
      }
    }

    if (!sender) {
      sender = this._sender
      if (!sender) {
        throw new Error('No sender provided or set in Swap instance.')
      }
    }

    if (!recipient) {
      recipient = sender
    }

    const exitRequest = await this._poolHelper.getLTSwapWithdrawExitObjects(orderId)
    if (doWithdraw) {
      await this._doExit(exitRequest, sender, recipient)
    }
    return exitRequest
  }

  async cancelLongTerm(orderId?: number,
                       sender?: SignerWithAddress,
                       recipient? :SignerWithAddress,
                       doCancel=true): Promise<IVault.ExitPoolRequestStruct>
  {
    if (orderId === undefined) {
      orderId = this._orderId
      if (orderId === undefined || orderId === -1) {
        throw new Error('No order id provided or set in Swap instance.')
      }
    }

    if (!sender) {
      sender = this._sender
      if (!sender) {
        throw new Error('No sender provided or set in Swap instance.')
      }
    }

    if (!recipient) {
      recipient = sender
    }

    const exitRequest = await this._poolHelper.getLTSwapCancelExitObjects(orderId)
    if (doCancel) {
      await this._doExit(exitRequest, sender, recipient)
    }
    return exitRequest
  }

  async cancelLongTermPart2Proceeds(orderId?: number,
                                    sender?: SignerWithAddress,
                                    doCancel=true,
                                    doApprovals=true): Promise<SwapObjects>
  {
    throw new Error(`Method cancelLongTermPart2Proceeds is deprecated. REMOVE FROM CALLING CODE!`)
  }

  setOrderId(orderId: number): void {
    this._orderId = orderId
  }

  getOrderId(): number {
    return this._orderId
  }

  private _poolHelper: VaultTwammPoolAPIHelper
  private _token0Owner: SignerWithAddress
  private _token1Owner: SignerWithAddress
  private _direction0To1: boolean
  private _sender?: SignerWithAddress
  private _orderId: number
}


export class SwapManager {
  constructor( poolHelper: VaultTwammPoolAPIHelper,
               token0Owner: SignerWithAddress,
               token1Owner: SignerWithAddress ) {
    this._poolHelper = poolHelper
    this._token0Owner = token0Owner
    this._token1Owner = token1Owner
  }

  newSwap0To1(): Swap {
    return new Swap(this._poolHelper, this._token0Owner, this._token1Owner, true)
  }

  newSwap1To0(): Swap {
    return new Swap(this._poolHelper, this._token0Owner, this._token1Owner, false)
  }

  private _poolHelper: VaultTwammPoolAPIHelper
  private _token0Owner: SignerWithAddress
  private _token1Owner: SignerWithAddress
}

export class VaultTwammPoolAPIHelper {
  constructor( vaultContract: Vault,
               poolContract: CronV1Pool,
               poolContractName: string,
               token0AssetContract: TestERC20,
               token1AssetContract: TestERC20,
               token0Decimals = 18,
               token1Decimals = 18 )
  {
    this._vaultContract = vaultContract
    this._poolContract = poolContract
    this._poolContractName = poolContractName
    this._poolId = ''
    this._token0AssetContract = token0AssetContract
    this._token1AssetContract = token1AssetContract
    this._token0Decimals = token0Decimals
    this._token1Decimals = token1Decimals
  }

  async init()
  {
    this._poolId = await this._poolContract.POOL_ID();
  }
  
  getVaultContract() : Vault
  {
    return this._vaultContract
  }

  getPoolContract() : CronV1Pool 
  {
    return this._poolContract
  }

  getToken0Contract() : TestERC20
  {
    return this._token0AssetContract
  }
  
  getToken1Contract() : TestERC20
  {
    return this._token1AssetContract
  }

  getPoolId(): string
  {
    return this._poolId
  }

  async getPoolReserves(blockNumber?: number): Promise<{reserve0: BigNumber, reserve1: BigNumber}>
  {
    blockNumber = (blockNumber != undefined) ? blockNumber : await getLastBlockNumber();
    let vrResult = await this._poolContract.callStatic.getVirtualReserves(blockNumber, false)
    return {
      reserve0: vrResult.token0ReserveU112,
      reserve1: vrResult.token1ReserveU112
    }
  }

  async getPoolBalance(balanceType: string): Promise<TokenPairAmtType>
  {
    switch (balanceType) {
      case 'vault':
        const vaultReserves = await this.getVaultPoolReserves()
        return {
          token0: vaultReserves.reserve0,
          token1: vaultReserves.reserve1
        }
        break;

      case 'orders':
        const orders = await this._poolContract.getOrderAmounts();
        return {
          token0: orders[0],
          token1: orders[1]
        }
        break;

      case 'proceeds':
        const proceeds = await this._poolContract.getProceedAmounts();
        return {
          token0: proceeds[0],
          token1: proceeds[1]
        }
        break;

      case 'balFees':
        const balFees = await this._poolContract.getBalancerFeeAmounts();
        return {
          token0: balFees[0],
          token1: balFees[1]
        }
        break;

      case 'cronFees':
        const cronFees = await this._poolContract.getCronFeeAmounts();
        return {
          token0: cronFees[0],
          token1: cronFees[1]
        }
        break;

      case 'reserves':
        let blockNumber = await getLastBlockNumber();
        let vrResult = await this._poolContract.callStatic.getVirtualReserves(blockNumber, false)
        return {
          token0: vrResult.token0ReserveU112,
          token1: vrResult.token1ReserveU112
        }
        break;
    
      default:
        throw new Error('Unsupported Balance Type')
        break;
    }
  }

  async getVaultPoolReserves(): Promise<{reserve0: BigNumber, reserve1: BigNumber}>
  {
    const {tokens, balances, lastChangeBlock } = await this._vaultContract.getPoolTokens(this._poolId)
    const firstIsTokenZero = tokens[0] === this._token0AssetContract.address

    return {
      reserve0: (firstIsTokenZero) ? balances[0] : balances[1],
      reserve1: (firstIsTokenZero) ? balances[1] : balances[0]
    }
  }

  async getTokenAmtsFromLP(amountLP: BigNumber,
                           scaleDownDec18 = false): Promise<{ amount0: BigNumber, amount1: BigNumber }>
  {
    const supplyLP = await this._poolContract.totalSupply()
    let blockNumber = await getLastBlockNumber();
    let vrResult = await this._poolContract.callStatic.getVirtualReserves(blockNumber, false)
    const fractionalDigits = ethers.utils.parseUnits("1")
    if (scaleDownDec18) {
      return {
        amount0: (amountLP.mul(vrResult.token0ReserveU112).div(supplyLP)).div(fractionalDigits),
        amount1: (amountLP.mul(vrResult.token1ReserveU112).div(supplyLP)).div(fractionalDigits)
      }
    } else {
      return {
        amount0: amountLP.mul(vrResult.token0ReserveU112).div(supplyLP),
        amount1: amountLP.mul(vrResult.token1ReserveU112).div(supplyLP)
      }
    }
  }

  async getJoinObjects( token0AmtScaled: BigNumber,
                        token1AmtScaled: BigNumber,
                        tolerance = 1): Promise<JoinObjects>
  {
    // Ensure the value is between 0 - 100% (Standard Ts double resolution):
    //
    if (tolerance < 0 || tolerance >= 100) {
      throw new Error(`Invalid tolerance specified = ${tolerance}`)
    }

    // Convert to approximately 18 decimals of resolution integer scaled:
    //
    const divisor = 10n ** 18n
    const multiplier = divisor - BigInt((10 ** 18) * (tolerance / 100))

    // Determine the acceptible token minimums:
    //
    const token0Min = BigNumber.from((multiplier * (token0AmtScaled.toBigInt())) / divisor)
    const token1Min = BigNumber.from((multiplier * (token1AmtScaled.toBigInt())) / divisor)

    return this._getJoinRequest(JoinType.Join, token0AmtScaled, token1AmtScaled, token0Min, token1Min)
  }
  
  async getRewardObjects( token0AmtScaled: BigNumber,
                          token1AmtScaled: BigNumber): Promise<JoinObjects>
  {
    return this._getJoinRequest(JoinType.Reward, token0AmtScaled, token1AmtScaled)
  }

  async getExitRequest( amountLP: BigNumber,
                        minTokenAmt0 = "0",
                        minTokenAmt1 = "0",
                        scaleDown = false ): Promise<IVault.ExitPoolRequestStruct>
  {
    return this._getExitRequest(ExitType.Exit,
                                amountLP,
                                minTokenAmt0,
                                minTokenAmt1)
  }

  async getSwapObjects0To1 (amount: BigNumber, sender: SignerWithAddress, recipient: SignerWithAddress): Promise<SwapObjects>
  {
    const zeroBN = BigNumber.from(0)
    return await this._getSwapObjects(amount, zeroBN, sender, recipient, SwapType.RegularSwap);
  }

  async getSwapObjects1To0 (amount: BigNumber, sender: SignerWithAddress, recipient: SignerWithAddress): Promise<SwapObjects>
  {
    const zeroBN = BigNumber.from(0)
    return await this._getSwapObjects(zeroBN, amount, sender, recipient, SwapType.RegularSwap);
  }

  async getPartnerSwapObjects0To1 (amount: BigNumber, sender: SignerWithAddress, recipient: SignerWithAddress, partner: SignerWithAddress): Promise<SwapObjects>
  {
    const zeroBN = BigNumber.from(0)
    return await this._getSwapObjects(amount, zeroBN, sender, recipient, SwapType.PartnerSwap, BigNumber.from(partner.address));
  }

  async getPartnerSwapObjects1To0 (amount: BigNumber, sender: SignerWithAddress, recipient: SignerWithAddress, partner: SignerWithAddress): Promise<SwapObjects>
  {
    const zeroBN = BigNumber.from(0)
    return await this._getSwapObjects(zeroBN, amount, sender, recipient, SwapType.PartnerSwap, BigNumber.from(partner.address));
  }

  async getKeeperDaoSwapObjects0To1(amount: BigNumber, sender: SignerWithAddress, recipient: SignerWithAddress): Promise<SwapObjects>
  {
    const zeroBN = BigNumber.from(0)
    return await this._getSwapObjects(amount, zeroBN, sender, recipient, SwapType.KeeperDao);
  }

  async getKeeperDaoSwapObjects1To0 (amount: BigNumber, sender: SignerWithAddress, recipient: SignerWithAddress): Promise<SwapObjects>
  {
    const zeroBN = BigNumber.from(0)
    return await this._getSwapObjects(zeroBN, amount, sender, recipient, SwapType.KeeperDao);
  }

  async getLTSwapObjects0To1 (amount: BigNumber,
                              intervals: number,
                              sender: SignerWithAddress,
                              recipient: SignerWithAddress): Promise<SwapObjects>
  {
    const zeroBN = BigNumber.from(0)
    return await this._getSwapObjects(amount, zeroBN, sender, recipient, SwapType.LongTermSwap, BigNumber.from(intervals));
  }

  async getLTSwapObjects1To0 (amount: BigNumber,
                              intervals: number,
                              sender: SignerWithAddress,
                              recipient: SignerWithAddress): Promise<SwapObjects>
  {
    const zeroBN = BigNumber.from(0)
    return await this._getSwapObjects(zeroBN, amount, sender, recipient, SwapType.LongTermSwap, BigNumber.from(intervals));
  }

  async getLTSwapWithdrawExitObjects (orderId: number): Promise<IVault.ExitPoolRequestStruct>
  {
    return await this._getExitRequest( ExitType.Withdraw, BigNumber.from(orderId) )
  }

  async getLTSwapCancelExitObjects (orderId: number): Promise<IVault.ExitPoolRequestStruct>
  {
    return await this._getExitRequest( ExitType.Cancel, BigNumber.from(orderId) )
  }

  async getCronFiFeeWithdrawExitObjects (): Promise<IVault.ExitPoolRequestStruct>
  {
    return await this._getExitRequest( ExitType.FeeWithdraw,
                                       BigNumber.from(0) /* Unused/Ignored */ )
  }

  private async _getJoinRequest( joinType: JoinType,
                                 token0Amt: BigNumber,
                                 token1Amt: BigNumber,
                                 token0Min?: BigNumber,
                                 token1Min?: BigNumber): Promise<any>
  {
    const zeroBN = BigNumber.from(0)
    if (token0Min == undefined) {
      token0Min = zeroBN
    }
    if (token1Min == undefined) {
      token1Min = zeroBN
    }

    const assets = (await this._vaultContract.getPoolTokens(this._poolId)).tokens
    const amountsIn = (assets[0].toLowerCase() === this._token0AssetContract.address.toLowerCase()) ?
                         [token0Amt, token1Amt] :
                         [token1Amt, token0Amt];
    const amounts = amountsIn.map((amt) => amt.toHexString());

    const minAmountsIn = (assets[0].toLowerCase() === this._token0AssetContract.address.toLowerCase()) ?
                       [token0Min, token1Min] :
                       [token1Min, token0Min];
    const minAmounts = minAmountsIn.map((amt) => amt.toHexString());

    const userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]", "uint256[]"], 
                                                                     [joinType, amounts, minAmounts] );

    return {
      joinStruct: {
        assets,
        maxAmountsIn: amountsIn,
        userData,
        fromInternalBalance: false
      },
      token0Amt,
      token1Amt,
      token0Min,
      token1Min
    }

  }
  
  private async _getSwapObjects( amount0: BigNumber, 
                                 amount1: BigNumber,
                                 sender: SignerWithAddress,
                                 recipient: SignerWithAddress,
                                 swapType: SwapType,
                                 argument = BigNumber.from(0),
                                 limitOutAmt = 0,
                                 // Setting deadlineSec to now + 10 days (used
                                 // to be 1 day but mining and 12s inserted
                                 // times made that insufficient--could use a
                                 // block based computation but that would slow
                                 // things down).
                                 deadlineSec = Math.round(Date.now() / 1000) + 60 * 60 * 24 * 10,
                                 scale = false
                               ): Promise<SwapObjects>
  {
    const isAmount0 = !amount0.isZero()
    const tokenInContract = (isAmount0) ? this._token0AssetContract : this._token1AssetContract;
    const tokenOutContract = (isAmount0) ? this._token1AssetContract : this._token0AssetContract;
    const tokenInAmtBeforeScale = (isAmount0) ? amount0 : amount1;
    const tokenDecimals = (isAmount0) ? this._token0Decimals : this._token1Decimals;

    const tokenInAmt = (scale) ? 
      tokenInAmtBeforeScale.mul(10**tokenDecimals) :
      tokenInAmtBeforeScale

    // For converting Enum SwapType to contract ABI, have to encode as minimum sized uint.
    // See this for futher details:  https://docs.soliditylang.org/en/v0.7.6/types.html#enums
    //
    const userData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", // swap type:
                    //    0 -> regular swap
                    //    1 -> long-term swap
                    //    2 -> partner swap
         "uint256"  // argument (depends on swap type value)
                    //    swap type = 0   -> unused, value ignored
                    //    swap type = 1-2 -> intervals:   0 < value < MAX_INTERVAL   (TODO: define MAX_INTERVAL)
      ], [
        swapType,
        argument
      ]);
    
    const swapObjects: SwapObjects = {
      swapStruct: {
        poolId: this._poolId,
        kind: SwapKind.GIVEN_IN,
        assetIn: tokenInContract.address,
        assetOut: tokenOutContract.address,
        amount: tokenInAmt,
        userData
      },
      fundStruct: {
        sender: sender.address,
        fromInternalBalance: false,
        recipient: recipient.address,
        toInternalBalance: false
      },
      limitOutAmt,
      deadlineSec
    }

    return swapObjects
  }

  private async _getExitRequest( exitType: ExitType,
                                 argument = BigNumber.from(0),
                                 minTokenAmt0 = "0",
                                 minTokenAmt1 = "0",
                                 toInternalBalance = false,
                                 scaleDown = false ): Promise<IVault.ExitPoolRequestStruct>
  {
    const assets = (await this._vaultContract.getPoolTokens(this._poolId)).tokens

    const minToken0LPAmt = ethers.utils.parseUnits(minTokenAmt0, this._token0Decimals);
    const minToken1LPAmt = ethers.utils.parseUnits(minTokenAmt1, this._token1Decimals);
    const minAmountsOut = [minToken0LPAmt, minToken1LPAmt];   // Zero minimum out.

    let argumentValue: string = argument.toHexString()
    switch (exitType) {
      case ExitType.Exit:
        const fractionalDigits = ethers.utils.parseUnits("1")
        const amountLP = argument
        argumentValue = (scaleDown) ? amountLP.div(fractionalDigits).toHexString() :
                                      amountLP.toHexString();
        break;

      case ExitType.Withdraw:
        // Nothing to do: argumentValue set from argument method parameter, which should be order id.
        break;

      case ExitType.Cancel:
        // Nothing to do: argumentValue set from argument method parameter, which should be order id.
        break;

      case ExitType.FeeWithdraw:
        // Nothing to do: argumentValue set from argument method parameter, which should be "0", ignored
        break;
      
      default:
        throw new Error(`Unsupported ExitType: ${exitType}`)
        break;
    }

    // For converting Enum ExitType to contract ABI, have to encode as minimum sized uint.
    // See this for futher details:  https://docs.soliditylang.org/en/v0.7.6/types.html#enums
    //
    const userData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", // exit type:
                    //    0 -> regular exit / burn
                    //    1 -> long-term swap withdraw
                    //    2 -> long-term swap cancel
                    //    3 -> CronFi fee collect
         "uint256"  // argument (depends on exit type value)
                    //    exit type = 0   -> number of LP tokens
                    //    exit type = 1-2 -> order id:    0 <= value <= MAX_ORDER_ID
                    //    exit type = 3   -> unused, ignored value.
      ], [
        exitType,
        argumentValue
      ]);

    return {
      assets,
      minAmountsOut,
      userData,
      toInternalBalance
    }
  }

  private _vaultContract: Vault
  private _poolContract: CronV1Pool 
  private _poolContractName: string
  private _poolId: string
  private _token0AssetContract: TestERC20
  private _token1AssetContract: TestERC20
  private _token0Decimals: number
  private _token1Decimals: number
}
