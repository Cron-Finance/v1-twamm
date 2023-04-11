# Concurrent Long Term Swaps Scenarios
## Interruptions
### Withdraw before cancel
- Add 100,000 of USDC & DAI liquidity to pools

- Issue 2 long term swaps OBI 10 (interval): 
  0. Addr1: LT Swap 10,000 USDC => DAI, 100 blocks, SR: 100 per block, 1000 per interval
  1. Addr2: LT Swap 20,000 DAI => TO, 400 blocks, SR: 50 per block, 500 per interval

- Check values of reserves (TWAMM (State, View), Vault) between smart contract & TS Model
  * Expect reserves to be unchanged since order just placed in TWAMM
  * Expect Balancer Vault to think:
    0. 110,000 USDC
    1. 120,000 DAI

- Mine 10 blocks, 1 interval
- Check values of reserves (TWAMM (State, View), Vault) between smart contract & TS Model
  * Expect USDC reserves to be 2x less than DAI since USDC SR > DAI SR, only in TWAMM View & Vault since state hasn't been updated
  * Trade 0: Reserve0: 101,000, Reserve1: 99,000, Proceeds: 1000 DAI, Vault: 110,000 USDC, 120,000 DAI
  * Trade 1: Reserve0: 100,500, Reserve1: 99,500, Proceeds: 500 USDC, Vault: 110,000 USDC, 120,000 DAI

- Send a withdrawal request for order ID (0)
  - Need to get proceeds (DAI) out for Addr1
    - Send a swap request (USDC -> DAI) with 1 USDC, userData has withdraw information
    - Expect to withdraw sales rate * # of blocks of DAI out approximately 1000 DAI
    * Addr1: receives 1000 DAI, Reserve0: 100,501, Reserve1: 99,500, Vault: 110,001 USDC, 119,000 DAI
- Check values of reserves (TWAMM (State, View), Vault) between smart contract & TS Model
  * Expect order owner's DAI value to be equal to what was removed from Vault minus fees
  * Expect USDC reserves to have the amount user added and 1 extra token needed for swap
  * Expect view & state values to match as update has happened

- Mine a 50 blocks, 5 intervals
- Check values of reserves (TWAMM (State, View), Vault) between smart contract & TS Model
  * Expect Reserve0 to be growing slower than Reserve1
  * Trade 0: Reserve0: 105,501, Reserve1: 94,500, Vault: 110,001 USDC, 119,000 DAI, Proceeds: 6,000 DAI
  * Trade 1: Reserve0: 103,001, Reserve1: 97,000, Vault: 110,001 USDC, 119,000 DAI, Proceeds: 3,000 USDC
  * Expect view & state values to not match since no updates have happened

- Start cancel process for order ID (0)
  - Need to get proceeds (DAI) out and refund (USDC)
    - Send a swap request (DAI -> USDC) with 1 DAI, userData has cancel information
    - Expect to refund amount not sold of USDC to return to user
    - Reserves get: 1 DAI, Order Pool pays Refunds: 4,000 USDC
    - Send a second swap request (USDC -> DAI) with 1 USDC, userData has withdraw information
    - Reserves get: 1 USDC, Order Pool pays Proceeds: 6,000 DAI
- Check values of reserves (TWAMM (State, View), Vault)
    * Expect view & state values to match as update has happened
    * Reserve0: 103,002, Reserve1: 97,001, Vault: 106,000 USDC, 113,000 DAI
    * Expect USDC to continue growing a lot faster than DAI since it's now a CFMM DAI -> TO