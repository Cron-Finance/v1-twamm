import { expect } from "chai"
import { ethers, waffle, network } from "hardhat"
import { EthPoolMainnetInterface, loadEthPoolMainnetFixture  } from "./helpers/deployer"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

import { Vault } from "typechain/contracts/twault/balancer-core-v2/vault/Vault";
import { ProtocolFeesCollector } from "typechain/contracts/twault/balancer-core-v2/vault/ProtocolFeesCollector";
import { TestERC20 } from "typechain/contracts/twault/helpers/TestERC20";
import { TestERC20__factory } from "typechain/factories/contracts/twault/helpers/TestERC20__factory";
import { BigNumber, Contract } from 'ethers';
 import { CronV1PoolFactoryExposed } from "typechain/contracts/twault/exposed/CronV1PoolFactoryExposed";
 import { CronV1PoolFactoryExposed__factory } from "typechain/factories/contracts/twault/exposed/CronV1PoolFactoryExposed__factory";

import { ArbitrageurListExample, ArbitrageurListExample__factory } from "typechain/index";

import { SwapManager,
         VaultTwammPoolAPIHelper } from "./helpers/vaultTwammPoolAPIHelper"
import { PoolModel } from "./model_v2/vaultTwammPool"
import { scaleUp,
        deployBalancerVault } from "./helpers/misc"      
import { PoolType,
  getBlockInterval,
  getDefaultTestTwammContract } from "../scripts/utils/contractMgmt"
import { mineBlock } from "scripts/utils/simulation";
  
// Logging:
const ds = require("../scripts/utils/debugScopes");
const log = ds.getLog("twault-concurrent-lt-swaps");


// Testing parameters
const TWAMM_CONTRACT = getDefaultTestTwammContract()
const POOL_TYPE = PoolType.Liquid
const BLOCK_INTERVAL = getBlockInterval(POOL_TYPE);

// Equal initial liquidity for both token 0 & 1 of 10k tokens (accounting for 18 decimals).
const TOKEN0_DECIMALS = 18;
const TOKEN1_DECIMALS = 18;
const INITIAL_LIQUIDITY_0 = scaleUp(10_000n, TOKEN0_DECIMALS);
const INITIAL_LIQUIDITY_1 = scaleUp(10_000n, TOKEN1_DECIMALS);
const ERC20BatchApproveAmt = ethers.utils.parseUnits( "10000000000" );    // 10B

const DEV_TOLERANCE = 20;   // allowable difference during development

export async function deployCommonContracts() {
  let owner: SignerWithAddress,
      addr1: SignerWithAddress,
      addr2: SignerWithAddress,
      addr3: SignerWithAddress,
      admin1: SignerWithAddress,
      admin2: SignerWithAddress,
      partnerBloxRoute: SignerWithAddress,
      partnerX: SignerWithAddress,
      arbitrageur1: SignerWithAddress,
      arbitrageur2: SignerWithAddress,
      arbitrageur3: SignerWithAddress,
      arbitrageur4: SignerWithAddress,
      arbitrageur5: SignerWithAddress,
      arbitrageur6: SignerWithAddress,
      feeAddr1: SignerWithAddress,
      feeAddr2: SignerWithAddress,
      addrs: SignerWithAddress[];

  let poolHelper: VaultTwammPoolAPIHelper;
  let swapMgr: SwapManager;

  let poolModel: PoolModel;
    
  // Contracts for testing into local vars:
  let token0AssetContract: any;
  let token1AssetContract: any;
  let balancerVaultContract: any;
  let poolContract: any;
  let arbitrageListContract: ArbitrageurListExample;
  let arbitrageListContract2: ArbitrageurListExample;
  let balTwammFactoryContract: CronV1PoolFactoryExposed; 

  [owner, addr1, addr2, addr3, admin1, admin2, partnerBloxRoute, partnerX, arbitrageur1, arbitrageur2, arbitrageur3, arbitrageur4, arbitrageur5, arbitrageur6, feeAddr1, feeAddr2, ...addrs] = await ethers.getSigners();

  const ERC20Deployer = new TestERC20__factory(owner);
  const lToken0AssetContract: TestERC20 = await ERC20Deployer.deploy("Token0", "Token0", TOKEN0_DECIMALS);
  const lToken1AssetContract: TestERC20 = await ERC20Deployer.deploy("Token1", "Token1", TOKEN1_DECIMALS);

  const ArbitragerListDeployer = new ArbitrageurListExample__factory(owner);
  arbitrageListContract = await ArbitragerListDeployer.deploy([arbitrageur4.address, arbitrageur5.address]);
  arbitrageListContract2 = await ArbitragerListDeployer.deploy([arbitrageur6.address]);

  let fixture: EthPoolMainnetInterface = await loadEthPoolMainnetFixture();
  const wethAddress = fixture.weth.address;
  const lBalancerVaultContract: Vault = await deployBalancerVault(owner, wethAddress);

  // Testing setup to match Balancer production protocol fees
  const vaultProtocolFeeCollector = await lBalancerVaultContract.getProtocolFeesCollector();
  const vaultProtocolFeeCollectorContract = await ethers.getContractAt("ProtocolFeesCollector", vaultProtocolFeeCollector);
  log.info("protocol fees before", await vaultProtocolFeeCollectorContract.getSwapFeePercentage());
  const minFee = BigNumber.from("500000000000000000")
  await vaultProtocolFeeCollectorContract.setSwapFeePercentage(minFee);
  await mineBlock();
  log.info("protocol fees after", await vaultProtocolFeeCollectorContract.getSwapFeePercentage());


  const TWAMMFactoryDeployer = new CronV1PoolFactoryExposed__factory(owner);
  balTwammFactoryContract = await TWAMMFactoryDeployer.deploy(lBalancerVaultContract.address);

  await mineBlock();
  const lPoolContractTx = await balTwammFactoryContract.createExposed(
    lToken0AssetContract.address,
    lToken1AssetContract.address,
    "Token0 - Token1",   // name
    "T0-T1",             // symbol
    POOL_TYPE,
    admin1.address
  );
  await mineBlock();
  const receipt = await lPoolContractTx.wait()
  const eventData = receipt.events?.filter((x:any) => {return x.event == "CronV1PoolCreated"})
  const poolAddress = eventData?.[0]?.args?.pool

  const PoolContractFactory = await ethers.getContractFactory("CronV1PoolExposed");
  const lPoolContract = PoolContractFactory.attach(
   poolAddress // The deployed contract address
  );
  
  
  const cronFiFactoryAddr: string = "0xe122Eff60083bC550ACbf31E7d8197A58d436b39"
  admin1 = await ethers.getSigner(cronFiFactoryAddr)

  let approvePromises = [
    lToken0AssetContract.approve(lPoolContract.address, ERC20BatchApproveAmt)
    .catch((e: any) => {log.error(`Token 0 failed approving TWAMM address. Error:\n${e}`)}),
    lToken1AssetContract.approve(lPoolContract.address, ERC20BatchApproveAmt)
    .catch((e: any) => {log.error(`Token 1 failed approving TWAMM address. Error:\n${e}`)}),
    network.provider.send("evm_mine")
    .catch((e: any) => {log.error(`Failed mining Token Approvals. Error:\n${e}`)}),
  ]
  await Promise.all(approvePromises)

// Do the next parts in the safety test
//  await lPoolContract.connect(admin1).setArbitragePartner(
//    partnerBloxRoute, arbitrageListContract)

  poolHelper = new VaultTwammPoolAPIHelper( lBalancerVaultContract,
                                            lPoolContract,
                                            TWAMM_CONTRACT,
                                            lToken0AssetContract,
                                            lToken1AssetContract,
                                            TOKEN0_DECIMALS,
                                            TOKEN1_DECIMALS )
  await poolHelper.init()

  // Assign contracts for testing to local vars:
  token0AssetContract = poolHelper.getToken0Contract();
  token1AssetContract = poolHelper.getToken1Contract();
  balancerVaultContract = poolHelper.getVaultContract();
  poolContract = poolHelper.getPoolContract()

  // Mint a supply of the tokens (do it here so the mined blocks align with past tests for
  // fair comparisons.):
  //
  await token0AssetContract.connect(owner).mint(owner.address, ERC20BatchApproveAmt);
  await token1AssetContract.connect(owner).mint(owner.address, ERC20BatchApproveAmt);

  // Final mine before handing over to testing infra:
  await network.provider.send("evm_mine");

  swapMgr = new SwapManager( poolHelper, 
                              owner,                           // token 0 owner
                              owner )                          // token 1 owner
                            
  poolModel = new PoolModel(POOL_TYPE)
  return {
    BLOCK_INTERVAL,
    owner,
    addr1,
    addr2,
    addr3,
    admin1,
    admin2,
    partnerBloxRoute,
    partnerX,
    arbitrageur1,
    arbitrageur2,
    arbitrageur3,
    arbitrageur4,
    arbitrageur5,
    arbitrageur6,
    feeAddr1,
    feeAddr2,
    addrs,
    poolHelper,
    swapMgr,
    poolModel,
    token0AssetContract,
    token1AssetContract,
    balancerVaultContract,
    poolContract,
    arbitrageListContract,
    arbitrageListContract2
  }
}
