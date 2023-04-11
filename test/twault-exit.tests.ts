 import { expect } from "chai"

 import { ethers, waffle, network } from "hardhat"
 import { createSnapshot, restoreSnapshot } from "./helpers/snapshots"
 import { EthPoolMainnetInterface, loadEthPoolMainnetFixture  } from "./helpers/deployer"
 import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
 
 // Path Insanity - TODO: PB how'd you get typechain flat (it has something to do with path
 //                       definitions in a config file however, this project's hierarchy might
 //                       be part of the problem or I wasn't using hardhat test config).
 import { Vault } from "typechain/contracts/twault/balancer-core-v2/vault/Vault";
 import { TestERC20, TestERC20__factory } from "typechain/index";
 import { CronV1PoolFactory } from "typechain/contracts/twault/factories/CronV1PoolFactory";
 import { CronV1PoolFactory__factory } from "typechain/factories/contracts/twault/factories/CronV1PoolFactory__factory";
 import { SwapType, ExitType, JoinType, ParamType } from "../scripts/utils/contractMgmt"
 import { BigNumber, BytesLike } from "ethers";
 import { ReserveType, TokenPairAmtType, OracleState } from "./helpers/types"
 import { SwapKind } from "./helpers/batchSwap";

 import {
  scaleUp,
  getLastBlockNumber,
  getReserveData,
  compareReserveData,
  checkFees, 
  getBalanceData,
  testBalanceData,
  mineBlocks,
  deployBalancerVault
} from "./helpers/misc"
 import { Swap,
          SwapManager,
          getNextOrderId,
          VaultTwammPoolAPIHelper, 
          clearNextOrderId} from "./helpers/vaultTwammPoolAPIHelper"
import { join } from "path"

const TOKEN0_DECIMALS = 18;
const TOKEN1_DECIMALS = 18;
const INITIAL_LIQUIDITY_0 = scaleUp(10_000n, TOKEN0_DECIMALS);
const INITIAL_LIQUIDITY_1 = scaleUp(10_000n, TOKEN1_DECIMALS);
 
describe("TWAULT Coverage Hole Exits Suite", function () {
  let owner: SignerWithAddress,
      addr1: SignerWithAddress,
      addr2: SignerWithAddress,
      notOwner: SignerWithAddress,
      addrs: SignerWithAddress[];
  let poolHelper: VaultTwammPoolAPIHelper;

  // Contracts for testing into local vars:
  let token0AssetContract: TestERC20;
  let token1AssetContract: TestERC20;
  let token2AssetContract: TestERC20;
  let balancerVaultContract: Vault;
  let balTwammFactoryContract: CronV1PoolFactory;

  let poolAddress: any;
  let lPoolContract: any;
  let poolId: any;


  const dumpBalancesLP = async () => {
    let evtBalBN = BigNumber.from(0);
    let evtBal = 0n
    let tokenBalBN = await lPoolContract.balanceOf(addr1.address)
    console.log(`type of tokenBalBN ${typeof tokenBalBN}\njson: ${JSON.stringify(tokenBalBN, null, 2)}\n`)
    let tokenBal = BigInt(tokenBalBN.toString())
    console.log(`evtBal:   ${evtBal}\n` +
                `evtBalBN:   ${evtBalBN}\n` +
                `tokenBal: ${tokenBal}\n`);
                // ` +
                // `diff:     ${evtBal - tokenBal}\n`)
  }

  before(async function () 
  {
    clearNextOrderId()
  })

  beforeEach(async function () 
  {
    await createSnapshot(waffle.provider);

    [owner, addr1, addr2, notOwner, ...addrs] = await ethers.getSigners();

    const ERC20Deployer = new TestERC20__factory(owner);
    token0AssetContract = await ERC20Deployer.deploy("Token0", "Token0", 18);
    token1AssetContract = await ERC20Deployer.deploy("Token1", "Token1", 18);
    token2AssetContract = await ERC20Deployer.deploy("Token2", "Token2", 18);
    
    const ERC20BatchApproveAmt = ethers.utils.parseUnits( "10000000000" );    // 10B

    await mineBlocks();
    await token0AssetContract.connect(owner).mint(owner.address, INITIAL_LIQUIDITY_0);
    await token1AssetContract.connect(owner).mint(owner.address, INITIAL_LIQUIDITY_1);
    await mineBlocks();

    let fixture: EthPoolMainnetInterface = await loadEthPoolMainnetFixture();
    const wethAddress = fixture.weth.address;
    balancerVaultContract = await deployBalancerVault(owner, wethAddress);
    await balancerVaultContract.setRelayerApproval( owner.address,
                                                    owner.address,    // was different addr in custom pool amm project
                                                    true );           // approved
    const TWAMMFactoryDeployer = new CronV1PoolFactory__factory(owner);
    balTwammFactoryContract = await TWAMMFactoryDeployer.deploy(balancerVaultContract.address);
    await mineBlocks();
    const liquidPoolTx = await balTwammFactoryContract.create(
        token0AssetContract.address,
        token1AssetContract.address,
        "Token0-Token1-Liquid",
        "T0-T1-L",
        1
    );
    await mineBlocks();
    const receipt = await liquidPoolTx.wait()
    const eventData = receipt.events?.filter((x:any) => {return x.event == "CronV1PoolCreated"})
    poolAddress = eventData?.[0]?.args?.pool
    // console.log("POOL ADDRESS", poolAddress)

    const PoolContractFactory = await ethers.getContractFactory("CronV1Pool");
    lPoolContract = PoolContractFactory.attach(
      poolAddress // The deployed contract address
    );

    poolId = await lPoolContract.POOL_ID();
    // console.log("POOL ID", poolId)

    // const newHoldingPeriodSec = 12     // 1 block
    // const newHoldingPenaltyBP = 1000   // 1%
    // await lPoolContract.connect(owner).setParameter(ParamType.HoldingPeriodSec, newHoldingPeriodSec)
    // await lPoolContract.connect(owner).setParameter(ParamType.HoldingPenaltyBP, newHoldingPenaltyBP)
  })

  after(function () {
    restoreSnapshot(waffle.provider);
  })

  describe("Other tests", function () {
//    it ("Pool Exit Satisfies Join Event Test", async function () {
//      const token0_10 = scaleUp(10_000n, TOKEN0_DECIMALS)
//      const token1_10 = scaleUp(10_000n, TOKEN1_DECIMALS)
//      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
//      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)
//
//      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
//      await token0AssetContract.connect(owner).transfer(addr2.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr2.address, token1_10);
//      await token0AssetContract.connect(addr2).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr2).approve(balancerVaultContract.address, token1_10);
//
//      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
//      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
//                          [token0, token1] :
//                          [token1, token0];
//      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
//      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]"], 
//                                                                      [JoinType.Join, amounts] );
//
//      await balancerVaultContract.connect(addr2).joinPool(
//        poolId,
//        addr2.address,
//        addr2.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      await balancerVaultContract.connect(addr2).joinPool(
//        poolId,
//        addr2.address,
//        addr2.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      await balancerVaultContract.connect(addr2).joinPool(
//        poolId,
//        addr2.address,
//        addr2.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      let joinEvents = await lPoolContract.getJoinEvents(addr2.address)
//      expect(joinEvents.length).to.be.equal(3)
//
//      let tokensLP = 0n
//      tokensLP += BigInt(joinEvents[0].amountLP.toString())
//      tokensLP += BigInt(joinEvents[1].amountLP.toString())
//      tokensLP += BigInt(100)
//
//      await lPoolContract.connect(addr2).approve(balancerVaultContract.address, tokensLP);
//
//      const minToken0LPAmt = ethers.utils.parseUnits("0", TOKEN0_DECIMALS);
//      const minToken1LPAmt = ethers.utils.parseUnits("0", TOKEN1_DECIMALS);
//      const minAmountsOut = [minToken0LPAmt, minToken1LPAmt];   // Zero minimum out.
//      userData = ethers.utils.defaultAbiCoder.encode(
//        ["uint256","uint256"],
//        [ExitType.Exit, tokensLP]
//      );
//      let toInternalBalance = false
//      await balancerVaultContract.connect(addr2).exitPool(
//        poolId,
//        addr2.address,
//        addr2.address,
//        {
//          assets,
//          minAmountsOut,
//          userData,
//          toInternalBalance
//        }
//      )
//      await mineBlocks()
//
//      let joinEvents1 = await lPoolContract.getJoinEvents(addr2.address)
//      expect(joinEvents1.length).to.be.equal(1)
//
//      let prevLpAmount = BigInt(joinEvents[2].amountLP.toString())/* - BigInt(100)*/
//      // console.log(prevLpAmount, BigInt(joinEvents1[0].amountLP.toString()))
//      expect(BigInt(joinEvents1[0].amountLP.toString())).to.be.equal(prevLpAmount)
//      expect(joinEvents[0].timestamp).to.be.closeTo(joinEvents1[0].timestamp, 1000)
//      await mineBlocks()
//    })

//    it ("Exit Pool Remove Join Event Tests: Scenario 1", async function () {
//      const token0_10 = scaleUp(10_000n, TOKEN0_DECIMALS)
//      const token1_10 = scaleUp(10_000n, TOKEN1_DECIMALS)
//      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
//      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)
//
//      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
//      await token0AssetContract.connect(owner).transfer(addr1.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr1.address, token1_10);
//      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, token1_10);
//
//      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
//      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
//                          [token0, token1] :
//                          [token1, token0];
//      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
//      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]"], 
//                                                                      [JoinType.Join, amounts] );
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      let joinEvents = await lPoolContract.getJoinEvents(addr1.address)
//
//      let tokensLP = 0n
//      tokensLP += BigInt(joinEvents[0].amountLP.toString())
//      tokensLP -= BigInt(1)
//
//      await lPoolContract.connect(addr1).approve(balancerVaultContract.address, tokensLP);
//
//      const minToken0LPAmt = ethers.utils.parseUnits("0", TOKEN0_DECIMALS);
//      const minToken1LPAmt = ethers.utils.parseUnits("0", TOKEN1_DECIMALS);
//      const minAmountsOut = [minToken0LPAmt, minToken1LPAmt];   // Zero minimum out.
//      userData = ethers.utils.defaultAbiCoder.encode(
//        ["uint256","uint256"],
//        [ExitType.Exit, tokensLP]
//      );
//      let toInternalBalance = false
//      await balancerVaultContract.connect(addr1).exitPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          minAmountsOut,
//          userData,
//          toInternalBalance
//        }
//      )
//      await mineBlocks()
//
//      let joinEvents1 = await lPoolContract.getJoinEvents(addr1.address)
//      expect(joinEvents1.length).to.be.equal(2)
//      expect(BigInt(joinEvents1[0].amountLP.toString())).to.be.equal(BigInt(1))
//      await mineBlocks()
//    })

//    it ("Exit Pool Remove Join Event Tests: Scenario 2", async function () {
//      const token0_10 = scaleUp(10_000n, TOKEN0_DECIMALS)
//      const token1_10 = scaleUp(10_000n, TOKEN1_DECIMALS)
//      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
//      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)
//
//      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
//      await token0AssetContract.connect(owner).transfer(addr1.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr1.address, token1_10);
//      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, token1_10);
//
//      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
//      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
//                          [token0, token1] :
//                          [token1, token0];
//      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
//      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]"], 
//                                                                      [JoinType.Join, amounts] );
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      let joinEvents = await lPoolContract.getJoinEvents(addr1.address)
//
//      let tokensLP = 0n
//      tokensLP += BigInt(joinEvents[0].amountLP.toString())
//
//      await lPoolContract.connect(addr1).approve(balancerVaultContract.address, tokensLP);
//
//      const minToken0LPAmt = ethers.utils.parseUnits("0", TOKEN0_DECIMALS);
//      const minToken1LPAmt = ethers.utils.parseUnits("0", TOKEN1_DECIMALS);
//      const minAmountsOut = [minToken0LPAmt, minToken1LPAmt];   // Zero minimum out.
//      userData = ethers.utils.defaultAbiCoder.encode(
//        ["uint256","uint256"],
//        [ExitType.Exit, tokensLP]
//      );
//      let toInternalBalance = false
//      await balancerVaultContract.connect(addr1).exitPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          minAmountsOut,
//          userData,
//          toInternalBalance
//        }
//      )
//      await mineBlocks()
//
//      let joinEvents1 = await lPoolContract.getJoinEvents(addr1.address)
//      expect(joinEvents1.length).to.be.equal(1)
//      let x = BigInt(joinEvents1[0].amountLP.toString())
//      let y = BigInt(joinEvents[1].amountLP.toString())
//      expect(x).to.be.equal(y)
//      await mineBlocks()
//    })

//    it ("Exit Pool Remove Join Event Tests: Scenario 3", async function () {
//      const token0_10 = scaleUp(10_000n, TOKEN0_DECIMALS)
//      const token1_10 = scaleUp(10_000n, TOKEN1_DECIMALS)
//      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
//      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)
//
//      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
//      await token0AssetContract.connect(owner).transfer(addr1.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr1.address, token1_10);
//      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, token1_10);
//
//      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
//      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
//                          [token0, token1] :
//                          [token1, token0];
//      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
//      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]"], 
//                                                                      [JoinType.Join, amounts] );
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      let joinEvents = await lPoolContract.getJoinEvents(addr1.address)
//
//      let tokensLP = 0n
//      tokensLP += BigInt(joinEvents[0].amountLP.toString())
//      tokensLP += BigInt(1)
//
//      await lPoolContract.connect(addr1).approve(balancerVaultContract.address, tokensLP);
//
//      const minToken0LPAmt = ethers.utils.parseUnits("0", TOKEN0_DECIMALS);
//      const minToken1LPAmt = ethers.utils.parseUnits("0", TOKEN1_DECIMALS);
//      const minAmountsOut = [minToken0LPAmt, minToken1LPAmt];   // Zero minimum out.
//      userData = ethers.utils.defaultAbiCoder.encode(
//        ["uint256","uint256"],
//        [ExitType.Exit, tokensLP]
//      );
//      let toInternalBalance = false
//      await balancerVaultContract.connect(addr1).exitPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          minAmountsOut,
//          userData,
//          toInternalBalance
//        }
//      )
//      await mineBlocks()
//
//      let joinEvents1 = await lPoolContract.getJoinEvents(addr1.address)
//      expect(joinEvents1.length).to.be.equal(1)
//      let x = BigInt(joinEvents1[0].amountLP.toString())
//      let y = BigInt(joinEvents[1].amountLP.toString()) - BigInt(1)
//      expect(x).to.be.equal(y)
//      await mineBlocks()
//    })

//    it ("Exit Pool Remove Join Event Tests: Scenario 4", async function () {
//      const token0_10 = scaleUp(10_000n, TOKEN0_DECIMALS)
//      const token1_10 = scaleUp(10_000n, TOKEN1_DECIMALS)
//      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
//      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)
//
//      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
//      await token0AssetContract.connect(owner).transfer(addr1.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr1.address, token1_10);
//      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, token1_10);
//
//      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
//      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
//                          [token0, token1] :
//                          [token1, token0];
//      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
//      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]"], 
//                                                                      [JoinType.Join, amounts] );
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      let joinEvents = await lPoolContract.getJoinEvents(addr1.address)
//
//      let tokensLP = 0n
//      tokensLP += BigInt(joinEvents[0].amountLP.toString())
//      tokensLP += BigInt(joinEvents[1].amountLP.toString())
//
//      await lPoolContract.connect(addr1).approve(balancerVaultContract.address, tokensLP);
//
//      const minToken0LPAmt = ethers.utils.parseUnits("0", TOKEN0_DECIMALS);
//      const minToken1LPAmt = ethers.utils.parseUnits("0", TOKEN1_DECIMALS);
//      const minAmountsOut = [minToken0LPAmt, minToken1LPAmt];   // Zero minimum out.
//      userData = ethers.utils.defaultAbiCoder.encode(
//        ["uint256","uint256"],
//        [ExitType.Exit, tokensLP]
//      );
//      let toInternalBalance = false
//      await balancerVaultContract.connect(addr1).exitPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          minAmountsOut,
//          userData,
//          toInternalBalance
//        }
//      )
//      await mineBlocks()
//
//      let joinEvents1 = await lPoolContract.getJoinEvents(addr1.address)
//      expect(joinEvents1.length).to.be.equal(0)
//    })

//    it ("Destination Length Zero Test", async function () {
//      const token0_10 = scaleUp(10_000n, TOKEN0_DECIMALS)
//      const token1_10 = scaleUp(10_000n, TOKEN1_DECIMALS)
//      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
//      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)
//
//      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
//      await token0AssetContract.connect(owner).transfer(addr1.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr1.address, token1_10);
//      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, token1_10);
//
//      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
//      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
//                          [token0, token1] :
//                          [token1, token0];
//      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
//      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]"], 
//                                                                      [JoinType.Join, amounts] );
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(10);
//
//      let joinEventsAddr1Prev = await lPoolContract.getJoinEvents(addr1.address)
//      let joinEventsAddr2 = await lPoolContract.getJoinEvents(addr2.address)
//      expect(joinEventsAddr2.length).to.be.equal(0)
//
//      let tokensLP = 0n
//      tokensLP += BigInt(joinEventsAddr1Prev[0].amountLP.toString()) / BigInt(2)
//
//      await lPoolContract.connect(addr1).transferJoinEvent(addr2.address, 0, tokensLP);
//      await mineBlocks();
//
//      let joinEventsAddr1After = await lPoolContract.getJoinEvents(addr1.address)
//      joinEventsAddr2 = await lPoolContract.getJoinEvents(addr2.address)
//      expect(joinEventsAddr1After.length).to.be.equal(2)
//      expect(BigInt(joinEventsAddr1After[0].amountLP.toString())).to.be.equal(tokensLP)
//      expect(joinEventsAddr2.length).to.be.equal(1)
//      expect(BigInt(joinEventsAddr2[0].amountLP.toString())).to.be.equal(tokensLP)
//    })

//    it ("Destination Increment End Insertion Point Test", async function () {
//      const token0_10 = scaleUp(5_000n, TOKEN0_DECIMALS)
//      const token1_10 = scaleUp(5_000n, TOKEN1_DECIMALS)
//      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
//      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)
//
//      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
//      await token0AssetContract.connect(owner).transfer(addr1.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr1.address, token1_10);
//      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, token1_10);
//      await token0AssetContract.connect(owner).transfer(addr2.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr2.address, token1_10);
//      await token0AssetContract.connect(addr2).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr2).approve(balancerVaultContract.address, token1_10);
//      await mineBlocks();
//
//      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
//      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
//                          [token0, token1] :
//                          [token1, token0];
//      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
//      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]"], 
//                                                                      [JoinType.Join, amounts] );
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(4);
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(4);
//
//      await balancerVaultContract.connect(addr2).joinPool(
//        poolId,
//        addr2.address,
//        addr2.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks();
//
//      await balancerVaultContract.connect(addr2).joinPool(
//        poolId,
//        addr2.address,
//        addr2.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks();
//
//      // B => Addr1
//      // A => Addr2
//
//      let joinEventsAddr1 = await lPoolContract.getJoinEvents(addr1.address)
//      let joinEventsAddr2Prev = await lPoolContract.getJoinEvents(addr2.address)
//      expect(joinEventsAddr1.length).to.be.equal(2)
//      expect(joinEventsAddr2Prev.length).to.be.equal(2)
//
//      let tokensLP = 0n
//      tokensLP += BigInt(joinEventsAddr2Prev[0].amountLP.toString())
//
//      await lPoolContract.connect(addr2).transferJoinEvent(addr1.address, 0, tokensLP);
//      await mineBlocks();
//
//      joinEventsAddr1 = await lPoolContract.getJoinEvents(addr1.address)
//      let joinEventsAddr2After = await lPoolContract.getJoinEvents(addr2.address)
//      expect(joinEventsAddr1.length).to.be.equal(3)
//      expect(BigInt(joinEventsAddr1[2].amountLP.toString())).to.be.equal(tokensLP)
//      expect(joinEventsAddr1[2].timestamp).to.be.closeTo(joinEventsAddr2Prev[0].timestamp, 1000)
//
//      expect(joinEventsAddr2After.length).to.be.equal(1)
//      expect(BigInt(joinEventsAddr2After[0].amountLP.toString())).to.be.equal(BigInt(joinEventsAddr2Prev[1].amountLP.toString()))
//      expect(joinEventsAddr2After[0].timestamp).to.be.closeTo(joinEventsAddr2Prev[1].timestamp, 1000)
//    })

//    it ("Destination Increment Middle Insertion Point Test", async function () {
//      const token0_10 = scaleUp(5_000n, TOKEN0_DECIMALS)
//      const token1_10 = scaleUp(5_000n, TOKEN1_DECIMALS)
//      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
//      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)
//
//      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
//      await token0AssetContract.connect(owner).transfer(addr1.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr1.address, token1_10);
//      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, token1_10);
//      await token0AssetContract.connect(owner).transfer(addr2.address, token0_10);
//      await token1AssetContract.connect(owner).transfer(addr2.address, token1_10);
//      await token0AssetContract.connect(addr2).approve(balancerVaultContract.address, token0_10);
//      await token1AssetContract.connect(addr2).approve(balancerVaultContract.address, token1_10);
//      await mineBlocks();
//
//      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
//      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
//                          [token0, token1] :
//                          [token1, token0];
//      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
//      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]"], 
//                                                                      [JoinType.Join, amounts] );
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(4);
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(4);
//
//      await balancerVaultContract.connect(addr2).joinPool(
//        poolId,
//        addr2.address,
//        addr2.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//
//      await balancerVaultContract.connect(addr2).joinPool(
//        poolId,
//        addr2.address,
//        addr2.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks(4);
//
//      await balancerVaultContract.connect(addr1).joinPool(
//        poolId,
//        addr1.address,
//        addr1.address,
//        {
//          assets,
//          maxAmountsIn,
//          userData,
//          fromInternalBalance: false
//        }
//      )
//      await mineBlocks();
//
//      let joinEventsAddr1Prev = await lPoolContract.getJoinEvents(addr1.address)
//      let joinEventsAddr2Prev = await lPoolContract.getJoinEvents(addr2.address)
//      expect(joinEventsAddr1Prev.length).to.be.equal(3)
//      expect(joinEventsAddr2Prev.length).to.be.equal(2)
//
//      let tokensLP = 0n
//      tokensLP += BigInt(joinEventsAddr2Prev[0].amountLP.toString())
//
//      await lPoolContract.connect(addr2).transferJoinEvent(addr1.address, 0, tokensLP);
//      await mineBlocks();
//
//      let joinEventsAddr1After = await lPoolContract.getJoinEvents(addr1.address)
//      let joinEventsAddr2After = await lPoolContract.getJoinEvents(addr2.address)
//      expect(joinEventsAddr1After.length).to.be.equal(4)
//      expect(BigInt(joinEventsAddr1After[2].amountLP.toString())).to.be.equal(tokensLP)
//      expect(joinEventsAddr1After[2].timestamp).to.be.closeTo(joinEventsAddr2Prev[0].timestamp, 1000)
//      
//      expect(joinEventsAddr2After.length).to.be.equal(1)
//      expect(BigInt(joinEventsAddr2After[0].amountLP.toString())).to.be.equal(BigInt(joinEventsAddr2Prev[1].amountLP.toString()))
//      expect(joinEventsAddr2After[0].timestamp).to.be.closeTo(joinEventsAddr2Prev[1].timestamp, 1000)
//    })

    it ("LT Withdraw Order early Test", async function () {
      // Figure out the ratio of tokens to add to the pool, given an investment of 3k token0
      const token0 = scaleUp(1_000n, TOKEN0_DECIMALS)
      const token1 = scaleUp(1_000n, TOKEN1_DECIMALS)

      // Transfer the tokens to the customer's wallet and approve them for the vault contract:
      await token0AssetContract.connect(owner).transfer(addr1.address, token0);
      await token1AssetContract.connect(owner).transfer(addr1.address, token1);
      await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, token0);
      await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, token1);

      const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
      const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
                          [token0, token1] :
                          [token1, token0];
      const amounts = maxAmountsIn.map((amt) => amt.toHexString());
      const zeroBN = BigNumber.from(0)
      const minAmounts = [zeroBN, zeroBN].map((amt) => amt.toHexString());
      let userData: BytesLike = ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256[]", "uint256[]"], 
                                                                      [JoinType.Join, amounts, minAmounts] );

      await balancerVaultContract.connect(addr1).joinPool(
        poolId,
        addr1.address,
        addr1.address,
        {
          assets,
          maxAmountsIn,
          userData,
          fromInternalBalance: false
        }
      )
      await mineBlocks();

      const isAmount0 = !token0.isZero()
      const tokenInContract = (isAmount0) ? token0AssetContract : token1AssetContract;
      const tokenOutContract = (isAmount0) ? token1AssetContract : token0AssetContract;
      const tokenInAmtBeforeScale = (isAmount0) ? token0 : token1;
      const tokenDecimals = (isAmount0) ? TOKEN0_DECIMALS : TOKEN1_DECIMALS;

      const tokenInAmt = tokenInAmtBeforeScale
      const interval = 10;
      userData = ethers.utils.defaultAbiCoder.encode(
        ["uint256","uint256"],
        [SwapType.LongTermSwap, interval]
      );

      await tokenInContract.connect(owner).transfer(addr1.address, tokenInAmt)
      await tokenInContract.connect(addr1).approve(balancerVaultContract.address, tokenInAmt)
    
      const swapStruct = {
        poolId: poolId,
        kind: SwapKind.GIVEN_IN,
        assetIn: tokenInContract.address,
        assetOut: tokenOutContract.address,
        amount: tokenInAmt,
        userData
      }
      const fundStruct = {
        sender: addr1.address,
        fromInternalBalance: false,
        recipient: addr1.address,
        toInternalBalance: false
      }
      const limitOutAmt = 0
      const deadlineSec = Math.round(Date.now() / 1000) + 60 * 60 * 24
      
      await balancerVaultContract.connect(addr1).swap(
        swapStruct,
        fundStruct,
        limitOutAmt,
        deadlineSec
      )
      await mineBlocks(interval/2);

      let tokensLP = await lPoolContract.balanceOf(addr1.address)
      await lPoolContract.connect(addr1).approve(balancerVaultContract.address, tokensLP);

      const minToken0LPAmt = ethers.utils.parseUnits("0", TOKEN0_DECIMALS);
      const minToken1LPAmt = ethers.utils.parseUnits("0", TOKEN1_DECIMALS);
      const minAmountsOut = [minToken0LPAmt, minToken1LPAmt];   // Zero minimum out.
      userData = ethers.utils.defaultAbiCoder.encode(
        ["uint256","uint256"],
        [ExitType.Withdraw, 0]
      );
      let toInternalBalance = false
      await balancerVaultContract.connect(addr1).exitPool(
        poolId,
        addr1.address,
        addr1.address,
        {
          assets,
          minAmountsOut,
          userData,
          toInternalBalance
        }
      )
      await mineBlocks()
    })
  })
})
