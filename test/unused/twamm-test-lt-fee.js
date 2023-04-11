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

  describe("Long Term Swap Fee Functionality", function () {

    describe("TBD test", function () {

      it("Does someting PB puts here", async function () {

        // TODO ...
      });

    });
  });
});

async function mineBlocks(blockNumber) {
  for (let i = 0; i < blockNumber; i++) {
    await network.provider.send("evm_mine")
  }
}
