import { BigNumber } from "ethers";
import { IVault } from "typechain/contracts/twault/balancer-core-v2/vault/interfaces/IVault";

export type TokenPairAmtType = {
  token0: BigNumber,
  token1: BigNumber
}

export type ReserveType = {
  reserve0: BigNumber,
  reserve1: BigNumber
}

export type ReserveCompareType = {
  pairs: { [index: string]: ReserveType }
  differences: ReserveType
}

export type JoinObjects = {
  joinStruct: IVault.JoinPoolRequestStruct,
  token0Amt: BigNumber,
  token1Amt: BigNumber
}

export type SwapObjects = {
  swapStruct: IVault.SingleSwapStruct,
  fundStruct: IVault.FundManagementStruct,
  limitOutAmt: number,
  deadlineSec: number
}

export type OracleState = {
  p0: BigNumber,
  p1: BigNumber,
  timeStampSec: BigNumber
}
