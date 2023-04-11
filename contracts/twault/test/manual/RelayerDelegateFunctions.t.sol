pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { IERC20 } from "../../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";

import { Vault } from "../../balancer-core-v2/vault/Vault.sol";
import { Authorizer } from "../../balancer-core-v2/vault/Authorizer.sol";
import { IAuthorizer } from "../../balancer-core-v2/vault/interfaces/IAuthorizer.sol";
import { IWETH } from "../../balancer-core-v2/vault/interfaces/IWETH.sol";
import { WETH } from "../../balancer-core-v2/test/WETH.sol";

import { TestToken } from "../../helpers/TestToken.sol";
import { ICronV1Pool } from "../../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../../interfaces/pool/ICronV1PoolEnums.sol";
import { ICronV1PoolFactory } from "../../interfaces/ICronV1PoolFactory.sol";
import { CronV1PoolFactory } from "../../factories/CronV1PoolFactory.sol";

import { CronV1Actions } from "../../periphery/CronV1Actions.sol";
import { CronV1Relayer } from "../../periphery/CronV1Relayer.sol";
import { ICronV1Relayer } from "../../interfaces/ICronV1Relayer.sol";

import { Order } from "../../interfaces/Structs.sol";

import { C } from "../../miscellany/Constants.sol";

contract DelegateFunctionality is Test {
  address public owner;
  address public delegate;
  Authorizer public authorizer;
  ICronV1Relayer public relayer;
  CronV1Actions public relayerLib;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken public token1;
  TestToken public token2;
  address public pool;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    authorizer = new Authorizer(owner);
    vault = new Vault(authorizer, IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    vm.label(owner, "owner");
    vm.label(delegate, "delegate");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
    // create Cron-Fi Relayer & Actions:
    relayerLib = new CronV1Actions(IVault(address(vault)), ICronV1PoolFactory(address(factory)));
    relayer = ICronV1Relayer(address(relayerLib.getEntrypoint()));
    // create two mock tokens
    uint256 mintAmount = 2**112;
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
    addLiquidity(pool, owner, owner, 1e24, 1e24, 0);
    IERC20(token1).transfer(owner, 1e23);
    IERC20(token2).transfer(owner, 1e23);
    // Give the relayer authorization on action ids:
    {
      // New actionIds below from:
      //   https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/deployments/action-ids/mainnet/action-ids.json
      //
      // Production Vault Action IDs
      // address vault = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
      bytes32[] memory roles = generateActionIds(address(vault));

      authorizer.grantRoles(roles, address(relayer));
    }
  }

  // Delegate Functionality Test 1
  function testManualPeripheryDelegate1() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    vm.startPrank(delegate);
    vault.setRelayerApproval(delegate, address(relayer), true);
    vm.stopPrank();
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    // 2.  Issue an LT Swap for 100k Token A as the owner over 100 intervals. Specify a 
    //     delegate (longTermSwap recipient).
    swap(1e23, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), pool, owner, delegate);
    uint preToken2 = IERC20(token2).balanceOf(owner);
    // 3.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(owner, 0, 10);
    // 4.  Confirm the owner can withdraw proceeds to their address
    withdraw(orderIds[0], pool, owner, owner, "");
    // 5.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 6.  Confirm the owner can withdraw proceeds to any other address
    withdraw(orderIds[0], pool, owner, vm.addr(1223), "");
    // 7.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 8.  Confirm the owner can withdraw proceeds to the null address <-- curiousity
    withdraw(orderIds[0], pool, owner, address(0), "BAL#409");
    // 9.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 10. Confirm the delegate can withdraw proceeds to the owner address
    withdraw(orderIds[0], pool, delegate, owner, "");
    // 11. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 12. Confirm the delegate cannot withdraw proceeds to the delegate address
    withdraw(orderIds[0], pool, delegate, delegate, "CFI#609");
    // 13. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 14. Confirm the delegate cannot withdraw proceeds to another address
    withdraw(orderIds[0], pool, delegate, vm.addr(88), "CFI#609");
    // 15. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 16. Confirm the delegate cannot withdraw proceeds to the null address
    withdraw(orderIds[0], pool, delegate, address(0), "CFI#609");
    // 17. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 18. Confirm the delegate cannot cancel the order to the null address
    cancel(orderIds[0], pool, delegate, address(0), "CFI#612");
    // 19. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 20. Confirm the delegate cannot cancel the order to the delegate address
    cancel(orderIds[0], pool, delegate, delegate, "CFI#612");
    // 21. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 22. Confirm the delegate cannot cancel the order to another address
    cancel(orderIds[0], pool, delegate, address(77), "CFI#612");
    // 23. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 24. Confirm the delegate can cancel the order to the owner address
    cancel(orderIds[0], pool, delegate, owner, "");
    // // 25. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    uint postToken2 = IERC20(token2).balanceOf(owner);
    assertGt(postToken2, preToken2);
  }

  // Delegate Functionality Test 2
  function testManualPeripheryDelegate2A() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    // 2.  Issue an LT Swap for 100k Token A as the owner over 100 intervals. Specify a 
    //     delegate (longTermSwap recipient).
    swap(1e23, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), pool, owner, delegate);
    uint preToken2 = IERC20(token2).balanceOf(owner);
    // 3.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(owner, 0, 10);
    // 4. Confirm the owner can cancel the order to their address
    cancel(orderIds[0], pool, owner, owner, "");
    // 5. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    uint postToken2 = IERC20(token2).balanceOf(owner);
    assertGt(postToken2, preToken2);
  }

  // Delegate Functionality Test 2
  function testManualPeripheryDelegate2B() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    // 2.  Issue an LT Swap for 100k Token A as the owner over 100 intervals. Specify a 
    //     delegate (longTermSwap recipient).
    swap(1e23, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), pool, owner, delegate);
    address targetAddr = vm.addr(888);
    uint preToken2 = IERC20(token2).balanceOf(targetAddr);
    // 3.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(owner, 0, 10);
    // 4. Confirm the owner can cancel the order to their address
    cancel(orderIds[0], pool, owner, targetAddr, "");
    // 5. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    uint postToken2 = IERC20(token2).balanceOf(targetAddr);
    assertGt(postToken2, preToken2);
  }

  // Delegate Functionality Test 3
  function testManualPeripheryDelegate3() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    vm.startPrank(delegate);
    vault.setRelayerApproval(delegate, address(relayer), true);
    vm.stopPrank();
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    // 2.  Issue an LT Swap for 100k Token A as the owner over 100 intervals. Specify a 
    //     delegate (longTermSwap recipient).
    swap(1e23, 100, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), pool, owner, delegate);
    uint preToken2 = IERC20(token2).balanceOf(owner);
    // 3.  Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(owner, 0, 10);
    // 4. Confirm the owner can cancel the order to their address
    cancel(orderIds[0], pool, address(0), vm.addr(888), "CFI#613");
    // 5. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 4. Confirm the owner can cancel the order to their address
    withdraw(orderIds[0], pool, address(0), vm.addr(888), "CFI#611");
    // 5. Run the EVM blocks OBI blocks
    mineBlocks(C.LIQUID_OBI);
    // 4. Confirm the owner can cancel the order to their address
    withdraw(orderIds[0], pool, delegate, owner, "");
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
  ) public {
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20 token = (_tokenIn == address(tokens[0])) ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);
    // swap amounts with vault
    IVault(address(vault)).swap(
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

  function withdraw(
    uint _argument,
    address _pool,
    address _sender,
    address _recipient,
    string memory revertStr
  ) public {
    vm.startPrank(_sender);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (revertStrTest.length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    relayer.withdraw(
      address(tokens[0]),
      address(tokens[1]),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      _argument,
      _recipient
    );
    vm.stopPrank();
  }

  function cancel(
    uint _argument,
    address _pool,
    address _sender,
    address _recipient,
    string memory revertStr
  ) public {
    vm.startPrank(_sender);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (revertStrTest.length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    relayer.cancel(
      address(tokens[0]),
      address(tokens[1]),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      _argument,
      _recipient
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
    IVault(address(vault)).joinPool(
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
      vm.ffi(inputs);
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

  function generateActionId(address _vault, string memory fn) public pure returns (bytes32) {
    bytes32 disambiguator = bytes32(uint256(address(_vault)));
    bytes4 selector = bytes4(keccak256(bytes(fn)));
    return keccak256(abi.encodePacked(disambiguator, selector));
  }

  function generateActionIds(address _vault) public pure returns (bytes32[] memory) {
    string[] memory fns = new string[](10);
    fns[0] = "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)";
    fns[1] = "joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))";
    fns[2] = "exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))";

    bytes32[] memory roles = new bytes32[](fns.length);
    for (uint256 i = 0; i < fns.length; i++) {
      bytes32 role = generateActionId(_vault, fns[i]);
      roles[i] = role;
    }
    return roles;
  }

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
