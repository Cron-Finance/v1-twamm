#!/bin/bash
source .env

forge clean

# these tests don't need a local anvil node
forge test -vv --match-test testAuto
forge test -vv --match-test testFailAuto
forge test -vv --match-test testFuzz

# these tests require mainnet forking
forge test -vv --fork-url https://eth-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY --match-path contracts/twault/test/fork/MEVRewards.t.sol
forge test -vv --fork-url https://eth-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY --match-path contracts/twault/test/fork/AtomicActionsFork.t.sol
