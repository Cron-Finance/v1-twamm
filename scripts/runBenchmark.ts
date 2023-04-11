/**
 *  Script that processes benchmark files to deliver:
 *   - gas used (min, max, avg)
 *    - output values [not yet supported]
 * 
 *  Works by:
 *    0. Configuring a pool
 *    1. Reading a benchmark file.
 *    2. Issuing calls to the pool for each block
 *    3. Mining blocks
 *    4. Capturing the receipts of the calls to the pool and creating statistics.
 *
 *  History:
 *    Created as a dive-catch to fix random behavior in benchmark gas measurement code.
 *    Unfortunately no time to build an extensible solution. 
 */
require("dotenv").config();
import { BigNumber } from "@ethersproject/bignumber";   // TODO: difference between this and import from ethers?
import { writeFileSync } from "fs";

import { EthPoolMainnetInterface, loadEthPoolMainnetFixture } from "test/helpers/deployer";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { Vault } from "typechain/contracts/twault/balancer-core-v2/vault/Vault";
import { TestERC20 } from "typechain/contracts/twault/helpers/TestERC20";
import { TestERC20__factory } from "typechain/factories/contracts/twault/helpers/TestERC20__factory";
 
import { CronV1PoolFactory } from "typechain/contracts/twault/factories/CronV1PoolFactory";
import { CronV1PoolFactory__factory } from "typechain/factories/contracts/twault/factories/CronV1PoolFactory__factory";

// Bring deployBalancerVault in here to permit manual mining:
//
import { Signer } from "ethers";
import { Vault__factory } from "typechain/factories/contracts/twault/balancer-core-v2/vault/Vault__factory";

import { VaultTwammPoolAPIHelper } from "../test/helpers/VaultTwammPoolAPIHelper";

import { getDefaultProdTwammContract,
         PoolType,
         getBlockInterval,
         getContractName,
         getFunctionName } from "./../scripts/utils/contractMgmt";

import { ethers, network } from "hardhat"

import { getLastBlockNumber, mineBlocks } from "./../test/helpers/misc"      

const ds = require("./utils/debugScopes");
const log = ds.getLog("runBenchmark");


// const BENCHMARK_FILE = require("./../test/Benchmark-2022-04-13T02:38:44.165Z.tv.json");
const BENCHMARK_FILE = require("./../test/Benchmark-2022-04-13T10:23:04.582Z.tv.json");

const TWAMM_CONTRACT = getDefaultProdTwammContract()
const POOL_TYPE = PoolType.Liquid
const BLOCK_INTERVAL =  getBlockInterval(POOL_TYPE);

let tokenA: any, tokenB: any;
let twamm: any;
let owner: SignerWithAddress, 
    addr1: SignerWithAddress,
    admin1: SignerWithAddress,
    addrs: SignerWithAddress[];

type PoolReserveStat = {
  block: number,
  reserveA: BigNumber,
  reserveB: BigNumber
}

class PoolReserveHistory {
  constructor(aContractName: string, aTwammInstance: any) 
  {
    this.contractName = aContractName
    this.twammInstance = aTwammInstance
    this.reserves = []
  }

  collectReserves = async (block: number): Promise<void> => 
  {
    let reserveA: BigNumber
    let reserveB: BigNumber

    const poolInstance: any = this.twammInstance;
    const vrResult = await poolInstance.callStatic.getVirtualReserves(await getLastBlockNumber(), false);
    reserveA = vrResult.token0ReserveU112;
    reserveB = vrResult.token1ReserveU112;
    this.reserves.push({ block, reserveA, reserveB })
  }

  writeToCSV = (date = new Date()): void =>
  {
    if (this.reserves.length) {
      const header = Object.keys(this.reserves[0]).join(", ")
      const data = this.reserves.map((pollResStat: PoolReserveStat) => {
        return Object.values(pollResStat).join(", ")
      })
      const csvData = [header, ...data].join("\n")
      const filename = `bmk-res__${this.contractName}__${date.toISOString()}.csv`
      writeFileSync(filename, csvData)
      log.warn(`Wrote CSV file ${filename}.`)
    } else {
      log.warn(`No CSV file written; no data to write!`)
    }
  }

  private reserves: PoolReserveStat[]
  private contractName: string
  private twammInstance: any
}

type FnGasStat = {
  fn: string,
  calls: number,
  min: number,
  max: number,
  avg: number
}

class TransactionStats {
  constructor(aContractName: string) {
    this.contractName = aContractName
    this.transactions = []
    this.gasUsed = {}
  }

  clear = () => {
    this.transactions = []
  }

  addTransaction = (operation: string, transaction: any) => {
    this.transactions.push({operation, transaction})
  }

  processTransactions = async () => {

    for (const txn of this.transactions) {
      const { operation, transaction } = txn
      const receipt = await transaction.wait()
      const gasUsed: BigNumber = receipt.gasUsed
      if (gasUsed) {
        if (!this.gasUsed.hasOwnProperty(operation)) {
          this.gasUsed[operation] = []
        }
        this.gasUsed[operation].push(gasUsed.toNumber())
      }
    }

    this.clear()
  }

  getGasStats = (): FnGasStat[] => {
    const gasStats: FnGasStat[] = []

    for (const key in this.gasUsed) {
      const gasUsages: any[] = this.gasUsed[key]
      const avg = (gasUsages.reduce(
          (prev, curr) => { return prev + curr }, 0) / gasUsages.length);
      const min = (gasUsages.reduce(
        (prev, curr) => { return (prev === undefined || prev > curr) ? curr : prev}, undefined) ); 
      const max = (gasUsages.reduce(
        (prev, curr) => { return (prev === undefined || prev < curr) ? curr : prev}, undefined) );
      
      gasStats.push({ 
        fn: key, 
        calls: gasUsages.length,
        min: Math.round(min),
        max: Math.round(max),
        avg: Math.round(avg) })
    }

    return gasStats.sort((a: any, b: any) => {
      if (a.fn < b.fn) return -1
      else if (b.fn > a.fn) return 1
      return 0
    } )
  }

  writeToCSV = (date = new Date()): void =>
  {
    const gasStats = this.getGasStats()
    if (gasStats.length) {
      const header = Object.keys(gasStats[0]).join(", ")
      const data = gasStats.map((gasStat: FnGasStat) => {
        return Object.values(gasStat).join(", ")
      })
      const csvData = [header, ...data].join("\n")
      const filename = `bmk-gas__${this.contractName}__${date.toISOString()}.csv`
      writeFileSync(filename, csvData)
      log.warn(`Wrote CSV file ${filename}.`)
    } else {
      log.warn(`No CSV file written; no data to write!`)
    }
  }

  private contractName: string
  private transactions: any[]
  private gasUsed: any
}

const deployBalancerVault = async (signer: Signer, wethAddress: string): Promise<Vault> =>
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

type VaultPoolConfiguration = {
  configuredBlock: number,
  poolHelper: VaultTwammPoolAPIHelper
}

const configureVaultPool = async ():Promise<VaultPoolConfiguration> => 
{
  const INITIAL_LIQUIDITY_0 = ethers.utils.parseUnits(         "5000" );
  const INITIAL_LIQUIDITY_1 = ethers.utils.parseUnits(         "3000" );
  const ERC20BatchApproveAmt = ethers.utils.parseUnits( "10000000000" );

  const TOKEN0_DECIMALS = 18;
  const TOKEN1_DECIMALS = 18;

  log.debug(`Creating balancer vault pool:\n` +
            `********************************************************************************\n`);
  [owner, addr1, admin1, ...addrs] = await ethers.getSigners();

  const ERC20Deployer = new TestERC20__factory(owner);
  const token0AssetContract: TestERC20 = await ERC20Deployer.deploy("Token0", "Token0", TOKEN0_DECIMALS);
  const token1AssetContract: TestERC20 = await ERC20Deployer.deploy("Token1", "Token1", TOKEN1_DECIMALS);

  let fixture: EthPoolMainnetInterface = await loadEthPoolMainnetFixture();
  const wethAddress = fixture.weth.address;
  const balancerVaultContract: Vault = await deployBalancerVault( owner, wethAddress);
  await balancerVaultContract.setRelayerApproval( owner.address,
                                                  owner.address,    // <-- was different addr in custom pool amm project
                                                  true              // approved
                                                );

  let poolContract: any;
  let createCnt = 0
  log.debug('Create Point ', ++createCnt)

  const TWAMMFactoryDeployer = new CronV1PoolFactory__factory(owner);
  const twammFactoryContract = await TWAMMFactoryDeployer.deploy(balancerVaultContract.address);
  await network.provider.send("evm_mine")

  log.debug('Create Point ', ++createCnt)
  
  const poolContractTx = await twammFactoryContract.create(token0AssetContract.address,
                                                           token1AssetContract.address,
                                                           "Token0 - Token1",   // name
                                                           "T0-T1",             // symbol
                                                           POOL_TYPE) 
  await network.provider.send("evm_mine")

  const receipt = await poolContractTx.wait()
  const eventData = receipt.events?.filter((x:any) => {return x.event == "CronV1PoolCreated"})
  const poolAddress = eventData?.[0]?.args?.pool
  
  log.debug('Create Point ', ++createCnt)

  const PoolContractFactory = await ethers.getContractFactory("CronV1Pool");

  poolContract = PoolContractFactory.attach(
   poolAddress // The deployed contract address
  );
  log.debug('Create Point ', ++createCnt)

  // Assign variables used in benchmark testing
  //  TODO: cleanup and migrate upwards if possible
  twamm = poolContract;
  tokenA = token0AssetContract;
  tokenB = token1AssetContract;

  let approvePromises = [
    tokenA.approve(twamm.address, ERC20BatchApproveAmt)
    .catch((e: any) => {log.error(`Token A failed approving TWAMM address. Error:\n${e}`)}),
    tokenB.approve(twamm.address, ERC20BatchApproveAmt)
    .catch((e: any) => {log.error(`Token B failed approving TWAMM address. Error:\n${e}`)}),
    network.provider.send("evm_mine")
    .catch((e: any) => {log.error(`Failed mining Token Approvals. Error:\n${e}`)}),
  ]
  await Promise.all(approvePromises)
  log.debug('Create Point ', ++createCnt)

  const poolHelper = new VaultTwammPoolAPIHelper( balancerVaultContract,
                                          poolContract,
                                          TWAMM_CONTRACT,
                                          token0AssetContract,
                                          token1AssetContract )
  await poolHelper.init()

  // Mint a supply of the tokens (do it here so the mined blocks align with past tests for
  // fair comparisons.):
  //
  await token0AssetContract.connect(owner).mint(owner.address, ERC20BatchApproveAmt);
  await token1AssetContract.connect(owner).mint(owner.address, ERC20BatchApproveAmt);

  const joinObjects = await poolHelper.getJoinObjects( INITIAL_LIQUIDITY_0,
                                                       INITIAL_LIQUIDITY_1 )
  await token0AssetContract.connect(owner).transfer(addr1.address, INITIAL_LIQUIDITY_0);
  await token1AssetContract.connect(owner).transfer(addr1.address, INITIAL_LIQUIDITY_1);
  await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, joinObjects.token0Amt);
  await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, joinObjects.token1Amt);
  await balancerVaultContract.connect(addr1).joinPool(
    poolHelper.getPoolId(),
    addr1.address,
    addr1.address,
    joinObjects.joinStruct
  )

  return {
    configuredBlock: await getLastBlockNumber(),
    poolHelper
  }
}

const processBenchmarkFile = async (startBlockNum: number, poolHelper?: VaultTwammPoolAPIHelper): Promise<void> =>
{
  const contractName = getContractName(TWAMM_CONTRACT)
  const txnStats = new TransactionStats(contractName)
  const poolReserves = new PoolReserveHistory(contractName, twamm)
  await poolReserves.collectReserves(startBlockNum)

  // Workaround to figure out order direction based on orderID (needed to setup correct call
  // to events for vault swap)
  const orderDirectionAToB: any = {}

  for (let blockIdx = 0; blockIdx < BENCHMARK_FILE.length; blockIdx++) {
    const { events, block, description } = BENCHMARK_FILE[blockIdx]

    if (description) {
      log.info(`Test configuration:\n` +
                `==========================================================================================\n` +
                `${description}`
      )
      continue    // skip the remainder--there's no block content in the description.
    }
    
    // If we're at the end of the blocks of events, make the next block to mine to, one
    // block away. Otherwise, make it the next block.
    const nextBlock = (blockIdx < (BENCHMARK_FILE.length - 1)) ?
      BENCHMARK_FILE[blockIdx+1].block : block + 1

    log.info(`BLOCK ${block}\n` +
                `------------------------------------------------------------------------------------------`)

    for (let evtIdx = 0; evtIdx < events.length; evtIdx++) {
      const eventObj = events[evtIdx]
      const { event, amount } = eventObj
      const amountBN = (amount !== undefined) ?
        ethers.BigNumber.from(amount) :
        ethers.BigNumber.from("0") /* 0 b/c unused here */

      log.info(`\t\tEvent: ${event}, amount: ${amount}`)
      
      if (event === "longTermSwapAToB") {
        orderDirectionAToB[eventObj.id] = true
      } else if (event === "longTermSwapBToA") {
        orderDirectionAToB[eventObj.id] = false 
      }

      switch (event) {
        case "executeAllVirtualOrders":
        {
          log.info(`Executing all virtual orders at block ${block}`);
          const fnName = getFunctionName(TWAMM_CONTRACT, event)
          log.info(`Calling twamm[${fnName}] on contract ${TWAMM_CONTRACT}`)
          const currentBlock = await getLastBlockNumber()
          txnStats.addTransaction(event, await twamm[fnName](currentBlock));
        }
        break;

        case "swapAToB":
          log.info(`Swapping from A to B for: ${amountBN} at block: ${block}`);
          txnStats.addTransaction(`${event}-transfer`, await tokenA.transfer(addr1.address, amountBN));
          if (poolHelper) {
            txnStats.addTransaction(`${event}-approve`,
                                    await tokenA.connect(addr1)
                                                .approve(poolHelper.getVaultContract().address, amountBN));
            const swapObjects = await poolHelper.getSwapObjects0To1(amountBN, addr1, addr1);
            txnStats.addTransaction( event,
                                     await poolHelper.getVaultContract().connect(addr1).swap(
                                       swapObjects.swapStruct,
                                       swapObjects.fundStruct,
                                       swapObjects.limitOutAmt,
                                       swapObjects.deadlineSec) );
          } else {
            txnStats.addTransaction(`${event}-approve`, await tokenA.connect(addr1).approve(twamm.address, amountBN));
            txnStats.addTransaction(event, await twamm.swapFromAToB(amountBN));
          }
          break;

        case "swapBToA":
          log.info(`Swapping from B to A for: ${amountBN} at block: ${block}`);
          txnStats.addTransaction(`${event}-transfer`, await tokenB.transfer(addr1.address, amountBN));
          if (poolHelper) {
            txnStats.addTransaction(`${event}-approve`,
                                    await tokenB.connect(addr1)
                                                .approve(poolHelper.getVaultContract().address, amountBN));
            const swapObjects = await poolHelper.getSwapObjects1To0(amountBN, addr1, addr1)
            txnStats.addTransaction( event,
                                     await poolHelper.getVaultContract().connect(addr1).swap(
                                       swapObjects.swapStruct,
                                       swapObjects.fundStruct,
                                       swapObjects.limitOutAmt,
                                       swapObjects.deadlineSec) );
          } else {
            txnStats.addTransaction(`${event}-approve`, await tokenB.connect(addr1).approve(twamm.address, amountBN));
            txnStats.addTransaction(event, await twamm.swapFromBToA(amountBN));
          }
          break;

        case "longTermSwapAToB":
          log.info(`Long term swap A -> B of ${amountBN} in ${eventObj.intervals} ` +
                    `intervals at block: ${block}, id ${eventObj.id}`);
          txnStats.addTransaction(`${event}-transfer`, await tokenA.transfer(addr1.address, amountBN));
          if (poolHelper) {
            txnStats.addTransaction(`${event}-approve`,
                                    await tokenA.connect(addr1)
                                                .approve(poolHelper.getVaultContract().address, amountBN));
            const swapObjects = await poolHelper.getLTSwapObjects0To1(amountBN, eventObj.intervals, addr1, addr1);
            txnStats.addTransaction( event,
                                     await poolHelper.getVaultContract().connect(addr1).swap(
                                       swapObjects.swapStruct,
                                       swapObjects.fundStruct,
                                       swapObjects.limitOutAmt,
                                       swapObjects.deadlineSec) );
          } else {
            txnStats.addTransaction(`${event}-approve`, await tokenA.connect(addr1).approve(twamm.address, amountBN));
            txnStats.addTransaction(event, await twamm.connect(addr1).longTermSwapFromAToB(amountBN, eventObj.intervals));
          }
          break;

        case "longTermSwapBToA":
          log.info(`Long term swap B -> A of ${amountBN} in ${eventObj.intervals} ` +
                    `intervals at block: ${block}, id ${eventObj.id}`);
          txnStats.addTransaction(`${event}-transfer`, await tokenB.transfer(addr1.address, amountBN));
          if (poolHelper) {
            txnStats.addTransaction(`${event}-approve`,
                                    await tokenB.connect(addr1)
                                                .approve(poolHelper.getVaultContract().address, amountBN));
            const swapObjects = await poolHelper.getLTSwapObjects1To0(amountBN, eventObj.intervals, addr1, addr1)
            txnStats.addTransaction( event,
                                     await poolHelper.getVaultContract().connect(addr1).swap(
                                       swapObjects.swapStruct,
                                       swapObjects.fundStruct,
                                       swapObjects.limitOutAmt,
                                       swapObjects.deadlineSec) );
          } else {
            txnStats.addTransaction(`${event}-approve`, await tokenB.connect(addr1).approve(twamm.address, amountBN));
            txnStats.addTransaction(event, await twamm.connect(addr1).longTermSwapFromBToA(amountBN, eventObj.intervals));
          }
        break;

        case "provideLiquidity":
          log.info(`Providing liquidity: ${amountBN} at block ${block}`);
          if (poolHelper) {
            const amounts = await poolHelper.getTokenAmtsFromLP(amountBN)
            const joinObjects = await poolHelper.getJoinObjects( amounts.amount0,
                                                                 amounts.amount1 )
            // log.debug('Provide Liquidity\n' +
            //           `  lp tokens: ` + amountBN + '\n' +
            //           `  amount0: ` + amounts.amount0 + '\n' +
            //           `  amount1: ` + amounts.amount1 + '\n' )
            // Not counting gas for transfer / approve
            await tokenA.connect(owner).transfer(addr1.address, amounts.amount0);
            await tokenB.connect(owner).transfer(addr1.address, amounts.amount1);
            await tokenA.connect(addr1).approve(poolHelper.getVaultContract().address, joinObjects.token0Amt);
            await tokenB.connect(addr1).approve(poolHelper.getVaultContract().address, joinObjects.token1Amt);

            txnStats.addTransaction(event,
                                    await poolHelper.getVaultContract().connect(addr1).joinPool(
                                      poolHelper.getPoolId(),
                                      addr1.address,
                                      addr1.address,
                                      joinObjects.joinStruct
                                    ))
          } else {
            txnStats.addTransaction(event, await twamm.provideLiquidity(amountBN));
          }
          break;

        case "removeLiquidity":
          log.info(`Removing liquidity: ${amountBN} at block ${block}`);
          if (poolHelper) {
            const exitRequest = await poolHelper.getExitRequest( amountBN )
            txnStats.addTransaction(event,
                                    await poolHelper.getVaultContract().connect(addr1).exitPool(
                                      poolHelper.getPoolId(),
                                      addr1.address,
                                      addr1.address,
                                      exitRequest
                                    ))

          } else {
            txnStats.addTransaction(event, await twamm.removeLiquidity(amountBN));
          }
          break;

        case "withdrawOrder":
          log.info(`Withdrawing proceeds for order id: ${eventObj.id} at block: ${block}`);
          if (poolHelper) {
            const exitRequest = await poolHelper.getLTSwapWithdrawExitObjects(eventObj.id);
            txnStats.addTransaction( event,
                                     await poolHelper.getVaultContract().connect(addr1).exitPool(
                                       poolHelper.getPoolId(),
                                       addr1.address,
                                       addr1.address,
                                       exitRequest) );

          } else {
            // TODO: probably remove this as it wouldn't work anymore
            txnStats.addTransaction(event, await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(eventObj.id));
          }
          break;

        case "cancelOrder":
          log.info(`Cancelling order id: ${eventObj.id} at block: ${block}`);
          if (poolHelper) {

            // ORDER IS IMPORTANT HERE - Cancel must come first!
            let exitRequest = await poolHelper.getLTSwapCancelExitObjects(eventObj.id);
            txnStats.addTransaction( `${event}`,
                                     await poolHelper.getVaultContract().connect(addr1).exitPool(
                                       poolHelper.getPoolId(),
                                       addr1.address,
                                       addr1.address,
                                       exitRequest) );
          } else {
            // TODO: probably remove this as it wouldn't work anymore
            txnStats.addTransaction(event, await twamm.connect(addr1).cancelLongTermSwap(eventObj.id));
          }
          break;

        default:
          log.info( `Unsupported command received: "${event}". Ignoring.`);
          break;
      }
    }

    const currentBlock = await mineBlocks(nextBlock - block)
    await txnStats.processTransactions()
    await poolReserves.collectReserves(currentBlock)
  }

  poolReserves.writeToCSV()
  txnStats.writeToCSV()
}

const main = async () => {
  await network.provider.send("evm_setAutomine", [false]);
  await network.provider.send("evm_setIntervalMining", [0]);

  // const EXPECTED_START = 13629032    <-- Back when forking Alchemy
  //  const EXPECTED_START = 2          <-- Up until starting use of PB's Factory vs. AutoFactory
  const EXPECTED_START = 4
  let startBlockNum = 0
  let poolHelper: VaultTwammPoolAPIHelper | undefined = undefined

  const vaultPoolConfig: VaultPoolConfiguration = await configureVaultPool()
  startBlockNum = vaultPoolConfig.configuredBlock
  poolHelper = vaultPoolConfig.poolHelper
  // Repeated testing over long duration showed the same EXPECTED_START block number.
  // Coding it in here as an error condition for determinism.  (This block number is
  // the number from the EVM start to after configuring the pool, which we've made constant
  // to ensure consistent measurement between contracts.)
  if (startBlockNum !== EXPECTED_START) {
    throw `Expected starting block number ${EXPECTED_START}. Found ${startBlockNum}.\n` +
          `This means something is likely wrong and you are not mining deterministically\n` +
          `in this test. (Or a cache or something else is wrong.)`
  }
  log.info(`Pool configured, processing benchmark at EVM block ${startBlockNum}.`)

  await processBenchmarkFile(startBlockNum, poolHelper)
};

// Pattern to be able to use async/await everywhere and properly handle errors:
main()
  .then(() => process.exit(0))
  .catch((error) => {
    log.error(error);
    process.exit(1);
  });
