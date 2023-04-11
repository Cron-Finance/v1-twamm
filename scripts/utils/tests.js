const ds = require("./debugScopes");
const io = require("socket.io-client");
const sim = require("./simulation");
const { jsonStringifyExt } = require("./misc");

////////////////////////////////////////////////////////////////////////////////
// Ignore the contents of this file.  They're for testing the
// connection between the main web/db socket server and this process
// which interacts with eth:
////////////////////////////////////////////////////////////////////////////////

const log = ds.getLog("tests");

// Pretend we're PB's web page issuing commands
//
const runClientCommand = async (clientSocket, cmdObj) => {
  if (cmdObj.executed) {
    log.error(
      `Command executed already! A new command and id must be created. Ignoring!\n` +
        `Command object:\n${JSON.stringify(cmdObj, null, 2)}`
    );
    return;
  }

  clientSocket.emit("client-command", cmdObj);
  cmdObj.executed = true;

  await new Promise((resolve) => {
    clientSocket.once("result", (obj) => {
      if (obj && obj.result && obj.result.id === cmdObj.id) {
        log.debug(`Command ${cmdObj.command} succeeded.`);
        resolve();
      } else {
        const errStr =
          `Failed to get expected acknowledgement of command ${cmdObj.command}. ` +
          `Expected command id ${cmdObj.id}, received response: ` +
          `${JSON.stringify(obj, null, 2)}`;

        throw new Error(errStr);
      }
    });
  });
};

const delayMs = async (delayInMs = 250) => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, delayInMs);
  });
};

exports.testAsClient = async () => {
  log.debug("Testing client mode ...");
  await delayMs(3000);
  const clientSocket = io(_serverUrl());

  clientSocket.on("connect", async () => {
    log.debug("Connected as client. Starting simulation:");

    let cmdId = 0;
    let cmdObj = {
      id: cmdId++,
      command: "simulation-play",
      args: {
        tokenA: 1000000, // Sell 1M token A for tokenB in an LT Swap
        tokenB: 0,
        numIntervals: 10,
        blockInterval: 10,
        /* more options possible (and in place, get this working first) */
      },
    };
    await runClientCommand(clientSocket, cmdObj);

    await delayMs(3000);

    log.debug("Pausing simulation:");
    cmdObj = { id: cmdId++, command: "simulation-pause" };
    await runClientCommand(clientSocket, cmdObj);

    await delayMs(3000);

    log.debug("Re-starting simulation:");
    cmdObj = { id: cmdId++, command: "simulation-play", args: {} };
    await runClientCommand(clientSocket, cmdObj);

    await delayMs(3000);

    log.debug("Resetting simulation:");
    cmdObj = { id: cmdId++, command: "simulation-reset", args: {} };
    await runClientCommand(clientSocket, cmdObj);

    await delayMs(3000);

    log.debug("Re-starting simulation:");
    cmdObj = {
      id: cmdId++,
      command: "simulation-play",
      args: {
        tokenA: 1000000, // Sell 10M token A for tokenB in an LT Swap
        tokenB: 0,
        numIntervals: 10,
        blockInterval: 10,
        /* more options possible (and in place, get this working first) */
      },
    };
    await runClientCommand(clientSocket, cmdObj);

    await delayMs(3000);
  });

  clientSocket.on("status", (statusObj) => {
    log.debug(`Received status:\n${JSON.stringify(statusObj, null, 2)}`);
  });

  clientSocket.on("disconnect", (reason) => {
    log.warn(`Server disconnected because ${reason}.`);
  });

  clientSocket.on("connect_error", (error) => {
    log.warn(`Server connection error.\n${error}`);
  });
};

exports.testOnStart = async () => {
  // Test run of my old arb
  log.info(`Running my old arb ...`);
  await sim.initialize();
  await sim.configureTwammSim();
  await sim.execVirtualOrders();
  await sim.mineBlock();
  await sim.getReserves();

  await sim.swapBToA(10000);
  await sim.mineBlock();
  await sim.getReserves();

  const numIntervals = 10;
  await sim.ltSwapBToA(10000000, 10);
  await sim.mineBlock();
  await sim.getReserves();

  const blockInterval = 10;
  const blocksToMine = numIntervals * blockInterval;
  for (let idx = 0; idx < blocksToMine; idx++) {
    await sim.execVirtualOrders();
    await sim.mineBlock();

    // Simple arb to unity:
    //
    const obj = await sim.getReserves();
    if (obj.reserveA / obj.reserveB < 0.999) {
      const swapA = Math.ceil((obj.reserveB - obj.reserveA) / 2);
      await sim.swapAToB(swapA);
    } else if (obj.reserveB / obj.reserveA < 0.999) {
      const swapB = Math.ceil((obj.reserveA - obj.reserveB) / 2);
      await sim.swapBToA(swapB);
    }
  }

  log.info(`Finished`);
};

exports.testCalcReserves = async () => {
  // Test run of my old arb
  log.info(`Testing Calculate Reserves ...`);
  await sim.initialize();
  await sim.configureTwammSim();
  await sim.execVirtualOrders();
  await sim.mineBlock();

  log.debug("Calling calcReserves...");
  let calculatedReserves = await sim.calcReserves();
  log.debug(`  returned:\n${jsonStringifyExt(calculatedReserves, 2)}`);

  // await sim.getReserves();

  // await sim.swapBToA(10000);
  // await sim.mineBlock();
  // await sim.getReserves();

  const numIntervals = 10;
  await sim.ltSwapBToA(1000000, 10);
  await sim.mineBlock();
  // await sim.getReserves();

  const blockInterval = 10;
  const blocksToMine = numIntervals * blockInterval;
  for (let idx = 0; idx < blocksToMine; idx++) {
    // await sim.execVirtualOrders();
    await sim.mineBlock();

    // const start = Date.now();
    // log.debug("Calling calcReserves...");
    // calculatedReserves = await sim.calcReserves();
    // log.debug(
    //   `  returned (${(Date.now() - start).toFixed(3)} ms):\n${jsonStringifyExt(
    //     calculatedReserves,
    //     2
    //   )}`
    // );

    // // Simple arb to unity:
    // //
    // const obj = await sim.getReserves();
    // if (obj.reserveA / obj.reserveB < 0.999) {
    //   const swapA = Math.ceil((obj.reserveB - obj.reserveA) / 2);
    //   await sim.swapAToB(swapA);
    // } else if (obj.reserveB / obj.reserveA < 0.999) {
    //   const swapB = Math.ceil((obj.reserveA - obj.reserveB) / 2);
    //   await sim.swapBToA(swapB);
    // }
  }

  // Now compare our calculation to reality
  calculatedReserves = await sim.calcReserves(
    undefined /* blockNum */,
    [] /* transactions */
  );
  const { transactions } = calculatedReserves;

  await sim.execVirtualOrders();
  await sim.mineBlock();
  const actualReserves = await sim.getReserves();

  const start = Date.now();
  log.debug("Calling calcReserves...");
  calculatedReserves = await sim.calcReserves();
  const { reserveA, reserveB } = calculatedReserves;
  log.debug(
    `Calculated: (${(Date.now() - start).toFixed(3)} ms):\n` +
      `${jsonStringifyExt({ reserveA, reserveB }, 2)}\n` +
      `\n` +
      `Actual:\n` +
      `${jsonStringifyExt(actualReserves, 2)}\n\n`
  );
  log.debug(`\n\n\nGas:\n`, JSON.stringify(transactions, null, 2));

  log.info(`Finished`);
};
