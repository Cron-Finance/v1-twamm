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

contract RelayerGetOrderTest is Test {
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
  TestToken public token3;
  address public stablePool;
  address public liquidPool;
  address public volatilePool;

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
    token3 = new TestToken("T3", "T3", mintAmount);
    delegate = vm.addr(1337);
    bytes32[] memory roles = generateActionIds(address(vault));
    authorizer.grantRoles(roles, address(relayer));
    stablePool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      uint256(ICronV1PoolEnums.PoolType.Stable)
    );
    liquidPool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      uint256(ICronV1PoolEnums.PoolType.Liquid)
    );
    volatilePool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      uint256(ICronV1PoolEnums.PoolType.Volatile)
    );
    addLiquidity(stablePool, owner, owner, 1e24, 1e24, 0);
    addLiquidity(liquidPool, owner, owner, 1e24, 1e24, 0);
    addLiquidity(volatilePool, owner, owner, 1e24, 1e24, 0);
  }

  // getOrder Test 1  (P1)
  // 1.  Create a STABLE pool (1M Token A and B, both 18 decimals)
  // 2.  Store the pool address from the above creation
  // 3.  Create a LIQUID pool (1M Token A and B, both 18 decimals)
  // 4.  Store the pool address from the above creation
  // 5.  Create a VOLATILE pool (1M Token A and B, both 18 decimals)
  // 6.  Store the pool address from the above creation
  // 7.  User X issues LT swaps on all three pools (different amounts and lengths 
  //     for each)
  // 8.  User Y issues LT swap on the LIQUID pool
  // 9.  Do some mining for a couple blocks
  // 10. User Z calls getOrder with Token A, B and Pool Type STABLE with order id 0
  //     - check Order has no delegate
  //     - check Order owner is User X
  //     - confirm Order amount is correct
  //     - confirm returned pool address is correct
  // 11. User X calls getOrder with Token A, B and Pool Type LIQUID with order id 0
  //     - check Order has no delegate
  //     - check Order owner is User X
  //     - confirm Order amount is correct
  //     - confirm returned pool address is correct
  // 12. User X calls getOrder with Token A, B and Pool Type LIQUID with order id 1
  //     - check Order has no delegate
  //     - check Order owner is User Y
  //     - confirm Order amount is correct
  // 13. User Y calls getOrder with Token A, B and Pool Type LIQUID with order id 1
  //     - check Order has no delegate
  //     - check Order owner is User Y
  //     - confirm Order amount is correct
  // 14. User Y calls getOrder with Token A, B and Pool Type LIQUID with order id 2
  //     - check all order struct data is empty (0)
  // 15. Mine to the end of the orders
  // 16. Get User Y to withdraw their order
  // 17. User Y calls getOrder with Token A, B and Pool Type LIQUID with order id 1
  //     - check all order struct data is empty (0) (cleared from withdrawal)
  function testManualGetPoolAddress() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    token1.approve(address(vault), 1e30);
    address xTrader = owner;
    (, uint256 salesRateStableOrder0,) = 
      _getEffectiveLongTermTradeParams(1000e18, 10, ICronV1PoolEnums.PoolType.Stable);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Stable), // Pool type
      1000e18,                                   // Swap Amount
      10,                                        // Number of intervals
      owner                                      // Destination
    );
    (, uint256 salesRateLiquidOrder0,) =
      _getEffectiveLongTermTradeParams(2000e18, 15, ICronV1PoolEnums.PoolType.Liquid);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      2000e18,                                   // Swap Amount
      15,                                        // Number of intervals
      owner                                      // Destination
    );
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Volatile), // Pool type
      3000e18,                                   // Swap Amount
      5,                                       // Number of intervals
      owner                                      // Destination
    );
    mineBlocks(100);
    address yTrader = vm.addr(1323);
    token1.transfer(yTrader, 1e24);
    vm.startPrank(yTrader);
    token1.approve(address(vault), 1e24);
    vault.setRelayerApproval(yTrader, address(relayer), true);
    assertEq(vault.hasApprovedRelayer(yTrader, address(relayer)), true);
    (, uint256 salesRateLiquidOrder1,) =
      _getEffectiveLongTermTradeParams(500e18, 10, ICronV1PoolEnums.PoolType.Liquid);
    relayer.longTermSwap(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      500e18,                                    // Swap Amount
      10,                                        // Number of intervals
      yTrader                                    // Destination
    );
    vm.stopPrank();
    mineBlocks(100);
    address zTrader = vm.addr(444);
    vm.startPrank(zTrader);
    vault.setRelayerApproval(zTrader, address(relayer), true);
    assertEq(vault.hasApprovedRelayer(zTrader, address(relayer)), true);
    (address _stablePool, Order memory stableOrder) = relayer.getOrder(address(token1), address(token2), uint256(ICronV1PoolEnums.PoolType.Stable), 0);
    assertEq(_stablePool, stablePool, "pool address");
    assertEq(stableOrder.delegate, address(0), "delegate");
    assertEq(stableOrder.owner, xTrader, "owner");
    assertEq(uint256(stableOrder.salesRate), salesRateStableOrder0, "sales rate");
    vm.stopPrank();
    (address _liquidPool, Order memory liquidOrder0) = relayer.getOrder(address(token1), address(token2), uint256(ICronV1PoolEnums.PoolType.Liquid), 0);
    assertEq(_liquidPool, liquidPool, "pool address0");
    assertEq(liquidOrder0.delegate, address(0), "delegate0");
    assertEq(liquidOrder0.owner, xTrader, "owner0");
    assertEq(uint256(liquidOrder0.salesRate), salesRateLiquidOrder0, "sales rate0");
    (, Order memory liquidOrder1) = relayer.getOrder(address(token1), address(token2), uint256(ICronV1PoolEnums.PoolType.Liquid), 1);
    assertEq(liquidOrder1.delegate, address(0), "delegate1");
    assertEq(liquidOrder1.owner, yTrader, "owner1");
    assertEq(uint256(liquidOrder1.salesRate), salesRateLiquidOrder1, "sales rate1");
    vm.startPrank(yTrader);
    (, Order memory liquidOrder2) = relayer.getOrder(address(token1), address(token2), uint256(ICronV1PoolEnums.PoolType.Liquid), 1);
    assertEq(liquidOrder2.delegate, address(0), "delegate2");
    assertEq(liquidOrder2.owner, yTrader, "owner2");
    assertApproxEqRel(uint256(liquidOrder2.salesRate), salesRateLiquidOrder1, 5, "sales rate2");
    (, Order memory liquidOrder3) = relayer.getOrder(address(token1), address(token2), uint256(ICronV1PoolEnums.PoolType.Liquid), 2);
    assertEq(liquidOrder3.delegate, address(0), "delegate3");
    assertEq(liquidOrder3.owner, address(0), "owner3");
    assertEq(uint256(liquidOrder3.salesRate), 0, "sales rate3");
    assertEq(liquidOrder3.orderExpiry, 0, "order expiry3");
    mineBlocks(5 * C.VOLATILE_OBI);
    relayer.withdraw(
      address(token1),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      1,                                         // Order ID
      yTrader                                    // Recipient
    );
    (, Order memory liquidOrder4) = relayer.getOrder(address(token1), address(token2), uint256(ICronV1PoolEnums.PoolType.Liquid), 1);
    assertEq(liquidOrder4.delegate, address(0), "delegate4");
    assertEq(liquidOrder4.owner, address(0), "owner4");
    assertEq(uint256(liquidOrder4.salesRate), 0, "sales rate4");
    assertEq(liquidOrder4.orderExpiry, 0, "order expiry4");
    vm.stopPrank();
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
