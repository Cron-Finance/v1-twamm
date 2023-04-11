pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { ExecVirtualOrdersMem } from "../../interfaces/Structs.sol";

contract OverflowTests is HelperContract {
  struct Users {
    address B;
    address C;
    address D;
    address E;
    address F;
    address G;
  }
  TestToken public tokenA;
  TestToken public tokenB;
  address[] public arbitrageurs1;
  ArbitrageurListExample public arbPartners1;

  function setUp() public {
    uint256 mintAmount = 2 ** 128;
    tokenA = new TestToken("T0", "T0", mintAmount);
    tokenB = new TestToken("T1", "T1", mintAmount);
  }

  // Basic Overflow Tests
  // ================================================================================
  // Description:
  //   Ensure overflow is caught on basics.

  // Test Procedure:
  //   1. User A initializes a pool with a join of (((2 ** 112) - 1) - 100000) of
  //     each token.
  //     - Mine a block
  //   2. User B initiates a long term swap of 100001 Token 0 over 4 intervals
  //     * Expect fail
  //   3. User B initiates a long term swap of 100001 Token 1 over 2 intervals
  //     * Expect fail
  //   4. User C initiates a short term swap of 100001 Token 0
  //     * Expect fail
  //   5. User C initiates a short term swap of 100001 Token 1 
  //     * Expect fail
  //   6. User D initiates a partner swap of 100001 Token 0
  //     * Expect fail
  //   7. User D initiates a partner swap of 100001 Token 1 
  //     * Expect fail
  // 10. User F initiates a join of 100001 of each token
  //     * Expect fail
  // 11. User G initiates a reward of 100001 of Token 0
  //     * Expect fail
  // 12. User G initiates a reward of 100001 of Token 1
  //     * Expect fail

  function testOverflowManualBasic() public {
    address newPool = factory.create(
      address(tokenA),
      address(tokenB),
      "TA-TB-Liquid",
      "TA-TB-L",
      1
    );
    Users memory u;
    u.B = vm.addr(54);
    u.C = vm.addr(53);
    u.D = vm.addr(55);
    u.E = vm.addr(56);
    u.F = vm.addr(57);
    u.G = vm.addr(58);
    arbitrageurs1 = [owner, u.D, u.E];
    arbPartners1 = new ArbitrageurListExample(arbitrageurs1);
    bytes32 poolId = ICronV1Pool(newPool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IERC20(tokens[0]).transfer(u.B, 100e18);
    IERC20(tokens[1]).transfer(u.B, 100e18);
    IERC20(tokens[0]).transfer(u.C, 100e18);
    IERC20(tokens[1]).transfer(u.C, 100e18);
    IERC20(tokens[0]).transfer(u.D, 100e18);
    IERC20(tokens[1]).transfer(u.D, 100e18);
    IERC20(tokens[0]).transfer(u.E, 100e18);
    IERC20(tokens[1]).transfer(u.E, 100e18);
    IERC20(tokens[0]).transfer(u.F, 100e18);
    IERC20(tokens[1]).transfer(u.F, 100e18);
    IERC20(tokens[0]).transfer(u.G, 100e18);
    IERC20(tokens[1]).transfer(u.G, 100e18);
    uint MAX_U112 = 2 ** 112 - 1;
    uint initialMint = MAX_U112 - 100000;
    addLiquidity(newPool, address(this), address(this), initialMint, initialMint, 0);
    mineBlocks(1);
    _swap(100001, 4, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenA), newPool, u.B, "BAL#526");
    mineBlocks(1);
    _swap(100001, 2, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenB), newPool, u.B, "BAL#526");
    mineBlocks(1);
    _swap(100001, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokenA), newPool, u.C, "BAL#526");
    mineBlocks(1);
    _swap(100001, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokenB), newPool, u.C, "BAL#526");
    mineBlocks(1);
    ICronV1Pool(newPool).setAdminStatus(address(this), true);
    ICronV1Pool(newPool).setArbitragePartner(owner, address(arbPartners1));
    _swap(100001, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, address(tokenA), newPool, u.D, "BAL#526");
    mineBlocks(1);
    _swap(100001, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, address(tokenB), newPool, u.D, "BAL#526");
    mineBlocks(1);
    addLiquidityRevert(newPool, u.F, u.F, 100001, 100001, 0, "BAL#526");
    mineBlocks(1);
    addLiquidityRevert(newPool, u.G, u.G, 100001, 0, 1, "BAL#526");
    mineBlocks(1);
    addLiquidityRevert(newPool, u.G, u.G, 0, 100001, 1, "BAL#526");
    mineBlocks(1);
  }

  // Token 0 Advanced Overflow Tests
  // ================================================================================
  // Description:
  //   Ensure overflow is caught on more advanced scenarios for Token 0

  // Test Procedure:
  //   1. User A initializes a pool with a join of (((2 ** 112) - 1) - 1,000,000) of
  //     each token.
  //     - Mine a block
  //   2. User B issues an LT swap of 900,000 Token 0 over 5 intervals
  //     - Mine a block
  //   3. User C initiates a long term swap of 100001 Token 0 over 4 intervals
  //     * Expect fail
  //   4. User C initiates a short term swap of 100001 Token 0
  //     * Expect fail
  //   5. User D initiates a partner swap of 100001 Token 0
  //     * Expect fail
  //   7. User F initiates a join of 100001 of each token
  //     * Expect fail
  //   8. User G initiates a reward of 100001 of Token 0
  //     * Expect fail

  function testOverflowManualT0Advanced() public {
    address newPool = factory.create(
      address(tokenA),
      address(tokenB),
      "TA-TB-Liquid",
      "TA-TB-L",
      1
    );
    Users memory u;
    u.B = vm.addr(54);
    u.C = vm.addr(53);
    u.D = vm.addr(55);
    u.E = vm.addr(56);
    u.F = vm.addr(57);
    u.G = vm.addr(58);
    arbitrageurs1 = [owner, u.D, u.E];
    arbPartners1 = new ArbitrageurListExample(arbitrageurs1);
    bytes32 poolId = ICronV1Pool(newPool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IERC20(tokens[0]).transfer(u.B, 100e18);
    IERC20(tokens[1]).transfer(u.B, 100e18);
    IERC20(tokens[0]).transfer(u.C, 100e18);
    IERC20(tokens[1]).transfer(u.C, 100e18);
    IERC20(tokens[0]).transfer(u.D, 100e18);
    IERC20(tokens[1]).transfer(u.D, 100e18);
    IERC20(tokens[0]).transfer(u.E, 100e18);
    IERC20(tokens[1]).transfer(u.E, 100e18);
    IERC20(tokens[0]).transfer(u.F, 100e18);
    IERC20(tokens[1]).transfer(u.F, 100e18);
    IERC20(tokens[0]).transfer(u.G, 100e18);
    IERC20(tokens[1]).transfer(u.G, 100e18);
    uint MAX_U112 = 2 ** 112 - 1;
    uint initialMint = MAX_U112 - 1000000;
    addLiquidity(newPool, address(this), address(this), initialMint, initialMint, 0);
    mineBlocks(1);
    _swap(900000, 5, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenA), newPool, u.B, "");
    mineBlocks(1);
    _swap(100001, 4, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenA), newPool, u.C, "BAL#526");
    mineBlocks(1);
    _swap(100001, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokenA), newPool, u.C, "BAL#526");
    mineBlocks(1);
    ICronV1Pool(newPool).setAdminStatus(address(this), true);
    ICronV1Pool(newPool).setArbitragePartner(owner, address(arbPartners1));
    _swap(100001, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, address(tokenA), newPool, u.D, "BAL#526");
    mineBlocks(1);
    addLiquidityRevert(newPool, u.F, u.F, 100001, 100001, 0, "BAL#526");
    mineBlocks(1);
    addLiquidityRevert(newPool, u.G, u.G, 1000001, 0, 1, "BAL#526");
    mineBlocks(1);
  }

  // Token 1 Advanced Overflow Tests
  // ================================================================================
  // Description:
  //   Ensure overflow is caught on more advanced scenarios for Token 1

  // Test Procedure:
  //   1. User A initializes a pool with a join of (((2 ** 112) - 1) - 1,000,000) of
  //     each token.
  //     - Mine a block
  //   2. User B issues an LT swap of 900,000 Token 1 over 5 intervals
  //     - Mine a block
  //   3. User C initiates a long term swap of 100001 Token 1 over 4 intervals
  //     * Expect fail
  //   4. User C initiates a short term swap of 100001 Token 1
  //     * Expect fail
  //   5. User D initiates a partner swap of 100001 Token 1
  //     * Expect fail
  //   7. User F initiates a join of 100001 of each token
  //     * Expect fail
  //   8. User G initiates a reward of 100001 of Token 1
  //     * Expect fail

  function testOverflowManualT1Advanced() public {
    address newPool = factory.create(
      address(tokenA),
      address(tokenB),
      "TA-TB-Liquid",
      "TA-TB-L",
      1
    );
    Users memory u;
    u.B = vm.addr(54);
    u.C = vm.addr(53);
    u.D = vm.addr(55);
    u.E = vm.addr(56);
    u.F = vm.addr(57);
    u.G = vm.addr(58);
    arbitrageurs1 = [owner, u.D, u.E];
    arbPartners1 = new ArbitrageurListExample(arbitrageurs1);
    bytes32 poolId = ICronV1Pool(newPool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IERC20(tokens[0]).transfer(u.B, 100e18);
    IERC20(tokens[1]).transfer(u.B, 100e18);
    IERC20(tokens[0]).transfer(u.C, 100e18);
    IERC20(tokens[1]).transfer(u.C, 100e18);
    IERC20(tokens[0]).transfer(u.D, 100e18);
    IERC20(tokens[1]).transfer(u.D, 100e18);
    IERC20(tokens[0]).transfer(u.E, 100e18);
    IERC20(tokens[1]).transfer(u.E, 100e18);
    IERC20(tokens[0]).transfer(u.F, 100e18);
    IERC20(tokens[1]).transfer(u.F, 100e18);
    IERC20(tokens[0]).transfer(u.G, 100e18);
    IERC20(tokens[1]).transfer(u.G, 100e18);
    uint MAX_U112 = 2 ** 112 - 1;
    uint initialMint = MAX_U112 - 1000000;
    addLiquidity(newPool, address(this), address(this), initialMint, initialMint, 0);
    mineBlocks(1);
    _swap(900000, 5, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenB), newPool, u.B, "");
    mineBlocks(1);
    _swap(100001, 4, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenB), newPool, u.C, "BAL#526");
    mineBlocks(1);
    _swap(100001, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokenB), newPool, u.C, "BAL#526");
    mineBlocks(1);
    ICronV1Pool(newPool).setAdminStatus(address(this), true);
    ICronV1Pool(newPool).setArbitragePartner(owner, address(arbPartners1));
    _swap(100001, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, address(tokenB), newPool, u.D, "BAL#526");
    mineBlocks(1);
    addLiquidityRevert(newPool, u.F, u.F, 100001, 100001, 0, "BAL#526");
    mineBlocks(1);
    addLiquidityRevert(newPool, u.G, u.G, 0, 1000001, 1, "BAL#526");
    mineBlocks(1);
  }

  function repeatableTests(Users memory u, bool expectFail, address newPool, ArbitrageurListExample _arbPartners) public {
    bytes32 poolId = ICronV1Pool(newPool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IERC20(tokens[0]).transfer(u.D, 100e18);
    IERC20(tokens[1]).transfer(u.D, 100e18);
    IERC20(tokens[0]).transfer(u.E, 100e18);
    IERC20(tokens[1]).transfer(u.E, 100e18);
    IERC20(tokens[0]).transfer(u.F, 100e18);
    IERC20(tokens[1]).transfer(u.F, 100e18);
    IERC20(tokens[0]).transfer(u.G, 100e18);
    IERC20(tokens[1]).transfer(u.G, 100e18);
    string memory errStr = expectFail ? "BAL#526" : "";
    _swap(100001, 4, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenA), newPool, u.D, errStr);
    mineBlocks(1);
    _swap(100001, 2, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenB), newPool, u.D, errStr);
    mineBlocks(1);
    _swap(100001, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokenA), newPool, u.D, errStr);
    mineBlocks(1);
    _swap(100001, 0, ICronV1PoolEnums.SwapType.RegularSwap, address(tokenB), newPool, u.D, errStr);
    mineBlocks(1);
    ICronV1Pool(newPool).setAdminStatus(address(this), true);
    ICronV1Pool(newPool).setArbitragePartner(owner, address(_arbPartners));
    _swap(100001, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, address(tokenA), newPool, u.D, errStr);
    mineBlocks(1);
    _swap(100001, uint256(owner), ICronV1PoolEnums.SwapType.PartnerSwap, address(tokenB), newPool, u.D, errStr);
    mineBlocks(1);
    addLiquidityRevert(newPool, u.F, u.F, 100001, 100001, 0, errStr);
    mineBlocks(1);
    addLiquidityRevert(newPool, u.G, u.G, 0, 100001, 1, errStr);
    mineBlocks(1);
    addLiquidityRevert(newPool, u.G, u.G, 100001, 0, 1, errStr);
    mineBlocks(1);
  }

  // Concurrent Advanced Overflow Tests
  // ================================================================================
  // Description:
  //   Ensure overflow is caught on more advanced scenarios for both tokens.

  // Test Procedure:
  //   1. User A initializes a pool with a join of (((2 ** 112) - 1) - 1,000,000) of
  //     each token.
  //     - Mine a block
  //   2. User B issues an LT swap of 900,000 Token 0 over 5 intervals
  //     User C issues an LT swap of 900,000 Token 1 over 5 intervals
  //     - Mine a block
  //   3. User D initiates a long term swap of 100001 Token 0 over 4 intervals
  //     * Expect fail
  //   4. User D initiates a long term swap of 100001 Token 1 over 2 intervals
  //     * Expect fail
  //   5. User D initiates a short term swap of 100001 Token 0
  //     * Expect fail
  //   6. User D initiates a short term swap of 100001 Token 1 
  //     * Expect fail
  //   7. User D initiates a partner swap of 100001 Token 0
  //     * Expect fail
  //   8. User D initiates a partner swap of 100001 Token 1 
  //     * Expect fail
  // 11. User D initiates a join of 100001 of each token
  //     * Expect fail
  // 12. User D initiates a reward of 100001 of Token 0
  //     * Expect fail
  // 13. User D initiates a reward of 100001 of Token 1
  //     * Expect fail
  // 14. Get the Vault balances
  //     * Expect 2 ** 112 - 1
  // 15. Sum the orders, proceeds, fees, and twammReserveAmounts
  //     * Expect very close to, if not 2 ** 112 - 1
  // 16. User A exits 1/2 their LP tokens
  //     * Expect success
  // 17. Repeat steps 3 - 13, but expect success

  function testOverflowManualConcurrentAdvanced() public {
    address newPool = factory.create(
      address(tokenA),
      address(tokenB),
      "TA-TB-Liquid",
      "TA-TB-L",
      1
    );
    uint MAX_U112 = 2 ** 112 - 1;
    uint initialMint = MAX_U112 - 1000000;
    addLiquidity(newPool, address(this), address(this), initialMint, initialMint, 0);
    mineBlocks(1);
    Users memory u;
    u.B = vm.addr(54);
    u.C = vm.addr(53);
    u.D = vm.addr(55);
    u.E = vm.addr(56);
    u.F = vm.addr(57);
    u.G = vm.addr(58);
    arbitrageurs1 = [owner, u.D, u.E];
    arbPartners1 = new ArbitrageurListExample(arbitrageurs1);
    bytes32 poolId = ICronV1Pool(newPool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IERC20(tokens[0]).transfer(u.B, 100e18);
    IERC20(tokens[1]).transfer(u.B, 100e18);
    IERC20(tokens[0]).transfer(u.C, 100e18);
    IERC20(tokens[1]).transfer(u.C, 100e18);
    _swap(900000, 5, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenA), newPool, u.B, "");
    mineBlocks(1);
    _swap(900000, 5, ICronV1PoolEnums.SwapType.LongTermSwap, address(tokenB), newPool, u.C, "");
    mineBlocks(1);
    ICronV1Pool(newPool).setAdminStatus(address(this), true);
    repeatableTests(u, true, newPool, arbPartners1);
    (uint256 reserve0, uint256 reserve1, uint256 total0, uint256 total1) = getReservesAndTotals(newPool);
    assertLt(reserve0, 2**112-1-100000);
    assertLt(reserve1, 2**112-1-100000);
    // Sum the orders, proceeds, fees, and twammReserveAmounts
    //  * Expect very close to, if not 2 ** 112 - 1
    // Note - API change in getVirtualReserves, might need to change below assertions to assert the 
    //        before/after difference.
    assertLt(total0, 2**112-1-90000);
    assertLt(total1, 2**112-1-90000);
    uint256 lpTokens = ICronV1Pool(newPool).balanceOf(address(this));
    exit(lpTokens/2, ICronV1PoolEnums.ExitType.Exit, newPool, address(this));
    repeatableTests(u, false, newPool, arbPartners1);
  }

  function _swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1PoolEnums.SwapType _swapType,
    address _tokenIn,
    address _pool,
    address _trader,
    string memory revertStr
  ) internal returns (uint256 amountOut) {
    vm.startPrank(_trader);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20 token = (_tokenIn == address(tokens[0])) ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);
    // swap amounts with vault
    // bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (bytes(revertStr).length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    amountOut = IVault(vault).swap(
      IVault.SingleSwap(
        poolId,
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
        payable (_trader),
        false
      ),
      0,
      block.timestamp + 1000
    );
    vm.stopPrank();
  }

  function getReservesAndTotals(address pool) internal returns(uint256 reserve0, uint256 reserve1, uint256 total0, uint256 total1)
  {
      ( ,
        uint256 token0ReserveU112,
        uint256 token1ReserveU112,
        uint256 token0OrdersU112,
        uint256 token1OrdersU112,
        uint256 token0ProceedsU112,
        uint256 token1ProceedsU112,
        uint256 token0BalancerFeesU96,
        uint256 token1BalancerFeesU96,
        uint256 token0CronFiFeesU96,
        uint256 token1CronFiFeesU96 ) = ICronV1Pool(pool).getVirtualReserves(block.number, false);
      reserve0 = token0ReserveU112;
      reserve1 = token1ReserveU112;
      total0 = token0BalancerFeesU96 + token0CronFiFeesU96 + token0OrdersU112 + token0ProceedsU112 + reserve0;
      total1 = token1BalancerFeesU96 + token1CronFiFeesU96 + token1OrdersU112 + token1ProceedsU112 + reserve1;
  }
}
