pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";

import { IERC20 } from "../../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";

import { Vault } from "../../balancer-core-v2/vault/Vault.sol";
import { Authorizer } from "../../balancer-core-v2/vault/Authorizer.sol";
import { IAuthorizer } from "../../balancer-core-v2/vault/interfaces/IAuthorizer.sol";
import { IWETH } from "../../balancer-core-v2/vault/interfaces/IWETH.sol";
import { WETH } from "../../balancer-core-v2/test/WETH.sol";

import { TestToken } from "../../helpers/TestToken.sol";
import { ICronV1Pool } from "../../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../../interfaces/pool/ICronV1PoolEnums.sol";
import { ICronV1PoolFactory } from "../../interfaces/ICronV1PoolFactory.sol";
import { CronV1PoolFactory } from "../../factories/CronV1PoolFactory.sol";

import { CronV1Actions } from "../../periphery/CronV1Actions.sol";
import { CronV1Relayer } from "../../periphery/CronV1Relayer.sol";
import { ICronV1Relayer } from "../../interfaces/ICronV1Relayer.sol";

import { Order } from "../../interfaces/Structs.sol";

import { C } from "../../miscellany/Constants.sol";

contract RelayerEffectiveAmountInTest is Test {
  address public owner;
  address public delegate;
  Authorizer public authorizer;
  ICronV1Relayer public relayer;
  CronV1Actions public relayerLib;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken public token1;
  TestToken public token2;
  address public pool;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    authorizer = new Authorizer(owner);
    vault = new Vault(authorizer, IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    vm.label(owner, "owner");
    vm.label(delegate, "delegate");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
    // create Cron-Fi Relayer & Actions:
    relayerLib = new CronV1Actions(IVault(address(vault)), ICronV1PoolFactory(address(factory)));
    relayer = ICronV1Relayer(address(relayerLib.getEntrypoint()));
    // create two mock tokens
    uint256 mintAmount = 2**112;
    token1 = new TestToken("T1", "T1", mintAmount);
    token2 = new TestToken("T2", "T2", mintAmount);
    delegate = vm.addr(1337);
    bytes32[] memory roles = generateActionIds(address(vault));
    authorizer.grantRoles(roles, address(relayer));
  }

  // Effective Amount In Test 1  (P1)
  // 1. Create a pool (1M Token A and B, both 18 decimals)
  // 2. Move the EVM's current block to n * pool OBI
  //   a) Issue an LT Swap for 3 intervals with amount = 1000e18 * 4 * OBI
  //   b) Confirm that the exact amount, 1000e18 * 4 * OBI, was transferred 
  //       from the user to the pool.
  function testManualEffectiveAmount1Stable() public {
    pool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      uint256(ICronV1PoolEnums.PoolType.Stable)
    );
    addLiquidity(pool, owner, owner, 1e24, 1e24, 0);
    IERC20(token1).transfer(owner, 1e23);
    IERC20(token2).transfer(owner, 1e23);
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    uint256 n = 4 * C.STABLE_OBI;
    mineBlocks(n);
    uint effectiveAmount = 1e23 * n;
    token1.approve(address(vault), effectiveAmount);
    uint preToken1 = IERC20(token1).balanceOf(owner);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Stable), // Pool type
      effectiveAmount,                           // Swap Amount
      3,                                         // Number of intervals
      owner                                      // Destination
    );
    mineBlocks(C.STABLE_OBI);
    uint postToken1 = IERC20(token1).balanceOf(owner);
    assertApproxEqRel(preToken1 - postToken1, effectiveAmount, 1);
  }

  function testManualEffectiveAmount1Liquid() public {
    pool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      1
    );
    addLiquidity(pool, owner, owner, 1e24, 1e24, 0);
    IERC20(token1).transfer(owner, 1e23);
    IERC20(token2).transfer(owner, 1e23);
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    mineBlocks(4 * C.LIQUID_OBI);
    uint effectiveAmount = 1e23 * 4 * C.LIQUID_OBI;
    token1.approve(address(vault), effectiveAmount);
    uint preToken1 = IERC20(token1).balanceOf(owner);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      effectiveAmount,                           // Swap Amount
      3,                                         // Number of intervals
      owner                                      // Destination
    );
    mineBlocks(C.LIQUID_OBI);
    uint postToken1 = IERC20(token1).balanceOf(owner);
    assertApproxEqRel(preToken1 - postToken1, effectiveAmount, 1);
  }

  function testManualEffectiveAmount1Volatile() public {
    pool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      uint256(ICronV1PoolEnums.PoolType.Volatile)
    );
    addLiquidity(pool, owner, owner, 1e24, 1e24, 0);
    IERC20(token1).transfer(owner, 1e23);
    IERC20(token2).transfer(owner, 1e23);
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    mineBlocks(4 * C.VOLATILE_OBI);
    uint effectiveAmount = 1e23 * 4 * C.VOLATILE_OBI;
    token1.approve(address(vault), effectiveAmount);
    uint preToken1 = IERC20(token1).balanceOf(owner);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Volatile), // Pool type
      effectiveAmount,                           // Swap Amount
      3,                                         // Number of intervals
      owner                                      // Destination
    );
    mineBlocks(C.VOLATILE_OBI);
    uint postToken1 = IERC20(token1).balanceOf(owner);
    assertApproxEqRel(preToken1 - postToken1, effectiveAmount, 1);
  }

  // Effective Amount In Test 2  (P1)
  // 1. Create a pool (1M Token A and B, both 18 decimals)
  // 2. Move the EVM's current block to n * pool OBI + 1
  //   a) Issue an LT Swap for 3 intervals with amount = 1000e18 * 4 * OBI
  //   b) Confirm that the exact amount, (1000e18 * 4 * OBI) / (4 * OBI + 1), was
  //       transferred from the user to the pool.
  //       IMPORTANT: the division in the amount above is truncating integer division
  //                 and should result in less than 1000e18*4*OBI being traded.
  function testManualEffectiveAmount2Stable() public {
    pool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      uint256(ICronV1PoolEnums.PoolType.Stable)
    );
    addLiquidity(pool, owner, owner, 1e24, 1e24, 0);
    IERC20(token1).transfer(owner, 1e23);
    IERC20(token2).transfer(owner, 1e23);
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    uint256 n = 4 * C.STABLE_OBI + 1;
    mineBlocks(n);
    uint desiredAmount = 1e21 * 4 * C.STABLE_OBI;
    token1.approve(address(vault), desiredAmount);
    (, , uint256 effectiveAmount) = _getEffectiveLongTermTradeParams(desiredAmount, 3, ICronV1PoolEnums.PoolType.Stable);
    uint preToken1 = IERC20(token1).balanceOf(owner);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Stable), // Pool type
      desiredAmount,                             // Swap Amount
      3,                                         // Number of intervals
      owner                                      // Destination
    );
    mineBlocks(C.LIQUID_OBI);
    uint postToken1 = IERC20(token1).balanceOf(owner);
    assertEq(preToken1 - postToken1, effectiveAmount);
  }

  function testManualEffectiveAmount2Liquid() public {
    pool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      uint256(ICronV1PoolEnums.PoolType.Liquid)
    );
    addLiquidity(pool, owner, owner, 1e24, 1e24, 0);
    IERC20(token1).transfer(owner, 1e23);
    IERC20(token2).transfer(owner, 1e23);
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    mineBlocks(4 * C.LIQUID_OBI + 1);
    uint desiredAmount = 1e21 * 4 * C.LIQUID_OBI;
    token1.approve(address(vault), desiredAmount);
    (, , uint256 effectiveAmount) = _getEffectiveLongTermTradeParams(desiredAmount, 3, ICronV1PoolEnums.PoolType.Liquid);
    uint preToken1 = IERC20(token1).balanceOf(owner);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      desiredAmount,                             // Swap Amount
      3,                                         // Number of intervals
      owner                                      // Destination
    );
    mineBlocks(C.LIQUID_OBI);
    uint postToken1 = IERC20(token1).balanceOf(owner);
    assertEq(preToken1 - postToken1, effectiveAmount);
  }

  function testManualEffectiveAmount2Volatile() public {
    pool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      uint256(ICronV1PoolEnums.PoolType.Volatile)
    );
    addLiquidity(pool, owner, owner, 1e24, 1e24, 0);
    IERC20(token1).transfer(owner, 1e23);
    IERC20(token2).transfer(owner, 1e23);
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    mineBlocks(4 * C.VOLATILE_OBI + 1);
    uint desiredAmount = 1e23 * 4 * C.VOLATILE_OBI;
    token1.approve(address(vault), desiredAmount);
    (, , uint256 effectiveAmount) = _getEffectiveLongTermTradeParams(desiredAmount, 3, ICronV1PoolEnums.PoolType.Volatile);
    uint preToken1 = IERC20(token1).balanceOf(owner);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Volatile), // Pool type
      desiredAmount,                           // Swap Amount
      3,                                         // Number of intervals
      owner                                      // Destination
    );
    mineBlocks(C.LIQUID_OBI);
    uint postToken1 = IERC20(token1).balanceOf(owner);
    assertEq(preToken1 - postToken1, effectiveAmount);
  }

  function addLiquidity(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) public {
    // setup parameters for joinPool
    bytes memory userData = getJoinUserData(_joinKind, _liquidity0, _liquidity1);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
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
    IVault(address(vault)).joinPool(
      poolId,
      _from,
      payable (_to),
      IVault.JoinPoolRequest(
        assets,
        maxAmountsIn,
        userData,
        fromInternalBalance
      )
    );
  }

  function mineBlocks(uint256 _numBlocks) public {
    // emit log_uint(block.number);
    for (uint256 i = 0; i < _numBlocks; ++i) {
      string[] memory inputs = new string[](3);
      inputs[0] = "cast";
      inputs[1] = "rpc";
      inputs[2] = "anvil_mine";
      vm.ffi(inputs);
    }
    uint256 secondsPerBlock = 12;
    vm.roll(block.number + _numBlocks);
    vm.warp(block.timestamp + secondsPerBlock);
    // console.log("block time", block.timestamp);
    // emit log_uint(block.number);
  }

  function mineBlocks() public {
    mineBlocks(1);
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

  function generateActionId(address _vault, string memory fn) public pure returns (bytes32) {
    bytes32 disambiguator = bytes32(uint256(address(_vault)));
    bytes4 selector = bytes4(keccak256(bytes(fn)));
    return keccak256(abi.encodePacked(disambiguator, selector));
  }

  function generateActionIds(address _vault) public pure returns (bytes32[] memory) {
    string[] memory fns = new string[](10);
    fns[0] = "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)";
    fns[1] = "joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))";
    fns[2] = "exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))";

    bytes32[] memory roles = new bytes32[](fns.length);
    for (uint256 i = 0; i < fns.length; i++) {
      bytes32 role = generateActionId(_vault, fns[i]);
      roles[i] = role;
    }
    return roles;
  }

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
  
  function _getEffectiveLongTermTradeParams(
    uint256 _amountIn,
    uint256 _orderIntervals,
    ICronV1PoolEnums.PoolType _poolType
  ) internal view returns (uint256 tradeBlocks, uint256 sellingRate, uint256 effectiveAmountIn) {
    require(_orderIntervals > 0, "CronErrors.P_INVALID_INTERVAL_AMOUNT");

    // #unchecked
    //            The value of _poolType is unchecked here because this function is always called after
    //            function _getPoolInfoAndCheckValid, which ensures that _poolType is within the PoolType Enum's
    //            range.
    uint256 orderBlockInterval;
    if (_poolType == ICronV1PoolEnums.PoolType.Stable) {
      require(_orderIntervals <= C.STABLE_MAX_INTERVALS, "CronErrors.P_MAX_ORDER_LENGTH_EXCEEDED");
      orderBlockInterval = C.STABLE_OBI;
    } else if (_poolType == ICronV1PoolEnums.PoolType.Liquid) {
      require(_orderIntervals <= C.LIQUID_MAX_INTERVALS, "CronErrors.P_MAX_ORDER_LENGTH_EXCEEDED");
      orderBlockInterval = C.LIQUID_OBI;
    } else {
      require(_orderIntervals <= C.VOLATILE_MAX_INTERVALS, "CronErrors.P_MAX_ORDER_LENGTH_EXCEEDED");
      orderBlockInterval = C.VOLATILE_OBI;
    }

    // The calculation for trade blocks is an optimized version from the core contract (since intermediate
    // values are not required here).
    //
    // #unchecked:
    //             Multiplication of orderBlockInterval and _orderIntervals is unchecked below because
    //             orderBlockInterval maxes out at 1200 and _orderIntervals at 175320, much less than
    //             MAX_U256.
    //             Similarly the addition of the modulus of block.number by orderBlockInterval is not
    //             checked since this value is much less than MAX_U256, except at a point in the future
    //             when this system is unlikely to be operational (in ~75 years the value of block.number
    //             will approach MAX_U112 for 12s block times).
    tradeBlocks = orderBlockInterval * (_orderIntervals + 1) - (block.number % orderBlockInterval);

    sellingRate = _amountIn / tradeBlocks; // Intended: Solidity rounds towards zero.

    // #unchecked:
    //             The multiplication below is unchecked as it was explained that the value of tradeBlocks
    //             is much less than MAX_U256 (or even MAX_U112) above and the value of sellingRate has
    //             an upper bound of _amountIn, which is confirmed to be less than or equal to MAX_U112 in
    //             the function _checkAmountIn.
    effectiveAmountIn = sellingRate * tradeBlocks;
  }

}
