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

  const initialLiquidityProvided = 100000000;
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

  describe("ExecuteVirtualOrders Functionality ", function () {

    describe("Current block test", function () {

      it("Orders in both pools work as expected", async function () {

        const amountIn = ethers.BigNumber.from(10000);
        await tokenA.transfer(addr1.address, amountIn);
        await tokenB.transfer(addr2.address, amountIn);

        //trigger long term order
        await tokenA.connect(addr1).approve(twamm.address, amountIn);
        await tokenB.connect(addr2).approve(twamm.address, amountIn);

        //trigger long term orders
        await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 10);
        await twamm.connect(addr2).longTermSwapFromBToA(amountIn, 10);

        console.log("$$$$$$$$$$$$$$$$$CHECKPOINT 0: BALANCE CHECK")
        // console.log("what block", block.number)

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(5 * blockInterval)
        }
        else {
          await delayBlocks(5 * blockInterval)
        }
        const tx1 = await twamm.executeAllVirtualOrders();

        console.log("$$$$$$$$$$$$$$$$$CHECKPOINT 1: BALANCE CHECK", tx1.blockNumber)

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(5 * blockInterval)
        }
        else {
          await delayBlocks(5 * blockInterval)
        }
        // await twamm.executeAllVirtualOrders();
        const tx2 = await twamm.executeVirtualOrdersToBlock(tx1.blockNumber + 15);
        console.log("$$$$$$$$$$$$$$$$$CHECKPOINT 2: BALANCE CHECK", tx2.blockNumber)

        //withdraw proceeds 
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
        await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);

        console.log("$$$$$$$$$$$$$$$$$CHECKPOINT 3: WITHDRAW PROCEEDS")

        const amountABought = await tokenA.balanceOf(addr2.address);
        const amountBBought = await tokenB.balanceOf(addr1.address);

        //pool is balanced, and both orders execute same amount in opposite directions,
        //so we expect final balances to be roughly equal
        expect(amountABought).to.be.closeTo(amountBBought, amountIn / 100)
      });

      // it("Multiple orders in both pools work as expected", async function () {

      //     const amountIn = 10000;
      //     await tokenA.transfer(addr1.address, amountIn);
      //     await tokenB.transfer(addr2.address, amountIn);

      //     //trigger long term order
      //     await tokenA.connect(addr1).approve(twamm.address, amountIn);
      //     await tokenB.connect(addr2).approve(twamm.address, amountIn);

      //     //trigger long term orders
      //     await twamm.connect(addr1).longTermSwapFromAToB(amountIn / 2, 10);
      //     await twamm.connect(addr2).longTermSwapFromBToA(amountIn / 2, 10);
      //     await twamm.connect(addr1).longTermSwapFromAToB(amountIn / 2, 10);
      //     await twamm.connect(addr2).longTermSwapFromBToA(amountIn / 2, 10);

      //     //move blocks forward, and execute virtual orders
      //     if (LOCAL_VM_TEST) {
      //         await mineBlocks(5 * blockInterval)
      //     }
      //     else {
      //         await delayBlocks(5 * blockInterval)
      //     }
      //     await twamm.executeAllVirtualOrders();

      //     //move blocks forward, and execute virtual orders
      //     if (LOCAL_VM_TEST) {
      //         await mineBlocks(5 * blockInterval)
      //     }
      //     else {
      //         await delayBlocks(5 * blockInterval)
      //     }
      //     await twamm.executeAllVirtualOrders();

      //     //withdraw proceeds 
      //     await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
      //     await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);
      //     await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(2);
      //     await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(3);

      //     const amountABought = await tokenA.balanceOf(addr2.address);
      //     const amountBBought = await tokenB.balanceOf(addr1.address);

      //     //pool is balanced, and orders execute same amount in opposite directions,
      //     //so we expect final balances to be roughly equal
      //     expect(amountABought).to.be.closeTo(amountBBought, amountIn / 80)
      // });
    });

    // describe("iterative update test", function () {

    //     it("Orders in both pools work as expected", async function () {

    //         const amountIn = ethers.BigNumber.from(10000);
    //         await tokenA.transfer(addr1.address, amountIn);
    //         await tokenB.transfer(addr2.address, amountIn);

    //         //trigger long term order
    //         await tokenA.connect(addr1).approve(twamm.address, amountIn);
    //         await tokenB.connect(addr2).approve(twamm.address, amountIn);

    //         //trigger long term orders
    //         await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 10);
    //         await twamm.connect(addr2).longTermSwapFromBToA(amountIn, 10);

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //withdraw proceeds 
    //         await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
    //         await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);

    //         const amountABought = await tokenA.balanceOf(addr2.address);
    //         const amountBBought = await tokenB.balanceOf(addr1.address);

    //         //pool is balanced, and both orders execute same amount in opposite directions,
    //         //so we expect final balances to be roughly equal
    //         expect(amountABought).to.be.closeTo(amountBBought, amountIn / 100)
    //     });

    //     it("Multiple orders in both pools work as expected", async function () {

    //         const amountIn = 10000;
    //         await tokenA.transfer(addr1.address, amountIn);
    //         await tokenB.transfer(addr2.address, amountIn);

    //         //trigger long term order
    //         await tokenA.connect(addr1).approve(twamm.address, amountIn);
    //         await tokenB.connect(addr2).approve(twamm.address, amountIn);

    //         //trigger long term orders
    //         await twamm.connect(addr1).longTermSwapFromAToB(amountIn / 2, 10);
    //         await twamm.connect(addr2).longTermSwapFromBToA(amountIn / 2, 10);
    //         await twamm.connect(addr1).longTermSwapFromAToB(amountIn / 2, 10);
    //         await twamm.connect(addr2).longTermSwapFromBToA(amountIn / 2, 10);

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(2 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(2 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         //withdraw proceeds 
    //         await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
    //         await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);
    //         await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(2);
    //         await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(3);

    //         const amountABought = await tokenA.balanceOf(addr2.address);
    //         const amountBBought = await tokenB.balanceOf(addr1.address);

    //         //pool is balanced, and orders execute same amount in opposite directions,
    //         //so we expect final balances to be roughly equal
    //         expect(amountABought).to.be.closeTo(amountBBought, amountIn / 100)
    //     });

    // });

    // describe("bad value time travel to the past test", function () {

    //     it("proceeds can be withdrawn while order is still active", async function () {

    //         const amountIn = 100000;
    //         await tokenA.transfer(addr1.address, amountIn);
    //         await tokenA.connect(addr1).approve(twamm.address, amountIn);

    //         await tokenB.transfer(addr2.address, amountIn);
    //         await tokenB.connect(addr2).approve(twamm.address, amountIn);

    //         //trigger long term order
    //         await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 10);

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(3 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(3 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         const beforeBalanceA = await tokenA.balanceOf(addr2.address);
    //         const beforeBalanceB = await tokenB.balanceOf(addr2.address);
    //         await twamm.connect(addr2).swapFromBToA(amountIn);
    //         const afterBalanceA = await tokenA.balanceOf(addr2.address);
    //         const afterBalanceB = await tokenB.balanceOf(addr2.address);

    //         //expect swap to work as expected
    //         expect(beforeBalanceA).to.be.lt(afterBalanceA);
    //         expect(beforeBalanceB).to.be.gt(afterBalanceB);
    //     });

    // });

    // describe("bad value time travel to the future test", function () {

    //     it("proceeds can be withdrawn while order is still active", async function () {

    //         const amountIn = 100000;
    //         await tokenA.transfer(addr1.address, amountIn);
    //         await tokenA.connect(addr1).approve(twamm.address, amountIn);

    //         await tokenB.transfer(addr2.address, amountIn);
    //         await tokenB.connect(addr2).approve(twamm.address, amountIn);

    //         //trigger long term order
    //         await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 10);

    //         //move blocks forward, and execute virtual orders
    //         if (LOCAL_VM_TEST) {
    //             await mineBlocks(20 * blockInterval)
    //         }
    //         else {
    //             await delayBlocks(20 * blockInterval)
    //         }
    //         await twamm.executeAllVirtualOrders();

    //         const beforeBalanceA = await tokenA.balanceOf(addr2.address);
    //         const beforeBalanceB = await tokenB.balanceOf(addr2.address);
    //         await twamm.connect(addr2).swapFromBToA(amountIn);
    //         const afterBalanceA = await tokenA.balanceOf(addr2.address);
    //         const afterBalanceB = await tokenB.balanceOf(addr2.address);

    //         //expect swap to work as expected
    //         expect(beforeBalanceA).to.be.lt(afterBalanceA);
    //         expect(beforeBalanceB).to.be.gt(afterBalanceB);
    //     });

    // });


  });
});

async function mineBlocks(blockNumber) {
  for (let i = 0; i < blockNumber; i++) {
    await network.provider.send("evm_mine")
  }
}
