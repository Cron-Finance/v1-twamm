// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.7.6;

import { IERC20 } from "../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IVault } from "../balancer-core-v2/vault/interfaces/IVault.sol";
import { BasePoolFactory } from "../balancer-core-v2/pools/factories/BasePoolFactory.sol";
import { ICronV1PoolFactory } from "../interfaces/ICronV1PoolFactory.sol";
import { ICronV1PoolEnums } from "../interfaces/pool/ICronV1PoolEnums.sol";
import { CronV1Pool } from "../CronV1Pool.sol";
import { requireErrCode, CronErrors } from "../miscellany/Errors.sol";

/// @author Cron Finance
/// @title Cron V1 Pool Factory
contract CronV1PoolFactory is ICronV1PoolFactory, BasePoolFactory {
  address public override owner;
  address public override pendingOwner;
  mapping(address => mapping(address => mapping(uint256 => address))) internal poolMap;

  /// @notice Only allows the `owner` to execute the function.
  modifier onlyOwner() {
    requireErrCode(msg.sender == owner, CronErrors.INVALID_FACTORY_OWNER);
    _;
  }

  /// @notice This function constructs the pool
  /// @param _vault The balancer v2 vault
  constructor(IVault _vault) BasePoolFactory(_vault) {
    owner = msg.sender;
    emit OwnerChanged(address(0), owner);
  }

  /// @notice Deploys a new `CronV1Pool`
  /// @param _token0 The asset which is converged to ie "base'
  /// @param _token1 The asset which converges to the underlying
  /// @param _poolType The type of pool (stable, liquid, volatile)
  /// @param _name The name of the balancer v2 lp token for this pool
  /// @param _symbol The symbol of the balancer v2 lp token for this pool
  /// @return The new pool address
  function create(
    address _token0,
    address _token1,
    string memory _name,
    string memory _symbol,
    uint256 _poolType
  ) external override(ICronV1PoolFactory) returns (address) {
    ICronV1PoolEnums.PoolType poolType = ICronV1PoolEnums.PoolType(_poolType);
    requireErrCode(_token0 != _token1, CronErrors.IDENTICAL_TOKEN_ADDRESSES);
    (address token0, address token1) = _token0 < _token1 ? (_token0, _token1) : (_token1, _token0);
    requireErrCode(token0 != address(0), CronErrors.ZERO_TOKEN_ADDRESSES);
    requireErrCode(poolMap[token0][token1][_poolType] == address(0), CronErrors.EXISTING_POOL);
    address pool = address(new CronV1Pool(IERC20(token0), IERC20(token1), getVault(), _name, _symbol, poolType));
    // Register the pool with the vault
    _register(pool);
    // Stores pool information to prevent duplicates
    poolMap[token0][token1][_poolType] = pool;
    // Emit a creation event
    emit CronV1PoolCreated(pool, _token0, _token1, poolType);
    return pool;
  }

  /// @notice Sets `CronV1Pool` address in the mapping
  /// @param _token0 address of token0
  /// @param _token1 address of token1
  /// @param _poolType type of pool (stable, liquid, volatile)
  /// @param _pool address of pool to set in the mapping
  function set(
    address _token0,
    address _token1,
    uint256 _poolType,
    address _pool
  ) external override(ICronV1PoolFactory) onlyOwner {
    poolMap[_token0][_token1][_poolType] = _pool;
    ICronV1PoolEnums.PoolType poolType = ICronV1PoolEnums.PoolType(_poolType);
    emit CronV1PoolSet(_pool, _token0, _token1, poolType);
  }

  /// @notice Removes an already deployed `CronV1Pool` from the mapping
  ///         WARNING - Best practice to disable Cron-Fi fees before
  ///         removing it from the factory pool mapping. Also advisable
  ///         to notify LPs / LT swappers in some way that this is
  ///         occurring.
  /// @param _token0 address of token0
  /// @param _token1 address of token1
  /// @param _poolType type of pool (stable, liquid, volatile)
  function remove(
    address _token0,
    address _token1,
    uint256 _poolType
  ) external override(ICronV1PoolFactory) onlyOwner {
    address pool = poolMap[_token0][_token1][_poolType];
    requireErrCode(pool != address(0), CronErrors.NON_EXISTING_POOL);
    poolMap[_token0][_token1][_poolType] = address(0);
    ICronV1PoolEnums.PoolType poolType = ICronV1PoolEnums.PoolType(_poolType);
    emit CronV1PoolRemoved(pool, _token0, _token1, poolType);
  }

  /// @notice Transfers ownership to `_newOwner`. Either directly or claimable by the new pending owner.
  /// Can only be invoked by the current `owner`.
  /// @param _newOwner Address of the new owner.
  /// @param _direct True if `_newOwner` should be set immediately. False if `_newOwner` needs to use `claimOwnership`.
  /// @param _renounce Allows the `_newOwner` to be `address(0)` if `_direct` and `_renounce` is True. Has no effect otherwise.
  function transferOwnership(
    address _newOwner,
    bool _direct,
    bool _renounce
  ) external override(ICronV1PoolFactory) onlyOwner {
    if (_direct) {
      requireErrCode(_newOwner != address(0) || _renounce, CronErrors.ZERO_TOKEN_ADDRESSES);
      emit OwnerChanged(owner, _newOwner);
      owner = _newOwner;
      pendingOwner = address(0);
    } else {
      pendingOwner = _newOwner;
    }
  }

  /// @notice Needs to be called by `pendingOwner` to claim ownership.
  function claimOwnership() external override(ICronV1PoolFactory) {
    address _pendingOwner = pendingOwner;
    requireErrCode(msg.sender == _pendingOwner, CronErrors.INVALID_PENDING_OWNER);
    emit OwnerChanged(owner, _pendingOwner);
    owner = _pendingOwner;
    pendingOwner = address(0);
  }

  /// @notice Gets existing pool for given address pair post sort and pool type
  /// @param _token0 address of token 0
  /// @param _token1 address of token 1
  /// @param _poolType type of pool
  function getPool(
    address _token0,
    address _token1,
    uint256 _poolType
  ) external view override(ICronV1PoolFactory) returns (address) {
    (address token0, address token1) = _token0 < _token1 ? (_token0, _token1) : (_token1, _token0);
    return poolMap[token0][token1][_poolType];
  }
}
