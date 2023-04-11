const fs = require("fs");
const { ethers, network } = require("hardhat");

const twamm_contract = 'TWAMM'

async function mineBlock() {
  await network.provider.send("evm_mine");
}

async function getBlockNumber() {
  return Number(await network.provider.send("eth_blockNumber"));
}

// Pasta from: https://stackoverflow.com/questions/45309447/calculating-median-javascript
//
function median(values){
  if(values.length ===0) throw new Error("No inputs");

  values.sort(function(a,b){
    return a-b;
  });

  var half = Math.floor(values.length / 2);
  
  if (values.length % 2)
    return values[half];
  
  return (values[half - 1] + values[half]) / 2.0;
}

const average = (array) => {
  let sum = 0
  for(const val of array) {
    sum += val
  }
  return sum / array.length
}


const arb_ts_data = [];

async function main() {
  let tokenA;
  let tokenB;

  let twamm;

  let owner;
  let addr1;
  let addr2;
  let addrs;

  const blockInterval = 10;

  // const initialLiquidityProvided = 1000000000;
  const initialLiquidityProvided = ethers.utils.parseUnits("10");
  const ERC20Supply = ethers.utils.parseUnits("1000");

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

  await twamm.deployed();

  console.log("Twamm deployed to:", twamm.address);
  
  // Collect reserve / swap stats:
  let updateTx = await twamm.executeAllVirtualOrders();
  let resTokenA = await twamm.tokenAReserves();
  let resTokenB = await twamm.tokenBReserves();
  console.log(`Simulation Start:\n--------------------------------------------------------------------------------\n`)
  let blockNumber = await getBlockNumber();
  console.log(`A: ${resTokenA}, B: ${resTokenB}, Block: ${blockNumber}`)

  // this.timeout(60000 /* ms */);


  // Setup addr1 to LT swap token A and addr2 to LT swap token B:
  //
  const amountIn = ethers.utils.parseUnits("1")
  // const amount = amountIn.toNumber()
  // console.log(`Setting amount to ${amount}`)
  // const amount = 100000000;
  // const amountIn = ethers.BigNumber.from(amount);
  await tokenA.transfer(addr1.address, amountIn);
  await tokenB.transfer(addr2.address, amountIn);
  await tokenA.connect(addr1).approve(twamm.address, amountIn);
  await tokenB.connect(addr2).approve(twamm.address, amountIn);

  const numberOfBlockIntervals = 100;
  const ltSwapATx = await twamm
    .connect(addr1)
    .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
  const ltSwapBTx = await twamm
    .connect(addr2)
    .longTermSwapFromBToA(amountIn, numberOfBlockIntervals);

  // This may break other tests, we may need a way to capture and restore
  // previous values:
  console.log(`Disabling automine ...`)
  await network.provider.send("evm_setAutomine", [false]);
  await network.provider.send("evm_setIntervalMining", [0]);

  //arbitrage:
  //  - examine the price of tokenB / tokenA every block
  //  - if the price of tokenB / tokenA exceeds arbThresh, then perform an arb
  //
  // const totalBlocksToMine =
  //   numberOfBlockIntervals * blockInterval + 2 * blockInterval; /* safety */
  const totalBlocksToMine = numberOfBlockIntervals * blockInterval  // Insufficient amount but good enough for crude data collection.

  blockNumber = await getBlockNumber();

  const evoInterval = 100
  let evoBlockCount = 0

  let gasUsedData = []
  for (let blockOffset = 0; blockOffset < totalBlocksToMine; blockOffset++) {
    // console.log(`Executing virtual orders ... (blockOffset: ${blockOffset})`)
    // console.log(`updateTx:\n${JSON.stringify(updateTx, null, 2)}`)

    evoBlockCount++

    if (evoInterval === evoBlockCount) {
      updateTx = await twamm.executeAllVirtualOrders();
    }

    await mineBlock();

    if (evoInterval === evoBlockCount) {
      const updateReceipt = await updateTx.wait()
      const gasUsed = ethers.BigNumber.from(updateReceipt.gasUsed)
      // console.log(`updateReceipt gas used:\n${gasUsed}`)
      gasUsedData.push(gasUsed.toNumber())

      resTokenA = await twamm.tokenAReserves();
      resTokenB = await twamm.tokenBReserves();
      blockNumber = await getBlockNumber();
      console.log(`A: ${resTokenA}, B: ${resTokenB}, Block: ${blockNumber}`)
      evoBlockCount = 0
    }
  }

  const avgGas = average(gasUsedData);
  const minGas = Math.min.apply(null, gasUsedData)
  const maxGas = Math.max.apply(null, gasUsedData)
  const medGas = median(gasUsedData)
  console.log(`Gas Used Stats:\n----------------------------------------\n`)
  console.log(`num vals: ${gasUsedData.length}`)
  console.log(`min:    ${minGas}`)
  console.log(`max:    ${maxGas}`)
  console.log(`avg:    ${avgGas}`)
  console.log(`median: ${medGas}`)
  // console.log(`values:\n ${JSON.stringify(gasUsedData, null, 2)}`)

  // Restore previous values
  await network.provider.send("evm_setAutomine", [true]);
  await network.provider.send("evm_setIntervalMining", [1000]);

  //withdraw proceeds
  // await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
