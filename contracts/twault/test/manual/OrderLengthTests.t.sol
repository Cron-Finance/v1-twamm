pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { C } from "../../miscellany/Constants.sol";

// Max Order Length Test
// ================================================================================
// Description:
//   Ensure that LT Swaps can't exceed the maximum length for all three different
//   pool types.

// Test Procedure:
//   1. Initialize a Stable pool and provide liquidity
//   2. Ensure that an LT Swap issued in both directions fails for
//      intervals > 176102
//   3. Repeat steps 1-2 for the following:
//     - Liquid Pool, intervals > 43854
//     - Volatile Pool, intervals > 10963

contract OrderLengthTests is HelperContract {

  function testMaunalStableOrderLength() public {
    address stablePool = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Stable",
      "T1-T2-S",
      0
    );
    addLiquidity(stablePool, address(this), address(this), 1e21, 1e21, 0);
    mineBlocks(1);
    // fails #223
    _swapPoolAddrRevert(1000e18, C.STABLE_MAX_INTERVALS + 1, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), stablePool, address(this), "CFI#223");
    // passes
    _swapPoolAddrRevert(1000e18, C.STABLE_MAX_INTERVALS, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), stablePool, address(this), "");
  }

  function testMaunalLiquidOrderLength() public {
    address liquidPool = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Liquid",
      "T1-T2-L",
      1
    );
    addLiquidity(liquidPool, address(this), address(this), 1e21, 1e21, 0);
    mineBlocks(1);
    // fails #223
    _swapPoolAddrRevert(1000e18, C.LIQUID_MAX_INTERVALS + 1, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), liquidPool, address(this), "CFI#223");
    // passes
    _swapPoolAddrRevert(1000e18, C.LIQUID_MAX_INTERVALS, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), liquidPool, address(this), "");
  }

  function testMaunalVolatileOrderLength() public {
    address volatilePool = factory.create(
      address(token1),
      address(token2),
      "T1-T2-Volatile",
      "T1-T2-V",
      2
    );
    addLiquidity(volatilePool, address(this), address(this), 1e21, 1e21, 0);
    mineBlocks(1);
    // fails #223
    _swapPoolAddrRevert(1000e18, C.VOLATILE_MAX_INTERVALS + 1, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), volatilePool, address(this), "CFI#223");
    // passes
    _swapPoolAddrRevert(1000e18, C.VOLATILE_MAX_INTERVALS, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), volatilePool, address(this), "");
  }



  function _swapPoolAddrRevert(
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
