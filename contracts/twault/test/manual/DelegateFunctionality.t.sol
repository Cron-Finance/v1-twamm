pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../../balancer-core-v2/vault/Vault.sol";
import "../../balancer-core-v2/vault/interfaces/IAsset.sol";
import "../../balancer-core-v2/test/WETH.sol";

import "../../helpers/TestToken.sol";
import "../../interfaces/ICronV1Pool.sol";
import "../../interfaces/pool/ICronV1PoolEnums.sol";
import "../../factories/CronV1PoolFactory.sol";
import { Order } from "../../interfaces/Structs.sol";

import { C } from "../../miscellany/Constants.sol";

contract DelegateFunctionality is Test {
  address public owner;
  address public delegate;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken public token0;
  TestToken public token1;
  TestToken public token2;
  address public pool;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    vault = new Vault(IAuthorizer(owner), IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
    // create two mock tokens
    uint256 mintAmount = 2**112;
    token0 = new TestToken("T0", "T0", mintAmount);
    token1 = new TestToken("T1", "T1", mintAmount);
    token2 = new TestToken("T2", "T2", mintAmount);
    delegate = vm.addr(1337);
    pool = factory.create(
      address(token1),
      address(token2),
      "T1-T2",
      "T1-T2",
      1
    );
    vm.label(owner, "owner");
    vm.label(delegate, "delegate");
    addLiquidity(pool, owner, owner, 1e24, 1e24, 0);
    IERC20(token1).transfer(owner, 1e23);
    IERC20(token2).transfer(owner, 1e23);
  }

  // Delegate Functionality Test 1
  function testManualDelegate1() public {
    // 2.  Issue an LT Swap for 100k Token A as the owner over 100 intervals. Specify a 
    //     delegate (longTermSwap recipient).
    swap(1e23, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), pool, owner, delegate);
    uint preToken2 = IERC20(token2).balanceOf(owner);
    // 3.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(owner, 0, 10);
    // 4.  Confirm the owner can withdraw proceeds to their address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, owner, owner, "");
    // 5.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 6.  Confirm the owner can withdraw proceeds to any other address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, owner, vm.addr(1223), "");
    // 7.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 8.  Confirm the owner can withdraw proceeds to the null address <-- curiousity
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, owner, address(0), "BAL#409");
    // 9.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 10. Confirm the delegate can withdraw proceeds to the owner address
    // Order memory order = ICronV1Pool(pool).getOrder(orderIds[0]);
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, delegate, owner, "");
    // 11. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 12. Confirm the delegate cannot withdraw proceeds to the delegate address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, delegate, delegate, "CFI#010");
    // 13. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 14. Confirm the delegate cannot withdraw proceeds to another address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, delegate, vm.addr(88), "CFI#010");
    // 15. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 16. Confirm the delegate cannot withdraw proceeds to the null address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, delegate, address(0), "CFI#010");
    // 17. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 18. Confirm the delegate cannot cancel the order to the null address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel, pool, delegate, address(0), "CFI#010");
    // 19. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 20. Confirm the delegate cannot cancel the order to the delegate address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel, pool, delegate, delegate, "CFI#010");
    // 21. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 22. Confirm the delegate cannot cancel the order to another address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel, pool, delegate, address(77), "CFI#010");
    // 23. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 24. Confirm the delegate can cancel the order to the owner address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel, pool, delegate, owner, "");
    // 25. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    uint postToken2 = IERC20(token2).balanceOf(owner);
    assertGt(postToken2, preToken2);
  }

  // Delegate Functionality Test 2
  function testManualDelegate2A() public {
    // 2.  Issue an LT Swap for 100k Token A as the owner over 100 intervals. Specify a 
    //     delegate (longTermSwap recipient).
    swap(1e23, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), pool, owner, delegate);
    uint preToken2 = IERC20(token2).balanceOf(owner);
    // 3.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(owner, 0, 10);
    // 4. Confirm the owner can cancel the order to their address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel, pool, owner, owner, "");
    // 5. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    uint postToken2 = IERC20(token2).balanceOf(owner);
    assertGt(postToken2, preToken2);
  }

  // Delegate Functionality Test 2
  function testManualDelegate2B() public {
    // 2.  Issue an LT Swap for 100k Token A as the owner over 100 intervals. Specify a 
    //     delegate (longTermSwap recipient).
    swap(1e23, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), pool, owner, delegate);
    uint preToken2 = IERC20(token2).balanceOf(vm.addr(888));
    // 3.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(owner, 0, 10);
    // 4. Confirm the owner can cancel the order to another address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel, pool, owner, vm.addr(888), "");
    // 5. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    uint postToken2 = IERC20(token2).balanceOf(vm.addr(888));
    assertGt(postToken2, preToken2);
  }

  // Delegate Functionality Test 3
  function testManualDelegate3() public {
    // 2.  Issue an LT Swap for 100k Token A as the owner over 100 intervals. Specify a 
    //     delegate (longTermSwap recipient).
    swap(1e23, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), pool, owner, delegate);
    uint preToken2 = IERC20(token2).balanceOf(owner);
    // 3.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(owner, 0, 10);
    // 4. Confirm the owner can cancel the order to their address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Cancel, pool, address(0), vm.addr(888), "CFI#010");
    // 5. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 4. Confirm the owner can cancel the order to their address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, address(0), vm.addr(888), "CFI#010");
    // 5. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 4. Confirm the owner can cancel the order to their address
    exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, delegate, owner, "");
    uint postToken2 = IERC20(token2).balanceOf(owner);
    assertGt(postToken2, preToken2);
  }

  function swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1Pool.SwapType _swapType,
    address _tokenIn,
    address _pool,
    address _trader,
    address _delegate
  ) public returns (uint256 amountOut) {
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20 token = (_tokenIn == address(tokens[0])) ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);
    // swap amounts with vault
    amountOut = IVault(vault).swap(
      IVault.SingleSwap(
        ICronV1Pool(_pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        (_tokenIn == address(tokens[0])) ? assets[0] : assets[1],
        (_tokenIn == address(tokens[0])) ? assets[1] : assets[0],
        _amountIn,
        abi.encode(
          _swapType,
          _argument
        )
      ),
      IVault.FundManagement(
        _trader,
        false,
        payable (_delegate),
        false
      ),
      0,
      block.timestamp + 1000
    );
  }

  function exit(
    uint _argument,
    ICronV1Pool.ExitType _exitType,
    address _pool,
    address _sender,
    address _recipient,
    string memory revertStr
  ) public {
    vm.startPrank(_sender);
    // build userData field
    bytes memory userData = abi.encode(
      _exitType, // exit type
      _argument
    );
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory minAmountOut = getMinAmountsOut(0, 0);
    bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (revertStrTest.length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    IVault(vault).exitPool(
      poolId,
      _sender,
      payable (_recipient),
      IVault.ExitPoolRequest(
        assets,
        minAmountOut,
        userData,
        false
      )
    );
    vm.stopPrank();
  }

  function addLiquidity(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) public {
    // setup parameters for joinPool
    bytes memory userData = getJoinUserData(_joinKind, _liquidity0, _liquidity1);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
    bool fromInternalBalance = false;
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(address(vault), _liquidity0);
    IERC20(tokens[1]).approve(address(vault), _liquidity1);
    // call joinPool function on TWAMMs
    IVault(vault).joinPool(
      poolId,
      _from,
      payable (_to),
      IVault.JoinPoolRequest(
        assets,
        maxAmountsIn,
        userData,
        fromInternalBalance
      )
    );
  }

  function mineBlocks(uint256 _numBlocks) public {
    // emit log_uint(block.number);
    for (uint256 i = 0; i < _numBlocks; ++i) {
      string[] memory inputs = new string[](3);
      inputs[0] = "cast";
      inputs[1] = "rpc";
      inputs[2] = "anvil_mine";
      bytes memory res = vm.ffi(inputs);
    }
    uint256 secondsPerBlock = 12;
    vm.roll(block.number + _numBlocks);
    vm.warp(block.timestamp + secondsPerBlock);
    // console.log("block time", block.timestamp);
    // emit log_uint(block.number);
  }

  function mineBlocks() public {
    mineBlocks(1);
  }
  
  function getMinAmountsOut(uint256 minToken0, uint256 minToken1)
           public pure
           returns(uint256[] memory minAmountsOut)
  {
    minAmountsOut = new uint256[](2);
    minAmountsOut[0] = minToken0;
    minAmountsOut[1] = minToken1;
  }

  function getJoinUserData(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1
  ) public pure returns (bytes memory userData) {
    userData = getJoinUserDataWithMin(_joinKind, _liquidity0, _liquidity1, 0, 0);
  }
  
  function getJoinUserDataWithMin(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _minLiquidity0,
    uint256 _minLiquidity1
  ) public pure returns (bytes memory userData) {
    uint256[] memory balances = new uint256[](2);
    balances[0] = _liquidity0;
    balances[1] = _liquidity1;
    uint256[] memory minTokenAmt = new uint256[](2);
    minTokenAmt[0] = _minLiquidity0;
    minTokenAmt[1] = _minLiquidity1;
    userData = abi.encode(_joinKind, balances, minTokenAmt);
  }
  
  function getMaxAmountsIn(IERC20[] memory tokens)
           public pure
           returns(uint256[] memory maxAmountsIn)
  {
    maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
  }

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
