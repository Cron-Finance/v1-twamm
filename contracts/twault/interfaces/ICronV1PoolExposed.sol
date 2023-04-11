// (c) Copyright 2022, Bad Pumpkin Inc. All Rights Reserved
//
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.7.6;

pragma experimental ABIEncoderV2;

import { ICronV1Pool } from "./ICronV1Pool.sol";

interface ICronV1PoolExposed is ICronV1Pool {
  function iSetCronFeesMax(uint256 _maxFees) external;

  function iSetBalFeesMax(uint256 _maxFees) external;

  // internal functions exposed
  //  function iIncrementScaledProceeds(
  //    uint256 _scaledProceedsU128F64,
  //    uint256 _tokenOutU112,
  //    uint256 _salesRateU112
  //  ) external pure returns (uint256 scaledProceedsU128F64);

  function iCalculateProceeds(
    uint256 _scaledProceedsU128F64,
    uint256 _startScaledProceedsU128F64,
    uint256 _stakedAmountU112
  ) external pure returns (uint256 proceedsU112);
}
