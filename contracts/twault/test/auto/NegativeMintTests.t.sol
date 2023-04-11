pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract NegativeMintTests is HelperContract {

  function testAutoLowestInitialMint() public {
    uint liquidity0 = 1001;
    uint liquidity1 = 1001;
    uint joinKind = 0;
    addLiquidity(liquidity0, liquidity1, joinKind);
  }

  function testFailAutoTooLowInitialMint() public {
    uint liquidity0 = 1000;
    uint liquidity1 = 1000;
    uint joinKind = 0;
    addLiquidity(liquidity0, liquidity1, joinKind);
  }

  function testAutoHightestInitialMint() public {
    uint256 largestValueAllowed = 2**112 - 1;
    emit log_uint(largestValueAllowed);
    addLiquidity(largestValueAllowed, largestValueAllowed, 0);
  }

  function testFailAutoTooHighInitialMint() public {
    uint256 valueTooLarge = 2**112;
    emit log_uint(valueTooLarge);
    addLiquidity(valueTooLarge, valueTooLarge, 0);
  }
  
}
