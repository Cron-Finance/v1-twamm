import { expect } from "chai"

import { ethers, waffle, network } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber, Contract } from "ethers";
import { scaleUp, mineBlocks } from "../helpers/misc"  
import { VaultTwammPoolAPIHelper } from "../helpers/vaultTwammPoolAPIHelper"   

// Logging:
const ds = require("../../scripts/utils/debugScopes");
const log = ds.getLog("twault-concurrent-lt-swaps");
const TOKEN0_DECIMALS = 18;
const TOKEN1_DECIMALS = 18;
const INITIAL_LIQUIDITY_0 = scaleUp(10_000n, TOKEN0_DECIMALS);
const INITIAL_LIQUIDITY_1 = scaleUp(10_000n, TOKEN1_DECIMALS);
  
export function smotTest(
  owner: SignerWithAddress,
  addr1: SignerWithAddress,
  poolHelper: VaultTwammPoolAPIHelper,
  token1AssetContract: Contract,
  balancerVaultContract: Contract
): void {
  describe("First describe in function", function () {
    it ("should mint information", async function() {
        let joinObjects = await poolHelper.getJoinObjects( INITIAL_LIQUIDITY_0, INITIAL_LIQUIDITY_1 );
        await token1AssetContract.connect(owner).transfer(addr1.address, INITIAL_LIQUIDITY_1);
        await token1AssetContract.connect(addr1).approve(balancerVaultContract.address, joinObjects.token1Amt);
        await mineBlocks();   // Mine after transfers (otherwise they get aggregated with other ops)
    })
    it ("should have balance in contract for address", async function () {
        let prevBalT1Addr1 = await token1AssetContract.balanceOf(addr1.address)
        console.log("Prev balance", prevBalT1Addr1);
        expect(prevBalT1Addr1).to.be.greaterThan(0);
    })
  })
}