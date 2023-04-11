pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { C } from "../../miscellany/Constants.sol";
import { PriceOracle } from "../../interfaces/Structs.sol";

contract OracleTests is HelperContract {

  function getTradeBlocks(uint _obi) public view returns (uint256 tradeBlocks) {
    uint swapInterval = 10;
    uint lastExpiryBlock = block.number - (block.number % _obi);
    uint orderExpiry = _obi * (swapInterval + 1) + lastExpiryBlock;
    tradeBlocks = orderExpiry - block.number;
  }

  function sampleOracle(address _pool) public view returns (uint t0Price, uint t1Price) {
    (uint256 timestamp, uint256 token0U256F112, uint256 token1U256F112) = ICronV1Pool(_pool).getPriceOracle();
    t0Price = token0U256F112;
    t1Price = token1U256F112;
    // console.log("timestamp", timestamp);
    // console.log("T0: ", t0Price);
    // console.log("T1: ", t1Price);
  }

  // Oracle Test2
  // ================================================================================
  // Description:
  //   Our oracle needs serious testing and has only had the lightest of testing
  //   applied to it. This key test will see if the oracle is doing reasonable price
  //   tracking of an LT Swap

  // Test Procedure:
  //   1. User A initializes a pool with a join/mint of 1M Token 0 : 1M Token 1
  //     - Mine a block
  //   2. User B issues an LT Swap with the following characteristics
  //     - intervals = 10
  //     - amount = 1000 * tradeBlocks Token 0 for Token 1
  //     - to calculate tradeBlocks:
  //           lastExpiryBlock = currentBlockNumber - (currentBlockNumber % OBI)
  //           orderExpiry = OBI * (intervals + 1) + lastExpiryBlock
  //           tradeBlocks = orderExpiry - currentBlockNumber
  //     - now you have a precise sales rate of 1000 / block
  //   3. Capture the initial price and track the oracle price change every block for
  //     two intervals; make sure it corresponds to the expected values after
  //     running virtual orders each block.

  function testManualOracleLTSwap() public {
    address userA = address(this);
    address userB = vm.addr(1323);
    address poolAddr = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      1
    );
    addLiquidity(poolAddr, userA, userA, 1e6, 1e6, 0);
    sampleOracle(poolAddr);
    IERC20(token1).transfer(userB, 100e30);
    IERC20(token2).transfer(userB, 100e30);
    mineBlocks();
    uint256 tradeBlocks = getTradeBlocks(C.LIQUID_OBI);
    swapPoolAddr(1000*tradeBlocks, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), poolAddr, userB);
    mineBlocks(C.LIQUID_OBI);
    ICronV1Pool(poolAddr).executeVirtualOrdersToBlock(block.number);
    sampleOracle(poolAddr);
    mineBlocks(C.LIQUID_OBI);
    ICronV1Pool(poolAddr).executeVirtualOrdersToBlock(block.number);
    sampleOracle(poolAddr);
  }

// Oracle Price at Beginning of Block Only
// ================================================================================
// Description:
//   Ensure the oracle price is only set at the beginning of a block.

// Test Procedure:
//   1. User A initializes a pool with a join of 2B Token 0 : 1M Token 1
//      - Mine a block
//   2. In one block, in this order:
//        i) User B swaps the pool 1000 Token 0 (small price move, lock the oracle
//           price)
//        ii) PBJ captures the oracle values and timestamp
//        iii) User B swaps the pool 1M Token 1  (big price move)
//        iv) PBJ captures the oracle values and timestamp
//      * Expect oracle values the same in ii and iv
//      - Mine a block
//   3. User B swaps the pool 1000 Token 0 (small price move, lock the oracle
//      price)
//      - PBJ captures the oracle values and timestamp
//      * Expect oracle values significantly changed (average price will greatly
//        differ from initial price; measure by subtracting samples and dividing 
//        by subtracted timestamps)

  function testManualOracleStartBlock() public {
    address userA = address(this);
    address userB = vm.addr(1323);
    address poolAddr = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      1
    );
    addLiquidity(poolAddr, userA, userA, 2e9, 1e6, 0);
    IERC20(token1).transfer(userB, 100e30);
    IERC20(token2).transfer(userB, 100e30);
    mineBlocks();
    // check 1 the oracle price
    sampleOracle(poolAddr);
    swapPoolAddr(1000, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(token1), poolAddr, userB);
    // check 2 the oracle price
    sampleOracle(poolAddr);
    swapPoolAddr(1e6, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(token2), poolAddr, userB);
    // check 3 the oracle price
    sampleOracle(poolAddr);
    // expect 2 = 3
    mineBlocks();
    swapPoolAddr(1000, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(token1), poolAddr, userB);
    // check 4 the oracle price
    sampleOracle(poolAddr);
    // expect #4 lot different
  }
}
