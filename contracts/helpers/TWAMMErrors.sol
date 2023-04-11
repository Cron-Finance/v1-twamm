// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

library Errors {
  string internal constant InvalidBlockNumber = "invalid block number, please wait";
  string internal constant DuplicateInitialLiquidity =
    "liquidity has already been provided, need to call provideLiquidity";
  string internal constant ZeroLiquidityProvided =
    "no liquidity has been provided yet, need to call provideInitialLiquidity";
  string internal constant InsufficientLPTokens = "not enough lp tokens available";
  string internal constant SwapAmountShouldBePositive = "swap amount must be positive";
}
