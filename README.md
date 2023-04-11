# CronFi V1: TWAMM

## Setup & Testing
```bash
git clone https://github.com/Cron-Finance/twamm
cd twamm
npm install
```
### Hardhat
```bash
# add env vars in .env file or comment out features in hardhat.config.ts
npx hardhat compile
# run test suite
npm run test-safety
```
#### .env File Example:
```bash
ALCHEMY_API_KEY=xxx
ETHERSCAN_API_KEY=xxx
COINMARKET_API_KEY=xxx
ETH_FROM=xxx
REPORT_GAS=1
PRIVATE_KEY=
```
### Foundry
```bash
forge clean
forge build

# automated tests
./runFoundryAutoTests.sh

# these tests need a local anvil node
anvil --no-mining &
./runFoundryManualTests.sh
```

## Deployement Addresses
https://docs.cronfi.com/twamm/refrences/deployment-addresses

## Security Concerns
Contact us via [e-mail](security@cronfi.com) with subject line - ***CronFi V1: Vulnerability***
