import { BigNumber } from "ethers";
import bn from 'bignumber.js'       // for sqrt

export namespace BalMath {
  export const divDown = (numerator: BigNumber,
                          denominator: BigNumber): BigNumber =>
  {
    return numerator.eq(BigNumber.from(0)) ?
      numerator :
      numerator.div(denominator)
  }

  export const divUp = (numerator: BigNumber,
                        denominator: BigNumber): BigNumber =>
  {
    const one = BigNumber.from(1)
    return numerator.eq(BigNumber.from(0)) ?
      numerator :
      one.add((numerator.sub(one)).div(denominator))
  }
}

export const sqrt = (value: BigNumber): BigNumber =>
{
  return BigNumber.from(new bn(value.toString()).sqrt().toFixed().split('.')[0])
}
