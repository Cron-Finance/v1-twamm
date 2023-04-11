import { ethers, waffle, network } from "hardhat"
import { createSnapshot, restoreSnapshot } from "./helpers/snapshots"
import { EthPoolMainnetInterface, loadEthPoolMainnetFixture  } from "./helpers/deployer"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

// path insantity - not sure why TODO: PB how'd you get typechain flat (I know it has something to do with path definitions in a config file
//                                                                      however, this project's hierarchy might be part of the problem).
import { Vault } from "typechain/contracts/twault/balancer-core-v2/vault/Vault";
import { TestERC20 } from "typechain/contracts/twault/test/TestERC20";
import { TestERC20__factory } from "typechain/factories/contracts/twault/test/TestERC20__factory";
import { BalTWAMM } from "typechain/contracts/twault/V001/BalTWAMM";
import { IVault } from "typechain/contracts/twault/balancer-core-v2/vault/interfaces/IVault";
import { deployBalancerVault } from "./helpers/deployBalancerVault";
import { deployBalancerPool } from "./helpers/deployBalancerPool";
import { BigNumber, BytesLike } from "ethers";
import { SwapKind } from "./helpers/batchSwap";


const { provider } = waffle


describe("BalTWAMM",
         function () {
  let enabledAutomining = false;

  const SECONDS_IN_YEAR = 60 * 60 * 24 * 365    // Doesn't handle leap year.
  const TOKEN0_DECIMALS = 18
  const TOKEN1_DECIMALS = 18


  let fixture: EthPoolMainnetInterface
  let startTimestamp: number
  let expirationTime: number
  let accounts: SignerWithAddress[]
  let balancerSigner: SignerWithAddress
  let cronFiSigner: SignerWithAddress
  let tokenSigner: SignerWithAddress
  let token0AssetContract: TestERC20;
  let token1AssetContract: TestERC20;
  let balancerVaultContract: Vault;
  let cronFiAddress: string;
  // TODO: should tie poolContract to the deploy function, but that will go away and it will just be BalTWAMM, so why bother
  let poolContract: BalTWAMM;
  let poolLP: SignerWithAddress;
  let poolSwapper: SignerWithAddress;
  let poolLTSwapper: SignerWithAddress;


  async function getTimestamp() {
    return (await ethers.provider.getBlock("latest")).timestamp
  }

  async function deployPool() {
    // TODO:
    //    1. deployBalTWAMMPool takes funny token arguments (baseAssetContract and yieldAssetContract).
    //       These should be "token0Contract" and "token1Contract".
    //    2. What is the swap fee denoted in?  (i.e. is 0.05 meaning 5% or 0.05%?)
    //    3. What is the durationInSeconds and expiration all about?
    //
    ({ poolContract } = await deployBalancerPool(
      cronFiSigner,
      balancerVaultContract,
      token0AssetContract,
      token1AssetContract,
      {
        swapFee: "0.05",
        durationInSeconds: SECONDS_IN_YEAR,
        expiration: expirationTime
      }
    ));
  }

  async function resetPool() {
    await deployPool()
  }

  async function mint(
      token0Amt: string,
      token1Amt: string,
      sender: SignerWithAddress,
      fundSender = true
    )
  {
    const token0AmtScaled = ethers.utils.parseUnits(token0Amt, TOKEN0_DECIMALS);
    const token1AmtScaled = ethers.utils.parseUnits(token1Amt, TOKEN1_DECIMALS);

    if (fundSender) {
      await token0AssetContract.connect(tokenSigner).transfer(sender.address, token0AmtScaled);
      await token1AssetContract.connect(tokenSigner).transfer(sender.address, token1AmtScaled);
    }

    const poolId = await poolContract.getPoolId();
    const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
    const maxAmountsIn = (assets[0].toLowerCase() === token0AssetContract.address.toLowerCase()) ?
                         [token0AmtScaled, token1AmtScaled] :
                         [token1AmtScaled, token0AmtScaled];
    const amounts = maxAmountsIn.map((amt) => amt.toHexString());
    const userData: BytesLike = ethers.utils.defaultAbiCoder.encode(
      ["uint256[]"],
      [amounts]
    );
    const joinPoolRequest: IVault.JoinPoolRequestStruct = {
      assets,
      maxAmountsIn,
      userData,
      fromInternalBalance: false
    }

    await token0AssetContract.connect(sender).approve(balancerVaultContract.address, token0AmtScaled);
    await token1AssetContract.connect(sender).approve(balancerVaultContract.address, token1AmtScaled);
    await balancerVaultContract.connect(sender).joinPool(
      poolId,
      sender.address,     // Placeholder - not used.
      sender.address,     // Recipient of LP tokens
      joinPoolRequest
    )
  }

  // Prints balancers notion of the pool's token balances.
  // Will be incorrect if virtual orders ever issued in past.
  async function logPoolBalancesBalancer() 
  {
    const poolId = await poolContract.getPoolId();
    const { balances } = (await balancerVaultContract.getPoolTokens(poolId));
    console.log(` Pool Balances\n` +
                `   Token Idx 0: ${balances[0]}\n` +
                `   Token Idx 1: ${balances[1]}\n` )
  }

  async function logPoolBalances()
  {
    const poolId = await poolContract.getPoolId();
    await poolContract.executeVirtualOrders();
    const { balances } = (await balancerVaultContract.getPoolTokens(poolId));
    const { reserveToken0Balancer,
            reserveToken1Balancer,
            reserveToken0Twamm,
            reserveToken1Twamm } = await poolContract.getBalances();
    const diff0 = reserveToken0Balancer.sub(reserveToken0Twamm);
    const diff1 = reserveToken1Balancer.sub(reserveToken1Twamm);
    console.log(` Pool Balances\n` +
                `   Token Idx 0: ${balances[0]} (Actual Balancer)\n` +
                `   Token Idx 1: ${balances[1]} (Actual Balancer)\n` +
                `   Token Idx 0: ${reserveToken0Balancer} (TWAMM Balancer)\n` +
                `   Token Idx 1: ${reserveToken1Balancer} (TWAMM Balancer)\n` +
                `   Token Idx 0: ${reserveToken0Twamm} (TWAMM), diff=${diff0}\n` +
                `   Token Idx 1: ${reserveToken1Twamm} (TWAMM), diff=${diff1}\n` );
  }

  async function burn(
      minToken0Amt: string,
      minToken1Amt: string,
      lpTokenAmt: string,
      sender: SignerWithAddress,
    )
  {
    const lpTokenAmtScaled = ethers.utils.parseUnits(lpTokenAmt, 0);  // No scaling needed
    const lpTokenAmtScaledHexStr = lpTokenAmtScaled.toHexString();

    const poolId = await poolContract.getPoolId();
    const assets = (await balancerVaultContract.getPoolTokens(poolId)).tokens
    const minToken0LPAmt = ethers.utils.parseUnits(minToken0Amt, TOKEN0_DECIMALS);
    const minToken1LPAmt = ethers.utils.parseUnits(minToken1Amt, TOKEN1_DECIMALS);
    const minAmountsOut = [minToken0LPAmt, minToken1LPAmt];                         // Zero minimum out.
    const userData: BytesLike = ethers.utils.defaultAbiCoder.encode(["uint256"], [lpTokenAmtScaledHexStr]);
    const exitPoolRequest: IVault.ExitPoolRequestStruct = {
      assets,
      minAmountsOut,
      userData,
      toInternalBalance: false
    }
    await balancerVaultContract.connect(sender).exitPool(
      poolId,
      sender.address,
      sender.address,
      exitPoolRequest
    )
  }

  async function swap(
      token0Amt: string,
      token1Amt: string,
      sender: SignerWithAddress,
      limitOutAmt = 0,
      swapType = 0,
      argument = 0,
      deadlineSec = Math.round(Date.now() / 1000) + 60 * 60 * 24,   // Now + 1 day.
      fundSwapper = true
    )
  {
    if (token0Amt && token1Amt) {
      console.log(`ERROR in call to swap. Both token0Amt (${token0Amt}) and token1Amt (${token1Amt}) are defined. `+
                  `Only one can be defined, the other should be "". Skipping this swap.`);
      return;
    }
    if (!token0Amt && !token1Amt) {
      console.log(`ERROR in swap call. token0Amt (${token0Amt}) OR token1Amt (${token1Amt}) must be defined. `+
                  `Only one can be defined, the other should be "". Skipping this swap.`);
      return;
    }
    const tokenInContract = (token0Amt) ? token0AssetContract : token1AssetContract;
    const tokenOutContract = (token0Amt) ? token1AssetContract : token0AssetContract;
    const tokenInAmtStr = (token0Amt) ? token0Amt : token1Amt;
    const tokenDecimals = (token0Amt) ? TOKEN0_DECIMALS : TOKEN1_DECIMALS;
    
    let tokenInAmt = ethers.utils.parseUnits(tokenInAmtStr, tokenDecimals);
    if (swapType === 2 || swapType === 3) {
      // Minimize the amount to prevent BAL#510
      tokenInAmt = BigNumber.from(1)
    }
    if (fundSwapper) {
      await tokenInContract.connect(tokenSigner).transfer(sender.address, tokenInAmt);
    }
    
    const poolId = await poolContract.getPoolId();
    const userData = ethers.utils.defaultAbiCoder.encode(
      ["uint256",   // swap type:
                    //    0 -> regular swap
                    //    1 -> long-term swap
                    //    2 -> long-term swap withdraw
                    //    3 -> long-term swap cancel
       "uint256"    // argument (depends on swap type value)
                    //    swap type = 0   -> unused, value ignored
                    //    swap type = 1   -> intervals:   0 < value < MAX_INTERVAL   (TODO: define MAX_INTERVAL)
                    //    swap type = 2-3 -> order id:    0 <= value <= MAX_ORDER_ID (TODO: define MAX_ORDER_ID)
      ], [
        swapType,
        argument
      ]);

    const singleSwap: IVault.SingleSwapStruct = {
      poolId,
      kind: SwapKind.GIVEN_IN,
      assetIn: tokenInContract.address,
      assetOut: tokenOutContract.address,
      amount: tokenInAmt,
      userData
    };
    const funds: IVault.FundManagementStruct = {
      sender: sender.address,
      fromInternalBalance: false,
      recipient: sender.address,
      toInternalBalance: false
    }

    await tokenInContract.connect(sender).approve(balancerVaultContract.address, tokenInAmt);
    await balancerVaultContract.connect(sender).swap(
      singleSwap,
      funds,
      limitOutAmt,
      deadlineSec 
    )
  }


  before(async function () 
  {
    if (!enabledAutomining) {
      // Configure automining for this test (it's defaulted to off in this project):
      //  Note: we set the mempool order to fifo in hh config.
      console.log('Enabling auto mining ...')
      await network.provider.send("evm_setAutomine", [true]);
      await network.provider.send("evm_setIntervalMining", [1000]);
      console.log('  ... Done!')

      enabledAutomining = true
    }

    console.log('Balancer TWAMM test before function')
    await createSnapshot(provider);
    fixture = await loadEthPoolMainnetFixture();
    const wethAddress = fixture.weth.address;

    startTimestamp = await getTimestamp();
    expirationTime = startTimestamp + SECONDS_IN_YEAR;

    accounts = await ethers.getSigners();
    [balancerSigner, cronFiSigner, tokenSigner, poolLP, poolSwapper, poolLTSwapper] = accounts;

    const ERC20Deployer = new TestERC20__factory(tokenSigner);
    token0AssetContract = await ERC20Deployer.deploy("Token 0", "TOKEN0", TOKEN0_DECIMALS);
    let cp = 0
    console.log('before function cp', ++cp)
    const token0Supply = ethers.utils.parseUnits("1000000000", TOKEN0_DECIMALS);
    console.log('before function cp', ++cp)
    await token0AssetContract.connect(tokenSigner).mint(tokenSigner.address, token0Supply);
    console.log('before function cp', ++cp)
    token1AssetContract = await ERC20Deployer.deploy("Token 1", "TOKEN1", TOKEN1_DECIMALS);
    console.log('before function cp', ++cp)
    const token1Supply = ethers.utils.parseUnits("1000000000", TOKEN1_DECIMALS);
    await token1AssetContract.connect(tokenSigner).mint(tokenSigner.address, token1Supply);
    console.log('before function cp', ++cp)

    balancerVaultContract = await deployBalancerVault(balancerSigner, wethAddress);
    cronFiAddress = cronFiSigner.address;
    await balancerVaultContract.setRelayerApproval(
      balancerSigner.address,
      cronFiAddress,
      true // approved
    );
    console.log('before function cp', ++cp)
    
    await deployPool();
    console.log('Balancer TWAMM test before function done')
  })

  after(function () {
    restoreSnapshot(provider);
  })

  it("Should operate as a CPAMM is expected to for sequence of mint, swap, burn", async function () {
    console.log('1. Mint an initial supply of 2M token0 : 1M token1 in the pool:\n' +
                '-------------------------------------------------------------------------------------------');
    let beforeLP = await poolContract.balanceOf(poolLP.address);
    await mint("2000000", "1000000", poolLP);
    await logPoolBalances();
    let afterLP = await poolContract.balanceOf(poolLP.address);
    console.log(` LP balance\n` +
                `   before = ${beforeLP}\n` +
                `   after  = ${afterLP}\n` +
                `   change = ${afterLP.sub(beforeLP)}\n`)

    let argument = 10;  // Intervals
    console.log(`1.5 LT Swap 100000 token0 over ${argument} intervals for token 1:\n` + 
                '-------------------------------------------------------------------------------------------');
    let swapType = 1;   // LT Swap
    const limitOutAmt = 0;
    await swap("100000", "", poolSwapper, limitOutAmt, swapType, argument);
    const blocks = (argument + 1) * 10;    // TWAMM does intervals + 1 blocks, OBI default = 10
    const cancelAfterblocks = blocks / 2
    let cancelled = false;
    for (let block = 0; block <= blocks; block++) {
      console.log(`After ${block+1} blocks:`)
      await logPoolBalances();

      if (!cancelled && block > cancelAfterblocks && cancelAfterblocks > 0) {
        console.log(`1.5 Canceling LT Swap 100000 token0 over ${argument} \n` +
                    `intervals for token 1 after ${cancelAfterblocks} blocks:\n` + 
                    '-------------------------------------------------------------------------------------------');

        console.log(`  LT Cancel Part 1 / 2:\n` +
                    `- - - - - - - - - - - - - - - - - - - - `)
        swapType = 3;   // LT Swap Cancel 
        argument = 0;   // orderId  (Assumed from console.log--need to improve this <-- TODO)
                        // POOP <-- orderID + 1 is what's returned/output
        // Swap is structured the same as earlier order but reversed input token as we're returning
        // the unsold amount (Balancer requires 1e-18 minimum so we put that in to get our original
        // unsold input amount back).
        // transaction:
        await swap("", "1", poolSwapper, limitOutAmt, swapType, argument);
        await logPoolBalances();

        console.log(`  LT Cancel Part 2 / 2:\n` +
                    `- - - - - - - - - - - - - - - - - - - - `)
        swapType = 4;   // LT Swap Cancel Get Purchased
        argument = 0;   // orderId  (Assumed from console.log--need to improve this <-- TODO)
                        // POOP <-- orderID + 1 is what's returned/output
        // Swap is structured the same as earlier order with same order input token as we're returning
        // the purchased amount (Balancer requires 1e-18 minimum so we put that in to get purchased
        // tokens back). 
        // transaction:
        await swap("1", "", poolSwapper, limitOutAmt, swapType, argument);
        await logPoolBalances();
        
        cancelled = true;
      }

      if (block > cancelAfterblocks + 2) {
        // Exit the loop after 2 blocks after cancel
        break
      }
    }

    console.log('2. Swap 10000 token0 for token 1:\n' +
                '-------------------------------------------------------------------------------------------');
    await swap("10000", "", poolSwapper);
    await logPoolBalances();

    if (cancelAfterblocks === 0) {
      console.log(`2.5 Withdraw the earlier LT Swap of 100000 token0 over ${argument} intervals for token 1:\n` +
                  '-------------------------------------------------------------------------------------------');
      swapType = 2;   // LT Swap Withdraw
      argument = 0;   // orderId  (Assumed from console.log--need to improve this <-- TODO)
                      // POOP <-- orderID + 1 is what's returned/output
      // Swap is structured the same as earlier order as we're just completeing the second half of the split 
      // transaction:
      await swap("1", "", poolSwapper, limitOutAmt, swapType, argument);
      await logPoolBalances();
    }

    console.log('3. Mint more LP tokens - 200K token0 : 100k token1:\n' +
                '-------------------------------------------------------------------------------------------');
    beforeLP = await poolContract.balanceOf(poolLP.address);
    await mint("200000", "100000", poolLP);
    await logPoolBalances();
    afterLP = await poolContract.balanceOf(poolLP.address);
    console.log(` LP balance\n` +
                `   before = ${beforeLP}\n` +
                `   after  = ${afterLP}\n` +
                `   change = ${afterLP.sub(beforeLP)}\n`)
    const burnAmt = afterLP.sub(beforeLP);

    console.log('4. Swap 5000 token 1 for token 0:\n' +
                '-------------------------------------------------------------------------------------------');
    await swap("", "5000", poolSwapper);
    await logPoolBalances();

    console.log('5. Swap 1000 token 0 for token 1:\n' +
                '-------------------------------------------------------------------------------------------');
    await swap("1000", "", poolSwapper);
    await logPoolBalances();

    console.log('6. Burn some LP tokens:\n' +
                '-------------------------------------------------------------------------------------------');
    let beforeT0 = await token0AssetContract.balanceOf(poolLP.address);
    let beforeT1 = await token1AssetContract.balanceOf(poolLP.address);
    beforeLP = await poolContract.balanceOf(poolLP.address);
    // await burn("200000", "100000", `${burnAmt}`, poolLP);
    await burn("0", "0", `${burnAmt}`, poolLP);
    await logPoolBalances();
    let afterT0 = await token0AssetContract.balanceOf(poolLP.address);
    let afterT1 = await token1AssetContract.balanceOf(poolLP.address);
    afterLP = await poolContract.balanceOf(poolLP.address);
    console.log(` LP balance\n` +
                `   before = ${beforeLP}\n` +
                `   after  = ${afterLP}\n` +
                `   change = ${afterLP.sub(beforeLP)}\n` +
                ` T0 balance\n` +
                `   before = ${beforeT0}\n` +
                `   after  = ${afterT0}\n` +
                `   change = ${afterT0.sub(beforeT0)}\n` +
                ` T1 balance\n` +
                `   before = ${beforeT1}\n` +
                `   after  = ${afterT1}\n` +
                `   change = ${afterT1.sub(beforeT1)}\n`)
  })
})