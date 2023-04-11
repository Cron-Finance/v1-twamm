const fs = require("fs");

const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { deepCopy } = require("./../scripts/utils/misc");

const twamm_contract = 'TWAMM'

async function delayBlocks(numblocks) {
  await new Promise(async (resolve) => {
    console.log(`waiting for approximately ${numblocks} blocks`);
    let latestBlock = await web3.eth.getBlock("latest");
    let checkBlock = latestBlock.number;
    while (latestBlock.number < checkBlock + numblocks) {
      latestBlock = await web3.eth.getBlock("latest");
    }
    resolve();
  });
}

const processTxn = async (txn) => {
  const receipt = await web3.eth.getTransactionReceipt(txn.hash);
  const txnCopy = deepCopy(txn);
  for (const field of [
    "type",
    "accessList",
    "maxPriorityFeePerGas",
    "maxFeePerGas",
    "gasLimit",
    "creates",
    "chainId",
  ]) {
    delete txnCopy[field];
  }
  for (const field of ["cumulativeGasUsed", "gasUsed", "effectiveGasPrice"]) {
    txnCopy[field] = receipt[field];
  }
  return txnCopy;
};

// Must be a local VM test!
// TODO: PB how to ensure this?

const arb_ts_data = [];

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
    await network.provider.send("evm_setAutomine", [true]);
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    const ERC20Factory = await ethers.getContractFactory("ERC20Mock");
    tokenA = await ERC20Factory.deploy("TokenA", "TokenA", ERC20Supply);
    tokenB = await ERC20Factory.deploy("TokenB", "TokenB", ERC20Supply);

    const TWAMMFactory = await ethers.getContractFactory(twamm_contract);

    twamm = await TWAMMFactory.deploy(
      twamm_contract,
      twamm_contract,
      tokenA.address,
      tokenB.address,
      blockInterval
    );

    await tokenA.approve(twamm.address, ERC20Supply);
    await tokenB.approve(twamm.address, ERC20Supply);

    await twamm.provideInitialLiquidity(
      initialLiquidityProvided,
      initialLiquidityProvided
    );
  });

  describe("Simple Arb Tests", function () {
    describe("Unidirectional Trade", function () {
      it("Arb stabilizes the transaction", async function () {
        this.timeout(60000 /* ms */);

        const amount = 100000000;
        const amountIn = ethers.BigNumber.from(amount);
        await tokenA.transfer(addr1.address, amountIn);

        // Fill the arbitrageur's wallet w/ token B for arbing and approve twamm:
        const arber = addr2;
        await tokenB.transfer(arber.address, amountIn);

        // Collect reserve / swap stats:
        let updateTx = await twamm.executeAllVirtualOrders();
        console.log(
          `Txn Stats:\n${JSON.stringify(await processTxn(updateTx), null, 2)}`
        );
        let resTokenA = await twamm.tokenAReserves();
        let resTokenB = await twamm.tokenBReserves();
        let arbAmount = 0;

        //trigger long term order
        await tokenA.connect(addr1).approve(twamm.address, amountIn);

        //trigger long term orders
        const numberOfBlockIntervals = 10;
        const ltSwapTx = await twamm
          .connect(addr1)
          .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);

        // This may break other tests, we may need a way to capture and restore
        // previous values:
        await network.provider.send("evm_setAutomine", [false]);
        await network.provider.send("evm_setIntervalMining", [0]);

        //arbitrage:
        //  - examine the price of tokenB / tokenA every block
        //  - if the price of tokenB / tokenA exceeds arbThresh, then perform an arb
        //
        const totalBlocksToMine =
          numberOfBlockIntervals * blockInterval +
          2 * blockInterval; /* safety */

        let blockNumber = await getBlockNumber();

        for (
          let blockOffset = 0;
          blockOffset < totalBlocksToMine;
          blockOffset++
        ) {
          arb_ts_data.push({
            block: blockNumber,
            reserveA: resTokenA,
            reserveB: resTokenB,
            arbAmount,
          });

          const priceThresholdTokenB = 0.98;
          const priceTokenB = resTokenB / resTokenA;
          // console.log(`price tokenB (per tokenA) = ${priceTokenB}`);
          if (priceTokenB < priceThresholdTokenB) {
            arbAmount = Math.floor(
              Math.abs(resTokenA - initialLiquidityProvided)
            );
            const arbAmountIn = ethers.BigNumber.from(arbAmount);
            const approveTx = await tokenB
              .connect(arber)
              .approve(twamm.address, arbAmountIn);
            const arbTx = await twamm.connect(arber).swapFromBToA(arbAmountIn);

            // console.log(
            //   `Arb executed:\n\n${JSON.stringify(arbTx, null, 2)}\n\n`
            // );
          } else {
            // TODO: need analytical way to determine this offline so we don't have to call update
            //       to block.
            updateTx = await twamm.executeAllVirtualOrders();
            arbAmount = 0;
          }

          await mineBlock();
          resTokenA = await twamm.tokenAReserves();
          resTokenB = await twamm.tokenBReserves();

          blockNumber = await getBlockNumber();
        }

        // Restore previous values
        await network.provider.send("evm_setAutomine", [true]);
        await network.provider.send("evm_setIntervalMining", [1000]);

        //withdraw proceeds
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);

        // To CSV
        console.log("Writing csv ...");
        const header = Object.keys(arb_ts_data[0]).join(", ");
        const data = arb_ts_data.map((arb_data) => {
          return Object.values(arb_data).join(", ");
        });
        const csvData = [header, ...data].join("\n");
        fs.writeFileSync("arb_ts_data.csv", csvData);
        console.log("done");

        //calculate constant product expectation (a * b = k):
        //
        const k = initialLiquidityProvided * initialLiquidityProvided;
        const ammAmountTokenB = k / (initialLiquidityProvided + amount);
        const userAmountTokenB =
          0.997 * (initialLiquidityProvided - ammAmountTokenB);

        const amountBought = await tokenB.balanceOf(addr1.address);
        console.log(
          `addr1 (${addr1.address}):\n` +
            `  expect ${userAmountTokenB} of tokenB according to const. prod.\n` +
            `  bought ${amountBought} of tokenB with ${amountIn} of tokenA\n` +
            `  if A == B, addr1 lost ${amountIn - amountBought} (${
              (100 * (amountIn - amountBought)) / amountIn
            }) %\n` +
            `  cp error = ${
              (100 * (userAmountTokenB - amountBought)) / userAmountTokenB
            }%`
        );
      });
    });
  });
});

async function mineBlocks(numBlocks) {
  for (let i = 0; i < numBlocks - 1; i++) {
    await network.provider.send("evm_mine");
  }
}

async function mineBlock() {
  await network.provider.send("evm_mine");
}

async function getBlockNumber() {
  return Number(await network.provider.send("eth_blockNumber"));
}
