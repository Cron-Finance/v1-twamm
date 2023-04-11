pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import { IERC20 } from "../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IVault } from "../balancer-core-v2/vault/interfaces/IVault.sol";
import { IAsset } from "../balancer-core-v2/vault/interfaces/IAsset.sol";
import { IWETH } from "../balancer-core-v2/vault/interfaces/IWETH.sol";

import { TestToken } from "../helpers/TestToken.sol";
import { ICronV1Pool } from "../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../interfaces/pool/ICronV1PoolEnums.sol";
import { ICronV1PoolFactory } from "../interfaces/ICronV1PoolFactory.sol";
import { CronV1PoolFactory } from "../factories/CronV1PoolFactory.sol";

contract CronV1Tester {
  address constant public VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
  address constant public WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
  TestToken public token0;
  TestToken public token1;
  address public pool;
  address public owner;

  CronV1PoolFactory public factory;
  IVault public vault = IVault(VAULT);

  constructor () {
    owner = address(this);
    factory = new CronV1PoolFactory(vault);
    uint256 mintAmount = 2**112;
    token0 = new TestToken("T0", "T0", mintAmount);
    token1 = new TestToken("T1", "T1", mintAmount);
    // create a TWAMM pool
    pool = factory.create(
      address(token0),
      address(token1),
      "T0-T1-Liquid",
      "T0-T1-L",
      1
    );
    ICronV1Pool(pool).setAdminStatus(address(this), true);
  }

  function addLiquidity(
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) public {
    // setup parameters for joinPool
    bytes memory userData = getJoinUserData(_joinKind, _liquidity0, _liquidity1);
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
    bool fromInternalBalance = false;
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(address(vault), _liquidity0);
    IERC20(tokens[1]).approve(address(vault), _liquidity1);
    // call joinPool function on TWAMMs
    IVault(vault).joinPool(
      poolId,
      owner,
      payable (owner),
      IVault.JoinPoolRequest(
        assets,
        maxAmountsIn,
        userData,
        fromInternalBalance
      )
    );
  }

  function getJoinUserData(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1
  ) public pure returns (bytes memory userData) {
    userData = getJoinUserDataWithMin(_joinKind, _liquidity0, _liquidity1, 0, 0);
  }
  
  function getJoinUserDataWithMin(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _minLiquidity0,
    uint256 _minLiquidity1
  ) public pure returns (bytes memory userData) {
    uint256[] memory balances = new uint256[](2);
    balances[0] = _liquidity0;
    balances[1] = _liquidity1;
    uint256[] memory minTokenAmt = new uint256[](2);
    minTokenAmt[0] = _minLiquidity0;
    minTokenAmt[1] = _minLiquidity1;
    userData = abi.encode(_joinKind, balances, minTokenAmt);
  }
  
  function getMaxAmountsIn(IERC20[] memory tokens)
           public pure
           returns(uint256[] memory maxAmountsIn)
  {
    maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
  }

  function shortTermSwap(
    uint256 _amountIn,
    bool _zeroToOne
  ) public returns (uint256 amountOut) {
    // build userData field
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.SwapType.RegularSwap, // swap type
      0
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20 token = _zeroToOne ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);
    // swap amounts with vault
    amountOut = IVault(vault).swap(
      IVault.SingleSwap(
        ICronV1Pool(pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        _zeroToOne ? assets[0] : assets[1],
        _zeroToOne ? assets[1] : assets[0],
        _amountIn,
        userData
      ),
      IVault.FundManagement(
        owner,
        false,
        payable (owner),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }

  function longTermSwap(
    uint256 _amountIn,
    uint256 _intervals,
    bool _zeroToOne
  ) public returns (uint256 amountOut) {
    // build userData field
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.SwapType.LongTermSwap, // swap type
      _intervals
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20 token = _zeroToOne ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);
    // swap amounts with vault
    amountOut = IVault(vault).swap(
      IVault.SingleSwap(
        ICronV1Pool(pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        _zeroToOne ? assets[0] : assets[1],
        _zeroToOne ? assets[1] : assets[0],
        _amountIn,
        userData
      ),
      IVault.FundManagement(
        owner,
        false,
        payable (owner),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }

  function exit() public {
    // build userData field
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.ExitType.Exit, // exit type
      ICronV1Pool(pool).balanceOf(owner)
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory minAmountOut = getMinAmountsOut(0, 0);
    // swap amounts with vault
    IVault(vault).exitPool(
      ICronV1Pool(pool).POOL_ID(),
      owner,
      payable (owner),
      IVault.ExitPoolRequest(
        assets,
        minAmountOut,
        userData,
        false
      )
    );
  }

  function withdraw(
    uint _orderId
  ) public {
    // build userData field
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.ExitType.Withdraw, // exit type
      _orderId
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory minAmountOut = getMinAmountsOut(0, 0);
    // swap amounts with vault
    IVault(vault).exitPool(
      ICronV1Pool(pool).POOL_ID(),
      owner,
      payable (owner),
      IVault.ExitPoolRequest(
        assets,
        minAmountOut,
        userData,
        false
      )
    );
  }

  function cancel(
    uint _orderId
  ) public {
    // build userData field
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.ExitType.Cancel, // exit type
      _orderId
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory minAmountOut = getMinAmountsOut(0, 0);
    // swap amounts with vault
    IVault(vault).exitPool(
      ICronV1Pool(pool).POOL_ID(),
      owner,
      payable (owner),
      IVault.ExitPoolRequest(
        assets,
        minAmountOut,
        userData,
        false
      )
    );
  }

  function getVirtualReserves(uint256 _maxBlock, bool _paused)
    public
    returns (
      uint256 blockNumber,
      uint256 token0ReserveU112,
      uint256 token1ReserveU112,
      uint256 token0OrdersU112,
      uint256 token1OrdersU112,
      uint256 token0ProceedsU112,
      uint256 token1ProceedsU112,
      uint256 token0BalancerFeesU96,
      uint256 token1BalancerFeesU96,
      uint256 token0CronFiFeesU96,
      uint256 token1CronFiFeesU96
    )
  {
    ICronV1Pool(pool).getVirtualReserves(_maxBlock, _paused);
  }
  
  function getMinAmountsOut(uint256 minToken0, uint256 minToken1)
           public pure
           returns(uint256[] memory minAmountsOut)
  {
    minAmountsOut = new uint256[](2);
    minAmountsOut[0] = minToken0;
    minAmountsOut[1] = minToken1;
  }

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
