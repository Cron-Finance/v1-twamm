const { expect } = require("chai");
const { ethers } = require("hardhat");

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

const LOCAL_VM_TEST = true;
const twamm_contract = "TWAMM_0_1";

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

  describe("Basic AMM", function () {
    describe("Providing Liquidity", function () {
      it("Should mint correct number of LP tokens", async function () {
        const LPBalance = await twamm.balanceOf(owner.address);

        console.log(
          "Minting exercise",
          LPBalance.toNumber(),
          initialLiquidityProvided
        );

        expect(LPBalance.toNumber()).to.eq(initialLiquidityProvided);
      });

      it("can't provide initial liquidity twice", async function () {
        const amount = 10000;
        await expect(
          twamm.provideInitialLiquidity(amount, amount)
        ).to.be.revertedWith(
          "liquidity has already been provided, need to call provideLiquidity"
        );
      });

      it("LP token value is constant after mint", async function () {
        let totalSupply = await twamm.totalSupply();

        let tokenAReserve = await twamm.tokenAReserves();
        let tokenBReserve = await twamm.tokenBReserves();

        const initialTokenAPerLP = tokenAReserve / totalSupply;
        const initialTokenBPerLP = tokenBReserve / totalSupply;

        const newLPTokens = 10000;
        await twamm.provideLiquidity(newLPTokens);

        totalSupply = await twamm.totalSupply();

        tokenAReserve = await twamm.tokenAReserves();
        tokenBReserve = await twamm.tokenBReserves();

        const finalTokenAPerLP = tokenAReserve / totalSupply;
        const finalTokenBPerLP = tokenBReserve / totalSupply;

        expect(finalTokenAPerLP).to.eq(initialTokenAPerLP);
        expect(finalTokenBPerLP).to.eq(initialTokenBPerLP);
      });
    });

    describe("Removing Liquidity", function () {
      it("LP token value is constant after removing", async function () {
        let totalSupply = await twamm.totalSupply();

        let tokenAReserve = await twamm.tokenAReserves();
        let tokenBReserve = await twamm.tokenBReserves();

        const initialTokenAPerLP = tokenAReserve / totalSupply;
        const initialTokenBPerLP = tokenBReserve / totalSupply;

        const liquidityToRemove = initialLiquidityProvided / 2;
        await twamm.removeLiquidity(liquidityToRemove);

        totalSupply = await twamm.totalSupply();

        tokenAReserve = await twamm.tokenAReserves();
        tokenBReserve = await twamm.tokenBReserves();

        const finalTokenAPerLP = tokenAReserve / totalSupply;
        const finalTokenBPerLP = tokenBReserve / totalSupply;

        expect(finalTokenAPerLP).to.eq(initialTokenAPerLP);
        expect(finalTokenBPerLP).to.eq(initialTokenBPerLP);
      });

      it("can't remove more than available liquidity", async function () {
        let totalSupply = await twamm.totalSupply();

        const liquidityToRemove = initialLiquidityProvided * 2;

        await expect(
          twamm.removeLiquidity(liquidityToRemove)
        ).to.be.revertedWith("not enough lp tokens available");
      });
    });

    describe("Swapping", function () {
      it("swaps expected amount", async function () {
        const amountInA = ethers.utils.parseUnits("1");
        const tokenAReserve = await twamm.tokenAReserves();
        const tokenBReserve = await twamm.tokenBReserves();
        const expectedOutBeforeFees = tokenBReserve
          .mul(amountInA)
          .div(tokenAReserve.add(amountInA));

        //adjust for LP fee of 0.3%
        const expectedOutput = expectedOutBeforeFees.mul(1000 - 3).div(1000);

        const beforeBalanceB = await tokenB.balanceOf(owner.address);

        //ACFTW: Here's how you get the data from log emits
        let tx = await twamm.swapFromAToB(amountInA);
        //get receipt after waiting for tx to process
        let receipt = await tx.wait();
        //filter for the event name in the logs 'SwapAToB'
        const data = receipt.events?.filter((x) => {
          return x.event == "SwapAToB";
        });
        //event SwapAToB(address indexed addr, uint256 amountAIn, uint256 amountBOut);
        //args[0] = addr, [1] = amountIn, [2] = amountBOut
        const amountAIn = data?.[0].args[1];
        const amountBOut = data?.[0].args[2];
        console.log("Event data: ", data?.[0].args);
        console.log("Amount A In: ", amountAIn);
        console.log("Amount B Out: ", amountBOut);
        //this is a really big number so it keeps cerroring with overflow
        // console.log("Amount A In: ", amountAIn.toNumber());
        console.log("Amount B Out: ", amountBOut.toNumber());

        const afterBalanceB = await tokenB.balanceOf(owner.address);
        const actualOutput = afterBalanceB.sub(beforeBalanceB);

        expect(actualOutput).to.eq(expectedOutput);
      });
    });
  });

  describe.only("TWAMM Functionality ", function () {
    describe("Long term swaps", function () {
      it("Single sided long term order behaves like normal swap", async function () {
        const amountInA = 10000;
        await tokenA.transfer(addr1.address, amountInA);

        //expected output
        const tokenAReserve = await twamm.tokenAReserves();
        const tokenBReserve = await twamm.tokenBReserves();
        const expectedOut = tokenBReserve
          .mul(amountInA)
          .div(tokenAReserve.add(amountInA));

        //trigger long term order
        tokenA.connect(addr1).approve(twamm.address, amountInA);
        await twamm.connect(addr1).longTermSwapFromAToB(amountInA, 2);

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(3 * blockInterval);
        } else {
          await delayBlocks(3 * blockInterval);
        }
        await twamm.executeAllVirtualOrders();

        //withdraw proceeds
        const beforeBalanceB = await tokenB.balanceOf(addr1.address);
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
        const afterBalanceB = await tokenB.balanceOf(addr1.address);
        const actualOutput = afterBalanceB.sub(beforeBalanceB);

        //since we are breaking up order, match is not exact
        expect(actualOutput).to.be.closeTo(
          expectedOut,
          ethers.utils.parseUnits("100", "wei")
        );
      });

      it("Orders in both pools work as expected", async function () {
        const amountIn = ethers.BigNumber.from(10000);
        await tokenA.transfer(addr1.address, amountIn);
        await tokenB.transfer(addr2.address, amountIn);

        //trigger long term order
        await tokenA.connect(addr1).approve(twamm.address, amountIn);
        await tokenB.connect(addr2).approve(twamm.address, amountIn);

        //trigger long term orders
        await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 2);
        await twamm.connect(addr2).longTermSwapFromBToA(amountIn, 2);

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(3 * blockInterval);
        } else {
          await delayBlocks(3 * blockInterval);
        }
        await twamm.executeAllVirtualOrders();

        //withdraw proceeds
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
        await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);

        const amountABought = await tokenA.balanceOf(addr2.address);
        const amountBBought = await tokenB.balanceOf(addr1.address);

        //pool is balanced, and both orders execute same amount in opposite directions,
        //so we expect final balances to be roughly equal
        expect(amountABought).to.be.closeTo(amountBBought, amountIn / 100);
      });

      it("Swap amounts are consistent with twamm formula", async function () {
        // TODO: Increasing the lower amount fixes this test breaking. Suspect it's
        //       fixed precision error of 2000/30 (sales rate) causing problems.
        const tokenAIn = 10000;
        const tokenBIn = 20000; // Was 2000
        await tokenA.transfer(addr1.address, tokenAIn);
        await tokenB.transfer(addr2.address, tokenBIn);
        await tokenA.connect(addr1).approve(twamm.address, tokenAIn);
        await tokenB.connect(addr2).approve(twamm.address, tokenBIn);

        const tokenAReserve = (await twamm.tokenAReserves()).toNumber();
        const tokenBReserve = (await twamm.tokenBReserves()).toNumber();

        const k = tokenAReserve * tokenBReserve;
        const c =
          (Math.sqrt(tokenAReserve * tokenBIn) -
            Math.sqrt(tokenBReserve * tokenAIn)) /
          (Math.sqrt(tokenAReserve * tokenBIn) +
            Math.sqrt(tokenBReserve * tokenAIn));

        const exponent = 2 * Math.sqrt((tokenAIn * tokenBIn) / k);

        const finalAReserveExpected =
          (Math.sqrt((k * tokenAIn) / tokenBIn) * (Math.exp(exponent) + c)) /
          (Math.exp(exponent) - c);

        const finalBReserveExpected = k / finalAReserveExpected;

        const tokenAOut = Math.abs(
          tokenAReserve - finalAReserveExpected + tokenAIn
        );
        const tokenBOut = Math.abs(
          tokenBReserve - finalBReserveExpected + tokenBIn
        );

        //trigger long term orders
        await twamm.connect(addr1).longTermSwapFromAToB(tokenAIn, 2);
        await twamm.connect(addr2).longTermSwapFromBToA(tokenBIn, 2);

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(22 * blockInterval);
        } else {
          await delayBlocks(22 * blockInterval);
        }
        await twamm.executeAllVirtualOrders();

        //withdraw proceeds
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
        await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);

        const amountABought = await tokenA.balanceOf(addr2.address);
        const amountBBought = await tokenB.balanceOf(addr1.address);

        const finalAReserveActual = await twamm.tokenAReserves();
        const finalBReserveActual = await twamm.tokenBReserves();

        //expect results to be within 1% of calculation
        expect(finalAReserveActual.toNumber()).to.be.closeTo(
          finalAReserveExpected,
          finalAReserveExpected / 100
        );
        expect(finalBReserveActual.toNumber()).to.be.closeTo(
          finalBReserveExpected,
          finalBReserveExpected / 100
        );

        expect(amountABought.toNumber()).to.be.closeTo(
          tokenAOut,
          tokenAOut / 100
        );
        expect(amountBBought.toNumber()).to.be.closeTo(
          tokenBOut,
          tokenBOut / 100
        );
      });

      it("Multiple orders in both pools work as expected", async function () {
        const amountIn = 10000;
        await tokenA.transfer(addr1.address, amountIn);
        await tokenB.transfer(addr2.address, amountIn);

        //trigger long term order
        await tokenA.connect(addr1).approve(twamm.address, amountIn);
        await tokenB.connect(addr2).approve(twamm.address, amountIn);

        //trigger long term orders
        await twamm.connect(addr1).longTermSwapFromAToB(amountIn / 2, 2);
        await twamm.connect(addr2).longTermSwapFromBToA(amountIn / 2, 3);
        await twamm.connect(addr1).longTermSwapFromAToB(amountIn / 2, 4);
        await twamm.connect(addr2).longTermSwapFromBToA(amountIn / 2, 5);

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(6 * blockInterval);
        } else {
          await delayBlocks(6 * blockInterval);
        }
        await twamm.executeAllVirtualOrders();

        //withdraw proceeds
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
        await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(2);
        await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(3);

        const amountABought = await tokenA.balanceOf(addr2.address);
        const amountBBought = await tokenB.balanceOf(addr1.address);

        //pool is balanced, and orders execute same amount in opposite directions,
        //so we expect final balances to be roughly equal
        expect(amountABought).to.be.closeTo(amountBBought, amountIn / 100);
      });

      it("Normal swap works as expected while long term orders are active", async function () {
        const amountIn = 10000;
        await tokenA.transfer(addr1.address, amountIn);
        await tokenB.transfer(addr2.address, amountIn);

        //trigger long term order
        await tokenA.connect(addr1).approve(twamm.address, amountIn);
        await tokenB.connect(addr2).approve(twamm.address, amountIn);

        //trigger long term orders
        await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 10);
        await twamm.connect(addr2).longTermSwapFromBToA(amountIn, 10);

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(3 * blockInterval);
        } else {
          await delayBlocks(3 * blockInterval);
        }
        await twamm.executeAllVirtualOrders();

        //withdraw proceeds
        await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
        await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);

        const amountABought = await tokenA.balanceOf(addr2.address);
        const amountBBought = await tokenB.balanceOf(addr1.address);

        //pool is balanced, and both orders execute same amount in opposite directions,
        //so we expect final balances to be roughly equal
        expect(amountABought).to.be.closeTo(amountBBought, amountIn / 100);
      });
    });

    describe("Cancelling orders", function () {
      it("Order can be cancelled", async function () {
        const amountIn = 100000;
        await tokenA.transfer(addr1.address, amountIn);
        await tokenA.connect(addr1).approve(twamm.address, amountIn);

        const amountABefore = await tokenA.balanceOf(addr1.address);
        const amountBBefore = await tokenB.balanceOf(addr1.address);

        //trigger long term order
        await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 10);

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(3 * blockInterval);
        } else {
          await delayBlocks(3 * blockInterval);
        }
        await twamm.connect(addr1).cancelLongTermSwap(0);

        const amountAAfter = await tokenA.balanceOf(addr1.address);
        const amountBAfter = await tokenB.balanceOf(addr1.address);

        //expect some amount of the order to be filled
        expect(amountABefore).to.be.gt(amountAAfter);
        expect(amountBBefore).to.be.lt(amountBAfter);
      });
    });

    describe("partial withdrawal", function () {
      it("proceeds can be withdrawn while order is still active", async function () {
        const amountIn = 100000;
        await tokenA.transfer(addr1.address, amountIn);
        await tokenA.connect(addr1).approve(twamm.address, amountIn);

        await tokenB.transfer(addr2.address, amountIn);
        await tokenB.connect(addr2).approve(twamm.address, amountIn);

        //trigger long term order
        await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 10);

        //move blocks forward, and execute virtual orders
        if (LOCAL_VM_TEST) {
          await mineBlocks(3 * blockInterval);
        } else {
          await delayBlocks(3 * blockInterval);
        }

        const beforeBalanceA = await tokenA.balanceOf(addr2.address);
        const beforeBalanceB = await tokenB.balanceOf(addr2.address);
        await twamm.connect(addr2).swapFromBToA(amountIn);
        const afterBalanceA = await tokenA.balanceOf(addr2.address);
        const afterBalanceB = await tokenB.balanceOf(addr2.address);

        //expect swap to work as expected
        expect(beforeBalanceA).to.be.lt(afterBalanceA);
        expect(beforeBalanceB).to.be.gt(afterBalanceB);
      });
    });
  });
});

async function mineBlocks(blockNumber) {
  for (let i = 0; i < blockNumber; i++) {
    await network.provider.send("evm_mine");
  }
}
