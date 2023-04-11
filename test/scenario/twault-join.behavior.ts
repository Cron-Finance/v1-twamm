import { expect } from "chai"

import { ethers, waffle, network } from "hardhat"
import { createSnapshot, restoreSnapshot } from "../helpers/snapshots"
import { EthPoolMainnetInterface, loadEthPoolMainnetFixture  } from "../helpers/deployer"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

// Path Insanity - TODO: PB how'd you get typechain flat (it has something to do with path
//                       definitions in a config file however, this project's hierarchy might
//                       be part of the problem or I wasn't using hardhat test config).
import { Vault } from "typechain/contracts/twault/balancer-core-v2/vault/Vault";
import { TestERC20 } from "typechain/contracts/twault/test/TestERC20";
import { TestERC20__factory } from "typechain/factories/contracts/twault/test/TestERC20__factory";

import { VaultTwammPoolAPIHelper } from "../helpers/vaultTwammPoolAPIHelper"
import { PoolModel } from "../model_v1/vaultTwammPool"
import { scaleUp,
         mineBlocks,
         deployBalancerVault } from "../helpers/misc"      
import { PoolType,
        isVaultTwammV003OrLater,
        getBlockInterval,
        getDefaultTwammContract } from "./../../scripts/utils/contractMgmt"

// Logging:
const ds = require("../../scripts/utils/debugScopes");
const log = ds.getLog("twault-safety");


// Testing parameters
const TWAMM_CONTRACT = getDefaultTwammContract()
const POOL_TYPE = PoolType.Liquid
const BLOCK_INTERVAL = isVaultTwammV003OrLater(TWAMM_CONTRACT) ? getBlockInterval(POOL_TYPE) : 10

const ERC20BatchApproveAmt = ethers.utils.parseUnits( "10000000000" );    // 10B

export function itBehavesAsNormalJoin(
    TOKEN0_DECIMALS: number,
    TOKEN1_DECIMALS: number,
  ): void {
    let owner: SignerWithAddress,
        addr1: SignerWithAddress,
        addr2: SignerWithAddress,
        addrs: SignerWithAddress[];

    let poolHelper: VaultTwammPoolAPIHelper;

    let poolModel: PoolModel;
        
    // Contracts for testing into local vars:
    let token0AssetContract: any;
    let token1AssetContract: any;
    let balancerVaultContract: any;
    let poolContract: any;

    // Equal initial liquidity for both token 0 & 1 of 10k tokens (accounting for 18 decimals).
    const INITIAL_LIQUIDITY_0 = scaleUp(10_000n, TOKEN0_DECIMALS);
    const INITIAL_LIQUIDITY_1 = scaleUp(10_000n, TOKEN1_DECIMALS);

    before(async function () 
    {
        await createSnapshot(waffle.provider);

        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        const ERC20Deployer = new TestERC20__factory(owner);
        const lToken0AssetContract: TestERC20 = await ERC20Deployer.deploy("Token0", "Token0", TOKEN0_DECIMALS);
        const lToken1AssetContract: TestERC20 = await ERC20Deployer.deploy("Token1", "Token1", TOKEN1_DECIMALS);

        let fixture: EthPoolMainnetInterface = await loadEthPoolMainnetFixture();
        const wethAddress = fixture.weth.address;
        const lBalancerVaultContract: Vault = await deployBalancerVault(owner, wethAddress);
        await lBalancerVaultContract.setRelayerApproval( owner.address,
                                                        owner.address,    // was different addr in custom pool amm project
                                                        true );           // approved

        const TWAMMAutoFactory: any = await ethers.getContractFactory(TWAMM_CONTRACT)
        const lPoolContract = isVaultTwammV003OrLater(TWAMM_CONTRACT) ?
                                await TWAMMAutoFactory.deploy(lToken0AssetContract.address,
                                                            lToken1AssetContract.address,
                                                            lBalancerVaultContract.address,
                                                            "Token0 - Token1",   // name
                                                            "T0-T1",             // symbol
                                                            POOL_TYPE) :
                                await TWAMMAutoFactory.deploy(lToken0AssetContract.address,
                                                            lToken1AssetContract.address,
                                                            lBalancerVaultContract.address,
                                                            "Token0 - Token1",   // name
                                                            "T0-T1",             // symbol
                                                            BLOCK_INTERVAL) 

        let approvePromises = [
        lToken0AssetContract.approve(lPoolContract.address, ERC20BatchApproveAmt)
        .catch((e: any) => {log.error(`Token 0 failed approving TWAMM address. Error:\n${e}`)}),
        lToken1AssetContract.approve(lPoolContract.address, ERC20BatchApproveAmt)
        .catch((e: any) => {log.error(`Token 1 failed approving TWAMM address. Error:\n${e}`)}),
        network.provider.send("evm_mine")
        .catch((e: any) => {log.error(`Failed mining Token Approvals. Error:\n${e}`)}),
        ]
        await Promise.all(approvePromises)

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

        poolModel = new PoolModel()
    })

    after(function () {
        restoreSnapshot(waffle.provider);
    })

    describe("Initial liquidity mint checks", function () {
        it ("should mint initial liquidity", async function () {
        await token0AssetContract.connect(owner).transfer(addr1.address, INITIAL_LIQUIDITY_0);
        await token1AssetContract.connect(owner).transfer(addr1.address, INITIAL_LIQUIDITY_1);
        let joinObjects = await poolHelper.getJoinObjects( INITIAL_LIQUIDITY_0, INITIAL_LIQUIDITY_1 );
        await token0AssetContract.connect(addr1).approve(balancerVaultContract.address, joinObjects.token0Amt);
        await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, joinObjects.token1Amt);
        await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)
        //
        // Provide initial liquidity:
        await balancerVaultContract.connect(addr1).joinPool(
            poolHelper.getPoolId(),
            addr1.address,
            addr1.address,
            joinObjects.joinStruct
        )
        await mineBlocks();

        poolModel.initialMint(addr1.address, INITIAL_LIQUIDITY_0, INITIAL_LIQUIDITY_1)
        })

        it ("should contain the provided liquidity", async function () {
        // Check the results of the initial mint:
        let pr = await poolHelper.getPoolReserves()
        expect(pr.reserve0).to.eq(INITIAL_LIQUIDITY_0);
        expect(pr.reserve1).to.eq(INITIAL_LIQUIDITY_1);
        })

        it ("should have total supply matching geometric mean of the provided liquidity", async function () {
        // Should see the geometric mean of the initial liquidities as the total supply of the pool:
        let lpSupply = await poolContract.totalSupply();
        expect(lpSupply).to.eq(poolModel.getLpTokenSupply());
        })

        it ("should provide correct number of LP tokens to initial liquidity provider", async function () {
        // Should see the first liquidity provider get 1k minus the total supply (the
        // 1k goes to the minimum liquidity div by zero prevention adapted from UNI V2).
        let lpTokensMinted = await poolContract.balanceOf(addr1.address)
        expect(lpTokensMinted).to.eq(poolModel.balanceOfLpToken(addr1.address))
        })
    })
}