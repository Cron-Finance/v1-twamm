pragma solidity ^0.7.6;

pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { CronV1Tester } from "../CronV1Tester.sol";

contract CronV1TesterForkTest is Test {
  CronV1Tester public tester;

  function setUp() public {
    tester = new CronV1Tester();
  }

  function testForkV1AddLiquidity() public {
    tester.addLiquidity(10e18, 10e18, 0);
  }

  function testForkV1DonateLiquidity() public {
    tester.addLiquidity(10e18, 10e18, 1);
  }

  function testForkV1ShortTermSwap0To1() public {
    tester.shortTermSwap(10e18, true);
  }

  function testForkV1ShortTermSwap1To0() public {
    tester.shortTermSwap(10e18, false);
  }

  function testForkV1LongTermSwap0To1() public {
    tester.longTermSwap(10e18, 100, true);
  }

  function testForkV1LongTermSwap1To0() public {
    tester.longTermSwap(10e18, 100, false);
  }

  function testForkV1ExitBurn() public {
    tester.addLiquidity(10e18, 10e18, 0);
    tester.exit();
  }

  function testFailForkV1ExitWithdraw() public {
    tester.addLiquidity(10e18, 10e18, 0);
    tester.longTermSwap(10e18, 100, true);
    // will fail because blocks haven't processed and nothing to withdraw
    tester.withdraw(0);
  }

  function testForkV1ExitCancel() public {
    tester.addLiquidity(10e18, 10e18, 0);
    tester.longTermSwap(10e18, 100, true);
    tester.cancel(0);
  }

  function testForkV1GetVirtualReserves() public {
    tester.addLiquidity(10000e18, 10000e18, 0);
    tester.longTermSwap(1000e18, 100, true);
    tester.shortTermSwap(10e18, false);
    (
      uint256 blockNumber,
      uint256 token0ReserveU112,
      uint256 token1ReserveU112,
      uint256 token0OrdersU112,
      uint256 token1OrdersU112,
      uint256 token0ProceedsU112,
      uint256 token1ProceedsU112,
      uint256 token0BalancerFeesU96,
      uint256 token1BalancerFeesU96,
      uint256 token0CronFiFeesU96,
      uint256 token1CronFiFeesU96
    ) = tester.getVirtualReserves(block.number, false);
    console.log(blockNumber);
    console.log(token0ReserveU112);
    console.log(token1ReserveU112);
    console.log(token0OrdersU112);
    console.log(token1OrdersU112);
    console.log(token0ProceedsU112);
    console.log(token1ProceedsU112);
    console.log(token0BalancerFeesU96);
    console.log(token1BalancerFeesU96);
    console.log(token0CronFiFeesU96);
    console.log(token1CronFiFeesU96);
  }

}
