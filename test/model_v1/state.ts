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
      twammState: {
        reserve0: ZERO,
        reserve1: ZERO
      },
      twammView: {
        reserve0: ZERO,
        reserve1: ZERO
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
    return {
      vault: {
        reserve0: obj.vault.reserve0,
        reserve1: obj.vault.reserve1
      },
      twammState: {
        reserve0: obj.twammState.reserve0,
        reserve1: obj.twammState.reserve1
      },
      twammView: {
        reserve0: obj.twammView.reserve0,
        reserve1: obj.twammView.reserve1
      },
      balFee: {
        token0: obj.balFee.token0,
        token1: obj.balFee.token1
      },
      cronFiFee: {
        token0: obj.cronFiFee.token0,
        token1: obj.cronFiFee.token1
      }
    }
  }
}