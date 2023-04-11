async function testCompleteHandler(){
  console.log("Tests complete");
}

module.exports = {
  skipFiles: [
    "cronfi",
    "extended",
    "FIL",
    "frankie",
    "optimize_0_1",
    "mock",
    "helpers/ds-math/src/",
    "helpers/ds-test/src/",
    "twault/V001",
    "twault/V002",
    "twault/V003",
    "twault/V004",
    "twault/CronV1PoolExposed.sol",
    "twault/test",
    "twault/mev",
    "twault/helpers",
    "twault/scripts",
    "twault/balancer-core-v2",
    "contracts/twault/libraries"
  ],
  onTestsComplete: testCompleteHandler
};
