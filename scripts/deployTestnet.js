const { ethers } = require("hardhat");

const factoryContract = "CronV1PoolFactory";
const balancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
const USDC = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";
const WETH = "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  const vault = await ethers.getContractAt("Vault", balancerVault);
  const factory = await ethers.getContractFactory(factoryContract);

  const CronV1PoolFactory = await factory.deploy(vault.address);

  await CronV1PoolFactory.deployed();

  const CronV1Pool = CronV1PoolFactory.create(address(USDC), address(WETH), "USDC-WETH-Liquid", "USDC/WETH/L", 1);
  
  const WAIT_BLOCK_CONFIRMATIONS = 6;
  await CronV1Pool.deployTransaction.wait(WAIT_BLOCK_CONFIRMATIONS);

  console.log("Factory address:", CronV1PoolFactory.address);
  console.log("Pool address:", CronV1Pool.address);

  const iVault = await ethers.getContractFactory("IVault");
  const IVault = await iVault.attach(
    balancerVault // The deployed contract address
  );

  const iERC20USDC = await ethers.getContractFactory("IERC20");
  const IERC20USDC = await iERC20USDC.attach(
    USDC // The deployed contract address
  );

  const iERC20WETH = await ethers.getContractFactory("IERC20");
  const IERC20WETH = await iERC20WETH.attach(
    WETH // The deployed contract address
  );

  console.log(`Verifying factory contract on Etherscan...`);
  await run(`verify:verify`, {
    address: CronV1PoolFactory.addresss,
    constructorArguments: [vault.address],
  });

  console.log(`Verifying pool contract on Etherscan...`);
  await run(`verify:verify`, {
    address: CronV1Pool.addresss,
    constructorArguments: [IERC20USDC, IERC20WETH, IVault, "USDC-WETH-Liquid", "USDC/WETH/L", ethers.BigNumber.from("1")],
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
