# How to run tests

These tests expect a mainnet fork

`FORK_URL=https://eth-mainnet.g.alchemy.com/v2/H4pd6ZHrNV_bhPydFFXng6dexwFAbVcp
forge test -vv --gas-report --fork-url $FORK_URL --match-path contracts/twault/test/mev/KeeperDAOTest.t.sol`