// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface IERC20 {
  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);

  function transfer(address _recipient, uint256 _amount) external returns (bool);

  function approve(address _spender, uint256 _amount) external returns (bool);

  function transferFrom(
    address _sender,
    address _recipient,
    uint256 _amount
  ) external returns (bool);

  function symbol() external view returns (string memory);

  function balanceOf(address _account) external view returns (uint256);

  // Note this is non standard but nearly all ERC20 have exposed decimal functions
  function decimals() external view returns (uint8);

  function allowance(address _owner, address _spender) external view returns (uint256);
}
