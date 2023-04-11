Scenario
------------------------------------------------------------
- Liquidity pool with 100,000 tokens
- Order block interval 10
- Two concurrent unbalanced long term swaps
  - LT Swap 10,000 USDC => DAI, 100 blocks
  - LT Swap 20,000 DAI => USDC, 400 blocks
- Withdraw swap 1 proceeds before completion
- Cancel swap 1 after

Assumptions
------------------------------------------------------------
- Stable coin swap 1:1 USDC <> DAI
- 1 token = 1 coin
- 1 decimal not 18 decimal
- No fees charged

Trade
------------------------------------------------------------
Action: Add liquidity 100k DAI, 100k USDC
Block Number: 0
Sales Rate:
    0:
    1:
Vault Reserves:
    0: 100,000 USDC
    1: 100,000 DAI
TWAMM:
    Reserves State:
        0:
        1:
    Reserves View:
        0:
        1:
    Order Pool:
        0:
        1:
------------------------------------------------------------
Action: Issue two concurrent unbalanced long term swaps
  - LT Swap 10,000 USDC => DAI, 100 blocks
  - LT Swap 20,000 DAI => USDC, 400 blocks 
Block Number: 1
Sales Rate:
    0: 100 tokens per block
    1: 50 tokens per block
Vault Reserves:
    0: 110,000 USDC
    1: 120,000 DAI
TWAMM:
    Reserves State:
        0: 100,000 USDC
        1: 100,000 DAI
    Reserves View:
        0: 100,000 USDC
        1: 100,000 DAI
    Order Pool:
        0: 10,000 USDC
        1: 20,000 DAI
------------------------------------------------------------
Action: Mine 10 blocks, check values 
Block Number: 11
Sales Rate:
    0: 100 tokens per block
    1: 50 tokens per block
Vault Reserves:
    0: 110,000 USDC
    1: 120,000 DAI
TWAMM:
    Reserves State:
        0: 100,000
        1: 100,000
    Reserves View:
        0: 100,500
        1: 99,500
    Order Pool:
        0: 
        1: 
------------------------------------------------------------
Action: Send withdrawal request for order 0
  - Swap request USDC -> DAI with 1 USDC
Block Number: 11
Sales Rate:
    0: 100 tokens per block
    1: 50 tokens per block
Vault Reserves:
    0: 110,001 USDC
    1: 119,000 DAI
TWAMM:
    Reserves State:
        0: 100,501
        1: 99,500
    Reserves View:
        0: 100,501
        1: 99,500
    Order Pool:
        0: 9,000 USDC
        1: 19,500 DAI
    Proceeds:
        0: 1000 DAI
        1: 500 USDC
------------------------------------------------------------
Action: Mine 50 blocks, check values 
Block Number: 61
Sales Rate:
    0: 100 tokens per block
    1: 50 tokens per block
Vault Reserves:
    0: 110,001 USDC
    1: 119,000 DAI
TWAMM:
    Reserves State:
        0: 100,501
        1: 99,500
    Reserves View:
        0: 103,001
        1: 97,000
    Order Pool:
        0: 
        1: 500 USDC
------------------------------------------------------------
Action: Start cancel process for order id 0
  - Swap request DAI -> USDC with 1 DAI
Block Number: 61
Sales Rate:
    0: 100 tokens per block
    1: 50 tokens per block
Vault Reserves:
    0: 106,001 USDC
    1: 113,001 DAI
TWAMM:
    Reserves State:
        0: 100,501
        1: 99,500
    Reserves View:
        0: 100,501
        1: 99,500
    Order Pool:
        0: 
        1: 3000
    Proceeds:
        0: 6000 DAI
    Refunds:
        0: 4000 USDC