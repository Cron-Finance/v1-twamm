pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../RelayerHelperContract.sol";

contract RelayerNegativeMintTests is RelayerHelperContract {

  function testAutoRelayerLowestInitialMint() public {
    uint liquidity0 = 1001;
    uint liquidity1 = 1001;
    uint poolType = 1;
    addLiquidity(liquidity0, liquidity1, poolType);
  }

  function testFailAutoRelayerTooLowInitialMint() public {
    uint liquidity0 = 1000;
    uint liquidity1 = 1000;
    uint poolType = 1;
    addLiquidity(liquidity0, liquidity1, poolType);
  }

  function testAutoRelayerHightestInitialMint() public {
    uint256 largestValueAllowed = 2**112 - 1;
    uint poolType = 1;
    emit log_uint(largestValueAllowed);
    addLiquidity(largestValueAllowed, largestValueAllowed, poolType);
  }

  function testFailAutoTooHighInitialMint() public {
    uint256 valueTooLarge = 2**112;
    uint poolType = 1;
    emit log_uint(valueTooLarge);
    addLiquidity(valueTooLarge, valueTooLarge, poolType);
  }
  
}
