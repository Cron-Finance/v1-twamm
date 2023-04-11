// (c) Copyright 2022, Bad Pumpkin Inc. All Rights Reserved
//
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

export type LTFeeType = {
  tokenInLessFees: BigNumber,
  balancerFee: BigNumber,
  cronFiFee: BigNumber,
  lpFee: BigNumber
}

export type ModelStateType = {
  vault: ReserveType,
  orders: TokenPairAmtType,
  proceeds: TokenPairAmtType,
  balFee: TokenPairAmtType,
  cronFiFee: TokenPairAmtType
}