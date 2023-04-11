const { expect } = require("chai");
const { ethers } = require("hardhat");

async function delayBlocks(numblocks) {
  await new Promise(async (resolve) => {
    console.log(`waiting for approximately ${numblocks} blocks`);
    let latestBlock = await web3.eth.getBlock('latest')
    let checkBlock = latestBlock.number
    while (latestBlock.number < checkBlock + numblocks) {
      latestBlock = await web3.eth.getBlock('latest')
    }
    resolve()
  })
}

const LOCAL_VM_TEST = true
const twamm_contract = 'TWAMM'

describe("TWAMM", function () {

  let tokenA;
  let tokenB;

  let twamm;

  let owner;
  let addr1;
  let addr2;
  let addrs;

  const blockInterval = 10;

  const initialLiquidityProvided = 1000000000;
  const ERC20Supply = ethers.utils.parseUnits("100");

  beforeEach(async function () {

    if (LOCAL_VM_TEST) {
      await network.provider.send("evm_setAutomine", [true]);
    }
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    const ERC20Factory = await ethers.getContractFactory("ERC20Mock");
    tokenA = await ERC20Factory.deploy("TokenA", "TokenA", ERC20Supply);
    tokenB = await ERC20Factory.deploy("TokenB", "TokenB", ERC20Supply);

    const TWAMMFactory = await ethers.getContractFactory(twamm_contract)

    twamm = await TWAMMFactory.deploy(
      twamm_contract
      , twamm_contract
      , tokenA.address
      , tokenB.address
      , blockInterval);

    await tokenA.approve(twamm.address, ERC20Supply);
    await tokenB.approve(twamm.address, ERC20Supply);

    await twamm.provideInitialLiquidity(initialLiquidityProvided, initialLiquidityProvided);
  });

  describe("Simple Long Term Order Functionality", function () {

    describe("Unidirectional Trade", function () {

      it("Trades in one direction only", async function () {
        // Interesting:
        // Given a pool with 1B of token A & token B, trade different amounts of token A
        // for 10 block intervals of 10 blocks. Remove the proceeds after 200 blocks.
        //
        // The results are interesting and likely show how the fixed-precision effects
        // and slippage effects work to create a sweet spot for a uni-directional trade.
        //
        // If 100 of token A is traded, we get an error:
        // 'sales rate amount must be positive'
        //
        // For other values, we get the following results:
        //
        // Token A   |   Loss (%)
        // ========================
        // 100       |   N/A - Err
        // 1000      |   10.6
        // 10000     |   0.43
        // 100K      |   0.327
        // 1M        |   0.4102
        // 10M       |   1.2881
        // 100M      |   9.363644
        //
        // Now if we change the trade to 100 block intervals of 10 blocks, and remove
        // the proceeds after 2000 blocks, we get the following results:
        //
        // Token A   |   Loss (%)
        // ========================
        // 100       |   N/A - Err
        // 1000      |   N/A - Err
        // 10000     |   11.2
        // 100K      |   1.3
        // 1M        |   0.405
        // 10M       |   1.28774

        const amount = 1000
        const amountIn = ethers.BigNumber.from(amount);
        await tokenA.transfer(addr1.address, amountIn);

        //trigger long term order
        await tokenA.connect(addr1).approve(twamm.address, amountIn);

        //trigger long term orders
        const numberOfBlockIntervals = 10
        await twamm.connect(addr1).longTermSwapFromAToB(amountIn, numberOfBlockIntervals);

        //move blocks forward, and execute virtual orders
        const blocksToMine = 2 * numberOfBlockIntervals * blockInterval   // blocks
        if (LOCAL_VM_TEST) {
          await mineBlocks(blocksToMine)
        }
        else {
          await delayBlocks(blocksToMine)
        }

        //withdraw proceeds 
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);

        //calculate constant product expectation (a * b = k):
        //  
        const k = initialLiquidityProvided * initialLiquidityProvided
        const ammAmountTokenB = k / (initialLiquidityProvided + amount)
        const userAmountTokenB = 0.997 * (initialLiquidityProvided - ammAmountTokenB)

        const amountBought = await tokenB.balanceOf(addr1.address);
        console.log(`addr1 (${addr1.address}):\n` +
          `  expect ${userAmountTokenB} of tokenB according to const. prod.\n` +
          `  bought ${amountBought} of tokenB with ${amountIn} of tokenA\n` +
          `  if A == B, addr1 lost ${amountIn - amountBought} (${(100 * (amountIn - amountBought)) / amountIn}) %\n` +
          `  cp error = ${100 * (userAmountTokenB - amountBought) / userAmountTokenB}%`)
      });
    });
  });
});

async function mineBlocks(blockNumber) {
  for (let i = 0; i < blockNumber; i++) {
    await network.provider.send("evm_mine")
  }
}
