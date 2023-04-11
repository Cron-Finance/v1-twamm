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

 import { mineBlocks, deployBalancerVault} from "./helpers/misc"
import {clearNextOrderId} from "./helpers/VaultTwammPoolAPIHelper"
 
 describe("TWAULT (TWAMM Balancer Vault) Factory Regression Suite", function () {
    let owner: SignerWithAddress,
       addr1: SignerWithAddress,
       addr2: SignerWithAddress,
       notOwner: SignerWithAddress,
       addrs: SignerWithAddress[];

    // Contracts for testing into local vars:
    let token0AssetContract: TestERC20;
    let token1AssetContract: TestERC20;
    let token2AssetContract: TestERC20;
    let balancerVaultContract: Vault;
    let balTwammFactoryContract: CronV1PoolFactory;

   before(async function () 
   {
        clearNextOrderId()
        await createSnapshot(waffle.provider);

        [owner, addr1, addr2, notOwner, ...addrs] = await ethers.getSigners();

        const ERC20Deployer = new TestERC20__factory(owner);
        token0AssetContract = await ERC20Deployer.deploy("Token0", "Token0", 18);
        token1AssetContract = await ERC20Deployer.deploy("Token1", "Token1", 18);
        token2AssetContract = await ERC20Deployer.deploy("Token2", "Token2", 18);

        let fixture: EthPoolMainnetInterface = await loadEthPoolMainnetFixture();
        const wethAddress = fixture.weth.address;
        balancerVaultContract = await deployBalancerVault(owner, wethAddress);
        await balancerVaultContract.setRelayerApproval( owner.address,
                                                        owner.address,    // was different addr in custom pool amm project
                                                        true );           // approved
        const TWAMMFactoryDeployer = new CronV1PoolFactory__factory(owner);
        balTwammFactoryContract = await TWAMMFactoryDeployer.deploy(balancerVaultContract.address);
   })
 
   after(function () {
     restoreSnapshot(waffle.provider);
   })


 
   describe("Factory owner tests", function () {
    it ("should set new owner", async function () {
      await mineBlocks();
      const changeOwnerTx = await balTwammFactoryContract.transferOwnership(addr1.address, true, false);
      await mineBlocks();
      const receipt = await changeOwnerTx.wait()
      const eventData = receipt.events?.filter((x:any) => {return x.event == "OwnerChanged"})
      const newOwner = eventData?.[0]?.args?.newAdmin
      expect(newOwner).to.be.equal(addr1.address);
    })
    it ("should not set new owner", async function () {
      await mineBlocks();
      await expect(balTwammFactoryContract.connect(notOwner).transferOwnership(addr1.address, true, false)).to.be.revertedWith("CFI#503");
    })
  })
 
   describe("Pool type tests", function () {
    it ("should create stable pool", async function () {
        await mineBlocks();
        const stablePoolTx = await balTwammFactoryContract.create(
            token0AssetContract.address,
            token1AssetContract.address,
            "Token0-Token1-Stable",
            "T0-T1-S",
            0
        );
        await mineBlocks();
        const receipt = await stablePoolTx.wait()
        const eventData = receipt.events?.filter((x:any) => {return x.event == "TWAMMPoolCreated"})
        const poolAddress = eventData?.[0]?.args?.pool
        expect(poolAddress).to.not.be.null;
     })
 
     it ("should create liquid pool", async function () {
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
        const eventData = receipt.events?.filter((x:any) => {return x.event == "TWAMMPoolCreated"})
        const poolAddress = eventData?.[0]?.args?.pool
        expect(poolAddress).to.not.be.null;
     })
 
     it ("should create volatile pool", async function () {
        await mineBlocks();
        const volatilePoolTx = await balTwammFactoryContract.create(
            token0AssetContract.address,
            token1AssetContract.address,
            "Token0-Token1-Volatile",
            "T0-T1-V",
            2
        );
        await mineBlocks();
        const receipt = await volatilePoolTx.wait()
        const eventData = receipt.events?.filter((x:any) => {return x.event == "TWAMMPoolCreated"})
        const poolAddress = eventData?.[0]?.args?.pool
        expect(poolAddress).to.not.be.null;
     })
 
     it ("should not create invalid pool type: 3", async function () {
        await mineBlocks();
        let errorStr: string = ''
        let failed = false
        try {
          const receipt = await balTwammFactoryContract.create(
            token1AssetContract.address,
            token2AssetContract.address,
            "Token1-Token2-Invalid",
            "T1-T2-I",
            3
          );
          await mineBlocks()
        } catch(error: any) {        
          failed = true
          errorStr = error.toString()
        }
        expect(
          failed,
          "invalid pool type enum"
        ).to.eq(true)
     })
 
     it ("should not create duplicate stable pool", async function () {
        await mineBlocks();
        const duplicateStablePoolTx = balTwammFactoryContract.create(
            token0AssetContract.address,
            token1AssetContract.address,
            "Token0-Token1-Stable",
            "T0-T1-S",
            0
        );
        await expect(duplicateStablePoolTx).to.be.revertedWith("CFI#502")
     })
 
     it ("should not create duplicate liquid pool", async function () {
        await mineBlocks();
        const duplicateLiquidPoolTx = balTwammFactoryContract.create(
            token0AssetContract.address,
            token1AssetContract.address,
            "Token0-Token1-Liquid",
            "T0-T1-L",
            1
        );
        await expect(duplicateLiquidPoolTx).to.be.revertedWith("CFI#502")
     })
 
     it ("should not create duplicate volatile pool", async function () {
        await mineBlocks();
        const duplicateVolatilePoolTx = balTwammFactoryContract.create(
            token0AssetContract.address,
            token1AssetContract.address,
            "Token0-Token1-Volatile",
            "T0-T1-V",
            2
        );
        await expect(duplicateVolatilePoolTx).to.be.revertedWith("CFI#502")
     })
   })
})
