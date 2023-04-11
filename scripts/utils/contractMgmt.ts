const ds = require("./debugScopes");
const log = ds.getLog("runBenchmark");

type StringMap = {[index: string]: string}

const CONTRACTS: StringMap = {
  balTwammProd: 'CronV1Pool',
  balTwammTest: 'CronV1PoolExposed'
}

// Available in TWAULT_V003 or greater (manually done w/ numbers in earlier versions of TWAULT)
export enum PoolType {
  Stable = 0,
  Liquid = 1,
  Volatile = 2
}

export enum JoinType {
  Join = 0,
  Reward = 1 
}

export enum SwapType {
  RegularSwap = 0,
  LongTermSwap = 1,
  PartnerSwap = 2,
  KeeperDao = 3
}

export enum ExitType {
  Exit = 0,
  Withdraw = 1,
  Cancel = 2,
  FeeWithdraw = 3
}

export enum ParamType {
  // Slot 1:
  SwapFeeBP = 0,
  PartnerFeeBP = 1,
  LongSwapFeeBP = 2,
  // Slot 3:
  HoldingPenaltyBP = 3,
  HoldingPeriodSec = 4
}

export const getContractName = (aContract: string): string =>
{
  for (const key in CONTRACTS) {
    if (aContract === CONTRACTS[key]) {
      return key
    }
  }

  return ''
}

// TODO: Ideal tie to values in the contract.
export const getBlockInterval = (poolType: PoolType): number =>
{
  switch (poolType) {
    case PoolType.Stable:
      return 75
      break;
    case PoolType.Liquid:
      return 300
      break;
    case PoolType.Volatile:
      return 1200
      break;
  
    default:
      throw new Error(`Invalid pool type ${poolType}`)
      break;
  }
}

export const getTwammContract = (aContract?: string): string =>
{
  if (process.env.TWAMM_CONTRACT) {
    const envContract = process.env.TWAMM_CONTRACT
    if (CONTRACTS.hasOwnProperty(envContract)) {
      log.info(
        `Using TWAMM Contract ${envContract} (${CONTRACTS[envContract]}).\n` +
        `(Specified via environment variable "TWAMM_CONTRACT" to getTwammContract.)\n`)
      return CONTRACTS[envContract]
    } else {
      throw `Invalid TWAMM Contract specified: "${envContract}".\n` +
            `Valid contracts = "${Object.keys(CONTRACTS).join("\", \"")}.\n"`
    }
  } else if (aContract) {
    if (CONTRACTS.hasOwnProperty(aContract)) {
      log.info(
        `Using TWAMM Contract ${aContract} (${CONTRACTS[aContract]}).\n` +
        `(Specified via argument to getTwammContract.)\n`)
      return CONTRACTS[aContract]
    } else {
      throw `Invalid TWAMM Contract specified: "${aContract}".\n` +
            `Valid contracts = "${Object.keys(CONTRACTS).join("\", \"")}.\n"`
    }
  } else {
    throw `Invalid TWAMM Contract specified: "${aContract}".\n` +
          `Valid contracts = "${Object.keys(CONTRACTS).join("\", \"")}.\n"`
  }
}

export const getDefaultProdTwammContract = (): string =>
{
  return getTwammContract('balTwammProd')
}

export const getDefaultTestTwammContract = (): string =>
{
  return getTwammContract('balTwammTest')
}


export const getFunctionName = (aContractName: string, aStdFunctionName: string): string => {
  let fnName = aStdFunctionName
  switch (aStdFunctionName) {
    case "executeAllVirtualOrders":
      {
        switch (aContractName) {
          case CONTRACTS["balTwammProd"]:
          case CONTRACTS["balTwammTest"]:
            fnName = "executeVirtualOrdersToBlock"
            break;
        
          default:
            fnName = "executeVirtualOrders"
            break;
        }
      }
      break;
  
    default:
      break;
  }
  log.info(`getFunctionName(aContractName=${aContractName}, aStdFunctionName=${aStdFunctionName}) returning ${fnName}`)
  return fnName
}
