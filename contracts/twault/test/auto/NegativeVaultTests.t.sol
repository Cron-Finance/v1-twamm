pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract NegativeVaultTests is HelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function testFailAutoWrongWalletSwapper() public {
    uint256 amountIn = 1e18;
    // build userData field
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.SwapType.RegularSwap, // swap type
      0
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20(tokens[0]).approve(address(vault), amountIn);
    // expect fail because swap amounts with from msg.sender instead of vault
    IVault(msg.sender).swap(
      IVault.SingleSwap(
        ICronV1Pool(pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        assets[0],
        assets[1],
        amountIn,
        userData
      ),
      IVault.FundManagement(
        address(this),
        false,
        payable (owner),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }

  function testFailAutoWrongPoolSwapper() public {
    uint256 amountIn = 1e18;
    // build userData field
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.SwapType.RegularSwap, // swap type
      0
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20(tokens[0]).approve(address(vault), amountIn);
    // expect fail because swap amounts with from pool instead of vault
    IVault(pool).swap(
      IVault.SingleSwap(
        ICronV1Pool(pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        assets[0],
        assets[1],
        amountIn,
        userData
      ),
      IVault.FundManagement(
        address(this),
        false,
        payable (owner),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }

  function testFailAutoWrongSwapKind() public {
    uint256 amountIn = 1e18;
    // build userData field
    bytes memory userData = abi.encode(
      ICronV1PoolEnums.SwapType.RegularSwap, // swap type
      0
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20(tokens[0]).approve(address(vault), amountIn);
    // expect fail because swap kind is not IVault.SwapKind.GIVEN_IN
    IVault(vault).swap(
      IVault.SingleSwap(
        ICronV1Pool(pool).POOL_ID(),
        IVault.SwapKind.GIVEN_OUT,
        assets[0],
        assets[1],
        amountIn,
        userData
      ),
      IVault.FundManagement(
        address(this),
        false,
        payable (owner),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }

  function testFailAutoWrongSwapType() public {
    uint256 amountIn = 1e18;
    // build userData field
    // expect fail because swap type out of bounds
    bytes memory userData = abi.encode(
      3, // wrong swap type
      0
    );
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20(tokens[0]).approve(address(vault), amountIn);
    // swap amounts with vault
    IVault(vault).swap(
      IVault.SingleSwap(
        ICronV1Pool(pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        assets[0],
        assets[1],
        amountIn,
        userData
      ),
      IVault.FundManagement(
        address(this),
        false,
        payable (owner),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }

  // broken
  // function testFailAutoWrongIntervalLTSwap() public {
  //   // TODO: this should fail but is passing
  //   swap(100e18, 0, ICronV1PoolEnums.SwapType.LongTermSwap, true);
  // }
}
