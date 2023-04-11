pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { C } from "../../miscellany/Constants.sol";

contract OBITests is HelperContract {

  function getTradeBlocks(uint _obi) public view returns (uint256 tradeBlocks) {
    uint swapInterval = 10;
    uint lastExpiryBlock = block.number - (block.number % _obi);
    uint orderExpiry = _obi * (swapInterval + 1) + lastExpiryBlock;
    tradeBlocks = orderExpiry - block.number;
  }

  function setupOBITestInfra(uint _type, uint _obi, uint _x, uint _fee) public {
    address userA = address(this);
    address userB = vm.addr(1323);
    address userC = vm.addr(323);
    address poolAddr = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      _type
    );
    addLiquidity(poolAddr, userA, userA, 2e9, 1e6, 0);
    IERC20(token1).transfer(userB, 100e30);
    IERC20(token2).transfer(userB, 100e30);
    IERC20(token1).transfer(userC, 100e30);
    IERC20(token2).transfer(userC, 100e30);
    mineBlocks();
    uint256 tradeBlocks = getTradeBlocks(_obi);
    swapPoolAddr(2000*tradeBlocks, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), poolAddr, userB);
    swapPoolAddr(1*tradeBlocks, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token2), poolAddr, userC);
    mineBlocks(_x);
    uint256 preUserB = IERC20(token2).balanceOf(userB);
    uint256 preUserC = IERC20(token1).balanceOf(userC);
    exit(0, ICronV1PoolEnums.ExitType.Withdraw, poolAddr, userB);
    exit(1, ICronV1PoolEnums.ExitType.Withdraw, poolAddr, userC);
    mineBlocks();
    uint256 postUserB = IERC20(token2).balanceOf(userB);
    uint256 postUserC = IERC20(token1).balanceOf(userC);
    // uint256 expectedBProceeds = (_x*2000*(100000-_fee)/100000)/2000;
    // uint256 expectedCProceeds = (_x*1*(100000-_fee)/100000)*2000;
    // uint256 actualBProceeds = postUserB - preUserB;
    // uint256 actualCProceeds = postUserC - preUserC;
    // roughly ~2% of the expected values
    assertApproxEqRel((_x*2000*(100000-_fee)/100000)/2000, postUserB - preUserB, 0.2e17);
    assertApproxEqRel((_x*1*(100000-_fee)/100000)*2000, postUserC - preUserC, 0.2e17);
  }

  // Stable OBI Test
  // ================================================================================
  // Description:
  //   Ensure pool behaves properly at low OBI (64).

  // Test Procedure:
  //   1. User A initializes a pool with a join of 2B Token 0 : 1M Token 1
  //     - Mine a block
  //   2. User B issues an LT Swap with the following characteristics
  //     - intervals = 10
  //     - amount = 2000 * tradeBlocks Token 0 for Token 1
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 2000 / block
  //     - Mine a block
  //   3. User C issues an LT Swap with the following characteristics
  //     - intervals = 10
  //     - amount = 1 * tradeBlocks Token 1 for Token 0 
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 1 / block
  //     - Mine a block
  //   4. Let x = 2 * OBI - 1
  //   5. Mine x blocks
  //   6. User B Withdraws the order
  //     * Expect proceeds to be near (x*2000*(100000-30)/100000)/2000  (i.e.  within 1%)
  //     User C Withdraws the order
  //     * Expect proceeds to be near (x*1*(100000-30)/100000)*2000  (i.e.  within 1%)
  //   7. Repeat the test with:
  //     - x = 2 * OBI
  //     - x = 2 * OBI + 1

  function testManualStableOBI1() public {
    uint256 x = 2 * C.STABLE_OBI - 1;
    setupOBITestInfra(0, C.STABLE_OBI, x, C.STABLE_LT_FEE_FP);
  }

  function testManualStableOBI2() public {
    uint256 x = 2 * C.STABLE_OBI;
    setupOBITestInfra(0, C.STABLE_OBI, x, C.STABLE_LT_FEE_FP);
  }

  function testManualStableOBI3() public {
    uint256 x = 2 * C.STABLE_OBI + 1;
    setupOBITestInfra(0, C.STABLE_OBI, x, C.STABLE_LT_FEE_FP);
  }

  // Liquid OBI Test
  // ================================================================================
  // Description:
  //   Ensure pool behaves properly at medium OBI (257).

  // Test Procedure:
  //   1. User A initializes a pool with a join of 2B Token 0 : 1M Token 1
  //     - Mine a block
  //   2. User B issues an LT Swap with the following characteristics
  //     - intervals = 10
  //     - amount = 2000 * tradeBlocks Token 0 for Token 1
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 2000 / block
  //     - Mine a block
  //   3. User C issues an LT Swap with the following characteristics
  //     - intervals = 10
  //     - amount = 1 * tradeBlocks Token 1 for Token 0 
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 1 / block
  //     - Mine a block
  //   4. Let x = 2 * OBI - 1
  //   5. Mine x blocks
  //   6. User B Withdraws the order
  //     * Expect proceeds to be near (x*2000*(100000-30))/2000  (i.e.  within 1%)
  //     User C Withdraws the order
  //     * Expect proceeds to be near (x*1*(100000-30))*2000  (i.e.  within 1%)
  //   7. Repeat the test with:
  //     - x = 2 * OBI
  //     - x = 2 * OBI + 1

  function testManualLiquidOBI1() public {
    uint256 x = 2 * C.LIQUID_OBI - 1;
    setupOBITestInfra(1, C.LIQUID_OBI, x, C.LIQUID_LT_FEE_FP);
  }

  function testManualLiquidOBI2() public {
    uint256 x = 2 * C.LIQUID_OBI;
    setupOBITestInfra(1, C.LIQUID_OBI, x, C.LIQUID_LT_FEE_FP);
  }

  function testManualLiquidOBI3() public {
    uint256 x = 2 * C.LIQUID_OBI + 1;
    setupOBITestInfra(1, C.LIQUID_OBI, x, C.LIQUID_LT_FEE_FP);
  }

  // Volatile OBI Test
  // ================================================================================
  // Description:
  //   Ensure pool behaves properly at high OBI (1028).

  // Test Procedure:
  //   1. User A initializes a pool with a join of 2B Token 0 : 1M Token 1
  //     - Mine a block
  //   2. User B issues an LT Swap with the following characteristics
  //     - intervals = 10
  //     - amount = 2000 * tradeBlocks Token 0 for Token 1
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 2000 / block
  //     - Mine a block
  //   3. User C issues an LT Swap with the following characteristics
  //     - intervals = 10
  //     - amount = 1 * tradeBlocks Token 1 for Token 0 
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 1 / block
  //     - Mine a block
  //   4. Let x = 2 * OBI - 1
  //   5. Mine x blocks
  //   6. User B Withdraws the order
  //     * Expect proceeds to be near (x*2000*(100000-30))/2000  (i.e.  within 1%)
  //     User C Withdraws the order
  //     * Expect proceeds to be near (x*1*(100000-30))*2000  (i.e.  within 1%)
  //   7. Repeat the test with:
  //     - x = 2 * OBI
  //     - x = 2 * OBI + 1

  function testManualVolatileOBI1() public {
    uint256 x = 2 * C.VOLATILE_OBI - 1;
    setupOBITestInfra(2, C.VOLATILE_OBI, x, C.VOLATILE_LT_FEE_FP);
  }

  function testManualVolatileOBI2() public {
    uint256 x = 2 * C.VOLATILE_OBI;
    setupOBITestInfra(2, C.VOLATILE_OBI, x, C.VOLATILE_LT_FEE_FP);
  }

  function testManualVolatileOBI3() public {
    uint256 x = 2 * C.VOLATILE_OBI + 1;
    setupOBITestInfra(2, C.VOLATILE_OBI, x, C.VOLATILE_LT_FEE_FP);
  }
}
