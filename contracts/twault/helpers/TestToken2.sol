// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import { ERC20 } from "../balancer-core-v2/lib/openzeppelin/ERC20.sol";

contract TestToken2 is ERC20 {
  constructor(
    string memory name,
    string memory symbol,
    uint256 initialSupply,
    uint8 decimals_
  ) ERC20(name, symbol) {
    _mint(msg.sender, initialSupply);
    _setupDecimals(decimals_);
  }
}
