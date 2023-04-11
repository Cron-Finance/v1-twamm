require("dotenv").config();
const ss = require("./utils/socketClient");
const tests = require("./utils/tests");

const DEFAULT_SOCKET_SVR_PORT = "3039";

const main = async (port = DEFAULT_SOCKET_SVR_PORT) => {
  // never resolving promise ...
  await new Promise((resolve) => {
    ss.startSocketClient(port);
    // tests.testCalcReserves();
  });
};

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
