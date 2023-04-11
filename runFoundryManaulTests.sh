#!/bin/bash
source .env

forge clean

# these tests need a local anvil node
# anvil --no-mining &
forge test -vv --rpc-url="http://127.0.0.1:8545" --ffi --match-test testFailManual

forge test -vv --rpc-url="http://127.0.0.1:8545" --ffi --match-test testManual

forge test -vv --rpc-url="http://127.0.0.1:8545" --ffi --match-path contracts/twault/test/overflow/Overflow.t.sol
forge test -vv --rpc-url="http://127.0.0.1:8545" --ffi --match-path contracts/twault/test/manual/OrdersTests.t.sol
forge test -vv --rpc-url="http://127.0.0.1:8545" --ffi --match-path contracts/twault/test/manual/OverflowTests.t.sol
forge test -vv --rpc-url="http://127.0.0.1:8545" --ffi --match-path contracts/twault/test/manual/SpecialScenarios.t.sol