import { BigNumber } from "ethers";
import { TokenPairAmtType, ReserveType } from "../helpers/types";

export type LTSwapParams = {
  swapLengthBlocks: number,
  swapStartBlock: number,
  swapExpiryBlock: number,
  sellingRate: BigNumber
}

export type STFeeType = {
  tokenInLessFees: BigNumber,
  balancerFee: BigNumber,
  lpFee: BigNumber
}

export type ModelStateType = {
  vault: ReserveType,
  twammState: ReserveType,
  twammView: ReserveType,
  balFee: TokenPairAmtType,
  cronFiFee: TokenPairAmtType
}