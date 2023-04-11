import { Signer } from "ethers";
import { ethers } from "hardhat";
import "module-alias/register";
import { IERC20__factory } from "typechain/factories/contracts/twault/interfaces/IERC20__factory";
import { IWETH__factory } from "typechain/factories/contracts/twault/balancer-core-v2/vault/interfaces/IWETH__factory";
import { TestERC20__factory } from "typechain/factories/contracts/twault/helpers/TestERC20__factory";
import { IERC20 } from "typechain/contracts/twault/interfaces/IERC20";
import { IWETH } from "typechain/contracts/twault/balancer-core-v2/vault/interfaces/IWETH";

export interface EthPoolMainnetInterface {
  signer: Signer;
  weth: IWETH;
}

export interface UsdcPoolMainnetInterface {
  signer: Signer;
  usdc: IERC20;
}

export const deployUsdc = async (signer: Signer, owner: string) => {
  const deployer = new TestERC20__factory(signer);
  return await deployer.deploy(owner, "tUSDC", 6);
};

export async function loadEthPoolMainnetFixture() {
  const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const [signer] = await ethers.getSigners();

  const weth = IWETH__factory.connect(wethAddress, signer);
  return {
    signer,
    weth,
  };
}

export async function loadUsdcPoolMainnetFixture() {
  const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const [signer] = await ethers.getSigners();

  const usdc = IERC20__factory.connect(usdcAddress, signer);

  return {
    signer,
    usdc,
  };
}
