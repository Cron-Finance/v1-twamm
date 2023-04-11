pragma solidity ^0.7.6;

pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

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

/*
// How to run this
// forge clean;
// forge build;
// forge test -vvvv --match-test testAuto
*/

contract AtomicActionsTest is Test {
  Authorizer public authorizer;
  ICronV1Relayer public relayer;
  CronV1Actions public relayerLib;

  address public owner;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken public tokenA;
  TestToken public tokenB;
  TestToken public tokenC;
  address public pool;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    authorizer = new Authorizer(owner);
    vault = new Vault(authorizer, IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
    // create Cron-Fi Relayer & Actions:
    relayerLib = new CronV1Actions(IVault(address(vault)), ICronV1PoolFactory(address(factory)));
    relayer = ICronV1Relayer(address(relayerLib.getEntrypoint()));
    // create two mock tokens
    uint256 mintAmount = 2**112;
    tokenA = new TestToken("TA", "TA", mintAmount);
    tokenB = new TestToken("TB", "TB", mintAmount);
    tokenC = new TestToken("TC", "TC", mintAmount);
    // create a TWAMM pool
    pool = factory.create(
      address(tokenA),
      address(tokenB),
      "T0-T1-Liquid",
      "T0-T1-L",
      uint256(ICronV1PoolEnums.PoolType.Liquid)
    );
    
    // Give the relayer authorization on action ids:
    {
      // New actionIds below from:
      //   https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/deployments/action-ids/mainnet/action-ids.json
      //
      // Production Vault Action IDs
      // address vault = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
      bytes32[] memory roles = generateActionIds(address(vault));
      authorizer.grantRoles(roles, address(relayer));
    }

    // Add liquidity
    address retailLP = vm.addr(100);
    tokenA.transfer(retailLP, 1000000e18);
    tokenB.transfer(retailLP, 1000000e18);
    vm.startPrank(retailLP);
    _join(pool,
      retailLP,
      retailLP,
      1000000e18,
      1000000e18,
      uint256(ICronV1PoolEnums.JoinType.Join)
    );
    vm.stopPrank();
  }

  function testAutoRelayerActionIds() public view {
    generateActionIds(address(vault));
  }

  function testAutoRegularSwap() public {
    address retailTrader = vm.addr(99);


    tokenB.transfer(retailTrader, 10e18);
    console.log("retailTrader tokenB bal:", tokenB.balanceOf(retailTrader));
    
    // Determine the trade direction:
    bool swapT0toT1 = true;
    {
      bytes32 poolId = ICronV1Pool(pool).POOL_ID();
      (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
      swapT0toT1 = address(tokenB) == address(tokens[0]);
    }

    vm.startPrank(retailTrader);
    _swap(10e18,                                   // Swap Amount
      0,                                           // Argument - ignored,
      ICronV1PoolEnums.SwapType.RegularSwap,
      swapT0toT1,
      pool,
      retailTrader);
    vm.stopPrank();
  }

  // Test for the set cron fi relayer convenience in the relayer contract (would get through 
  // vault and emit event but wouldn't persist state.
  //
//  function testAutoSetCronRelayer() public {
//    address retailTrader = vm.addr(99);
//
//    vm.startPrank(retailTrader);
//
//    // 0. Store the relayer state for the retailTrader
//    bool relayerApprovedInitState = vault.hasApprovedRelayer(retailTrader, address(relayer));
//    console.log("0. hasApprovedRelayer =", relayerApprovedInitState);
//
//    // 1. Disable relayer approval and confirm:
//    relayer.setCronRelayerApproval(false);
//    bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
//    assertEq(relayerApproved, false);
//    console.log("1. hasApprovedRelayer =", relayerApproved);
//    
//    // 2.5 Sanity check try approval direct:
//    vault.setRelayerApproval(retailTrader, address(relayer), true);
//    relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
//    assertEq(relayerApproved, true);
//    console.log("2.5 hasApprovedRelayer =", relayerApproved);
//
//    // 2. Enable relayer approval and confirm:
//    relayer.setCronRelayerApproval(true);
//    relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
//    assertEq(relayerApproved, true);
//    console.log("2. hasApprovedRelayer =", relayerApproved);
//
//    // 3. Restore intitial relayer approval state and confirm:
//    relayer.setCronRelayerApproval(relayerApprovedInitState);
//    relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
//    assertEq(relayerApproved, relayerApprovedInitState);
//    console.log("3. hasApprovedRelayer =", relayerApproved);
//
//    vm.stopPrank();
//  }

  function testAutoRelayerShortSwap() public {
    address retailTrader = vm.addr(99);

    uint256 slippageBP = 500;
    uint256 swapAmt = 1000e18;
    uint256 minSwapAmt = (swapAmt * (10000-slippageBP)) / 10000; 

    tokenB.transfer(retailTrader, swapAmt);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenB.approve(address(vault), swapAmt);
    relayer.swap(
      address(tokenB),                           // Token In
      address(tokenA),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,
      minSwapAmt,
      retailTrader                               // Destination
    );
    vm.stopPrank();
  }

  function testAutoRelayerLongSwap() public {
    _relayerLongSwap();
  }

  function testAutoRelayerLongSwapCancel() public {
    _relayerLongSwap();
    address retailLP = vm.addr(99);
    vm.startPrank(retailLP);
    relayer.cancel(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      0,                               // orderId
      retailLP                         // Receiver address
    );
    vm.stopPrank();
  }

  function testAutoRelayerJoin() public {
    _relayerJoin();
  }

  function testAutoRelayerExit() public {
    _relayerJoin();
    address retailLP = vm.addr(99);
    vm.startPrank(retailLP);
    uint256 lpTokens = ICronV1Pool(pool).balanceOf(retailLP);
    relayer.exit(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      lpTokens,                        // num of LP tokens
      9e18,                            // Min Token 0
      9e18,                            // Min Token 1
      retailLP                         // Receiver address
    );
    vm.stopPrank();
  }

  function testFailAutoRelayerSlippage1BToA() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 100000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    uint tooLowSlippageBP = 100;
    uint256 swapAmt = 100000e18;
    uint256 minSwapAmt = (swapAmt * (10000-tooLowSlippageBP)) / 10000; 
    tokenB.approve(address(vault), swapAmt);
    relayer.swap(
      address(tokenB),                           // Token In
      address(tokenA),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,
      minSwapAmt,
      retailTrader                               // Destination
    );
    vm.stopPrank();
  }

  function testFailAutoRelayerSlippage1AToB() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenA.transfer(retailTrader, 100000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    uint tooLowSlippageBP = 100;
    uint256 swapAmt = 100000e18;
    uint256 minSwapAmt = (swapAmt * (10000-tooLowSlippageBP)) / 10000; 
    tokenA.approve(address(vault), swapAmt);
    relayer.swap(
      address(tokenA),                           // Token In
      address(tokenB),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,
      minSwapAmt,
      retailTrader                               // Destination
    );
    vm.stopPrank();
  }

  function testFailAutoRelayerSlippage2AToB() public {
    address retailTrader = vm.addr(99);

    uint tooLowSlippageBP = 100;
    uint256 swapAmt = 15000e18;
    uint256 minSwapAmt = (swapAmt * (10000-tooLowSlippageBP)) / 10000; 

    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenA.transfer(retailTrader, swapAmt);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenA.approve(address(vault), swapAmt);

    relayer.swap(
      address(tokenA),                           // Token In
      address(tokenB),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,
      minSwapAmt,
      retailTrader                               // Destination
    );
    vm.stopPrank();
  }

  function testAutoRelayerSlippage2AToB() public {
    address retailTrader = vm.addr(99);

    uint reasonableSlippageBP = 200;
    uint256 swapAmt = 15000e18;
    uint256 minSwapAmt = (swapAmt * (10000-reasonableSlippageBP)) / 10000; 

    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenA.transfer(retailTrader, swapAmt);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenA.approve(address(vault), swapAmt);
    relayer.swap(
      address(tokenA),                           // Token In
      address(tokenB),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,
      minSwapAmt,
      retailTrader                               // Destination
    );
    vm.stopPrank();
  }

  function testFailAutoRelayerJoinAttack1AB() public {
    address retailTrader = vm.addr(99);

    uint reasonableSlippageBP = 200;
    uint256 swapAmt = 500000e18;
    uint256 minSwapAmt = (swapAmt * (10000-reasonableSlippageBP)) / 10000; 

    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenA.transfer(retailTrader, 600000e18);
    tokenB.transfer(retailTrader, 100000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenA.approve(address(vault), 600000e18);
    tokenB.approve(address(vault), 100000e18);
    relayer.swap(
      address(tokenA),                           // Token In
      address(tokenB),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,
      minSwapAmt,
      retailTrader                               // Destination
    );
    relayer.join(
      address(tokenA),                           // Token In
      address(tokenB),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      100000e18,                           // Token 0
      100000e18,                           // Token 1
      98000e18,                            // Min Token 0
      98000e18,                            // Min Token 1
      retailTrader                         // Receiver address
    );
    vm.stopPrank();
  }

  function testFailAutoRelayerJoinAttack1BA() public {
    address retailTrader = vm.addr(99);

    uint reasonableSlippageBP = 200;
    uint256 swapAmt = 500000e18;
    uint256 minSwapAmt = (swapAmt * (10000-reasonableSlippageBP)) / 10000; 

    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 600000e18);
    tokenA.transfer(retailTrader, 100000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenB.approve(address(vault), 600000e18);
    tokenA.approve(address(vault), 100000e18);
    relayer.swap(
      address(tokenB),                           // Token In
      address(tokenA),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,                                 
      minSwapAmt,
      retailTrader                               // Destination
    );
    relayer.join(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      100000e18,                           // Token 0
      100000e18,                           // Token 1
      98000e18,                            // Min Token 0
      98000e18,                            // Min Token 1
      retailTrader                         // Receiver address
    );
    vm.stopPrank();
  }

  function testAutoRelayerJoinAttack2() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 100000e18);
    tokenA.transfer(retailTrader, 100000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenB.approve(address(vault), 100000e18);
    tokenA.approve(address(vault), 100000e18);
    relayer.join(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      100000e18,                           // Token 0
      100000e18,                           // Token 1
      98000e18,                            // Min Token 0
      98000e18,                            // Min Token 1
      retailTrader                         // Receiver address
    );
    vm.stopPrank();
  }

  function testFailAutoRelayerJoinAttack3() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 100000e18);
    tokenA.transfer(retailTrader, 100000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenB.approve(address(vault), 100000e18);
    tokenA.approve(address(vault), 100000e18);
    relayer.join(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      100000e18,                           // Token 0
      100000e18,                           // Token 1
      101000e18,                           // Min Token 0
      101000e18,                           // Min Token 1
      retailTrader                         // Receiver address
    );
    vm.stopPrank();
  }

  function testFailAutoRelayerExitAttack1() public {
    address retailTrader = vm.addr(99);

    uint unReasonableSlippageBP = 500;
    uint256 swapAmt = 25000e18;
    uint256 minSwapAmt = (swapAmt * (10000-unReasonableSlippageBP)) / 10000; 

    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenA.transfer(retailTrader, 400000e18);
    tokenB.transfer(retailTrader, 100000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenA.approve(address(vault), 400000e18);
    tokenB.approve(address(vault), 100000e18);
    relayer.join(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      100000e18,                           // Token 0
      100000e18,                           // Token 1
      98000e18,                            // Min Token 0
      98000e18,                            // Min Token 1
      retailTrader                         // Receiver address
    );
    relayer.swap(
      address(tokenA),                           // Token In
      address(tokenB),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,
      minSwapAmt,
      retailTrader                               // Destination
    );
    uint256 lpTokens = ICronV1Pool(pool).balanceOf(retailTrader);
    relayer.exit(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      lpTokens,                        // num of LP tokens
      98000e18,                        // Min Token 0
      98000e18,                        // Min Token 1
      retailTrader                     // Receiver address
    );
    vm.stopPrank();
  }

  function testFailAutoRelayerExitAttack2() public {
    address retailTrader = vm.addr(99);

    uint unReasonableSlippageBP = 500;
    uint256 swapAmt = 25000e18;
    uint256 minSwapAmt = (swapAmt * (10000-unReasonableSlippageBP)) / 10000; 

    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenA.transfer(retailTrader, 100000e18);
    tokenB.transfer(retailTrader, 400000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenA.approve(address(vault), 100000e18);
    tokenB.approve(address(vault), 400000e18);
    relayer.join(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      100000e18,                           // Token 0
      100000e18,                           // Token 1
      98000e18,                            // Min Token 0
      98000e18,                            // Min Token 1
      retailTrader                         // Receiver address
    );
    relayer.swap(
      address(tokenB),                           // Token In
      address(tokenA),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,
      minSwapAmt,
      retailTrader                               // Destination
    );
    uint256 lpTokens = ICronV1Pool(pool).balanceOf(retailTrader);
    relayer.exit(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      lpTokens,                        // num of LP tokens
      98000e18,                        // Min Token 0
      98000e18,                        // Min Token 1
      retailTrader                     // Receiver address
    );
    vm.stopPrank();
  }

  function _relayerLongSwap() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 1000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenB.approve(address(vault), 1000e18);
    relayer.longTermSwap(
      address(tokenB),                           // Token In
      address(tokenA),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      1000e18,                                   // Swap Amount
      100,                                       // Number of intervals
      retailTrader                               // Destination
    );
    vm.stopPrank();
  }

  function _relayerJoin() public {
    address retailLP = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenA.transfer(retailLP, 1000e18);
    tokenB.transfer(retailLP, 1000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailLP, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailLP);
      vault.setRelayerApproval(retailLP, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailLP, address(relayer));
    }
    vm.startPrank(retailLP);
    tokenA.approve(address(vault), 10e18);
    tokenB.approve(address(vault), 10e18);
    relayer.join(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      10e18,                           // Token 0
      10e18,                           // Token 1
      9e18,                            // Min Token 0
      9e18,                            // Min Token 1
      retailLP                         // Receiver address
    );
    vm.stopPrank();
  }

  function _join(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) public {
    // setup parameters for joinPool
    bytes memory userData = _getJoinUserData(_joinKind, _liquidity0, _liquidity1);
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
    // TODO: call vault.joinPool direct w/o IVault
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

  function generateActionId(address _vault, string memory fn) public pure returns (bytes32) {
    bytes32 disambiguator = bytes32(uint256(address(_vault)));
    bytes4 selector = bytes4(keccak256(bytes(fn)));
    return keccak256(abi.encodePacked(disambiguator, selector));
  }

  function generateActionIds(address _vault) public pure returns (bytes32[] memory) {
    string[] memory fns = new string[](3);
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

  function _getJoinUserData(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1
  ) internal pure returns (bytes memory userData) {
    userData = _getJoinUserDataWithMin(_joinKind, _liquidity0, _liquidity1, 0, 0);
  }

  function _swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1Pool.SwapType _swapType,
    bool _zeroToOne,
    address _pool,
    address _trader
  ) internal returns (uint256 amountOut) {
    // build userData field
    bytes memory userData = abi.encode(
      _swapType, // swap type
      _argument
    );
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);

    // approve tokens to spend from this contract in the vault
    IERC20 token = _zeroToOne ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);

    // swap amounts with vault
    // TODO: call vault.swap direct w/o IVault
    amountOut = IVault(address(vault)).swap(
      IVault.SingleSwap(
        ICronV1Pool(_pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        _zeroToOne ? assets[0] : assets[1],
        _zeroToOne ? assets[1] : assets[0],
        _amountIn,
        userData
      ),
      IVault.FundManagement(
        _trader,
        false,
        payable (_trader),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }
  
  function _getJoinUserDataWithMin(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _minLiquidity0,
    uint256 _minLiquidity1
  ) internal pure returns (bytes memory userData) {
    uint256[] memory balances = new uint256[](2);
    balances[0] = _liquidity0;
    balances[1] = _liquidity1;
    uint256[] memory minTokenAmt = new uint256[](2);
    minTokenAmt[0] = _minLiquidity0;
    minTokenAmt[1] = _minLiquidity1;
    userData = abi.encode(_joinKind, balances, minTokenAmt);
  }

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }

}
