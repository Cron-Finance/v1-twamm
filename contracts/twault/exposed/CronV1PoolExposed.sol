// SPDX-License-Identifier: Apache-2.0

// solhint-disable-next-line strict-import
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import { IVault } from "../balancer-core-v2/vault/interfaces/IVault.sol";
import { IERC20 } from "../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { CronV1Pool } from "../CronV1Pool.sol";
import { BitPackingLib } from "../miscellany/BitPacking.sol";
import { C } from "../miscellany/Constants.sol";

contract CronV1PoolExposed is CronV1Pool {
  constructor(
    IERC20 _token0Inst,
    IERC20 _token1Inst,
    IVault _vaultInst,
    string memory _poolName,
    string memory _poolSymbol,
    CronV1Pool.PoolType _poolType,
    address _adminAddr
  ) CronV1Pool(_token0Inst, _token1Inst, _vaultInst, _poolName, _poolSymbol, _poolType) {}

  function iSetCronFeesMax(uint256 _maxFees) public {
    slot4 = BitPackingLib.packBit(slot4, 0, C.S4_OFFSET_ZERO_CRONFI_FEES);
    slot3 = BitPackingLib.incrementPairWithClampU96(slot3, _maxFees, _maxFees);
  }

  function iSetBalFeesMax(uint256 _maxFees) public {
    uint256 localSlot4 = slot4; // #savegas
    slot4 = BitPackingLib.incrementPairWithClampU96(localSlot4, _maxFees, _maxFees);
  }

  function iFeeAddr() public view returns (address) {
    return feeAddr;
  }

  function iAdminAddrMap(address _a) public view returns (bool) {
    return adminAddrMap[_a];
  }

  function iPartnerContractAddrMap(address _a) public view returns (address) {
    return partnerContractAddrMap[_a];
  }

  function iCalculateProceeds(
    uint256 _scaledProceedsU128F64,
    uint256 _startScaledProceedsU128F64,
    uint256 _stakedAmountU112
  ) public view returns (uint256 proceedsU112) {
    bool token0To1 = true;
    return _calculateProceeds(_scaledProceedsU128F64, _startScaledProceedsU128F64, _stakedAmountU112, token0To1);
  }

  //  function iIncrementScaledProceeds(
  //    uint256 _scaledProceedsU128F64,
  //    uint256 _tokenOutU112,
  //    uint256 _salesRateU112,
  //    uint256 _scalingFactor
  //  ) public pure returns (uint256 scaledProceedsU128F64) {
  //    return
  //      _incrementScaledProceeds(_scaledProceedsU128F64, _tokenOutU112, _salesRateU112, _scalingFactor);
  //  }
}
