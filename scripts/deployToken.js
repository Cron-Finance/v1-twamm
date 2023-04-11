const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  const ERC20Supply = ethers.utils.parseUnits("100"); 

  const ERC20Factory =  await ethers.getContractFactory("ERC20Mock");
  const tokenA = await ERC20Factory.deploy("TokenA", "TokenA", ERC20Supply);
  const tokenB = await ERC20Factory.deploy("TokenB", "TokenB", ERC20Supply);
  
  const WAIT_BLOCK_CONFIRMATIONS = 6;
  await tokenB.deployTransaction.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log("Token A address:", tokenA.address);
  console.log("Token B address:", tokenB.address);

  console.log(`Verifying token A contract on Etherscan...`);
  await run(`verify:verify`, {
    address: tokenA.address,
    constructorArguments: ["TokenA", "TokenA", ERC20Supply],
  });

  console.log(`Verifying token B contract on Etherscan...`);
  await run(`verify:verify`, {
    address: tokenB.address,
    constructorArguments: ["TokenB", "TokenB", ERC20Supply],
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });