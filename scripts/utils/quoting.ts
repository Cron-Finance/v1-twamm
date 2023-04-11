// Using the PRB math Javascript SDK.
// See "JavaScript SDK" here: https://github.com/paulrberg/prb-math
//

// import type { BigNumber } from "@ethersproject/bignumber";
import { BigNumber } from "@ethersproject/bignumber";
import { fromBn, toBn } from "evm-bn";
import { sqrt, inv, exp } from "prb-math";

import { TRANSACTION_TYPES } from "./constants";

type uint256 = BigNumber;
type int256 = BigNumber; // TODO: need to think carefully about this and how the
//       signed arithmetic is modelled.  Does it match
//       the PRB lib accurately here?  Might need to take
//       a closer look at the PRB test cases.
//
type LongTermOrderType = {
  tokenA: string;
  tokenB: string;
  lastVirtualOrderBlock: uint256;
  orderBlockInterval: uint256;
  OrderPoolMap: OrderPoolMapType;
};

type ReservePairType = { reserveA: uint256; reserveB: uint256 };
type ReserveMapType = { [index: string]: uint256 };

// A callback function is used in the order pool type b/c you can't return an
// entire map from a contract, this allows the algorithm to get the
// final sales rate for a given block
type SalesRateEndingFn = (block: uint256) => Promise<uint256>;
type OrderPoolType = {
  currentSalesRate: uint256;
  // Not needed:
  // rewardFactor: uint256,
  salesRateEndingPerBlockFn: SalesRateEndingFn;
  // Not needed: (getting set only)
  // rewardFactorAtBlock: {[index: string]: uint256}
};
type OrderPoolMapType = { [index: string]: OrderPoolType };

type VirtualBalanceType = {
  tokenAOut: uint256;
  tokenBOut: uint256;
  ammEndTokenA: uint256;
  ammEndTokenB: uint256;
};

const ZERO: uint256 = BigNumber.from(0);

export const calcReserves = async (
  longTermOrders: LongTermOrderType,
  reserveMap: ReserveMapType,
  blockNumber: uint256,
  transactions?: any // For calculating gas if defined.  TODO: define type
): Promise<ReservePairType> => {
  await executeVirtualOrders(
    longTermOrders,
    reserveMap,
    blockNumber,
    transactions
  );

  return {
    reserveA: reserveMap[longTermOrders.tokenA],
    reserveB: reserveMap[longTermOrders.tokenB],
  };
};

//
// LongTermOrders.sol:
////////////////////////////////////////////////////////////////////////////////

const executeVirtualOrders = async (
  longTermOrders: LongTermOrderType /* get or resolve to discrete components */,
  reserveMap: ReserveMapType /* get or resolve to discrete components */,
  blockNumber: uint256 /* get from block chain node */,
  transactions?: any /* for calculating gas */
): Promise<void> => {
  // Perform a local execution of longTermOrders.executeVirtualOrders:
  //
  let nextExpiryBlock: uint256 = longTermOrders.lastVirtualOrderBlock
    .sub(
      longTermOrders.lastVirtualOrderBlock.mod(
        longTermOrders.orderBlockInterval
      )
    )
    .add(longTermOrders.orderBlockInterval);

  // Iterate through blocks eligible for order expiries, moving state forward
  while (nextExpiryBlock.lt(blockNumber)) {
    await executeVirtualTradesAndOrderExpiries(
      longTermOrders,
      reserveMap,
      nextExpiryBlock,
      transactions
    );
    nextExpiryBlock = nextExpiryBlock.add(longTermOrders.orderBlockInterval);
  }

  // Finally, move state to current block if necessary
  //
  // TODO: Now that we expose the block number to users in the contract, we need to
  //       understand what specifying bad values might do here (i.e. 0, way less than
  //       current block, way more than current block).
  //
  // Next line was '!=', changed to handle bad blockNumber inputs (ie. in the past--prevent time travel).
  if (longTermOrders.lastVirtualOrderBlock.lt(blockNumber)) {
    await executeVirtualTradesAndOrderExpiries(
      longTermOrders,
      reserveMap,
      blockNumber,
      transactions
    );
  }
};

///@notice executes all virtual orders between current lastVirtualOrderBlock and blockNumber
//also handles orders that expire at end of final block. This assumes that no orders expire inside the given interval
const executeVirtualTradesAndOrderExpiries = async (
  longTermOrders: LongTermOrderType,
  reserveMap: ReserveMapType,
  blockNumber: uint256,
  transactions?: any // For calculating gas if provided
): Promise<void> => {
  // Amount sold from virtual trades:
  let blockNumberIncrement: uint256 = blockNumber.sub(
    longTermOrders.lastVirtualOrderBlock
  );
  let tokenASellAmount: uint256 =
    longTermOrders.OrderPoolMap[longTermOrders.tokenA].currentSalesRate.mul(
      blockNumberIncrement
    );
  let tokenBSellAmount: uint256 =
    longTermOrders.OrderPoolMap[longTermOrders.tokenB].currentSalesRate.mul(
      blockNumberIncrement
    );

  //initial amm balance
  let tokenAStart: uint256 = reserveMap[longTermOrders.tokenA];
  let tokenBStart: uint256 = reserveMap[longTermOrders.tokenB];

  //updated balances from sales
  let { tokenAOut, tokenBOut, ammEndTokenA, ammEndTokenB } =
    computeVirtualBalances(
      tokenAStart,
      tokenBStart,
      tokenASellAmount,
      tokenBSellAmount
    );

  //update balances reserves
  reserveMap[longTermOrders.tokenA] = ammEndTokenA;
  reserveMap[longTermOrders.tokenB] = ammEndTokenB;

  //distribute proceeds to pools
  let orderPoolA: OrderPoolType =
    longTermOrders.OrderPoolMap[longTermOrders.tokenA];
  let orderPoolB: OrderPoolType =
    longTermOrders.OrderPoolMap[longTermOrders.tokenB];

  // Following not needed for operations (setting an unread/unused value 'rewardFactor'):
  // distributePayment(orderPoolA, tokenBOut);
  // distributePayment(orderPoolB, tokenAOut);

  //handle orders expiring at end of interval
  let updateTxn = await updateStateFromBlockExpiry(orderPoolA, blockNumber);
  transactions?.push({
    txn: updateTxn,
    uxType: TRANSACTION_TYPES.CALCULATE_RES,
    description: `calculating reserves read block expiry`,
  });
  updateTxn = await updateStateFromBlockExpiry(orderPoolB, blockNumber);
  transactions?.push({
    txn: updateTxn,
    uxTypetype: TRANSACTION_TYPES.CALCULATE_RES,
    description: `calculating reserves read block expiry`,
  });

  //update last virtual trade block
  longTermOrders.lastVirtualOrderBlock = blockNumber;
};

///@notice computes the result of virtual trades by the token pools
const computeVirtualBalances = (
  tokenAStart: uint256,
  tokenBStart: uint256,
  tokenAIn: uint256,
  tokenBIn: uint256
): VirtualBalanceType => {
  // If no tokens are sold to the pool, we don't need to execute any orders:
  if (tokenAIn.eq(ZERO) && tokenBIn.eq(ZERO)) {
    return {
      tokenAOut: ZERO,
      tokenBOut: ZERO,
      ammEndTokenA: tokenAStart,
      ammEndTokenB: tokenBStart,
    };
  }

  // In the case where only one pool is selling, we just perform a normal swap:
  if (tokenAIn.eq(ZERO)) {
    // Constant product formula:
    const tokenAOut = tokenAStart.mul(tokenBIn).div(tokenBStart.add(tokenBIn));
    return {
      tokenAOut,
      tokenBOut: ZERO,
      ammEndTokenA: tokenAStart.sub(tokenAOut),
      ammEndTokenB: tokenBStart.add(tokenBIn),
    };
  }
  if (tokenBIn.eq(ZERO)) {
    // Contant product formula
    const tokenBOut = tokenBStart.mul(tokenAIn).div(tokenAStart.add(tokenAIn));
    return {
      tokenAOut: ZERO,
      tokenBOut,
      ammEndTokenA: tokenAStart.add(tokenAIn),
      ammEndTokenB: tokenBStart.sub(tokenBOut),
    };
  }

  // When both pools sell, we use the TWAMM formula:
  // signed, fixed point arithmetic   <-- TODO:
  //    - previously there was a cast going on
  //      for these values, e.g.:  int256(var).fromInt()
  const aIn: int256 = tokenAIn;
  const bIn: int256 = tokenBIn;
  const aStart: int256 = tokenAStart;
  const bStart: int256 = tokenBStart;
  const k: int256 = aStart.mul(bStart);

  const c: int256 = computeC(aStart, bStart, aIn, bIn);
  const endA: int256 = computeAmmEndTokenA(aIn, bIn, c, k, aStart, bStart);
  const endB: int256 = aStart.div(endA).mul(bStart);

  const outA: int256 = aStart.add(aIn).sub(endA);
  const outB: int256 = bStart.add(bIn).sub(endB);

  // TODO: previously this was casting to unsigned int
  //       e.g.:  uint256(var.toInt())
  return {
    tokenAOut: outA,
    tokenBOut: outB,
    ammEndTokenA: endA,
    ammEndTokenB: endB,
  };
};

//helper function for TWAMM formula computation, helps avoid stack depth errors
const computeC = (
  tokenAStart: int256,
  tokenBStart: int256,
  tokenAIn: int256,
  tokenBIn: int256
): int256 => {
  const c1: int256 = sqrt(tokenAStart).mul(sqrt(tokenBIn));
  const c2: int256 = sqrt(tokenBStart).mul(sqrt(tokenAIn));
  const cNumerator: int256 = c1.sub(c2);
  const cDenominator: int256 = c1.add(c2);
  const c: int256 = cNumerator.div(cDenominator);

  return c;
};

// Helper function for TWAMM formula computation, helps avoid stack depth errors
const computeAmmEndTokenA = (
  tokenAIn: int256,
  tokenBIn: int256,
  c: int256,
  k: int256,
  aStart: int256,
  bStart: int256
): int256 => {
  // Rearranged for numerical stability
  // Was: int256 eNumerator = PRBMathSD59x18.fromInt(4).mul(tokenAIn).mul(tokenBIn).sqrt();
  const eNumerator: int256 = sqrt(toBn("4").mul(tokenAIn).mul(tokenBIn));
  const eDenominator: int256 = inv(sqrt(aStart).mul(sqrt(bStart)));
  const exponent: int256 = exp(eNumerator.mul(eDenominator));
  const fraction: int256 = exponent.add(c).div(exponent.sub(c));
  // Was: int256 scaling = k.div(tokenBIn).sqrt().mul(tokenAIn.sqrt());
  const scaling: int256 = sqrt(k.div(tokenBIn)).mul(sqrt(tokenAIn));
  const ammEndTokenA: int256 = fraction.mul(scaling);

  return ammEndTokenA;
};

//
// OrderPool.sol:
////////////////////////////////////////////////////////////////////////////////

///@notice distribute payment amount to pool (in the case of TWAMM, proceeds from trades against amm)
const distributePayment = (orderPool: OrderPoolType, amount: uint256): void => {
  if (!orderPool.currentSalesRate.eq(ZERO)) {
    // floating point arithmetic  <-- TODO: understand
    // Not needed for operation:
    // orderPool.rewardFactor = orderPool.rewardFactor.add(amount.div(orderPool.currentSalesRate))
  }
};

///@notice when orders expire after a given block, we need to update the state of the pool
const updateStateFromBlockExpiry = async (
  orderPool: OrderPoolType,
  blockNumber: uint256
): Promise<any> => {
  const ordersExpiring: uint256 = await orderPool.salesRateEndingPerBlockFn(
    blockNumber
  );
  orderPool.currentSalesRate = orderPool.currentSalesRate.sub(ordersExpiring);
  // Not needed for operation:
  // orderPool.rewardFactorAtBlock[`${blockNumber}`] = orderPool.rewardFactor;

  return ordersExpiring;
};
