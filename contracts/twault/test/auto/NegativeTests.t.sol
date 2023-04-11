pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract NegativeTests is HelperContract {

  function testAutoZeroJoin() public {
    // setup parameters for joinPool
    uint joinKind = 0;
    bytes memory userData = getJoinUserData(joinKind, 0, 0);
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // IAsset[] memory assets = new IAsset[](2);
    uint256[] memory maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
    bool fromInternalBalance = false;
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(address(vault), 100e18);
    IERC20(tokens[1]).approve(address(vault), 100e18);
    // call joinPool function on TWAMMs
    vm.expectRevert(bytes("CFI#204"));
    IVault(vault).joinPool(
      poolId,
      address(this),
      payable (address(this)),
      IVault.JoinPoolRequest(
        assets,
        maxAmountsIn,
        userData,
        fromInternalBalance
      )
    );
  }

  function testAutoCorrectJoin() public {
    // setup parameters for joinPool
    uint joinKind = 0;
    uint256[] memory balances = new uint256[](2);
    balances[0] = 100e18;
    balances[1] = 100e18;
    bytes memory userData = getJoinUserData(joinKind, balances[0], balances[1]);
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
    bool fromInternalBalance = false;
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(address(vault), 100e18);
    IERC20(tokens[1]).approve(address(vault), 100e18);
    // call joinPool function on TWAMMs
    IVault(vault).joinPool(
      poolId,
      address(this),
      payable (address(this)),
      IVault.JoinPoolRequest(
        assets,
        maxAmountsIn,
        userData,
        fromInternalBalance
      )
    );
  }

  function testAutoCombinedJoin() public {
    testAutoCorrectJoin();
    testAutoZeroJoin();
  }

  function setupBadTokensTest(uint256 _swapType, uint256 _argument) public {
    bytes memory userData = abi.encode(
      _swapType, // swap type
      _argument
    );
    // correct tokens/assets
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    // (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    // IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // setup incorrect pool
    TestToken tokenB = new TestToken("TB", "TB", 2**112);
    TestToken tokenA = new TestToken("TA", "TA", 2**112);
    address incorrectPool = factory.create(
      address(tokenB),
      address(tokenA),
      "TA-TB-Stable",
      "TB-TB-S",
      0
    );
    // get incorrect tokens
    bytes32 badPoolId = ICronV1Pool(incorrectPool).POOL_ID();
    (IERC20[] memory wrongTokens, , ) = vault.getPoolTokens(badPoolId);
    IAsset[] memory wrongAssets = _convertERC20sToAssets(wrongTokens);
    // approve tokens to spend from this contract in the vault
    IERC20 wrongToken = wrongTokens[0];
    wrongToken.approve(address(vault), 1e18);
    // swap amounts with vault
    // vm.expectRevert(bytes("BAL#521"));
    IVault(vault).swap(
      IVault.SingleSwap(
        poolId, // correct pool
        IVault.SwapKind.GIVEN_IN,
        wrongAssets[0], // incorrect assets
        wrongAssets[1], // incorrect assets
        1e18,
        userData
      ),
      IVault.FundManagement(
        address(this),
        false,
        payable (address(this)),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }

  // incorrect tokens test
  function testFailAutoTokensShortTermSwap() public {
    setupBadTokensTest(0, 0);
  }

  function testFailAutoTokensLongTermSwap() public {
    setupBadTokensTest(1, 10);
  }
  
  function testFailAutoTokensPartnerSwap() public {
    setupBadTokensTest(2, 0);
  }
  
//  function testFailAutoTokensRookSwap() public {
//    setupBadTokensTest(3, 0);
//  }
}
