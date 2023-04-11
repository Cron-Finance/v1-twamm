pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../RelayerHelperContract.sol";

contract RelayerShortTermSwapper is RelayerHelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function testAutoRelayerShortTermSwap() public {
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(pool).POOL_ID());
    swap(1e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokens[0]));
  }
}
