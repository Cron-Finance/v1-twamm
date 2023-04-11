require("dotenv").config();
const fs = require("fs");
const { ethers, network } = require("hardhat");
import { Console } from "console";
import { getLiquidityAmountsJS } from "./utils/misc";
const ds = require("./utils/debugScopes");
const log = ds.getLog("twamm-test-prototypes");

const { getTwammContract,
        getContractName,
        getFunctionName  } = require("./../scripts/utils/contractMgmt");

// const TWAMM_CONTRACT = 'TWAMM'
// const TWAMM_CONTRACT = 'TWAMM_0_1'
const TWAMM_CONTRACT = getTwammContract('fil_rv')

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

const test_data = [];

/* test_gas_vs_block_interval:
 *
 *   For the scenario where a single LT order is issued and then 201 blocks later, we output the gas used
 *   to call execute virtual orders for block intervals ranging from 1 to 100.
 * 
 *   This takes about 10 minutes to run.
 * 
 *   Note: Originally I mistakenly thought console.log() && await mineBlock() would result in the
 *         block being mined; it does not--console.log() returns a falsy value. I've kept that code
 *         here as the data was collected with it set this way and the point wasn't for data alignment but
 *         to prevent out of gas errors.
 */ 
async function test_gas_vs_block_interval() {
  const concurrentLtSwaps = true
  const startBlockInterval = 1
  const maxBlockInterval = 100

  const numberOfBlocksForTrade = 21000
  const totalBlocksToMine = 201

  const initialLiquidityProvided = ethers.utils.parseUnits("10");
  const ERC20Supply = ethers.utils.parseUnits("1000");
  const amountIn = ethers.utils.parseUnits("1")

  try {
    for (let blockInterval = startBlockInterval; blockInterval <= maxBlockInterval; blockInterval++) {

      // Initialize and deploy the contracts (tokens and pool):
      //
      console.log(`Deploying TWAMM and Token Contracts (blockInterval=${blockInterval}):`)
      let tokenA, tokenB, twamm, owner, addr1, addr2, addrs;

      await network.provider.send("evm_setAutomine", [true]);
      [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

      const ERC20Factory = await ethers.getContractFactory("ERC20Mock");
      tokenA = await ERC20Factory.deploy("TokenA", "TokenA", ERC20Supply);
      tokenB = await ERC20Factory.deploy("TokenB", "TokenB", ERC20Supply);

      const TWAMMFactory = await ethers.getContractFactory(TWAMM_CONTRACT);

      twamm = await TWAMMFactory.deploy(
        "Token A Token B Pool",
        "A-B",
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
      
      // This may break other tests, we may need a way to capture and restore
      // previous values: (TODO)
      let blockNumber = await getBlockNumber();
      console.log(`Disabling automine (blockNumber=${blockNumber}) ...`)
      await network.provider.send("evm_setAutomine", [false]);
      await network.provider.send("evm_setIntervalMining", [0]);

      let updateTx = await twamm.executeAllVirtualOrders();
      console.log('Mining after executeAllVirtualOrders') && await mineBlock() && console.log('Done.')

      let resTokenA = await twamm.tokenAReserves();
      let resTokenB = await twamm.tokenBReserves();
      blockNumber = await getBlockNumber();
      console.log(`TWAMM contract deployed to address ${twamm.address}.\n` +
                  `  Reserve Token A: ${resTokenA}\n` +
                  `  Reserve Token B: ${resTokenB}\n` +
                  `  Block Number: ${blockNumber}`);

      
      // Configure the required LT swaps.
      // For single sided testing, addr1 will LT swap Token A.
      // For concurrent tests, addr2 will LT swap Token B.
      //
      await tokenA.transfer(addr1.address, amountIn);
      await tokenB.transfer(addr2.address, amountIn);
      await tokenA.connect(addr1).approve(twamm.address, amountIn);
      await tokenB.connect(addr2).approve(twamm.address, amountIn);
  
      // Correcting for different block intervals (to try and keep sales rates the same for 
      // more accurate gas comparison), we compute the number of block intervals from a constant
      // number of blocks for the trade:
      const numberOfBlockIntervals = Math.floor(numberOfBlocksForTrade / blockInterval);

      const ltSwapATx = await twamm
        .connect(addr1)
        .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
      if (concurrentLtSwaps) {
        const ltSwapBTx = await twamm
          .connect(addr2)
          .longTermSwapFromBToA(amountIn, numberOfBlockIntervals);
      }
      console.log('Mining after executing lt swaps') && await mineBlock() && console.log('Done.')
      blockNumber = await getBlockNumber();

      // // This may break other tests, we may need a way to capture and restore
      // // previous values: (TODO)
      // console.log(`Disabling automine (blockNumber=${blockNumber}) ...`)
      // await network.provider.send("evm_setAutomine", [false]);
      // await network.provider.send("evm_setIntervalMining", [0]);

      // We mine 201 blocks (the amount needed for the comparison we're presenting)
      let startBlockNumber = await getBlockNumber();
      console.log(`Mining ${totalBlocksToMine} blocks. (blockNumber=${startBlockNumber}).`)

      for (let blockOffset = 0; blockOffset < totalBlocksToMine; blockOffset++) {
        await mineBlock();
      }
      blockNumber = await getBlockNumber();
      console.log(`Finished mining ${totalBlocksToMine} blocks. (blockNumber=${blockNumber}).`)

      updateTx = await twamm.executeAllVirtualOrders();
      await mineBlock();  // <-- needed to be able to get receipt
      const updateReceipt = await updateTx.wait()
      const gasUsedBN = ethers.BigNumber.from(updateReceipt.gasUsed)
      const gasUsed = gasUsedBN.toNumber()
      resTokenA = await twamm.tokenAReserves();
      resTokenB = await twamm.tokenBReserves();
      console.log(`Gas used to execute virtual orders: ${gasUsed}.`)

      test_data.push({
        blockInterval,
        gasUsed,
        startBlockNumber,
        endBlockNumber: blockNumber,
        resTokenA,
        resTokenB,
      })

      // Restore previous values
      await network.provider.send("evm_setAutomine", [true]);
      await network.provider.send("evm_setIntervalMining", [1000]);
    }
  } catch (err) {
    console.log(`Encountered error\n${err}`)
  } finally {
    const file_name = `test_data_${concurrentLtSwaps ? 'concurrent' : ''}_${new Date().toISOString()}.csv`
    console.log(`Writing CSV file ${file_name} ...`)
    const header = Object.keys(test_data[0]).join(", ");
    const data = test_data.map((arb_data) => {
      return Object.values(arb_data).join(", ");
    });
    const csvData = [header, ...data].join("\n");
    fs.writeFileSync(file_name, csvData);
  }
}

async function test_gas_vs_inactivity(scenario='concurrent_opposing', // also: concurrent, single, none 
                                      blockIntervals=[1, 10, 20, 30, 60, 100],
                                      maxBlocksToMine=200
                                      ) {
  const scenarios = ['concurrent_opposing', 'concurrent',  'single', 'none']
  if (!scenarios.includes(scenario)) {
    throw `Unsupported scenario: ${scenario}.\nMust be one of ${scenarios.join(',')}.`
  }

  const numberOfBlocksForTrade = 21000

  const initialLiquidityProvided = ethers.utils.parseUnits("10");
  const ERC20Supply = ethers.utils.parseUnits("1000");
  const amountIn = ethers.utils.parseUnits("1")

  try {
    for (const blockInterval of blockIntervals) {
      for (let totalBlocksToMine = 0; totalBlocksToMine <= maxBlocksToMine; totalBlocksToMine += 10) {
        // Initialize and deploy the contracts (tokens and pool):
        //
        console.log(`Deploying TWAMM and Token Contracts (blockInterval=${blockInterval}):`)
        let tokenA, tokenB, twamm, owner, addr1, addr2, addrs;

        await network.provider.send("evm_setAutomine", [true]);
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        const ERC20Factory = await ethers.getContractFactory("ERC20Mock");
        tokenA = await ERC20Factory.deploy("TokenA", "TokenA", ERC20Supply);
        tokenB = await ERC20Factory.deploy("TokenB", "TokenB", ERC20Supply);

        const TWAMMFactory = await ethers.getContractFactory(TWAMM_CONTRACT);

        twamm = await TWAMMFactory.deploy(
          "Token A Token B Pool",
          "A-B",
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
        
        // This may break other tests, we may need a way to capture and restore
        // previous values: (TODO)
        let blockNumber = await getBlockNumber();
        console.log(`Disabling automine (blockNumber=${blockNumber}) ...`)
        await network.provider.send("evm_setAutomine", [false]);
        await network.provider.send("evm_setIntervalMining", [0]);

        let updateTx = await twamm.executeAllVirtualOrders();
        console.log('Mining after executeAllVirtualOrders')
        await mineBlock()
        console.log('Done.')

        let resTokenA = await twamm.tokenAReserves();
        let resTokenB = await twamm.tokenBReserves();
        blockNumber = await getBlockNumber();
        console.log(`TWAMM contract deployed to address ${twamm.address}.\n` +
                    `  Reserve Token A: ${resTokenA}\n` +
                    `  Reserve Token B: ${resTokenB}\n` +
                    `  Block Number: ${blockNumber}`);

        
        // Correcting for different block intervals (to try and keep sales rates the same for 
        // more accurate gas comparison), we compute the number of block intervals from a constant
        // number of blocks for the trade:
        const numberOfBlockIntervals = Math.floor(numberOfBlocksForTrade / blockInterval);

        // Configure the required LT swaps.
        // For single sided testing, addr1 will LT swap Token A.
        // For concurrent tests, addr2 will LT swap Token B.
        //
        switch (scenario) {
          case scenarios[0]:    // concurrent_opposing
            {
              await tokenA.transfer(addr1.address, amountIn);
              await tokenB.transfer(addr2.address, amountIn);
              await tokenA.connect(addr1).approve(twamm.address, amountIn);
              await tokenB.connect(addr2).approve(twamm.address, amountIn);
              const ltSwapATx = await twamm
                .connect(addr1)
                .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
              const ltSwapBTx = await twamm
                .connect(addr2)
                .longTermSwapFromBToA(amountIn, numberOfBlockIntervals);
            }
            break;

          case scenarios[1]:    // concurrent
            {
              await tokenA.transfer(addr1.address, amountIn);
              await tokenA.transfer(addr2.address, amountIn);
              await tokenA.connect(addr1).approve(twamm.address, amountIn);
              await tokenA.connect(addr2).approve(twamm.address, amountIn);
              const ltSwapATx = await twamm
                .connect(addr1)
                .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
              const ltSwapBTx = await twamm
                .connect(addr2)
                .longTermSwapFromBToA(amountIn, numberOfBlockIntervals);
            }
            break;
            
            break;
          case scenarios[2]:    // single
            {
              await tokenA.transfer(addr1.address, amountIn);
              await tokenA.transfer(addr2.address, amountIn);
              const ltSwapATx = await twamm
                .connect(addr1)
                .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
            }
            break;
        
          case scenarios[3]:    // none 
          default:
            break;
        }

        const ltSwapBlockNumber = await getBlockNumber();
        console.log('Mining after executing lt swaps')
        await mineBlock() 
        console.log('Done.')

        // // This may break other tests, we may need a way to capture and restore
        // // previous values: (TODO)
        // console.log(`Disabling automine (blockNumber=${blockNumber}) ...`)
        // await network.provider.send("evm_setAutomine", [false]);
        // await network.provider.send("evm_setIntervalMining", [0]);

        // We mine 201 blocks (the amount needed for the comparison we're presenting)
        let startBlockNumber = await getBlockNumber();
        console.log(`Mining ${totalBlocksToMine} blocks. (blockNumber=${startBlockNumber}).`)

        for (let blockOffset = 0; blockOffset < totalBlocksToMine; blockOffset++) {
          await mineBlock();
        }
        blockNumber = await getBlockNumber();
        console.log(`Finished mining ${totalBlocksToMine} blocks. (blockNumber=${blockNumber}).`)

        updateTx = await twamm.executeAllVirtualOrders();
        await mineBlock();  // <-- needed to be able to get receipt
        const updateReceipt = await updateTx.wait()
        const gasUsedBN = ethers.BigNumber.from(updateReceipt.gasUsed)
        const gasUsed = gasUsedBN.toNumber()
        resTokenA = await twamm.tokenAReserves();
        resTokenB = await twamm.tokenBReserves();
        console.log(`Gas used to execute virtual orders: ${gasUsed}.`)

        test_data.push({
          blockInterval,
          inactivity: totalBlocksToMine,
          gasUsed,
          ltSwapBlockNumber,
          startBlockNumber,
          endBlockNumber: blockNumber,
          resTokenA,
          resTokenB,
        })

        // Restore previous values
        await network.provider.send("evm_setAutomine", [true]);
        await network.provider.send("evm_setIntervalMining", [1000]);
      }
    }
  } catch (err) {
    console.log(`Encountered error\n${err}`)
  } finally {
    const file_name = `test_gas_vs_inactivity_${scenario}_${new Date().toISOString()}.csv`
    console.log(`Writing CSV file ${file_name} ...`)
    const header = Object.keys(test_data[0]).join(", ");
    const data = test_data.map((arb_data) => {
      return Object.values(arb_data).join(", ");
    });
    const csvData = [header, ...data].join("\n");
    fs.writeFileSync(file_name, csvData);
  }
}

async function test_gas_vs_inactivity_obi_mine(scenario='concurrent_opposing',   // also: concurrent, single, none
                                               blockInterval=10, 
                                               maxBlocksToMine=200) {
  const scenarios = ['concurrent_opposing', 'concurrent',  'single', 'none']
  if (!scenarios.includes(scenario)) {
    throw `Unsupported scenario: ${scenario}.\nMust be one of ${scenarios.join(',')}.`
  }

  const numberOfBlocksForTrade = 21000

  const initialLiquidityProvided = ethers.utils.parseUnits("10");
  const ERC20Supply = ethers.utils.parseUnits("1000");
  const amountIn = ethers.utils.parseUnits("1")

  try {
    let totalBlocksToMine = maxBlocksToMine
    // Initialize and deploy the contracts (tokens and pool):
    //
    console.log(`Deploying TWAMM and Token Contracts (blockInterval=${blockInterval}):`)
    let tokenA, tokenB, twamm, owner, addr1, addr2, addrs;

    await network.provider.send("evm_setAutomine", [true]);
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    const ERC20Factory = await ethers.getContractFactory("ERC20Mock");
    tokenA = await ERC20Factory.deploy("TokenA", "TokenA", ERC20Supply);
    tokenB = await ERC20Factory.deploy("TokenB", "TokenB", ERC20Supply);

    const TWAMMFactory = await ethers.getContractFactory(TWAMM_CONTRACT);

    twamm = await TWAMMFactory.deploy(
      "Token A Token B Pool",
      "A-B",
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
    
    // This may break other tests, we may need a way to capture and restore
    // previous values: (TODO)
    let blockNumber = await getBlockNumber();
    console.log(`Disabling automine (blockNumber=${blockNumber}) ...`)
    await network.provider.send("evm_setAutomine", [false]);
    await network.provider.send("evm_setIntervalMining", [0]);

    let updateTx = await twamm.executeAllVirtualOrders();
    console.log('Mining after executeAllVirtualOrders')
    await mineBlock()
    console.log('Done.')

    let resTokenA = await twamm.tokenAReserves();
    let resTokenB = await twamm.tokenBReserves();
    blockNumber = await getBlockNumber();
    console.log(`TWAMM contract deployed to address ${twamm.address}.\n` +
                `  Reserve Token A: ${resTokenA}\n` +
                `  Reserve Token B: ${resTokenB}\n` +
                `  Block Number: ${blockNumber}`);

    
    // Correcting for different block intervals (to try and keep sales rates the same for 
    // more accurate gas comparison), we compute the number of block intervals from a constant
    // number of blocks for the trade:
    const numberOfBlockIntervals = Math.floor(numberOfBlocksForTrade / blockInterval);

    // Configure the required LT swaps.
    // For single sided testing, addr1 will LT swap Token A.
    // For concurrent tests, addr2 will LT swap Token B.
    //
    switch (scenario) {
      case scenarios[0]:    // concurrent_opposing
        {
          await tokenA.transfer(addr1.address, amountIn);
          await tokenB.transfer(addr2.address, amountIn);
          await tokenA.connect(addr1).approve(twamm.address, amountIn);
          await tokenB.connect(addr2).approve(twamm.address, amountIn);
          const ltSwapATx = await twamm
            .connect(addr1)
            .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
          const ltSwapBTx = await twamm
            .connect(addr2)
            .longTermSwapFromBToA(amountIn, numberOfBlockIntervals);
        }
        break;

      case scenarios[1]:    // concurrent
        {
          await tokenA.transfer(addr1.address, amountIn);
          await tokenA.transfer(addr2.address, amountIn);
          await tokenA.connect(addr1).approve(twamm.address, amountIn);
          await tokenA.connect(addr2).approve(twamm.address, amountIn);
          const ltSwapATx = await twamm
            .connect(addr1)
            .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
          const ltSwapBTx = await twamm
            .connect(addr2)
            .longTermSwapFromBToA(amountIn, numberOfBlockIntervals);
        }
        break;
        
        break;
      case scenarios[2]:    // single
        {
          await tokenA.transfer(addr1.address, amountIn);
          await tokenA.transfer(addr2.address, amountIn);
          const ltSwapATx = await twamm
            .connect(addr1)
            .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
        }
        break;
    
      case scenarios[3]:    // none 
      default:
        break;
    }
    const ltSwapBlockNumber = await getBlockNumber();
    console.log('Mining after executing lt swaps')
    await mineBlock() 
    console.log('Done.')

    // // This may break other tests, we may need a way to capture and restore
    // // previous values: (TODO)
    // console.log(`Disabling automine (blockNumber=${blockNumber}) ...`)
    // await network.provider.send("evm_setAutomine", [false]);
    // await network.provider.send("evm_setIntervalMining", [0]);

    // We mine 201 blocks (the amount needed for the comparison we're presenting)
    let startBlockNumber = await getBlockNumber();
    console.log(`Mining ${totalBlocksToMine} blocks. (blockNumber=${startBlockNumber}).`)

    for (let blockOffset = 0; blockOffset < totalBlocksToMine; blockOffset++) {
      await mineBlock();
    }
    blockNumber = await getBlockNumber();
    console.log(`Finished mining ${totalBlocksToMine} blocks. (blockNumber=${blockNumber}).`)

    updateTx = await twamm.executeAllVirtualOrders();
    await mineBlock();  // <-- needed to be able to get receipt
    const updateReceipt = await updateTx.wait()
    const gasUsedBN = ethers.BigNumber.from(updateReceipt.gasUsed)
    const gasUsed = gasUsedBN.toNumber()
    resTokenA = await twamm.tokenAReserves();
    resTokenB = await twamm.tokenBReserves();
    console.log(`Gas used to execute virtual orders: ${gasUsed}.`)

    test_data.push({
      blockInterval,
      inactivity: totalBlocksToMine,
      gasUsed,
      ltSwapBlockNumber,
      startBlockNumber,
      endBlockNumber: blockNumber,
      resTokenA,
      resTokenB,
    })

    // Restore previous values
    await network.provider.send("evm_setAutomine", [true]);
    await network.provider.send("evm_setIntervalMining", [1000]);
  } catch (err) {
    console.log(`Encountered error\n${err}`)
  } finally {
    const file_name = `test_gas_vs_inactivity_${scenario}_obi${blockInterval}_mine${maxBlocksToMine}_${new Date().toISOString()}.csv`
    console.log(`Writing CSV file ${file_name} ...`)
    const header = Object.keys(test_data[0]).join(", ");
    const data = test_data.map((arb_data) => {
      return Object.values(arb_data).join(", ");
    });
    const csvData = [header, ...data].join("\n");
    fs.writeFileSync(file_name, csvData);
  }
}

/* test_gas_ddos:
 *
 *   Timeline:
 * 
 *   < - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - >
 *     |   |   |                       |                     |
 *     |   |   | <-- attack delay -->  |                     |
 *     |   |   |                       x x x x x ...         |
 *     |   |   Issue Attacks           Attack(s)             |
 *     |   |                                             |
 *     |   | <-- blocks to mine -----------------------> |
 *     |   |                                             |
 *     |   Issue                                         Exec. Virtual
 *     |   LT Swap(s)                                    Orders
 *     |
 *     Deploy &
 *     Init / Fund
 * 
 * blocks_to_mine = (safety + attackDelay + attacks) * blockInterval
 * 
 * Where safety, attackDelay & attacks are in block_interval units.
 * 
 * Note: testType="control" allows direct comparison to system w/o attacks by running 
 *       eVO where last attack would be.
 * 
 */
async function test_gas_ddos(
  attackDelay, 
  attacks, 
  blockInterval,
  testType /* "one-sided", "two-sided", "control" */
  ) {
  const noAttack = (testType.toLowerCase() === "control")
  const oneSided = (testType.toLowerCase() === "one-sided" ||
                    testType.toLowerCase() === "one-sided+")
  const extraAttack = (testType.endsWith("+"))

  const concurrentLtSwaps = true

  const initialLiquidityProvided = ethers.utils.parseUnits("10");
  const ERC20Supply = ethers.utils.parseUnits("1000");
  const amountIn = ethers.utils.parseUnits("1")

  const safety = 2
  const totalBlocksToMine = (safety + attackDelay + attacks) * blockInterval
  const EVOFN = getFunctionName(TWAMM_CONTRACT, 'executeAllVirtualOrders')
  log.debug(`EVOFN of ${TWAMM_CONTRACT} is ${EVOFN}`)
  try {

    // Initialize and deploy the contracts (tokens and pool):
    //
    console.log(`Deploying TWAMM and Token Contracts (blockInterval=${blockInterval}):`)
    let tokenA, tokenB, twamm, owner, addr1, addr2, attackAddr, addrs;

    await network.provider.send("evm_setAutomine", [true]);
    [owner, addr1, addr2, attackAddr, ...addrs] = await ethers.getSigners();

    const ERC20Factory = await ethers.getContractFactory("ERC20Mock");
    tokenA = await ERC20Factory.deploy("TokenA", "TokenA", ERC20Supply);
    tokenB = await ERC20Factory.deploy("TokenB", "TokenB", ERC20Supply);

    const TWAMMFactory = await ethers.getContractFactory(TWAMM_CONTRACT);

    twamm = await TWAMMFactory.deploy(
      "Token A Token B Pool",
      "A-B",
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
    
    // This may break other tests, we may need a way to capture and restore
    // previous values: (TODO)
    let blockNumber = await getBlockNumber();
    console.log(`Disabling automine (blockNumber=${blockNumber}) ...`)
    await network.provider.send("evm_setAutomine", [false]);
    await network.provider.send("evm_setIntervalMining", [0]);

    let updateTx = await twamm[EVOFN]();
    console.log('Mining after executeAllVirtualOrders')
    await mineBlock()
    console.log('Done.')

    let resTokenA = await twamm.tokenAReserves();
    let resTokenB = await twamm.tokenBReserves();
    blockNumber = await getBlockNumber();
    console.log(`TWAMM contract deployed to address ${twamm.address}.\n` +
                `  Reserve Token A: ${resTokenA}\n` +
                `  Reserve Token B: ${resTokenB}\n` +
                `  Block Number: ${blockNumber}`);

    
    // Configure the required LT swaps.
    // For single sided testing, addr1 will LT swap Token A.
    // For concurrent tests, addr2 will LT swap Token B.
    await tokenA.transfer(addr1.address, amountIn);
    await tokenB.transfer(addr2.address, amountIn);
    await tokenA.connect(addr1).approve(twamm.address, amountIn);
    await tokenB.connect(addr2).approve(twamm.address, amountIn);

    // Configure the attack LT swaps.
    // For attacks, attackAddr can swap Token A and/or Token B.
    await tokenA.transfer(attackAddr.address, amountIn);
    await tokenB.transfer(attackAddr.address, amountIn);
    await tokenA.connect(attackAddr).approve(twamm.address, amountIn);
    await tokenB.connect(attackAddr).approve(twamm.address, amountIn);

    // Correcting for different block intervals (to try and keep sales rates the same for 
    // more accurate gas comparison), we compute the number of block intervals from a constant
    // number of blocks for the trade:
    const numberOfBlocksForTrade = 2 * totalBlocksToMine
    const numberOfBlockIntervals = Math.floor(numberOfBlocksForTrade / blockInterval);

    const ltSwapATx = await twamm
      .connect(addr1)
      .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
    if (concurrentLtSwaps) {
      const ltSwapBTx = await twamm
        .connect(addr2)
        .longTermSwapFromBToA(amountIn, numberOfBlockIntervals);
    }
    const ltSwapBlockNumber = await getBlockNumber();
    console.log('Mining after executing lt swaps')
    await mineBlock() 
    console.log('Done.')

    // Mine blocks and issue dos attacks
    let startBlockNumber = await getBlockNumber();
    console.log(`Mining ${totalBlocksToMine} blocks. (blockNumber=${startBlockNumber}).`)

    let attackCount = 0
    let inactivity = 0;

    for (let blockOffset = 0; blockOffset < totalBlocksToMine; blockOffset++) {
      if (attackCount < attacks &&
          (blockOffset % blockInterval === 0)) {
        attackCount++
        if (!noAttack) {
          const attackAmount = Math.floor(amountIn / 10 ** 12)
          // Important AF:  if you don't have slight variation here, the attack fails b/c the contiguous change is
          //                not changing (i.e. storage/chain state goes from 'x' -> 'x')
          const scaleVal = 10 ** 3
          const attackAmountA = attackAmount + (attackCount * scaleVal)
          const attackAmountB = attackAmount - (attackCount * scaleVal)

          console.log(`Issuing attack ${attackCount}:\n` +
                      `   Block ${startBlockNumber + blockOffset}\n` +
                      `   LT swap of ${attackAmount} A & B expiring in ~ ${attackDelay * blockInterval} blocks.`)

          const attackATx = await twamm
            .connect(attackAddr)
            .longTermSwapFromAToB(attackAmountA, attackDelay);
          if (!oneSided) {
            const attackBTx = await twamm
              .connect(attackAddr)
              .longTermSwapFromBToA(attackAmountB, attackDelay);
          }
          // Introduce 2nd attack at first block to show no consequence to gas
          // Must permute the amounts. 
          if (blockOffset === 0 && extraAttack) {
            const attackATx = await twamm
              .connect(attackAddr)
              .longTermSwapFromAToB(attackAmountA + 137, attackDelay);
            if (!oneSided) {
              const attackBTx = await twamm
                .connect(attackAddr)
                .longTermSwapFromBToA(attackAmountB + 141, attackDelay);
            }
          }
          inactivity = 0
        } else if (attackCount === attacks) {
          console.log(`No attack measurement, issuing executeVirtualOrder transaction:\n` +
                      `   Block ${startBlockNumber + blockOffset}\n`)
          // Next line does await twamm.executeAllVirtualOrders(); for contracts w/ diff. fn names
          await twamm[EVOFN]();
          inactivity = 0
        }
      }

      await mineBlock();
      inactivity++
    }

    blockNumber = await getBlockNumber();
    console.log(`Finished mining ${totalBlocksToMine} blocks. (blockNumber=${blockNumber}).`)

    // updateTx = await twamm.executeAllVirtualOrders();
    console.log('\n\n')
    console.log(`Test scenario: ${testType}.`)
    console.log(`Executing virtual orders after ${attacks} attacks, \n` +
                `${inactivity} inactive blocks.`)
    console.log('*******************************************************\n')
    updateTx = await twamm[EVOFN]();
    await mineBlock();  // <-- needed to be able to get receipt
    const updateReceipt = await updateTx.wait()
    const gasUsedBN = ethers.BigNumber.from(updateReceipt.gasUsed)
    const gasUsed = gasUsedBN.toNumber()
    resTokenA = await twamm.tokenAReserves();
    resTokenB = await twamm.tokenBReserves();
    console.log('\n')
    console.log(`Executing virtual orders total gas used: ${gasUsed}\n`)

    test_data.push({
      blockInterval,
      inactivity: totalBlocksToMine,
      gasUsed,
      ltSwapBlockNumber,
      startBlockNumber,
      endBlockNumber: blockNumber,
      resTokenA,
      resTokenB,
    })

    // Restore previous values
    await network.provider.send("evm_setAutomine", [true]);
    await network.provider.send("evm_setIntervalMining", [1000]);
  } catch (err) {
    console.log(`Encountered error\n${err}`)
  } finally {
    const file_name = `test_gas_ddos_${blockInterval}_mine${totalBlocksToMine}_${concurrentLtSwaps ? 'concurrent' : ''}_${new Date().toISOString()}.csv`
    console.log(`Writing CSV file ${file_name} ...`)
    const header = Object.keys(test_data[0]).join(", ");
    const data = test_data.map((arb_data) => {
      return Object.values(arb_data).join(", ");
    });
    const csvData = [header, ...data].join("\n");
    fs.writeFileSync(file_name, csvData);
  }
}

async function test_lp_calculation(intervalsToMine=20, blockInterval=10) {
  const concurrentLtSwaps = false
  const initialLiquidityProvided = ethers.utils.parseUnits("10");
  const ERC20Supply = ethers.utils.parseUnits("1000");
  const amountIn = ethers.utils.parseUnits("1")

  const totalBlocksToMine = intervalsToMine * blockInterval
  try {

    // Initialize and deploy the contracts (tokens and pool):
    //
    console.log(`Deploying TWAMM and Token Contracts (blockInterval=${blockInterval}):`)
    let tokenA, tokenB, twamm, owner, addr1, addr2, addrs;

    await network.provider.send("evm_setAutomine", [true]);
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    const ERC20Factory = await ethers.getContractFactory("ERC20Mock");
    tokenA = await ERC20Factory.deploy("TokenA", "TokenA", ERC20Supply);
    tokenB = await ERC20Factory.deploy("TokenB", "TokenB", ERC20Supply);

    const TWAMMFactory = await ethers.getContractFactory(TWAMM_CONTRACT);

    twamm = await TWAMMFactory.deploy(
      "Token A Token B Pool",
      "A-B",
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
    
    // This may break other tests, we may need a way to capture and restore
    // previous values: (TODO)
    let blockNumber = await getBlockNumber();
    console.log(`Disabling automine (blockNumber=${blockNumber}) ...`)
    await network.provider.send("evm_setAutomine", [false]);
    await network.provider.send("evm_setIntervalMining", [0]);

    let updateTx = await twamm.executeAllVirtualOrders();
    console.log('Mining after executeAllVirtualOrders')
    await mineBlock()
    console.log('Done.')

    let resTokenA = await twamm.tokenAReserves();
    let resTokenB = await twamm.tokenBReserves();
    blockNumber = await getBlockNumber();
    console.log(`TWAMM contract deployed to address ${twamm.address}.\n` +
                `  Reserve Token A: ${resTokenA}\n` +
                `  Reserve Token B: ${resTokenB}\n` +
                `  Block Number: ${blockNumber}`);

    
    // Configure the required LT swaps.
    // For single sided testing, addr1 will LT swap Token A.
    // For concurrent tests, addr2 will LT swap Token B.
    await tokenA.transfer(addr1.address, amountIn);
    await tokenB.transfer(addr2.address, amountIn);
    await tokenA.connect(addr1).approve(twamm.address, amountIn);
    await tokenB.connect(addr2).approve(twamm.address, amountIn);

    // Correcting for different block intervals (to try and keep sales rates the same for 
    // more accurate gas comparison), we compute the number of block intervals from a constant
    // number of blocks for the trade:
    const numberOfBlocksForTrade = 2 * totalBlocksToMine
    const numberOfBlockIntervals = Math.floor(numberOfBlocksForTrade / blockInterval);

    const ltSwapATx = await twamm
      .connect(addr1)
      .longTermSwapFromAToB(amountIn, numberOfBlockIntervals);
    if (concurrentLtSwaps) {
      const ltSwapBTx = await twamm
        .connect(addr2)
        .longTermSwapFromBToA(amountIn, numberOfBlockIntervals);
    }
    const ltSwapBlockNumber = await getBlockNumber();
    console.log('Mining after executing lt swaps')
    await mineBlock() 
    console.log('Done.')

    // Mine blocks and test lp token calculation:
    let startBlockNumber = await getBlockNumber();
    console.log(`Mining ${totalBlocksToMine} blocks. (blockNumber=${startBlockNumber}).`)

    for (let blockOffset = 0; blockOffset < totalBlocksToMine; blockOffset++) {
      // console.log(`No attack measurement, issuing executeVirtualOrder transaction:\n` +
      //             `   Block ${startBlockNumber + blockOffset}\n`)
      // await twamm.executeAllVirtualOrders();

      if (TWAMM_CONTRACT === 'TWAMM_0_1') {
        const numLPTokens = 1_000
        const { reserveA, reserveB, blockNumber } = await twamm.getReserves()
        const totalSupply = await twamm.totalSupply()
        const { amtTokenA, amtTokenB } = getLiquidityAmountsJS(numLPTokens, reserveA, reserveB, totalSupply)
        console.log(`Calculated token A and B needed to get ${numLPTokens} LP tokens at block ${blockNumber}, given:\n` +
                    `  reserveA =    ${reserveA}\n` +
                    `  reserveB =    ${reserveB}\n` +
                    `  totalSupply = ${totalSupply}\n` +
                    `\n` +
                    `  amtTokenA =   ${amtTokenA}\n` +
                    `  amtTokenB =   ${amtTokenB}\n\n`)
      }

      await mineBlock();
    }

    blockNumber = await getBlockNumber();
    console.log(`Finished mining ${totalBlocksToMine} blocks. (blockNumber=${blockNumber}).`)

    updateTx = await twamm.executeAllVirtualOrders();
    await mineBlock();  // <-- needed to be able to get receipt
    const updateReceipt = await updateTx.wait()
    const gasUsedBN = ethers.BigNumber.from(updateReceipt.gasUsed)
    const gasUsed = gasUsedBN.toNumber()
    resTokenA = await twamm.tokenAReserves();
    resTokenB = await twamm.tokenBReserves();

    // Restore previous values
    await network.provider.send("evm_setAutomine", [true]);
    await network.provider.send("evm_setIntervalMining", [1000]);
  } catch (err) {
    console.log(`Encountered error\n${err}`)
  } finally {
    // TBD ...
  }
}

async function main() {
  // await test_gas_ddos(15,            // attackDelay (intervals)
  //                     10,            // attacks
  //                     10,            // interval (blocks)
  //                     "control")     // no_attack
  // await test_gas_ddos(15,            // attackDelay (intervals)
  //                     10,            // attacks
  //                     10,            // interval (blocks)
  //                     "two-sided")   // no_attack
  // await test_gas_ddos(15,             // attackDelay (intervals)
  //                     10,             // attacks
  //                     1,              // interval (blocks)
  //                     // "one-sided+"
  //                     "one-sided"
  //                     // "control"
  //                     )      // no_attack

  // Control:
  // const attackDelay = 190
  // const attacks = 185

  // One Sided
  const cattacks = 185
  const attacks = 185
  const attackDelay = 190 + (attacks-cattacks)

  await test_gas_ddos(attackDelay,    // attackDelay (intervals)
                      attacks,        // attacks
                      1,              // interval (blocks)
                      "two-sided"
                      // "one-sided+"
                      // "one-sided"
                      // "control"
                      )      // no_attack
  // await test_gas_vs_inactivity_obi_mine('none', 1, 200)
  // await test_gas_vs_inactivity_obi_mine('concurrent_opposing', 1, 200)
  // await test_gas_vs_inactivity('none')

  // await test_gas_vs_block_interval()

  // await test_lp_calculation()
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
