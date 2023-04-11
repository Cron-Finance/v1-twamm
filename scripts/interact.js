const { ethers } = require("hardhat");

const twamm_contract = 'TWAMM'

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

async function getBalances(tokenA, tokenB, wallet) {
  // get balances of tokens this address has to use
  const tokenASupply = ethers.utils.formatEther((await tokenA.totalSupply()).toString());
  const tokenBSupply = ethers.utils.formatEther((await tokenB.totalSupply()).toString());
  const tokenABal = ethers.utils.formatEther((await tokenA.balanceOf(wallet)).toString());
  const tokenBBal = ethers.utils.formatEther((await tokenB.balanceOf(wallet)).toString());
  console.log("Token A totalSupply (eth)", tokenASupply)
  console.log("Token B totalSupply (eth)", tokenBSupply)
  console.log("Token A Balance Of (eth)", tokenABal)
  console.log("Token B Balance Of (eth)", tokenBBal)
}

async function approveTokens(tokenA, tokenB, wallet, twamm_address) {
  // approve twamm to spend token A & token B
  const approveA = await tokenA.approve(twamm_address, tokenA.balanceOf(wallet))
  const approveB = await tokenB.approve(twamm_address, tokenB.balanceOf(wallet))
  await approveA.wait()
  await approveB.wait()
  console.log("Token A Balance approved for TWAMM", approveA)
  console.log("Token B Balance approved for TWAMM", approveB)
}

async function getTwammTokenBalances(twamm) {
  let value = await twamm.totalSupply();
  console.log('TWAMM total supply', value.toNumber());

  let tokenAReserve = await twamm.tokenAReserves();
  console.log('Token A Reserves', tokenAReserve.toNumber());

  let tokenBReserve = await twamm.tokenBReserves();
  console.log('Token B Reserves', tokenBReserve.toNumber());
}

async function provideInitialLiquidity(amount, twamm) {
  const initialLiquidityTx = await twamm.provideInitialLiquidity(amount, amount);
  let receipt = await initialLiquidityTx.wait();
  let event = receipt.events?.filter((x) => { return x.event == "InitialLiquidityProvided" });
  console.log("Filtered event info", event);
  // console.log("\n\n\n\nInitial liquidity tx", initialLiquidityTx);
  // console.log("\n\n\n\nInitial liquidity provided logs", receipt.logs);
  // console.log("\n\n\n\nInitial liquidity provided events", receipt.events);
}

async function provideLiquidity(twamm) {
  const provideLiquidityTx = await twamm.provideLiquidity(100000);
  let receipt = await provideLiquidityTx.wait();
  let event = receipt.events?.filter((x) => { return x.event == "LiquidityProvided" });
  console.log("Filtered event info", event);
  // console.log("\n\n\n\nProvide liquidity tx", provideLiquidityTx);
  // console.log("\n\n\n\nProvide liquidity tx LOGS", receipt.logs);
  // console.log("\n\n\n\nProvide liquidity tx EVENTS", receipt.events);
}

async function removeLiquidity(twamm) {
  const removeLiquidityTx = await twamm.removeLiquidity(100000);
  let receipt = await removeLiquidityTx.wait();
  let event = receipt.events?.filter((x) => { return x.event == "LiquidityRemoved" });
  console.log("Filtered event info", event);
  // console.log("Remove liquidity tx", removeLiquidityTx);
  // console.log("\n\n\n\nRemove liquidity tx LOGS", receipt.logs);
  // console.log("\n\n\n\nRemove liquidity tx EVENTS", receipt.events);
}

async function swapFromAToB(twamm) {
  const swapFromAToBTx = await twamm.swapFromAToB(1000);
  let receipt = await swapFromAToBTx.wait();
  let event = receipt.events?.filter((x) => { return x.event == "SwapAToB" });
  console.log("Filtered event info", event);
  // console.log("\n\n\n\nSwap from A to B tx", swapFromAToBTx);
  // console.log("\n\n\n\nSwap from A to B tx LOGS", receipt.logs);
  // console.log("\n\n\n\nSwap from A to B tx EVENTS", receipt.events);
}

async function longTermSwapFromAToB(twamm, address, amountIn, blocks) {
  const longTermSwapFromAToBTx = await twamm.connect(address).longTermSwapFromAToB(amountIn, blocks);
  let receipt = await longTermSwapFromAToBTx.wait();
  let event = receipt.events?.filter((x) => { return x.event == "LongTermSwapAToB" })
  console.log("Filtered event info", event)
  let orderId = event[0]['args']['orderId'].toNumber()
  console.log("OrderID", orderId)
  // console.log("Long term swap from A to B tx", longTermSwapFromAToBTx);
  return orderId
}

async function longTermSwapFromBToA(twamm, address, amountIn, blocks) {
  const longTermSwapFromBToATx = await twamm.connect(address).longTermSwapFromBToA(amountIn, blocks);
  let receipt = await longTermSwapFromBToATx.wait();
  let event = receipt.events?.filter((x) => { return x.event == "LongTermSwapBToA" })
  console.log("Filtered event info", event)
  let orderId = event[0]['args']['orderId'].toNumber()
  console.log("OrderID", orderId)
  // console.log("Long term swap from A to B tx", longTermSwapFromBToATx);
  return orderId
}

async function withdrawProceedsFromLongTermSwap(id, twamm) {
  const withdrawProceedsFromLongTermSwapTx = await twamm.withdrawProceedsFromLongTermSwap(id);
  let receipt = await withdrawProceedsFromLongTermSwapTx.wait();
  let event = receipt.events?.filter((x) => { return x.event == "WithdrawProceedsFromLongTermOrder" })
  console.log("Filtered event info", event)
  // console.log("Withdraw proceeds from long term swap tx", withdrawProceedsFromLongTermSwapTx);
}

async function cancelLongTermSwap(id, twamm) {
  const cancelLongTermSwapTx = await twamm.cancelLongTermSwap(id);
  let receipt = await cancelLongTermSwapTx.wait();
  let event = receipt.events?.filter((x) => { return x.event == "CancelLongTermOrder" })
  console.log("Filtered event info", event)
  // console.log("Cancel long term order swap tx", cancelLongTermSwapTx);
}

async function main() {
  let owner;
  let addr1;
  let addr2;
  let addrs;

  let tokenA;
  let tokenB;

  let twamm;

  const blockInterval = 10;

  const initialLiquidityProvided = 100000000;

  const [deployer] = await ethers.getSigners();
  [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

  console.log("Interacting with TWAMM contracts with the account:", deployer.address);

  console.log("Account balance:", (await deployer.getBalance()).toString());
  const ERC20Supply = ethers.utils.parseUnits("100");

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

  console.log("Token A address:", tokenA.address);
  console.log("Token B address:", tokenB.address);
  console.log("TWAMM address:", twamm.address);

  // await getBalances(tokenA, tokenB, deployer.address);
  await approveTokens(tokenA, tokenB, deployer.address, twamm.address);
  // await getTwammTokenBalances(twamm);

  await provideInitialLiquidity(initialLiquidityProvided, twamm);

  // const amountIn = ethers.BigNumber.from(10000);
  // await tokenA.transfer(addr1.address, amountIn);
  // await tokenB.transfer(addr2.address, amountIn);

  // await tokenA.connect(addr1).approve(twamm.address, amountIn);
  // await tokenB.connect(addr2).approve(twamm.address, amountIn);

  // // await twamm.connect(addr1).longTermSwapFromAToB(amountIn, 2);
  // await longTermSwapFromAToB(twamm, addr1, amountIn, 2)
  // // await twamm.connect(addr2).longTermSwapFromBToA(amountIn, 2);
  // await longTermSwapFromBToA(twamm, addr2, amountIn, 2)
  // console.log("Long term orders setup");

  // //move blocks forward, and execute virtual orders

  // await delayBlocks(30);

  // // //withdraw proceeds 
  // await twamm.executeAllVirtualOrders();
  // await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
  // await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);

  // const amountABought = await tokenA.balanceOf(addr2.address);
  // const amountBBought = await tokenB.balanceOf(addr1.address);

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
  await delayBlocks(30);
  await twamm.executeAllVirtualOrders();

  //withdraw proceeds 
  await twamm.connect(addr1).withdrawProceedsFromLongTermSwap(0);
  await twamm.connect(addr2).withdrawProceedsFromLongTermSwap(1);

  const amountABought = await tokenA.balanceOf(addr2.address);
  const amountBBought = await tokenB.balanceOf(addr1.address);

  //pool is balanced, and both orders execute same amount in opposite directions,
  //so we expect final balances to be roughly equal
  console.log("Amount A bought", amountABought.toNumber())
  console.log("Amount B bought", amountBBought.toNumber())

  await getTwammTokenBalances(twamm);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
