pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { ExecVirtualOrdersMem } from "../../interfaces/Structs.sol";

// No Initial Join Vulnerabilities
// ================================================================================
// Description:
//   Need to make sure the pool doesn't do anything before the initial mint or that
//   not doing an initial mint doesn't create a vulnerability.

// Required:
//   Create the dump method we talked about to see the pool's state:
//       - orders
//       - proceeds
//       - fees (cron and bal)
//       - current reserves (balancer balances minus the four above)
//       - balancer balances
//       - evo reserves (getReservesAmount result)
//       - lp supply
//       - sales rates

//   Modify the dump method to assert that the value of all of the above is zero
//   (or fail if not):  function assertPoolStateZero

//   See dumpContractAccounting in the safety test


// Test Procedure:
//   1. Create a pool, BUT DON'T DO AN INITIAL MINT
//   2. Mine 10 blocks
//   3. Try to do an ST Swap
//      * Expect fail or assertPoolStateZero
//   4. Try to do an LT Swap
//      * Expect fail or assertPoolStateZero
//   5. Try to do an executeVirtualOrdersToBlock <the current block>
//      * Expect fail or assertPoolStateZero
//   6. Scenarios I don't think we care about--what do you think:
//      onJoinPool::Reward
//      onExitPool::FeeWithdraw

//      Definitely run a Reward and see what happens

//   7. Perform an initial mint 1M : 1M
//   8. Perform a swap of 1k
//      * Expect to get 1k minus fees

contract MintTests is HelperContract {

  TestToken public tokenA;
  TestToken public tokenB;

  function setUp() public {
    uint256 mintAmount = 2 ** 128;
    tokenA = new TestToken("T0", "T0", mintAmount);
    tokenB = new TestToken("T1", "T1", mintAmount);
  }

  function addLiquidityMultipleTimes(address newPool, address a, uint n, uint perBlock) public {
    // mint n positions
    for (uint i = 0; i < n; ++i) {
      addLiquidity(newPool, a, a, 1000, 1000, 0);
      vm.warp(block.timestamp + 1);
      if (i % perBlock == 0) {
        mineBlocks(1);
      }
    }
  }

  function testManualInitialJoinVulnerabilities() public {
    address newPool = factory.create(
      address(tokenA),
      address(tokenB),
      "TA-TB-Liquid",
      "TA-TB-L",
      1
    );
    mineBlocks(10);
    address userA = vm.addr(55);
    (, uint256 reserve0, uint256 reserve1, , , , , , , , ) = ICronV1Pool(newPool).getVirtualReserves(block.number,
                                                                                                        false);
    assertEq(reserve0, 0);
    assertEq(reserve1, 0);
    bytes32 poolId = ICronV1Pool(newPool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IERC20(tokens[0]).transfer(userA, 100e18);
    IERC20(tokens[1]).transfer(userA, 100e18);
    mineBlocks();
    // all these should fail from assertPoolZeroState which doesn't exist...
    _swap(10000, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokenA), newPool, userA, "");
    _swap(10000, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenA), newPool, userA, "");
    _swap(10000, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenB), newPool, userA, "");
    mineBlocks(100);
    ICronV1Pool(newPool).executeVirtualOrdersToBlock(block.number);
    addLiquidity(newPool, address(this), address(this), 1e21, 1e21, 1);
    exitRevert(0, ICronV1PoolEnums.ExitType.Withdraw, newPool, userA, "");
    addLiquidity(newPool, address(this), address(this), 1e21, 1e21, 0);
    uint amount = _swap(1000, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokenA), newPool, userA, "");
    assertEq(amount, 999);
  }

  function _swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1PoolEnums.SwapType _swapType,
    address _tokenIn,
    address _pool,
    address _trader,
    string memory revertStr
  ) internal returns (uint256 amountOut) {
    vm.startPrank(_trader);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20 token = (_tokenIn == address(tokens[0])) ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);
    // swap amounts with vault
    // bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (bytes(revertStr).length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    amountOut = IVault(vault).swap(
      IVault.SingleSwap(
        poolId,
        IVault.SwapKind.GIVEN_IN,
        (_tokenIn == address(tokens[0])) ? assets[0] : assets[1],
        (_tokenIn == address(tokens[0])) ? assets[1] : assets[0],
        _amountIn,
        abi.encode(
          _swapType,
          _argument
        )
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
    vm.stopPrank();
  }
}
