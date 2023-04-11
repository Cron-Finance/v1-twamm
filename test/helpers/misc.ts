import { BigNumber, Signer } from "ethers";
import { expect } from "chai"
import { network } from "hardhat"

import { Vault } from "typechain/contracts/twault/balancer-core-v2/vault/Vault";
import { Vault__factory } from "typechain/factories/contracts/twault/balancer-core-v2/vault/Vault__factory";

import { VaultTwammPoolAPIHelper } from "./../helpers/vaultTwammPoolAPIHelper"
import { PoolModel } from "../model_v2/vaultTwammPool"
import { ReserveCompareType, ReserveType } from "./types";


// Logging:
const ds = require("../../scripts/utils/debugScopes");
const log = ds.getLog("helpers-misc");


export function scaleUp(value: BigInt | BigNumber, decimals: BigInt | BigNumber | number): BigNumber
{
  let scaledValue = BigNumber.from(value)
  let decimalsBN = BigNumber.from(decimals)
  return scaledValue.mul(BigNumber.from(10).pow(decimalsBN))
}

export const getLastBlockNumber = async ():Promise<number> => 
{
  return Number(await network.provider.send("eth_blockNumber"));
}

function toHexString(decimalNumber: number): string
{
  return `0x${decimalNumber.toString(16)}`
}

export const getBlockTimestamp = async(blockNumber: number, verbose=false):Promise<number> => 
{
  const blockObj = await network.provider.send("eth_getBlockByNumber", [toHexString(blockNumber), false]);
  const timestamp = Number(blockObj.timestamp)
  if (verbose) {
    log.info(`Block=${blockNumber}, timestamp=${timestamp}`)
  }

  return timestamp;
}

export const mineBlocks = async (blocksToMine?: number, verbose=false):Promise<number> =>
{
  const start = Number(await network.provider.send("eth_blockNumber"));
  const startTimestamp = await getBlockTimestamp(start, verbose);
  
  blocksToMine = (!blocksToMine) ? 1 : blocksToMine

  const BLOCK_TIME = 12   // 12s block times

  const nextTimeStamp = startTimestamp + BLOCK_TIME
  await network.provider.send("evm_setNextBlockTimestamp", [toHexString(nextTimeStamp)])

  // Fast way of doing this in hardhat w/ 12s block times:
  await network.provider.send("hardhat_mine", [toHexString(blocksToMine), toHexString(BLOCK_TIME)]);
  //
  // instead of slow way:
  //
  //  for (let idx = 0; idx < blocksToMine; idx++) {
  //    await network.provider.send("evm_mine");
  //  }

  const end = Number(await network.provider.send("eth_blockNumber"));

  if (verbose) {
    const timestamp = getBlockTimestamp(end, verbose);
    log.info(`Mined ${blocksToMine} blocks (start=${start}, end=${end}, diff=${end-start})`)
  }

  return end
}

export const deployBalancerVault = async (signer: Signer, wethAddress: string): Promise<Vault> =>
{
  const signerAddress = await signer.getAddress();
  const vaultDeployer = new Vault__factory(signer);
  const vaultContract = await vaultDeployer.deploy(
    signerAddress,
    wethAddress,
    0,
    0
  );
  
  // Next line needed when not automining.  (Not automining to align blocks to get
  // consistent benchmark results for TWAMM testing.)
  await mineBlocks();
  
  await vaultContract.deployed();
  return vaultContract;
}

export const getBalanceData = async (poolHelper: VaultTwammPoolAPIHelper,
                                     poolModel: PoolModel): Promise<any> =>
{
  let balanceData: any = {}
  for (const balanceType of ['vault', 'orders', 'proceeds', 'balFees', 'cronFees', 'reserves']) {
    balanceData[balanceType] = { 
      contract: await poolHelper.getPoolBalance(balanceType),
      model: poolModel.getPoolBalance(balanceType)
    }
  }

  return balanceData
}

export const getBalanceDataComparisonStr = (balanceData: any): string =>
{
  let comparisonStr = ''
  for (const balanceType of Object.keys(balanceData)) {
    const balances = balanceData[balanceType]
    const { contract, model } = balances
    comparisonStr += `\t${balanceType}:\n`
    for (const token of ['token0', 'token1']) {
      comparisonStr += `\t\t${token} difference=${contract[token].sub(model[token])}\n` +
                       `\t\t         ${contract[token]} (contract)\n` +
                       `\t\t         ${model[token]} (model)\n`
    }
  }
  return comparisonStr
}

export const testBalanceData = (balanceData: any, tolerance?: BigNumber | number): void =>
{
  let _tolerance: BigNumber = (tolerance === undefined) ? BigNumber.from(0) :
                              (typeof tolerance === 'number') ? BigNumber.from(tolerance) :
                              tolerance

  const failures: string[] = []

  for (const balanceType of Object.keys(balanceData)) {
    const balances = balanceData[balanceType]
    const { contract, model } = balances
    for (const token of ['token0', 'token1']) {
      const difference = contract[token].sub(model[token])
      if (difference.abs().gt(_tolerance)) {
        failures.push(`${balanceType} (${token} difference=${difference})`)
      }
    }
  }

  let message = ''
  if (failures.length > 0) {
    message += `\n` +
               `The following balances exceeded specified tolerance of ${_tolerance}:\n` +
               `\t${failures.join('\t\n')}\n\n` +
               `All balances compared:\n` +
               `${getBalanceDataComparisonStr(balanceData)}`
  }

  expect(failures.length===0, message).to.be.equal(true)
}

export const getReserveData = async (poolHelper: VaultTwammPoolAPIHelper,
                                     poolModel: PoolModel,
                                     tolerance?: number,
                                     vaultTolerance?: ReserveType,
                                     stateTolerance?: ReserveType,
                                     viewTolerance?: ReserveType): Promise<ReserveCompareType[]> =>
{
  // Actual values:
  const vaultAct = await poolHelper.getVaultPoolReserves()
  const viewAct = await poolHelper.getPoolReserves()

  // Expected values from model:
  const vaultExp = poolModel.getVaultReserves()
  const viewExp = poolModel.getTwammReserves()

  const toleranceBN = (tolerance === undefined) ? BigNumber.from(0) : BigNumber.from(tolerance)
  vaultTolerance = (vaultTolerance) ? vaultTolerance : { reserve0: toleranceBN, reserve1: toleranceBN }
  viewTolerance = (viewTolerance) ? viewTolerance : { reserve0: toleranceBN, reserve1: toleranceBN }
  
  
  const result: ReserveCompareType[] = [ { pairs: { vaultAct, vaultExp }, differences: vaultTolerance } ]

  result.push({ pairs: { viewAct, viewExp },   differences: viewTolerance })
  return result
}

export const getReserveDataDifferenceStr = (reserveData: ReserveCompareType[],
                                            warnOnAcceptableDifference=false): string => 
{
  const reservePairKeys = ['reserve0', 'reserve1']
  const actualIdx = 0
  const expectedIdx = 1

  let differenceStr = ''
  for (const reserveDataObj of reserveData) {
    const reservePairNames = Object.keys(reserveDataObj.pairs)
    const reservePairObjs: any = Object.values(reserveDataObj.pairs)
    let resKeyCount = 0
    for (const reserveKey of reservePairKeys) {
      resKeyCount++
      const actualObj = reservePairObjs[actualIdx][reserveKey]
      const expectedObj = reservePairObjs[expectedIdx][reserveKey]
      const difference = actualObj.sub(expectedObj)
      // TODO: something better than the next line to workaround the typescript
      //       issue with indexing defined objects
      const expectedDifference = (reserveKey === 'reserve0') ?
        reserveDataObj.differences.reserve0 :
        reserveDataObj.differences.reserve1

      if (!difference.eq(expectedDifference)) {
        const actualResPairName = reservePairNames[actualIdx]
        let resType = (actualResPairName.startsWith('vpr')) ? 'B-Vault:  ' :
          (actualResPairName.startsWith('psr')) ?             'T-State:  ' :
          (actualResPairName.startsWith('pr')) ?              'T-View:   ' : ''

        const actualName = reservePairNames[actualIdx] + '.' + reserveKey
        const expectedName = reservePairNames[expectedIdx] + '.' + reserveKey
        differenceStr += (resKeyCount === 1) ? `${resType}\n` : ''
        differenceStr +=
          `\t${actualName} - ${expectedName} = ${difference}, Expect ${expectedDifference}\n` +
          `\t\t${actualName} = ${actualObj}\n` +
          `\t\t${expectedName} = ${expectedObj}\n`
      }
    }
  }
  if (differenceStr !== '') {
    differenceStr = '\nFound Reserve Differences (Actual - Expected = Difference)\n' +
                    '--------------------------------------------------------------------------------\n' + 
                    differenceStr + '\n'
    if (warnOnAcceptableDifference) {
      log.warn(differenceStr)
    }
  }

  return differenceStr
}

/**
 * Compares different reserve actual values against expected, identifying 
 * differences and testing to ensure that the difference is met as a +/- tolerance
 * between values.
 * 
 * Useful for quickly identifying tolerances between multiple values in a specific
 * test (one iteration to discover and set the values).
 * 
 * @param reserveData An array of reserve compare types, for example:
 * 
 *     let reserveData: any = [
 *       { pairs: { vpr, evpr }, differences: { reserve0: 5, reserve1: 4 } },
 *       { pairs: { psr, epsr }, differences: { reserve0: 2, reserve1: 2 } },
 *       { pairs: { pr, epr },   differences: { reserve0: 2, reserve1: 2 } } ]
 *
 * TODO: This won't fail if there is a change--just if the change exceeds the largest
 *       difference.
 *       - add ability to fail on a difference.
 */
export const compareReserveData = (reserveData: ReserveCompareType[], warnOnAcceptableDifference=false): void =>
{
  const reservePairKeys = ['reserve0', 'reserve1']
  const actualIdx = 0
  const expectedIdx = 1

  // Two-pass comparison.
  //
  // 1. Compute the actual differences and report if they are not
  //    as expected.
  let differenceStr = getReserveDataDifferenceStr(reserveData, warnOnAcceptableDifference)
  
  // 2. Perform expect closeTo comparisons using the expected 
  //    differences to fail the test if changes detected.
  for (const reserveDataObj of reserveData) {
    const reservePairNames = Object.keys(reserveDataObj.pairs)
    const reservePairObjs: any = Object.values(reserveDataObj.pairs)
    for (const reserveKey of reservePairKeys) {
      const actualObj = reservePairObjs[actualIdx][reserveKey]
      const expectedObj = reservePairObjs[expectedIdx][reserveKey]
      const actualName = reservePairNames[actualIdx] + '.' + reserveKey
      const expectedName = reservePairKeys[expectedIdx] + '.' + reserveKey

      const tolerance = (reserveKey === 'reserve0') ?
        reserveDataObj.differences.reserve0.abs() :
        reserveDataObj.differences.reserve1.abs()
      
      // Note: had to put optional message in expect instead of closeTo to get it to print.
      const message = '\n' +
                      `Actual reserve, ${actualName}, doesn't match expected, ${expectedName}\n`
                      + differenceStr +
                      'AssertionError'
      expect(actualObj, message)
      .to.be.closeTo(
        expectedObj,
        tolerance)
    }
  }
}

export const checkFees = async (poolContract: any,
                                poolModel: PoolModel,
                                tolerance=0,
                                warnOnAcceptableDifference=true,
                                logDifference=false): Promise<void> =>
{
  const actualBalancerFees = await poolContract.getBalancerFeeAmounts();
  const balFeeT0: BigNumber = actualBalancerFees.balFee0U96;
  const balFeeT1: BigNumber = actualBalancerFees.balFee1U96;

  const balancerFees = poolModel.getBalancerFees()
  const balFeeDiffT0 = balFeeT0.sub(balancerFees.token0)
  const balFeeDiffT1 = balFeeT1.sub(balancerFees.token1)

  const toleranceBN = BigNumber.from(tolerance)

  let differenceStr = ''
  if (balFeeDiffT0.abs().gt(toleranceBN) || logDifference) {
    differenceStr += `Balancer Fees Token 0 Difference = ${balFeeDiffT0}\n` +
                     `\tactual = ${balFeeT0}\n` +
                     `\tmodel  = ${balancerFees.token0}\n`
  }
  if (balFeeDiffT1.abs().gt(toleranceBN) || logDifference) {
    differenceStr += `Balancer Fees Token 1 Difference = ${balFeeDiffT1}\n` +
                     `\tactual = ${balFeeT1}\n` +
                     `\tmodel  = ${balancerFees.token1}\n`
  }
  if (differenceStr !== '') {
    differenceStr = '\nFound Balancer Fee Differences (Actual - Expected = Difference)\n' +
                    '--------------------------------------------------------------------------------\n' + 
                    differenceStr + '\n'
    if (warnOnAcceptableDifference) {
      log.warn(differenceStr)
    }
  }

  const checks = [ { name: 'Balancer Fees T0', actual: balFeeT0, expected: balancerFees.token0 },
                   { name: 'Balancer Fees T1', actual: balFeeT1, expected: balancerFees.token1 } ]
  for (const check of checks) {
    const message = '\n' +
                    `${check.name} actual doesn't match expected.\n`
                    + differenceStr +
                    'AssertionError'
    expect(check.actual, message).to.be.closeTo(check.expected, toleranceBN)
  }
}
