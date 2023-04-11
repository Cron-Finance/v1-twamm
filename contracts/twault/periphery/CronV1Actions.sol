// SPDX-License-Identifier: BUSL-1.1
//
// (c) Copyright 2023, Bad Pumpkin Inc. All Rights Reserved
//
pragma solidity ^0.7.6;

pragma experimental ABIEncoderV2;

import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";
import { IERC20 } from "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import { IBaseRelayerLibrary } from "../interfaces/IBaseRelayerLibrary.sol";

import { Address } from "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";

import { ICronV1Relayer } from "../interfaces/ICronV1Relayer.sol";
import { ICronV1Pool } from "../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../interfaces/pool/ICronV1PoolEnums.sol";
import { ICronV1PoolFactory } from "../interfaces/ICronV1PoolFactory.sol";
import { Order } from "../interfaces/Structs.sol";

import { C } from "../miscellany/Constants.sol";
import { requireErrCode, CronErrors } from "../miscellany/Errors.sol";

import { CronV1Relayer } from "./CronV1Relayer.sol";

uint256 constant ASSET_IN = 0;
uint256 constant ASSET_OUT = 1;
uint256 constant FIVE_MIN_IN_SEC = 5 * 60;

uint256 constant ZERO_PCT_BP = 0;
uint256 constant TEN_PCT_BP = 1000;
uint256 constant MAX_BP = 10000;

/// @title CronFi Relayer Library
///
/// @notice CronFi specific periphery relayer functionality for performing Time Weighted
///         Average Market Maker (TWAMM) pool actions on a pool with some safety and convenience
///         checks.
///
/// @dev The periphery relayer is composed of two contracts:
///        - The CronV1Relayer contract, which acts as the point of entry into the system through
///          convenience functions and a multicall function.
///        - This library contract that defines the behaviors and checks allowed by the periphery
///          relayer.
///
/// @dev There are unchecked operations (this code targets Solidity 0.7.x which
///      didn't yet feature implicit arithmetic checks or have the 'unchecked' block feature)
///      herein for reasons of efficiency or desired overflow. Wherever they appear they will
///      be documented and accompanied with one of the following tags:
///        - #unchecked
///        - #overUnderFlowIntended
///
/// NOTE: Only the entrypoint contract should be allowlisted by Balancer governance as a relayer,
///       so that the Vault will reject calls from outside the entrypoint context.
///
/// WARNING: This contract should neither be allowlisted as a relayer, nor called directly by the
///          user. No guarantees can be made about fund safety when calling this contract in an
///          improper manner.
///
contract CronV1Actions is IBaseRelayerLibrary {
  IVault private immutable VAULT;
  ICronV1PoolFactory private immutable FACTORY;
  ICronV1Relayer private immutable ENTRY_POINT;

  /// @notice Creates an instance of the library contract and periphery relayer contract for
  ///         convenient interactions with CronFi TWAMM pools. The periphery relayer
  ///         contract is created by this constructor and should not be separately be created.
  /// @param _vault is the Balancer Vault instance this periphery relayer system services.
  /// @param _factory is the CronFi factory contract instance.
  ///
  constructor(IVault _vault, ICronV1PoolFactory _factory) IBaseRelayerLibrary(_vault.WETH()) {
    VAULT = _vault;
    ENTRY_POINT = new CronV1Relayer(_vault, address(this), _factory);
    FACTORY = _factory;
  }

  /// @notice see swap documentation in ICronV1Relayer.sol, except noted differences below:
  ///
  /// @param _caller is the address of the user that called the CronV1Relayer swap function.
  ///                It is explicitly passed here because the function calls the multicall
  ///                function, which delegate calls this method (msg.sender would be the relayer
  ///                contract address and not this one).
  ///
  function swap(
    address _tokenIn,
    uint256 _amountIn,
    address _tokenOut,
    uint256 _minTokenOut,
    uint256 _poolType,
    address _caller,
    address _recipient
  ) external returns (uint256 amountOut) {
    (, bytes32 poolId) = _getPoolInfoAndCheckValid(_tokenIn, _tokenOut, _poolType);
    _checkAmountIn(_amountIn, _tokenIn, _caller);
    IAsset[] memory assetsInOut = _getPoolAssetsAndCheckBalances(poolId, _tokenIn);

    amountOut = VAULT.swap(
      IVault.SingleSwap(
        poolId,
        IVault.SwapKind.GIVEN_IN,
        assetsInOut[ASSET_IN],
        assetsInOut[ASSET_OUT],
        _amountIn,
        abi.encode(ICronV1PoolEnums.SwapType.RegularSwap, 0)
      ),
      IVault.FundManagement(_caller, false, payable(_recipient), false),
      _minTokenOut,
      _getDeadline()
    );
  }

  /// @notice see join documentation in ICronV1Relayer.sol, except noted differences below:
  ///
  /// @param _caller is the address of the user that called the CronV1Relayer join function.
  ///                It is explicitly passed here because the function calls the multicall
  ///                function, which delegate calls this method (msg.sender would be the relayer
  ///                contract address and not this one).
  ///
  function join(
    address _tokenA,
    address _tokenB,
    uint256 _poolType,
    uint256 _liquidityA,
    uint256 _liquidityB,
    uint256 _minLiquidityA,
    uint256 _minAmountOutB,
    address _caller,
    address _recipient
  ) external {
    (, bytes32 poolId) = _getPoolInfoAndCheckValid(_tokenA, _tokenB, _poolType);
    requireErrCode(
      _liquidityA > C.MINIMUM_LIQUIDITY && _liquidityB > C.MINIMUM_LIQUIDITY,
      CronErrors.P_INSUFFICIENT_LIQUIDITY
    );

    IAsset[] memory assets = new IAsset[](2);
    uint256[] memory liquidity = new uint256[](2);
    bytes memory userData;
    {
      // Arrange input parameters by token sort order:
      //
      (IERC20[] memory tokens, , ) = VAULT.getPoolTokens(poolId);
      assets = _convertERC20sToAssets(tokens);

      // Sort the specified liquidity and  minimum amounts of token A and B to their corresponding
      // token 0 and 1 values in the Balancer pool; also check that balances are available in the
      // calling account:
      //
      // #unchecked
      //           The subtraction of tokenAIndex from unity below is unchecked because
      //           tokenAIndex can only take the values 0 or 1, which will not result in
      //           underflow.
      uint256 tokenAIndex = (address(tokens[0]) == _tokenA) ? 0 : 1;
      uint256 tokenBIndex = 1 - tokenAIndex;

      requireErrCode(
        tokens[tokenAIndex].balanceOf(_caller) >= _liquidityA,
        CronErrors.P_INSUFFICIENT_TOKEN_A_USER_BALANCE
      );
      requireErrCode(
        tokens[tokenBIndex].balanceOf(_caller) >= _liquidityB,
        CronErrors.P_INSUFFICIENT_TOKEN_B_USER_BALANCE
      );

      liquidity[tokenAIndex] = _liquidityA;
      liquidity[tokenBIndex] = _liquidityB;

      uint256[] memory minLiquidity = new uint256[](2);
      minLiquidity[tokenAIndex] = _minLiquidityA;
      minLiquidity[tokenBIndex] = _minAmountOutB;

      userData = abi.encode(ICronV1PoolEnums.JoinType.Join, liquidity, minLiquidity);
    }

    VAULT.joinPool(
      poolId,
      _caller,
      payable(_recipient),
      IVault.JoinPoolRequest(
        assets,
        liquidity,
        userData,
        false // fromInternalBalance
      )
    );
  }

  /// @notice see exit documentation in ICronV1Relayer.sol, except noted differences below:
  ///
  /// @param _caller is the address of the user that called the CronV1Relayer exit function.
  ///                It is explicitly passed here because the function calls the multicall
  ///                function, which delegate calls this method (msg.sender would be the relayer
  ///                contract address and not this one).
  ///
  function exit(
    address _tokenA,
    address _tokenB,
    uint256 _poolType,
    uint256 _numLPTokens,
    uint256 _minAmountOutA,
    uint256 _minAmountOutB,
    address _caller,
    address _recipient
  ) external {
    (address pool, bytes32 poolId) = _getPoolInfoAndCheckValid(_tokenA, _tokenB, _poolType);
    requireErrCode(_numLPTokens > 0, CronErrors.P_INVALID_POOL_TOKEN_AMOUNT);
    requireErrCode(IERC20(pool).balanceOf(_caller) >= _numLPTokens, CronErrors.P_INSUFFICIENT_POOL_TOKEN_USER_BALANCE);

    IAsset[] memory assets = new IAsset[](2);
    uint256[] memory minAmountsOut = new uint256[](2);
    bytes memory userData = abi.encode(ICronV1PoolEnums.ExitType.Exit, _numLPTokens);
    {
      (IERC20[] memory tokens, , ) = VAULT.getPoolTokens(poolId);
      assets = _convertERC20sToAssets(tokens);

      // Sort the specified minimum amounts of token A and B to their corresponding token 0 and 1
      // values in the Balancer pool:
      //
      // #unchecked
      //           The subtraction of tokenAIndex from unity below is unchecked because
      //           tokenAIndex can only take the values 0 or 1, which will not result in
      //           underflow.
      uint256 tokenAIndex = (address(tokens[0]) == _tokenA) ? 0 : 1;
      uint256 tokenBIndex = 1 - tokenAIndex;

      minAmountsOut[tokenAIndex] = _minAmountOutA;
      minAmountsOut[tokenBIndex] = _minAmountOutB;
    }

    VAULT.exitPool(
      poolId,
      _caller,
      payable(_recipient),
      IVault.ExitPoolRequest(
        assets,
        minAmountsOut,
        userData,
        false // toInternalBalance
      )
    );
  }

  /// @notice see longTermSwap documentation in ICronV1Relayer.sol, except noted differences below:
  ///
  /// @param _owner is the address of the user that called the CronV1Relayer longTermSwap function.
  ///               It is explicitly passed here because the function calls the multicall
  ///               function, which delegate calls this method (msg.sender would be the relayer
  ///               contract address and not this one).
  ///
  function longTermSwap(
    address _tokenIn,
    address _tokenOut,
    uint256 _poolType,
    uint256 _amountIn,
    uint256 _intervals,
    address _owner,
    address _delegate
  ) external {
    (, bytes32 poolId) = _getPoolInfoAndCheckValid(_tokenIn, _tokenOut, _poolType);

    _checkAmountIn(_amountIn, _tokenIn, _owner);
    IAsset[] memory assetsInOut = _getPoolAssetsAndCheckBalances(poolId, _tokenIn);

    // Saves lt swap users by eliminating any excess amount in that would not be use on their behalf
    // in the sales rate due to truncation/precision limitations:
    uint256 effAmountIn = _getEffectiveAmountInAndCheckIntervals(
      _amountIn,
      _intervals,
      ICronV1PoolEnums.PoolType(_poolType)
    );

    VAULT.swap(
      IVault.SingleSwap(
        poolId,
        IVault.SwapKind.GIVEN_IN,
        assetsInOut[ASSET_IN],
        assetsInOut[ASSET_OUT],
        effAmountIn,
        abi.encode(ICronV1PoolEnums.SwapType.LongTermSwap, _intervals)
      ),
      IVault.FundManagement(_owner, false, payable(_delegate), false),
      0, // limit - not applicable to LT Swap
      _getDeadline()
    );
  }

  /// @notice see withdraw documentation in ICronV1Relayer.sol, except noted differences below:
  ///
  /// @param _caller is the address of the user that called the CronV1Relayer withdraw function.
  ///                It is explicitly passed here because the function calls the multicall
  ///                function, which delegate calls this method (msg.sender would be the relayer
  ///                contract address and not this one).
  ///
  function withdraw(
    address _tokenA,
    address _tokenB,
    uint256 _poolType,
    uint256 _orderId,
    address _caller,
    address _recipient
  ) external {
    (address pool, bytes32 poolId) = _getPoolInfoAndCheckValid(_tokenA, _tokenB, _poolType);

    Order memory order = ICronV1Pool(pool).getOrder(_orderId);
    if (_caller == order.delegate) {
      requireErrCode(_recipient == order.owner, CronErrors.P_DELEGATE_WITHDRAW_RECIPIENT_NOT_OWNER);
    } else {
      requireErrCode(order.orderExpiry > 0, CronErrors.P_INVALID_OR_EXPIRED_ORDER_ID);
      requireErrCode(_caller == order.owner, CronErrors.P_WITHDRAW_BY_ORDER_OR_DELEGATE_ONLY);
    }

    // Min amounts out are zero here intentionally as values coming out are stored in proceeds
    // accounting variables, not reserves, and thus are not subject to price manipulation or
    // sandwich attacks the same way that reserves are.
    uint256[] memory minAmountsOut = new uint256[](2);
    bytes memory userData = abi.encode(ICronV1PoolEnums.ExitType.Withdraw, _orderId);

    VAULT.exitPool(
      poolId,
      _caller,
      payable(_recipient),
      IVault.ExitPoolRequest(
        _getPoolAssets(poolId),
        minAmountsOut,
        userData,
        false // toInternalBalance
      )
    );
  }

  /// @notice cancel see documentation in ICronV1Relayer.sol, except noted differences below:
  ///
  /// @param _caller is the address of the user that called the CronV1Relayer cancel function.
  ///                It is explicitly passed here because the function calls the multicall
  ///                function, which delegate calls this method (msg.sender would be the relayer
  ///                contract address and not this one).
  ///
  function cancel(
    address _tokenA,
    address _tokenB,
    uint256 _poolType,
    uint256 _orderId,
    address _caller,
    address _recipient
  ) external {
    (address pool, bytes32 poolId) = _getPoolInfoAndCheckValid(_tokenA, _tokenB, _poolType);

    Order memory order = ICronV1Pool(pool).getOrder(_orderId);
    if (_caller == order.delegate) {
      requireErrCode(_recipient == order.owner, CronErrors.P_DELEGATE_CANCEL_RECIPIENT_NOT_OWNER);
    } else {
      requireErrCode(order.orderExpiry > 0, CronErrors.P_INVALID_OR_EXPIRED_ORDER_ID);
      requireErrCode(_caller == order.owner, CronErrors.P_CANCEL_BY_ORDER_OR_DELEGATE_ONLY);
    }

    // Min amounts out are zero here intentionally as values coming out are stored in proceeds and
    // order accounting variables, not reserves, and thus are not subject to price manipulation or
    // sandwich attacks the same way that reserves are.
    uint256[] memory minAmountsOut = new uint256[](2);

    bytes memory userData = abi.encode(ICronV1PoolEnums.ExitType.Cancel, _orderId);

    VAULT.exitPool(
      poolId,
      _caller,
      payable(_recipient),
      IVault.ExitPoolRequest(
        _getPoolAssets(poolId),
        minAmountsOut,
        userData,
        false // toInternalBalance
      )
    );
  }

  /// @notice Gets the Balancer Vault instance this periphery relayer library is servicing.
  /// @return a Balancer Vault instance.
  ///
  function getVault() public view override(IBaseRelayerLibrary) returns (IVault) {
    return VAULT;
  }

  /// @notice Gets the periphery relayer contract instantiated by this library, that serves as
  ///         the user relayer entrypoint to CronFi Time-Weighted Average Market Maker (TWAMM)
  ///         pools.
  /// @return a instance of the CronFi Relayer serving as an entry point to this library.
  function getEntrypoint() public view returns (ICronV1Relayer) {
    return ENTRY_POINT;
  }

  /// @notice Gets the CronFi Time-Weighted Average Market Maker (TWAMM) factory contract
  ///         instance used by this periphery relayer library to select CronFi TWAMM pools.
  /// @return a CronFi TWAMM factory instance.
  ///
  function getFactory() public view returns (ICronV1PoolFactory) {
    return FACTORY;
  }

  /// @notice Gets the Balancer pool address and pool id for the provided token addresses and pool type,
  ///         if available. Reverts if the pool is not available with the reason why if possible.
  /// @param _tokenIn the address of the token being sold to the pool by the calling account.
  /// @param _tokenOut the address of the token being bought from the pool by the calling account.
  /// @param _poolType a number mapping to the PoolType enumeration (see ICronV1PoolEnums.sol::PoolType for the
  ///                  enumeration definition):
  ///                  Stable = 0
  ///                  Liquid = 1
  ///                  Volatile = 2
  ///                  Min. = 0, Max. = 2
  /// @return pool the address of the unique CronFi pool for the provided token addresses and pool type.
  /// @return poolId the Balancer pool id corresponding to the returned pool address.
  ///
  function _getPoolInfoAndCheckValid(
    address _tokenIn,
    address _tokenOut,
    uint256 _poolType
  ) internal view returns (address pool, bytes32 poolId) {
    requireErrCode(_tokenIn != C.NULL_ADDR, CronErrors.P_INVALID_TOKEN_IN_ADDRESS);
    requireErrCode(_tokenOut != C.NULL_ADDR, CronErrors.P_INVALID_TOKEN_OUT_ADDRESS);

    requireErrCode(_poolType < 3, CronErrors.P_INVALID_POOL_TYPE);
    pool = FACTORY.getPool(_tokenIn, _tokenOut, _poolType);
    requireErrCode(pool != C.NULL_ADDR, CronErrors.P_NON_EXISTING_POOL);

    poolId = ICronV1Pool(pool).POOL_ID();
    requireErrCode(poolId != "", CronErrors.P_INVALID_POOL_ADDRESS);
  }

  /// @notice Checks the amount of token being sold by the user to the pool is within acceptable bounds, reverts
  ///         otherwise. Also confirms that the user has sufficient amount of that token available in their
  ///         account, reverts otherwise.
  /// @param _amountIn is the user specified amount of a token to sell to the pool in a long-term or regular swap.
  ///                  Min. = 0, Max. = (2**112) - 1
  /// @param  _tokenIn the address of the token being sold to the pool by the user.
  /// @param _account the address of the user selling the token to the pool.
  ///
  function _checkAmountIn(
    uint256 _amountIn,
    address _tokenIn,
    address _account
  ) internal view {
    requireErrCode(_amountIn > 0 && _amountIn < C.MAX_U112, CronErrors.P_INVALID_AMOUNT_IN);
    requireErrCode(IERC20(_tokenIn).balanceOf(_account) >= _amountIn, CronErrors.P_INSUFFICIENT_TOKEN_IN_USER_BALANCE);
  }

  /// @notice Gets the tokens and balances for the pool specified by the pool id. Checks to ensure
  ///         the balances are greater than the MINIMUM_LIQUIDITY constraint (reverts otherwise).
  ///         Converts the token instances fetched from the pool into a sorted array of Asset instances;
  ///         the sort order is that Asset instance 0 (the first instance) corresponds to the address
  ///         specified for token in. Asset instance 1 (the second instance) corresponds to the address
  ///         specified for token out (there's only two assets in all these pools).
  ///
  ///         For convenience and clarity, the array of Asset instances should be indexed with the
  ///         provided constants ASSET_IN (0) and ASSET_OUT (1).
  ///
  /// @param _poolId the Balancer pool id for the pool to fetch tokens and balances of.
  /// @param  _tokenIn the address of the token being sold to the pool by the user.
  /// @return assetInOut an array of Asset instances for the pool corresponding to pool id sorted
  ///                    in the order of token in to token out. See notice above for more details.
  function _getPoolAssetsAndCheckBalances(bytes32 _poolId, address _tokenIn)
    internal
    view
    returns (IAsset[] memory assetInOut)
  {
    (IERC20[] memory tokens, uint256[] memory balances, ) = VAULT.getPoolTokens(_poolId);
    requireErrCode(
      balances[0] > C.MINIMUM_LIQUIDITY && balances[1] > C.MINIMUM_LIQUIDITY,
      CronErrors.P_POOL_HAS_NO_LIQUIDITY
    );

    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    assetInOut = new IAsset[](2);
    assetInOut[ASSET_IN] = (_tokenIn == address(tokens[0])) ? assets[0] : assets[1];
    assetInOut[ASSET_OUT] = (_tokenIn == address(tokens[0])) ? assets[1] : assets[0];
  }

  /// @notice This method computes the effective amount of an order that the pool can process for
  ///         a long-term swap verses a user specified amount. The difference between the two values
  ///         results from a truncation error due to division of the user specified amount by the
  ///         trade length. Losses due to this truncation are multiplied by the trade length.
  ///
  /// @param _amountIn is the user specified amount of a token to sell to the pool in a long-term swap.
  ///                  Min. = 0, Max. = (2**112) - 1
  /// @param _orderIntervals is the length of the long-term swap in order block intervals (OBI).
  /// @return effectiveAmountIn is the amount of the user specified order amount that would be sold to
  ///                           to the pool for the opposing token and not lost due to truncation.
  ///                           Min. = 0, Max. = (2**112) - 1
  ///
  function _getEffectiveAmountInAndCheckIntervals(
    uint256 _amountIn,
    uint256 _orderIntervals,
    ICronV1PoolEnums.PoolType _poolType
  ) internal view returns (uint256 effectiveAmountIn) {
    requireErrCode(_orderIntervals > 0, CronErrors.P_INVALID_INTERVAL_AMOUNT);

    // #unchecked
    //            The value of _poolType is unchecked here because this function is always called after
    //            function _getPoolInfoAndCheckValid, which ensures that _poolType is within the PoolType Enum's
    //            range.
    uint256 orderBlockInterval;
    if (_poolType == ICronV1PoolEnums.PoolType.Stable) {
      requireErrCode(_orderIntervals <= C.STABLE_MAX_INTERVALS, CronErrors.P_MAX_ORDER_LENGTH_EXCEEDED);
      orderBlockInterval = C.STABLE_OBI;
    } else if (_poolType == ICronV1PoolEnums.PoolType.Liquid) {
      requireErrCode(_orderIntervals <= C.LIQUID_MAX_INTERVALS, CronErrors.P_MAX_ORDER_LENGTH_EXCEEDED);
      orderBlockInterval = C.LIQUID_OBI;
    } else {
      requireErrCode(_orderIntervals <= C.VOLATILE_MAX_INTERVALS, CronErrors.P_MAX_ORDER_LENGTH_EXCEEDED);
      orderBlockInterval = C.VOLATILE_OBI;
    }

    // The calculation for trade blocks is an optimized version from the core contract (since intermediate
    // values are not required here).
    //
    // #unchecked:
    //             Multiplication of orderBlockInterval and _orderIntervals is unchecked below because
    //             orderBlockInterval maxes out at 1200 and _orderIntervals at 175320, much less than
    //             MAX_U256.
    //             Similarly the subtraction of the modulus of block.number by orderBlockInterval is not
    //             checked since this value isless than the orderBlockInterval (and certainly less than an
    //             integer product of the orderBlockInterval).
    uint256 tradeBlocks = orderBlockInterval * (_orderIntervals + 1) - (block.number % orderBlockInterval);

    uint256 sellingRateU112 = _amountIn / tradeBlocks; // Intended: Solidity rounds towards zero.

    // #unchecked:
    //             The multiplication below is unchecked as it was explained that the value of tradeBlocks
    //             is much less than MAX_U256 (or even MAX_U112) above and the value of sellingRateU112 has
    //             an upper bound of _amountIn, which is confirmed to be less than or equal to MAX_U112 in
    //             the function _checkAmountIn.
    effectiveAmountIn = sellingRateU112 * tradeBlocks;
  }

  /// @notice Gets a deadline timestamp--a timestamp in the future used to cue the Balancer Vault to
  ///         ignore a transaction that has sat in the mempool for an excessive amount of time.
  /// @return deadline the current block timestamp plus five minutes (in seconds).
  ///
  function _getDeadline() internal view returns (uint256 deadline) {
    deadline = block.timestamp + FIVE_MIN_IN_SEC;
  }

  /// @notice Gets the pool's Asset instances in Balancer token sort order given the Balancer pool id.
  /// @param _poolId the Balancer pool id for the pool to fetch tokens to be converted to asset instances.
  /// @return assets an array of ERC 20 token instances converted to Asset instances.
  ///
  function _getPoolAssets(bytes32 _poolId) internal view returns (IAsset[] memory assets) {
    (IERC20[] memory tokens, , ) = VAULT.getPoolTokens(_poolId);

    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }

  /// @notice Converts an array of ERC20 instances to Asset instances.
  /// @param _tokens an array of ERC20 token instances to convert to Asset instances.
  /// @return assets an array of ERC 20 token instances converted to Asset instances.
  ///
  function _convertERC20sToAssets(IERC20[] memory _tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := _tokens
    }
  }
}
