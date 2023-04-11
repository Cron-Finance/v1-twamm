# How to run tests

These tests expect a anvil node running locally with mining disabled.

1. start anvil in a separate terminal
`anvil --no-mining`

2. run following forge command to execute all tests
`forge test -vvvv --rpc-url="http://127.0.0.1:8545" --ffi --match-test Manual --gas-report`
