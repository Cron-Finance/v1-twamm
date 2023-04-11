(c) Copyright 2022, Bad Pumpkin Inc. All Rights Reserved


Cron-Fi Balancer Vault TWAMM Contract
================================================================================

Adapted from the FrankieIsLost reference design:
  - https://github.com/FrankieIsLost/TWAMM 


TODO
================================================================================

Production / Hardening Work
----------------------------------------
[] Review TODO / #tags in code and address or remove.
[] View functions for convenience
[] Numerical Analysis
    [] Understand appropriate scaling factor of rewardFactors/scaledProceeds for 
       absolute and relative minimums/maximums.
    [] Understand min, mean, max error per operation and deviation from ideal
       TWAMM. Tune / correct if possible.
[] Safe operators
    [] Analyze all paths and understand where uflow/oflow rejection is required.
    [] Places where shifting is used. Understand if safety required.
    [] Use appropriate math operators for explicit limits (i.e. U256 containers)
    [] Use appropriate operators or checks for implicit limits (i.e. U128 in a uint256
       container should check against type(uint128).max)
[] Sqrt function gas savings. Look at PRB library.
[] Optimizations
    [] More aggressive aggregates/big-packing where possible.
        [] Sensible limits on items like fees (U112.max is excessive, employ clipping).
    [] Review and apply Sol .7 best practices.

Version Feature / Change List
================================================================================

V005
----------------------------------------
- Introduce LP Holding Period.
- Optimizaiton and numerical quantification / analysis.
- Reward factor name change to scaled proceeds.
- Fees configurable during operation.
- LP Holding Period feature and composability feature.

V004
----------------------------------------
- Move withdraw and cancellation to onExit
- Accounting change to Balancer Paradigm
    - Compute current twamm reserves as a difference between vault balances and
      the fees, proceeds, and orders
    - Eliminate twamm reserve state variable
- Introduce proceed and order accounting
- Introduce cron-fi fees
- Correct reward factor type to permit overflow/underflow required for 
  billion dollar algorithm proceeds calculations.
- Reintroduce administrator concept
    - pause/unpause
    - add/remove partners, administrators
    - set fee address
- Combine order pools into one object with merged fields for gas savings on
  sload/sstore.
- Oracle feature.

V003
----------------------------------------
- Tokens A, B --> 0, 1 to match Balancer
- Enum instead of numbers for swapType
- Refactor libTwamm
    - merge cancelLongTermSwapGetPurchased into CronV1Pool method _withdrawCancelledLongTermSwap.
    - merge cancelLongTermSwap into CronV1Pool method _cancelLongTermSwap.
    - merge withdrawProceedsFromLongTermSwap into CronV1Pool method _withdrawLongTermSwap.
    - merge performLongTermSwap into CronV1Pool method _longTermSwap
- Remove orderId from Order struct (not used)
    - remove accompanying BitPackingLib methods
    - combine swap direction with unrefunded purchase
      - modify Order struct
      - add BitPackingLib methods
      - update uses in CronV1Pool
- Separate libTwamm into OrderPool.sol and VirtualOrder.sol, rename structs to generic case
  (Virtual Order vs. Long Term Order)
- Reintroduce fees
  - short term swap
  - long term swap
- Introduce Indexed OBI 
- Introduce Enumeration that sets both fees and OBI (Stable, Liquid, Volatile)
  
V002
----------------------------------------
- Remove extra reserve accounting of balancer balances in top level.
- Remove normalization and token scaling.
- Separate out swap functionality (onSwap -> ST swap, LT swap, cancel, etc...)
- Separate out mint functionality (onJoin -> initialMint, mint)
- Combine reserve storage as 112-bit numbers.
- Add natspec documentation to all functions in CronV1Pool.sol
- Make all variables in CronV1Pool.sol conform to naming convention (identifies representation vs. container).

V001
----------------------------------------
- Initial version with libTwamm.sol migrated from cronfi V010.
- Adapted to work with balancer vault as proof of concept.
- In need of optimization and numerical corrections among many other things.


Failed Optimizations
--------------------------------------------------------------------------------
1. Removing indirection in TWAMM.sol calls to longTermSwapFromAToB (and vice-versa) and calling performLongTermSwap
directly.  This resulted in more gas usage; surpisingly more.
2. FEE Math optimization (power of two).  Saves a little bit of gas (like ~100) but costs the pool way more by 
approximation differences. 
3. Zeroing of state in EVO (benefit depends on number of orders ending at different times and incurs loss in inactive
   pools).
