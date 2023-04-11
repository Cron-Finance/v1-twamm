// (c) Copyright 2022, Bad Pumpkin Inc. All Rights Reserved
//
import { BigNumber } from "ethers";
import { ModelStateType } from "./types"

const ZERO = BigNumber.from(0)

export namespace ModelState {
  export const getZeroObj = (): ModelStateType => {
    return {
      vault: {
        reserve0: ZERO,
        reserve1: ZERO
      },
      orders: {
        token0: ZERO,
        token1: ZERO
      },
      proceeds: {
        token0: ZERO,
        token1: ZERO
      },
      balFee: {
        token0: ZERO,
        token1: ZERO
      },
      cronFiFee: {
        token0: ZERO,
        token1: ZERO
      }
    }
  }

  export const copyObj = (obj: ModelStateType): ModelStateType => {
    const objAsAny: any = obj;
    const copy: any = getZeroObj();

    for (const outerKey of Object.keys(obj)) {
      const innerObj = objAsAny[outerKey]
      for (const innerKey of Object.keys(innerObj)) {
        copy[outerKey][innerKey] = innerObj[innerKey];
      }
    }

    return copy
 }
}
