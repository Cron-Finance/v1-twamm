import { BigNumber } from "@ethersproject/bignumber";
import { fromBn, toBn } from "evm-bn";
import { sqrt, inv, exp } from "prb-math";

/********************************************************************************
 * Misc
 ********************************************************************************/
export const deepCopy = (anObj: any): any => {
  return JSON.parse(JSON.stringify(anObj));
};

/********************************************************************************
 * String formatting
 ********************************************************************************/

export const padStr = (str: string, desiredWidth = 25): string => {
  const numSpacesNeeded = desiredWidth - str.length;
  for (let idx = 0; idx < numSpacesNeeded; idx++) {
    str += " ";
  }
  return str;
};

export const getSpaces = (numSpaces = 0): string => {
  let spaceStr = "";
  for (let spaceCnt = 0; spaceCnt < numSpaces; spaceCnt++) {
    spaceStr += " ";
  }
  return spaceStr;
};

/********************************************************************************
 * JSON for big ints
 ********************************************************************************/

const replacer = (key: string, value: any): string => {
  const type: string = typeof value;
  switch (type) {
    case "bigint":
      return BigInt(value).toString();

    case "object":
      if (value.type && value.type === "BigNumber") {
        return BigNumber.from(value.hex).toString();
      }

    default:
      break;
  }
  return value;
};

// Extended JSON stringify, handles serialization of BigInt:
//
export const jsonStringifyExt = (
  value: any,
  space: number | undefined = undefined
): string => {
  return JSON.stringify(value, replacer, space);
};

/********************************************************************************
 * Contract Utilities
 ********************************************************************************/

/**
 * getLiquidityAmountsBN:  Gets the number of token A and B required to acquire numLPTokens.
 * 
 * @param numLPTokens     The number of LP Tokens provided.
 * @param reserveTokenA   The number of token A in the pool.
 * @param reserveTokenB   The number of token B in the pool.
 * @param totalSupply     The total supply of LP tokens in the contract.
 * @returns { amtTokenA, amtTokenB }, an object containing the amount of each token required
 *                                    to provide liquidity and receive numLPTokens LP tokens.
 */
export function getLiquidityAmountsBN(numLPTokens: BigNumber,
                                      reserveTokenA: BigNumber,
                                      reserveTokenB: BigNumber,
                                      totalSupply: BigNumber):
                {amtTokenA: BigNumber, amtTokenB: BigNumber}
{
  const amtTokenA: BigNumber = numLPTokens.mul(reserveTokenA).div(totalSupply)
  const amtTokenB: BigNumber = numLPTokens.mul(reserveTokenB).div(totalSupply)
  return { amtTokenA, amtTokenB }
}

/**
 * getLiquidityAmountsJS:  Wrapped version suitable for feeding in JS numbers instead of BigNumber types.
 * 
 * @param numLPTokens 
 * @param reserveTokenA 
 * @param reserveTokenB 
 * @param totalSupply 
 * @returns 
 */
export function getLiquidityAmountsJS (numLPTokens: number,
                                      reserveTokenA: number,
                                      reserveTokenB: number,
                                      totalSupply: number,
                                      numDecimals = 18):
                {amtTokenA: number, amtTokenB: number}
{
  const _numLPTokens = toBn(numLPTokens.toString(), numDecimals)
  const _reserveTokenA = toBn(reserveTokenA.toString(), numDecimals)
  const _reserveTokenB = toBn(reserveTokenB.toString(), numDecimals)
  const _totalSupply = toBn(totalSupply.toString(), numDecimals)

  const bnResult = getLiquidityAmountsBN(_numLPTokens, _reserveTokenA, _reserveTokenB, _totalSupply)

  const amtTokenA = Number(fromBn(bnResult.amtTokenA, numDecimals))
  const amtTokenB = Number(fromBn(bnResult.amtTokenB, numDecimals))
  return { amtTokenA, amtTokenB }
}