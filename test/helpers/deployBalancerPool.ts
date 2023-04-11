import { Signer } from "ethers";
import { THIRTY_DAYS_IN_SECONDS } from "test/helpers/time";
import { TestBalTWAMM__factory } from "typechain/factories/contracts/twault/V001/test/TestBalTWAMM__factory";
import { TestERC20 } from "typechain/contracts/twault/V001/test/TestERC20";
import { Vault } from "typechain/contracts/twault/balancer-core-v2/vault/Vault";

const poolFactoryContract: any = TestBalTWAMM__factory;
const defaultOptions = {
  swapFee: ".003",
  durationInSeconds: THIRTY_DAYS_IN_SECONDS,
  orderBlockInterval: 10
};

export async function deployBalancerPool(
  signer: Signer,
  vaultContract: Vault,
  token0Contract: TestERC20,
  token1Contract: TestERC20,
  options?: {
    swapFee: string;
    expiration: number;
    durationInSeconds: number;
  }
): Promise<any> {
  const {
    expiration: providedExpiration,
    swapFee,
    durationInSeconds,
    orderBlockInterval
  } = {
    ...defaultOptions,
    ...options,
  };
  const elementAddress = await signer.getAddress();
  const baseAssetSymbol = await token0Contract.symbol();
  const balTWAMMDeployer = new poolFactoryContract(signer);

  const dateInMilliseconds = Date.now();
  const dateInSeconds = dateInMilliseconds / 1000;
  const defaultExpiration = Math.round(dateInSeconds + durationInSeconds);
  const expiration = providedExpiration ?? defaultExpiration;

  const poolContract = await balTWAMMDeployer.deploy( token0Contract.address,
                                                      token1Contract.address,
                                                      vaultContract.address,
                                                      `Element ${baseAssetSymbol} - fy${baseAssetSymbol}`,
                                                      `${baseAssetSymbol}-fy${baseAssetSymbol}`,
                                                      orderBlockInterval ) 


  // grab last poolId from last event
  const newPools = vaultContract.filters.PoolRegistered(null, null, null);
  const results = await vaultContract.queryFilter(newPools);
  const poolIds: string[] = results.map((result: any) => result.args?.poolId);
  const poolId = poolIds[poolIds.length - 1];

  return { poolId, poolContract };
}
