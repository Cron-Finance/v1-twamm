const ds = require("./debugScopes");
const sim = require("./simulation");
const { deepCopy, jsonStringifyExt } = require("./misc");
const io = require("socket.io-client");

const log = ds.getLog("socketClient");

const _isDev = () => {
  return process.env.NODE_ENV === "development";
};

const _serverUrl = () => {
  return _isDev()
    ? `http://localhost:${process.env.SERVER_PORT}`
    : `${process.env.SERVER_URL}:${process.env.SERVER_PORT}`;
};

const _processTxn = async (obj) => {
  const { txn, uxType, description } = obj;
  const txnCopy = txn.hasOwnProperty("deployTransaction")
    ? deepCopy(txn.deployTransaction)
    : deepCopy(txn);

  if (uxType !== undefined) {
    txnCopy["uxType"] = uxType;
  }
  if (description) {
    txnCopy["description"] = description;
  }
  log.debug(`processTxn: hash = ${txnCopy.hash}`);
  try {
    const receipt = await txn.wait();
    // log.debug(`Receipt \n${JSON.stringify(receiptB, null, 2)}`);

    // Previous way to get receipt.  Doesn't include events array
    // which has useful processed event/log info:
    //
    // const receipt = await web3.eth.getTransactionReceipt(txnCopy.hash);
    // log.debug(`Receipt \n${JSON.stringify(receipt, null, 2)}`);
    for (const field of [
      "type",
      "accessList",
      "maxPriorityFeePerGas",
      "maxFeePerGas",
      "gasLimit",
      "creates",
      "chainId",
    ]) {
      delete txnCopy[field];
    }
    for (const field of ["cumulativeGasUsed", "gasUsed", "effectiveGasPrice"]) {
      const receiptHasField = receipt && receipt.hasOwnProperty(field);
      txnCopy[field] = receiptHasField ? receipt[field] : "0";
    }

    // Now that we have the receipt, get the events of interest as
    // defined in the TWAMM contract:
    //
    const eventsOfInterest = {
      LiquidityProvided: [
        { name: "addr", type: "string" },
        { name: "lpTokens", type: "uint256" },
      ],
      LiquidityRemoved: [
        { name: "addr", type: "string" },
        { name: "lpTokens", type: "uint256" },
      ],
      SwapAToB: [
        { name: "addr", type: "string" },
        { name: "amountAIn", type: "uint256" },
        { name: "amountBOut", type: "uint256" },
      ],
      SwapBToA: [
        { name: "addr", type: "string" },
        { name: "amountBIn", type: "uint256" },
        { name: "amountAOut", type: "uint256" },
      ],
      LongTermSwapAToB: [
        { name: "addr", type: "string" },
        { name: "amountAIn", type: "uint256" },
        { name: "orderId", type: "uint256" },
      ],
      LongTermSwapBToA: [
        { name: "addr", type: "string" },
        { name: "amountBIn", type: "uint256" },
        { name: "orderId", type: "uint256" },
      ],
      CancelLongTermOrder: [
        { name: "addr", type: "string" },
        { name: "orderId", type: "uint256" },
      ],
      WithdrawProceedsFromLongTermOrder: [
        { name: "addr", type: "string" },
        { name: "orderId", type: "uint256" },
      ],
      Transfer: [
        { name: "from", type: "string" },
        { name: "to", type: "string" },
        { name: "amount", type: "uint256" },
      ],
      Approval: [
        { name: "approved", type: "string" },
        { name: "approvedBy", type: "string" },
        { name: "amount", type: "uint256" },
      ],
    };

    txnCopy["events"] = [];
    if (receipt.events) {
      const twammEventNames = Object.keys(eventsOfInterest);
      for (const eventObj of receipt.events) {
        const eventName = eventObj.event;
        if (!twammEventNames.includes(eventName)) {
          continue;
        }

        const twammEvent = { event: eventName };
        let index = 0;
        for (const eventField of eventsOfInterest[eventName]) {
          twammEvent[eventField.name] =
            eventField.type !== "uint256"
              ? eventObj.args[index]
              : eventObj.args[index].toString();

          index++;
        }

        txnCopy["events"].push(twammEvent);
        log.debug(`Decoded TWAMM event:\n${jsonStringifyExt(twammEvent)}`);
      }
    }
  } catch (err) {
    log.error(
      `Problem processing txn:\n ${err}\n ${JSON.stringify(obj, null, 2)}`
    );
  }
  return txnCopy;
};

let _unprocessedTxns = [];
let socket = undefined;
exports.startSocketClient = async () => {
  if (!socket) {
    log.info(`Initializing signers and factories...`);
    await sim.initialize();

    log.info(`Starting socket client; connecting to ${_serverUrl()} ...`);
    socket = io(_serverUrl(), {
      extraHeaders: { context: "simulation-server" },
    });

    socket.on("connect", async () => {
      log.info(`Server connected ${_serverUrl()}.`);
      // await testOnStart()
    });

    socket.on("disconnect", (reason) => {
      log.warn(`Server disconnected because ${reason}.`);
    });

    socket.on("connect_error", (error) => {
      log.warn(`Server connection error.\n${error}`);
    });

    socket.on("command", async (obj) => {
      const _startMs = Date.now();
      log.info(`Received command: ${obj.command}`);

      // Future: (<-- possible TODO)
      //  - Could implement queuing here and ability to query status
      //    on longer jobs. For now we simplify and make this very
      //    low-level control by the client.
      //
      const { id, command, args } = obj;
      const result = {
        id,
        command,
        args,
        obj: undefined,
        error: undefined,
        transactions: [],
      };

      switch (command) {
        case "simulation-init":
        case "simulation-reset":
          {
            const { initialTokenA, initialTokenB, blockInterval } = args;
            const transactions = await sim.configureTwammSim(
              initialTokenA,
              initialTokenB,
              blockInterval
            );
            _unprocessedTxns.push(...transactions);
          }
          break;

        case "mint":
          // TODO
          break;

        case "burn":
          // TODO
          break;

        case "arb":
        case "swap":
          {
            const isArb = command === "arb";
            const { tokenA, tokenB } = args;
            if (tokenA && tokenA > 0) {
              const transactions = await sim.swapAToB(tokenA, isArb);
              _unprocessedTxns.push(...transactions);
            } else if (tokenB && tokenB > 0) {
              const transactions = await sim.swapBToA(tokenB, isArb);
              _unprocessedTxns.push(...transactions);
            }
          }
          break;

        case "ltswap":
          {
            const { tokenA, tokenB, numIntervals } = args;
            if (numIntervals && numIntervals > 0) {
              if (tokenA && tokenA > 0) {
                const transactions = await sim.ltSwapAToB(tokenA, numIntervals);
                _unprocessedTxns.push(...transactions);
              } else if (tokenB && tokenB > 0) {
                const transactions = await sim.ltSwapBToA(tokenB, numIntervals);
                _unprocessedTxns.push(...transactions);
              }
            }
          }
          break;

        case "withdraw":
          {
            const { orderId } = args;
            if (orderId >= 0) {
              const transactions = await sim.withdrawLtSwapProceeds(orderId);
              log.debug(
                `Withdraw OrderId ${orderId} Result:\n` +
                  `${JSON.stringify(transactions, 2)}\n`
              );
              _unprocessedTxns.push(...transactions);
            }
          }
          break;

        case "exec-virtual-orders":
          {
            const transactions = await sim.execVirtualOrders();
            _unprocessedTxns.push(...transactions);
          }
          break;

        case "get-reserves":
          result.obj = await sim.getReserves();
          break;

        case "calc-reserves":
          result.obj = await sim.calcReserves();
          break;

        case "mine":
          {
            const { numBlocks } = args;
            const _numBlocks = numBlocks ? numBlocks : 1;
            for (let idx = 0; idx < _numBlocks; idx++) {
              await sim.mineBlock();
            }
            while (_unprocessedTxns.length > 0) {
              const txn = _unprocessedTxns.shift();
              const pTxn = await _processTxn(txn);
              result.transactions.push(pTxn);
            }
          }
          break;

        case "get-block-number":
          {
            const blockNumber = await sim.getBlockNumber();
            result.obj = { blockNumber };
          }
          break;

        default:
          log.warn(
            `Unrecognized command received: "${obj.command}". Ignoring.`
          );
          break;
      }

      // Emit the result of the most recent operation
      socket.emit("result", { result });

      log.debug(`Processed request in ${Date.now() - _startMs} ms`);
    });
  }
};
