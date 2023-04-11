pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";
import { ExecVirtualOrdersMem } from "../../interfaces/Structs.sol";

contract PriceQuotes is HelperContract {

  function setUp() public {
    _addInitialLiquidity();
  }

  function shortTermSwap() public {
    (uint256 amountOut) = swap(1e18, 0, ICronV1PoolEnums.SwapType.RegularSwap, true);
    assertGt(amountOut, 989e15);
  }

  function testAutoPreSwapPrice() public {
    uint256 reserve0U1120;
    uint256 reserve1U1120;
    {
      (, reserve0U1120, reserve1U1120, , , , , , , , ) = ICronV1Pool(pool).getVirtualReserves(block.number, false);
    }
  }

  function testAutoPostSwapPrice() public {
    shortTermSwap();
    uint256 reserve0U1120;
    uint256 reserve1U1120;
    {
      (, reserve0U1120, reserve1U1120, , , , , , , , ) = ICronV1Pool(pool).getVirtualReserves(block.number, false);
    }
  }
}
