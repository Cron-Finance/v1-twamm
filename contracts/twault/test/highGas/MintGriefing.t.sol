// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import "../../balancer-core-v2/vault/Vault.sol";
import "../../balancer-core-v2/vault/interfaces/IAsset.sol";
import "../../balancer-core-v2/test/WETH.sol";

import "../../helpers/TestToken.sol";
import "../../interfaces/ICronV1Pool.sol";
import "../../interfaces/pool/ICronV1PoolEnums.sol";
import "../../factories/CronV1PoolFactory.sol";

// Mint Event Scaling Test
// ================================================================================

// Description: 

//   Mint Events are essentially an ordered array of amounts and dates when a user
//   mints/joins a TWAMM pool. The nature of lists and list access in Solidity
//   means that there is a risk that a list could become too long, preventing
//   burning/exiting a pool or other manipulations. This test serves to identify
//   this limit.

// Notes: 

//   This test requires that the test infrastructure allows the gas used for a
//   transaction to be measured.

//   This test will run for a while and should go in the "LONG" test category.

//   This test focusses on an area I suspect the reviewers / auditors may ask us to
//   address.

//   I picked 1000 events b/c it seemed a reasonable upper bound--would like your
//   opinion too.

// Work Smart:

//   If I were constructing this test, I would construct a function/infra that does
//   steps A.1 #1-#2 using a variable to set the number of events. That way you can
//   test with a small amount to make sure things are correct and then we can up
//   the numbers to the 1000 specified. 1000 may be too large though, definitely
//   start with 10 events.

//   If it was possible, I would save the state of the blockchain after executing
//   variation A.2 #2 and then run tests loading that snapshot--that would be hyper
//   efficient making this test run quickly and not require 1000+ transactions
//   before testing. That would also help with other scenarios I want to test.

// Test Procedure:

//   Variation A.1: Mint then Burn, Small Amount
//       0. Construct a TWAMM pool with 1M of TokenA and TokenB
//       1. Have User A now mint 1000 of TokenA and TokenB, 1000 times
//       2. Verify that the length of User A's Mint Events is 1000 (call
//          getMintEvents(UserA_Addr)).
//       3. Have User A now burn enough LP tokens to get ONLY 1000 TokenA and TokenB
//          (basically, burn 1 mint event).
//          - Do this by inspecting the first element of the result of getMintEvents
//            and burning that number of LP tokens.
//          - AFAIK, this is the worst case for the burn's call to deleteMintEvents 
//            (it has to shift 999 events, reading and writing them).
//       4. Measure the gas used in transaction #3.
//   Variation A.2: Mint then Burn, Medium Amount
//       5. Re-use the pool & setup from above without restarting.
//       6. Have User A now mint 1000 of TokenA and TokenB, 1 time (to replace the
//          burned one in step #3).
//       7. Verify that the length of User A's Mint Events is 1000 (call
//          getMintEvents(UserA_Addr)).
//       8. Have User A now burn enough LP tokens to get half their minted TokenA and
//          TokenB.
//          - Do this by inspecting summing the first half of all mint event's LP
//            tokens returned by getMintEvents burning that number of LP tokens.
//          - This situation stresses delete elements less, but works the main loop
//            of the burn code b/c of all the reads and writes to storage.
//       9. Measure the gas used in transaction #8.
//   Variation A.3: Mint then Burn, Large Amount
//       10. Re-use the pool & setup from above without restarting.
//       11. Have User A now mint 1000 of TokenA and TokenB, n times (to replace the
//           burned mint events from step #8).
//       12. Verify that the length of User A's Mint Events is 1000 (call
//           getMintEvents(UserA_Addr)).
//       13. Have User A now burn enough LP tokens to get all but one of their mint
//           events of TokenA and TokenB.
//           - Do this by inspecting summing all but the last mint event's LP
//             tokens returned by getMintEvents burning that number of LP tokens.
//           - This situation stresses delete elements less, but works the main loop
//             of the burn code b/c of all the reads and writes to storage.
//       14. Measure the gas used in transaction #13.
//   Variation A.4: Mint then Burn, ALL
//       15. Re-use the pool & setup from above without restarting.
//       16. Have User A now mint 1000 of TokenA and TokenB, n times (to replace the
//           burned mint events from step #13).
//       17. Verify that the length of User A's Mint Events is 1000 (call
//           getMintEvents(UserA_Addr)).
//       18. Have User A now burn enough LP tokens to get all their TokenA and TokenB.
//           - Do this by inspecting summing all the mint event's LP
//             tokens returned by getMintEvents burning that number of LP tokens.
//       19. Measure the gas used in transaction #18.

//   Note: There are two stressors for transferring tokens
//         a) The delete mint events shifting of many elements
//         b) The destination mint events array insertion
  
//   Variation B.1: Mint then Transfer
//       0. Construct a TWAMM pool with 1M of TokenA and TokenB
//       1. Have User A and User B now mint 1000 of TokenA and TokenB, 1000 times,
//          each.
//           - These events need to be sequentially timed, that means they need to
//             be created in 1000 different blocks to get 1000 different mint
//             events I believe.
//       2. Verify that the length of User A's and User B's Mint Events is 1000.
//       3. Have User A now transfer their first mint event to User B.
//       4. Measure the gas used in transaction #3.
//       5. Have User A now transfer their 499th mint event to User B.
//       6. Measure the gas used in transaction #5.
//       7. Have User A now transfer their last mint event to User B (the 998th).
//       8. Measure the gas used in transaction #7.
//       9. Verify that the length of User A's and User B's Mint Events is 997 and
//          1003 respectively.

contract MintGriefing is Test {
  address public owner;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken public token0;
  TestToken public token1;
  address public pool;

  address public lp1;
  address public lp2;
  address public lp3;

  uint internal constant MINT_EVENTS = 50;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    vault = new Vault(IAuthorizer(owner), IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
    // create two mock tokens
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
    lp1 = vm.addr(1);
    lp2 = vm.addr(2);
    lp3 = vm.addr(3);
    token0.transfer(lp1, 100e25);
    token0.transfer(lp2, 100e25);
    token0.transfer(lp3, 100e25);
    token1.transfer(lp1, 100e25);
    token1.transfer(lp2, 100e25);
    token1.transfer(lp3, 100e25);
    // add initial liquidity
    _addLiquidity(pool, owner, owner, 10000, 10000, 0);
  }

  function addLiquidityMultipleTimes(address a, uint n) public {
    // mint n positions
    uint256 mintsPerBlock = 10;
    for (uint i = 0; i < n; ++i) {
      _addLiquidity(pool, a, a, 1000, 1000, 0);
      vm.warp(block.timestamp + 1);
      if (i % mintsPerBlock == 0) {
        mineBlocks(1);
      }
    }
  }
  
//  function testManualMintSmallAmount() public {
//    addLiquidityMultipleTimes(lp1, MINT_EVENTS);
//    JoinEvent[] memory joinEvents = ICronV1Pool(pool).getJoinEvents(lp1);
//    assertEq(joinEvents.length, MINT_EVENTS);
//    uint256 amountToBurn = joinEvents[0].amountLP;
//    _exit(amountToBurn, ICronV1PoolEnums.ExitType.Exit, pool, lp1);
//    joinEvents = ICronV1Pool(pool).getJoinEvents(lp1);
//    assertEq(joinEvents.length, MINT_EVENTS - 1);
//  }
  
//  function testManualMintMediumAmount() public {
//    addLiquidityMultipleTimes(lp1, MINT_EVENTS);
//    JoinEvent[] memory joinEvents = ICronV1Pool(pool).getJoinEvents(lp1);
//    assertEq(joinEvents.length, MINT_EVENTS);
//    uint256 amountToBurn;
//    for(uint256 index = 0; index < joinEvents.length/2; index++) {
//      amountToBurn += joinEvents[0].amountLP;
//    }
//    _exit(amountToBurn, ICronV1PoolEnums.ExitType.Exit, pool, lp1);
//    joinEvents = ICronV1Pool(pool).getJoinEvents(lp1);
//    assertEq(joinEvents.length, MINT_EVENTS/2);
//  }
  
//  function testManualMintLargeAmount() public {
//    addLiquidityMultipleTimes(lp1, MINT_EVENTS);
//    JoinEvent[] memory joinEvents = ICronV1Pool(pool).getJoinEvents(lp1);
//    assertEq(joinEvents.length, MINT_EVENTS);
//    uint256 amountToBurn;
//    for(uint256 index = 0; index < joinEvents.length-1; index++) {
//      amountToBurn += joinEvents[0].amountLP;
//    }
//    _exit(amountToBurn, ICronV1PoolEnums.ExitType.Exit, pool, lp1);
//    joinEvents = ICronV1Pool(pool).getJoinEvents(lp1);
//    assertEq(joinEvents.length, 1);
//  }
  
//  function testManualMintAllAmount() public {
//    addLiquidityMultipleTimes(lp1, MINT_EVENTS);
//    JoinEvent[] memory joinEvents1 = ICronV1Pool(pool).getJoinEvents(lp1);
//    assertEq(joinEvents1.length, MINT_EVENTS);
//    uint256 lpTokensMinted = ICronV1Pool(pool).balanceOf(lp1);
//    _exit(lpTokensMinted, ICronV1PoolEnums.ExitType.Exit, pool, lp1);
//  }

//  function testManualMintThenTransfer() public {
//    addLiquidityMultipleTimes(lp2, MINT_EVENTS);
//    addLiquidityMultipleTimes(lp3, MINT_EVENTS-3);
//    JoinEvent[] memory joinEvents2 = ICronV1Pool(pool).getJoinEvents(lp2);
//    assertEq(joinEvents2.length, 50);
//    JoinEvent[] memory joinEvents3 = ICronV1Pool(pool).getJoinEvents(lp3);
//    assertEq(joinEvents3.length, 47);
//
//    vm.startPrank(lp3);
//    ICronV1Pool(pool).setJoinEventTransferSource(lp2, true);
//    vm.stopPrank();
//
//    vm.startPrank(lp2);
//    ICronV1Pool(pool).transferJoinEvent(lp3, 0, 1000);
//    ICronV1Pool(pool).transferJoinEvent(lp3, 24, 1000);
//    ICronV1Pool(pool).transferJoinEvent(lp3, 47, 1000);
//    vm.stopPrank();
//    joinEvents2 = ICronV1Pool(pool).getJoinEvents(lp2);
//    assertEq(joinEvents2.length, MINT_EVENTS - 3);
//    joinEvents3 = ICronV1Pool(pool).getJoinEvents(lp3);
//    assertEq(joinEvents3.length, MINT_EVENTS);
//  }

  function mineBlocks(uint256 _numBlocks) public {
    // emit log_uint(block.number);
    for (uint256 i = 0; i < _numBlocks; ++i) {
      string[] memory inputs = new string[](3);
      inputs[0] = "cast";
      inputs[1] = "rpc";
      inputs[2] = "anvil_mine";
      vm.ffi(inputs);
    }
    vm.roll(block.number + _numBlocks);
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

  function _addLiquidity(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) internal {
    vm.startPrank(_from);
    // setup parameters for joinPool
    uint256[] memory balances = new uint256[](2);
    balances[0] = _liquidity0;
    balances[1] = _liquidity1;
    bytes memory userData = getJoinUserData(_joinKind, balances[0], balances[1]);
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
    IVault(vault).joinPool(
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
    vm.stopPrank();
  }

  function _exit(
    uint _argument,
    ICronV1PoolEnums.ExitType _exitType,
    address _pool,
    address _trader
  ) internal {
    vm.startPrank(_trader);
    // build userData field
    bytes memory userData = abi.encode(
      _exitType, // exit type
      _argument
    );
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    uint256[] memory minAmountIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      minAmountIn[i] = type(uint256).min;
    }
    // swap amounts with vault
    IVault(vault).exitPool(
      ICronV1Pool(_pool).POOL_ID(),
      _trader,
      payable (_trader),
      IVault.ExitPoolRequest(
        assets,
        minAmountIn,
        userData,
        false
      )
    );
    vm.stopPrank();
  }

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
