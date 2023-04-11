pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract FactoryTests is HelperContract {

  function testAutoFactoryOwner() public {
    assertEq(address(this), factory.owner());
  }

  function testAutoFactoryTokenOrdering() public {
    uint256 mintAmount = 2**112;
    TestToken tokenB = new TestToken("TB", "TB", mintAmount);
    TestToken tokenA = new TestToken("TA", "TA", mintAmount);
    TestToken tokenC = new TestToken("TC", "TC", mintAmount);
    // assertEq(address(tokenA) < address(tokenB), true);
    // assertEq(address(tokenB) < address(tokenC), true);
    address token0 = (address(tokenA) < address(tokenB)) ? address(tokenA) : address(tokenB);
    address token1 = (address(tokenA) < address(tokenB)) ? address(tokenB) : address(tokenA);
    address pool0 = factory.create(
      address(tokenB),
      address(tokenA),
      "TA-TB-Stable",
      "TB-TB-S",
      0
    );
    address pool1 = factory.getPool(token0, token1, 0);
    assertEq(pool0, pool1);
    bytes32 poolId0 = ICronV1Pool(pool0).POOL_ID();
    bytes32 poolId1 = ICronV1Pool(pool1).POOL_ID();
    assertEq(poolId0, poolId1);
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId0);
    assertEq(token0, address(tokens[0]));
    assertEq(token1, address(tokens[1]));

    address token2 = (address(tokenB) < address(tokenC)) ? address(tokenB) : address(tokenC);
    address token3 = (address(tokenB) < address(tokenC)) ? address(tokenC) : address(tokenB);
    address pool2 = factory.create(
      address(tokenB),
      address(tokenC),
      "TB-TC-Stable",
      "TB-TC-S",
      0
    );
    address pool3 = factory.getPool(token3, token2, 0);
    assertEq(pool2, pool3);
    bytes32 poolId2 = ICronV1Pool(pool2).POOL_ID();
    bytes32 poolId3 = ICronV1Pool(pool3).POOL_ID();
    assertEq(poolId2, poolId3);
    (tokens, , ) = vault.getPoolTokens(poolId3);
    assertEq(token2, address(tokens[0]));
    assertEq(token3, address(tokens[1]));
  }

  function testAutoFactoryCreateStablePool() public {
    address pool0 = factory.create(
      address(token0),
      address(token1),
      "T0-T1-Stable",
      "T0-T1-S",
      0
    );
    address pool1 = factory.getPool(address(token0), address(token1), 0);
    assertEq(pool0, pool1);
  }

  function testAutoFactoryCreateLiquidPool() public {
    address pool0 = factory.create(
      address(token0),
      address(token2),
      "T0-T2-Liquid",
      "T0-T2-L",
      1
    );
    address pool1 = factory.getPool(address(token0), address(token2), 1);
    assertEq(pool0, pool1);
  }

  function testAutoFactoryCreateVolatilePool() public {
    address pool0 = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Volatile",
      "T1-T2-V",
      2
    );
    address pool1 = factory.getPool(address(token1), address(token2), 2);
    assertEq(pool0, pool1);
  }

  function testAutoFactoryCreateMultiplePools() public {
    factory.create(
      address(token0),
      address(token1),
      "T0-T1-Stable",
      "T0-T1-S",
      0
    );
    vm.expectRevert(bytes("CFI#502"));
    factory.create(
      address(token0),
      address(token1),
      "T0-T1-Liquid",
      "T0-T1-L",
      1
    );
    factory.create(
      address(token0),
      address(token2),
      "T0-T2-Volatile",
      "T0-T2-V",
      2
    );
    // // 1 pool created in helper contract setup
    // assertEq(factory.allPoolsLength(), 4);
  }

  function testFailAutoPoolCreatedOutsideFactory() public {
    // vm.expectRevert(bytes("CFI#000"));
    new CronV1Pool(IERC20(token0), IERC20(token1), vault, "FailPool", "FP", ICronV1PoolEnums.PoolType.Stable);
  }

  function testFailAutoFactoryInvalidPoolType() public {
    // vm.expectRevert(bytes("CronV1: Invalid Pool Type"));
    factory.create(
      address(token1),
      address(token2),
      "T0-T1-Stable",
      "T0-T1-S",
      3
    );
  }

  function testFailAutoFactoryDuplicateTokenAddress() public {
    // vm.expectRevert(bytes("CronV1: Identical Addresses"));
    factory.create(
      address(token1),
      address(token1),
      "T0-T1-Stable",
      "T0-T1-S",
      0
    );
  }

  function testFailAutoFactoryZeroTokenAddress() public {
    // vm.expectRevert(bytes("CronV1: Zero Address"));
    factory.create(
      address(0),
      address(token1),
      "T0-T1-Stable",
      "T0-T1-S",
      0
    );
  }

  function testFailAutoFactoryCreateDuplicateStablePool() public {
    factory.create(
      address(token0),
      address(token1),
      "T0-T1-Stable",
      "T0-T1-S",
      0
    );
    // vm.expectRevert(bytes("CronV1: Pool Exists"));
    factory.create(
      address(token1),
      address(token0),
      "T0-T1-Stable",
      "T0-T1-S",
      0
    );
  }

  function testAutoFactoryRemovePool() public {
    address pool0 = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Volatile",
      "T1-T2-V",
      2
    );
    address pool1 = factory.getPool(address(token1), address(token2), 2);
    assertEq(pool0, pool1);
    factory.remove(address(token1), address(token2), 2);
  }

  function testFailAutoFactoryRemovePool() public {
    address pool0 = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Volatile",
      "T1-T2-V",
      2
    );
    address pool1 = factory.getPool(address(token1), address(token2), 2);
    assertEq(pool0, pool1);
    // vm.expectRevert(bytes("CFI#505"));
    factory.remove(address(token0), address(token2), 2);
  }

  function testAutoFactorySetPool() public {
    address pool0 = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Volatile",
      "T1-T2-V",
      2
    );
    address pool1 = factory.getPool(address(token1), address(token2), 2);
    assertEq(pool0, pool1);
    factory.remove(address(token1), address(token2), 2);
    address pool3 = factory.create(
      address(token0),
      address(token1),
      "T0-T1-Volatile",
      "T0-T1-V",
      2
    );
    factory.set(address(token0), address(token1), 2, pool3);
  }

  function testFailAutoFactoryNotOwnerPool() public {
    address pool0 = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Volatile",
      "T1-T2-V",
      2
    );
    address pool1 = factory.getPool(address(token1), address(token2), 2);
    assertEq(pool0, pool1);
    vm.startPrank(vm.addr(100));
    vm.expectRevert(bytes("CFI#503"));
    factory.remove(address(token1), address(token2), 2);
    vm.stopPrank();
    factory.remove(address(token1), address(token2), 2);
    address pool3 = factory.create(
      address(token0),
      address(token1),
      "T0-T1-Volatile",
      "T0-T1-V",
      2
    );
    vm.startPrank(vm.addr(100));
    factory.set(address(token0), address(token1), 2, pool3);
    vm.stopPrank();
  }

  
}
