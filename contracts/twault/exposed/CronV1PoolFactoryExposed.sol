// SPDX-License-Identifier: Apache-2.0

// solhint-disable-next-line strict-import
pragma solidity ^0.7.6;

import { IERC20 } from "../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IVault } from "../balancer-core-v2/vault/interfaces/IVault.sol";
import { BasePoolFactory } from "../balancer-core-v2/pools/factories/BasePoolFactory.sol";
import { ICronV1Pool } from "../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../interfaces/pool/ICronV1PoolEnums.sol";
import { CronV1Pool } from "../CronV1Pool.sol";
import { CronV1PoolExposed } from "./CronV1PoolExposed.sol";
import { requireErrCode, CronErrors } from "../miscellany/Errors.sol";

contract CronV1PoolFactoryExposed is BasePoolFactory {
  // This contract deploys CronV1 pools

  address public owner;
  mapping(address => mapping(address => mapping(uint256 => address))) public getPool;

  /// @notice This event tracks pool creations from this factory
  /// @param pool the address of the pool
  /// @param token0 The token 0 in this pool
  /// @param token1 The token 1 in this pool
  /// @param poolType The poolType set for this pool
  event CronV1PoolCreated(
    address indexed pool,
    address indexed token0,
    address indexed token1,
    ICronV1Pool.PoolType poolType
  );

  /// @notice This event tracks pool creations from this factory
  /// @param oldAdmin the address of the previous admin
  /// @param newAdmin the address of the new admin
  event OwnerChanged(address indexed oldAdmin, address indexed newAdmin);

  /// @notice This function constructs the pool
  /// @param _vault The balancer v2 vault
  constructor(IVault _vault) BasePoolFactory(_vault) {
    owner = msg.sender;
  }

  /// @notice Deploys a new `CronV1Pool`
  /// @param _token0 The asset which is converged to ie "base'
  /// @param _token1 The asset which converges to the underlying
  /// @param _poolType The type of pool (stable, liquid, volatile)
  /// @param _name The name of the balancer v2 lp token for this pool
  /// @param _symbol The symbol of the balancer v2 lp token for this pool
  /// @param _pauser An address with the power to stop trading and deposits
  /// @return The new pool address
  function createExposed(
    address _token0,
    address _token1,
    string memory _name,
    string memory _symbol,
    uint256 _poolType,
    address _pauser
  ) external returns (address) {
    ICronV1PoolEnums.PoolType poolType = ICronV1PoolEnums.PoolType(_poolType);
    requireErrCode(_token0 != _token1, CronErrors.IDENTICAL_TOKEN_ADDRESSES);
    (address token0, address token1) = _token0 < _token1 ? (_token0, _token1) : (_token1, _token0);
    requireErrCode(token0 != address(0), CronErrors.ZERO_TOKEN_ADDRESSES);
    requireErrCode(getPool[token0][token1][_poolType] == address(0), CronErrors.EXISTING_POOL);
    address pool = address(
      new CronV1PoolExposed(IERC20(token0), IERC20(token1), getVault(), _name, _symbol, poolType, _pauser)
    );
    // Register the pool with the vault
    _register(pool);
    // Stores pool information to prevent duplicates
    getPool[token0][token1][_poolType] = pool;
    // Emit a creation event
    emit CronV1PoolCreated(pool, _token0, _token1, poolType);
    return pool;
  }
}
