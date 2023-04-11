const { BigNumber } = require("ethers");
const fs = require("fs");
const { ethers, network } = require("hardhat");
const ds = require("./debugScopes");
const { calcReserves } = require("./quoting");
const { TRANSACTION_TYPES } = require("./constants");

const twamm_contract = 'TWAMM'

const log = ds.getLog("simulation");

const _state = {
  factories: {
    erc20: undefined,
    twamm: undefined,
  },
  contracts: {
    tokenA: undefined,
    tokenB: undefined,
    twamm: undefined,
  },
  signers: {
    ltSwap: undefined,
    swap: undefined,
    arbBot: undefined,
    others: undefined,
  },
  params: {
    blockInterval: undefined,
    initialLiquidityTokenA: undefined,
    initialLiquidityTokenB: undefined,
    erc20Supply: undefined,
    amount: undefined, // Amount to fund signers at simulation start.
  },
};

const scaleNumbers = true;
const decimalShiftLeft = (value, places = 18) => {
  return value * 10 ** places;
};

// Ugh:  Mess--need typescript clarity here as we're using this numerically and also as a string
//       Size limits matter.  TODO
const decimalShiftRight = (value, places = 18) => {
  return value / 10 ** places;
};

/* initialize:
 *
 *    Configures signers and factories in state object. Should only need to be called once.
 *    Performs auto-mining. Disables auto-mining on exit.
 *
 */
let _initializeCalled = false;
exports.initialize = async () => {
  if (_initializeCalled) {
    return;
  }

  log.info("Initializing simulation (enables auto-mining)...");

  // Get signing addresses:
  //
  let _others;
  [
    _state.signers.ltSwap,
    _state.signers.swap,
    _state.signers.arbBot,
    ..._others
  ] = await ethers.getSigners();
  _state.signers.others = _others;

  // Get factories:
  //
  await network.provider.send("evm_setAutomine", [true]);

  _state.factories.erc20 = await ethers.getContractFactory("ERC20Mock");

  // const orderPoolLib = await ethers.getContractFactory("OrderPoolLib");
  // log.debug(`orderPoolLib\n${JSON.stringify(orderPoolLib, null, 2)}`);
  // const longTermOrdersLib = await ethers.getContractFactory(
  //   "LongTermOrdersLib",
  //   {
  //     libraries: {
  //       OrderPoolLib: orderPoolLib.address,
  //     },
  //   }
  // );
  _state.factories.twamm = await ethers.getContractFactory(
    twamm_contract
    // , {
    //   libraries: {
    //     OrderPoolLib: orderPoolLib.address,
    //     LongTermOrdersLib: longTermOrdersLib.address,
    //   },
    // }
  );

  await network.provider.send("evm_setAutomine", [false]);
  await network.provider.send("evm_setIntervalMining", [0]);

  _initializeCalled = true;
};

/* configureTwamm:
 *
 *    Called every time a contract reset is needed.  Deploys new token/twamm contracts,
 *    initializes a twamm contract instance, funds singers.
 *    Performs auto-mining. Disables auto-mining on exit.
 *
 */
exports.configureTwammSim = async (
  initialLiquidityTokenA = 10000000,
  initialLiquidityTokenB = 10000000,
  blockInterval = 10,
  erc20Supply = ethers.utils.parseUnits("1000000000")
) => {
  // TODO:
  //    1. Need to free existing contract memory if these are being re-defined.
  //    2. Need to ensure erc20Supply is adequate for specified initial liquidities
  const transactions = [];

  let _initialLiquidityTokenA = scaleNumbers
    ? BigInt(Math.floor(decimalShiftLeft(initialLiquidityTokenA)))
    : BigInt(Math.floor(initialLiquidityTokenA));
  let _initialLiquidityTokenB = scaleNumbers
    ? BigInt(Math.floor(decimalShiftLeft(initialLiquidityTokenB)))
    : BigInt(Math.floor(initialLiquidityTokenB));

  _state.params.initialLiquidityTokenA = _initialLiquidityTokenA;
  _state.params.initialLiquidityTokenB = _initialLiquidityTokenB;
  _state.params.blockInterval = blockInterval;
  _state.params.erc20Supply = erc20Supply;

  log.info(
    "Configuring TWAMM (enables auto-mining) ... \n" +
      `  initial liquidity TokenA = ${_state.params.initialLiquidityTokenA}\n` +
      `  initial liquidity TokenB = ${_state.params.initialLiquidityTokenB}\n` +
      `  block interval = ${blockInterval}\n` +
      `  ERC20 supply = ${_state.params.erc20Supply}\n`
  );

  log.debug(
    `initial liquidities:\n  A: ${_initialLiquidityTokenA}\n  B: ${_initialLiquidityTokenB}\n`
  );
  await network.provider.send("evm_setAutomine", [true]);

  // Deploy new contracts:
  //
  _state.contracts.tokenA = await _state.factories.erc20.deploy(
    "TokenA",
    "TokenA",
    _state.params.erc20Supply
  );
  _state.contracts.tokenB = await _state.factories.erc20.deploy(
    "TokenB",
    "TokenB",
    _state.params.erc20Supply
  );
  // Don't need to scale blockInterval by 10 ** 18 b/c of inconsistency in code (it gets passed to
  // LongTermOrders.sol without treating it as an 18 digit fixed point number):
  _state.contracts.twamm = await _state.factories.twamm.deploy(
    twamm_contract,
    twamm_contract,
    _state.contracts.tokenA.address,
    _state.contracts.tokenB.address,
    _state.params.blockInterval
  );

  // Perform TWAMM initialization with provided parameters:
  //
  await _state.contracts.tokenA.approve(
    _state.contracts.twamm.address,
    _state.params.erc20Supply
  );
  await _state.contracts.tokenB.approve(
    _state.contracts.twamm.address,
    _state.params.erc20Supply
  );

  const dpTxn = await _state.contracts.twamm.deployed();

  transactions.push({
    txn: dpTxn,
    uxType: TRANSACTION_TYPES.DEPLOY,
    description:
      `TWAMM contract ${_state.contracts.twamm.address} deployed,` +
      `Token A address: ${_state.contracts.tokenA.address}, ` +
      `Token B address: ${_state.contracts.tokenB.address}.`,
  });
  log.debug(`TWAMM deployed ...`);

  const lpTxn = await _state.contracts.twamm.provideInitialLiquidity(
    _initialLiquidityTokenA,
    _initialLiquidityTokenB
  );
  transactions.push({
    txn: lpTxn,
    uxType: TRANSACTION_TYPES.INITIAL_LIQUIDITY,
    description:
      `Provide initial liquidity to TWAMM contract ${_state.contracts.twamm.address} ` +
      `(${initialLiquidityTokenA} Token A, ${initialLiquidityTokenB} Token B).`,
  });
  log.debug(`TWAMM initial liquidity provided...`);

  log.info(`Twamm deployed to ${_state.contracts.twamm.address}.`);

  // Fund simulation signers with tokens needed for operations (swaps, arbs etc.)
  //
  _state.params.amount = 100000000;
  const amountBN = ethers.BigNumber.from(_state.params.amount);

  const _contracts = [_state.contracts.tokenA, _state.contracts.tokenB];
  const _signers = [
    _state.signers.swap,
    _state.signers.ltSwap,
    _state.signers.arbBot,
  ];

  for (const _contract of _contracts) {
    for (const _signer of _signers) {
      await _contract.transfer(_signer.address, amountBN);
    }
  }

  log.info(`Signers funded.  Disabling auto & interval mining.`);

  await network.provider.send("evm_setAutomine", [false]);
  await network.provider.send("evm_setIntervalMining", [0]);

  return transactions;
};

/* execVirtualOrders
 *
 */
exports.execVirtualOrders = async () => {
  const txn = await _state.contracts.twamm.executeAllVirtualOrders();
  log.info(`Queued executeAllVirtualOrders call.`);

  return [
    {
      txn: txn,
      uxType: TRANSACTION_TYPES.EXEC_VIRTUAL,
      description: `Execute all virtual orders on TWAMM contract ${_state.contracts.twamm.address}.`,
    },
  ];
};

/* getReserves
 *
 *   Returns the current reserves. This value will be incorrect
 *   if a twamm contract function that hasn't exercised executeVirtualOrders
 *   hasn't been run and long-term trades are active.
 *
 */
exports.getReserves = async () => {
  const reserveA = await _state.contracts.twamm.tokenAReserves();
  const reserveB = await _state.contracts.twamm.tokenBReserves();

  const _reserveA = scaleNumbers ? decimalShiftRight(reserveA) : reserveA;
  const _reserveB = scaleNumbers ? decimalShiftRight(reserveB) : reserveB;

  log.info(`getReserves:  ReserveA = ${_reserveA}, reserveB = ${_reserveB}.`);
  return { reserveA: _reserveA, reserveB: _reserveB };
};

const ltSwap = async (amountTokenA, amountTokenB, numBlockIntervals) => {
  const ltSwapSigner = _state.signers.ltSwap;
  const twammContract = _state.contracts.twamm;
  const transactions = [];

  if (amountTokenA > 0) {
    const amountBN = scaleNumbers
      ? BigInt(Math.floor(decimalShiftLeft(amountTokenA)))
      : ethers.BigNumber.from(amountTokenA);

    // Approve the fund transfer:
    //
    const apTxn = await _state.contracts.tokenA
      .connect(ltSwapSigner)
      .approve(twammContract.address, amountBN);
    transactions.push({
      txn: apTxn,
      uxType: TRANSACTION_TYPES.APPROVE,
      description:
        `${ltSwapSigner.address} (LT trader) approves ${amountTokenA} ` +
        `of ${_state.contracts.tokenA.address} (Token A) to ` +
        `${twammContract.address} (TWAMM contract)`,
    });

    // Issue the long term swap transaction:
    //
    const ltTxn = await twammContract
      .connect(ltSwapSigner)
      .longTermSwapFromAToB(amountBN, numBlockIntervals);
    transactions.push({
      txn: ltTxn,
      uxType: TRANSACTION_TYPES.LTSWAP,
      description:
        `${ltSwapSigner.address} (LT trader) long-term swaps ${amountTokenA} ` +
        `of ${_state.contracts.tokenA.address} (Token A) in ` +
        `${twammContract.address} (TWAMM contract) over ` +
        `${numBlockIntervals} block intervals.`,
    });

    log.info(
      `Queued long-term swap of ${amountTokenA} TokenA to TokenB in ${numBlockIntervals} block intervals.\n` +
        `${JSON.stringify(ltTxn, null, 2)}`
    );
  } else if (amountTokenB > 0) {
    const amountBN = scaleNumbers
      ? BigInt(Math.floor(decimalShiftLeft(amountTokenB)))
      : ethers.BigNumber.from(amountTokenB);

    // Approve the fund transfer:
    //
    const apTxn = await _state.contracts.tokenB
      .connect(ltSwapSigner)
      .approve(twammContract.address, amountBN);
    transactions.push({
      txn: apTxn,
      uxType: TRANSACTION_TYPES.APPROVE,
      description:
        `${ltSwapSigner.address} (LT trader) approves ${amountTokenB} ` +
        `of ${_state.contracts.tokenB.address} (Token B) to ` +
        `${twammContract.address} (TWAMM contract)`,
    });

    // Issue the long term swap transaction:
    //
    const ltTxn = await twammContract
      .connect(ltSwapSigner)
      .longTermSwapFromBToA(amountBN, numBlockIntervals);
    transactions.push({
      txn: ltTxn,
      uxType: TRANSACTION_TYPES.LTSWAP,
      description:
        `${ltSwapSigner.address} (LT trader) long-term swaps ${amountTokenB} ` +
        `of ${_state.contracts.tokenB.address} (Token A) in ` +
        `${twammContract.address} (TWAMM contract) over ` +
        `${numBlockIntervals} block intervals.`,
    });

    log.info(
      `Queued long-term swap of ${amountTokenB} TokenB to TokenA in ${numBlockIntervals} block intervals.\n${JSON.stringify(
        ltTxn,
        null,
        2
      )}`
    );
  }

  return transactions;
};

exports.ltSwapAToB = async (amount, numBlockIntervals) => {
  return await ltSwap(amount, 0, numBlockIntervals);
};

exports.ltSwapBToA = async (amount, numBlockIntervals) => {
  return await ltSwap(0, amount, numBlockIntervals);
};

const swap = async (amountTokenA, amountTokenB, isArb = false) => {
  const swapSigner = _state.signers.ltSwap;
  const twammContract = _state.contracts.twamm;
  const transactions = [];

  if (amountTokenA > 0) {
    const amountBN = scaleNumbers
      ? BigInt(Math.floor(decimalShiftLeft(amountTokenA)))
      : ethers.BigNumber.from(amountTokenA);

    // Approve the fund transfer:
    //
    const apTxn = await _state.contracts.tokenA
      .connect(swapSigner)
      .approve(twammContract.address, amountBN);
    transactions.push({
      txn: apTxn,
      uxType: TRANSACTION_TYPES.APPROVE,
      description:
        `${swapSigner.address} (Trader) approves ${amountTokenA} ` +
        `of ${_state.contracts.tokenA.address} (Token A) to ` +
        `${twammContract.address} (TWAMM contract)`,
    });

    // Issue the swap transaction:
    //
    const stTxn = await twammContract
      .connect(swapSigner)
      .swapFromAToB(amountBN);
    transactions.push({
      txn: stTxn,
      uxType: isArb ? TRANSACTION_TYPES.ARB_SWAP : TRANSACTION_TYPES.SWAP,
      description:
        `${swapSigner.address} (${
          isArb ? "Arbitrageur" : "Trader"
        }) swaps ${amountTokenA} ` +
        `of ${_state.contracts.tokenA.address} (Token A) in ` +
        `${twammContract.address} (TWAMM contract).`,
    });

    log.info(`Queued swap of ${amountTokenA} TokenA to TokenB.`);
  } else if (amountTokenB > 0) {
    const amountBN = scaleNumbers
      ? BigInt(Math.floor(decimalShiftLeft(amountTokenB)))
      : ethers.BigNumber.from(amountTokenB);

    // Approve the fund transfer:
    //
    const apTxn = await _state.contracts.tokenB
      .connect(swapSigner)
      .approve(twammContract.address, amountBN);
    transactions.push({
      txn: apTxn,
      uxType: TRANSACTION_TYPES.APPROVE,
      description:
        `${swapSigner.address} (Trader) approves ${amountTokenB} ` +
        `of ${_state.contracts.tokenB.address} (Token B) to ` +
        `${twammContract.address} (TWAMM contract)`,
    });

    // Issue the swap transaction:
    //
    const stTxn = await twammContract
      .connect(swapSigner)
      .swapFromBToA(amountBN);
    transactions.push({
      txn: stTxn,
      uxType: isArb ? TRANSACTION_TYPES.ARB_SWAP : TRANSACTION_TYPES.SWAP,
      description:
        `${swapSigner.address} (${
          isArb ? "Arbitrageur" : "Trader"
        }) swaps ${amountTokenB} ` +
        `of ${_state.contracts.tokenB.address} (Token B) in ` +
        `${twammContract.address} (TWAMM contract).`,
    });

    log.info(`Queued swap of ${amountTokenB} TokenB to TokenA.`);
  }

  return transactions;
};

exports.swapAToB = async (amount, isArb = false) => {
  return await swap(amount, 0, isArb);
};

exports.swapBToA = async (amount, isArb = false) => {
  return await swap(0, amount, isArb);
};

// TODO:
// // Mint
// exports.provideLiquidity = async(lpTokenAmount) => {
//   const txn = await _state._contract.twamm
//     .connect(_state.signers.)
// }

// // Burn
// exports.removeLiquidity = async(lpTokenAmount) => {
// }

exports.withdrawLtSwapProceeds = async (orderId) => {
  const txn = await _state.contracts.twamm
    .connect(_state.signers.ltSwap)
    .withdrawProceedsFromLongTermSwap(orderId);
  log.info(`Queued withdraw of LT swap proceeds.`);

  return [
    {
      txn,
      uxType: TRANSACTION_TYPES.WITHDRAW,
      description: `Withdraw funds of order ${orderId} from TWAMM pool.`,
    },
  ];
};

exports.mineBlock = async () => {
  await network.provider.send("evm_mine");
};

exports.getBlockNumber = async () => {
  return Number(await network.provider.send("eth_blockNumber"));
};

// Converts the values returned by the TWAMM contract
// into JS object
const decodeGetOfflineQuoteIngredients = (result) => {
  const keyTypes = [
    { tokenA: "string" },
    { tokenB: "string" },
    { lastVirtualOrderBlock: "BigNumber" },
    { orderBlockInterval: "BigNumber" },
    { currentSalesRateTokenA: "BigNumber" },
    { currentSalesRateTokenB: "BigNumber" },
    { reserveA: "BigNumber" },
    { reserveB: "BigNumber" },
  ];

  let index = 0;
  const decoded = {};
  for (const keyType of keyTypes) {
    const _key = Object.keys(keyType)[0];
    const _type = keyType[_key];
    const _result = result[index++];

    switch (_type.toLowerCase()) {
      case "string":
        decoded[_key] = _result;
        break;

      case "bignumber":
        decoded[_key] = _result;
        break;

      default:
        log.warn(`Unhandled type ${_type} for key ${_key}`);
        break;
    }
  }

  return decoded;
};

exports.calcReserves = async (block = undefined, transactions = undefined) => {
  const useViewFunction = true
  const useOfflineFunction = true
    
  const _block = block ? block : await exports.getBlockNumber();
  const _blockNum = BigNumber.from(_block);

  const viewFnResults = {}
  if (useViewFunction) {
    const longTermOrdersArrTxn = await _state.contracts.twamm.getReserves()
    const _transactions = {
      txn: longTermOrdersArrTxn,
      uxType: TRANSACTION_TYPES.CALCULATE_RES,
      description: `get reserves`,
    }
    viewFnResults['transactions'] = _transactions
    transactions && transactions.push(_transactions);

    const keyTypes = [
      { reserveA: "BigNumber" },
      { reserveB: "BigNumber" },
      { blockNumber: "BigNumber" }
    ]
    let index = 0
    const decoded = {}
    for (const keyType of keyTypes) {
      // TODO: refactor with decodeGetOfflineQuoteIngredients (basically we're ABI decoding)
      const _key = Object.keys(keyType)[0]
      const _type = keyType[_key]
      const _result = longTermOrdersArrTxn[index++];
      switch (_type.toLowerCase()) {
        case "string":
          decoded[_key] = _result;
          break;

        case "bignumber":
          decoded[_key] = _result;
          break;

        default:
          log.warn(`Unhandled type ${_type} for key ${_key}`);
          break;
      }
    }

    const { reserveA, reserveB, blockNumber } = decoded;
    const _reserveA = scaleNumbers ? decimalShiftRight(reserveA) : reserveA;
    const _reserveB = scaleNumbers ? decimalShiftRight(reserveB) : reserveB;

    viewFnResults['blockNumber'] = blockNumber
    viewFnResults['reserveA'] = _reserveA
    viewFnResults['reserveB'] = _reserveB
  }

  const offlineFnResults = {}
  if (useOfflineFunction) {
    const longTermOrdersArrTxn =
      await _state.contracts.twamm.getOfflineQuoteIngredients();
    const longTermOrders = decodeGetOfflineQuoteIngredients(longTermOrdersArrTxn);
    const _transactions = {
      txn: longTermOrdersArrTxn,
      uxType: TRANSACTION_TYPES.CALCULATE_RES,
      description: `calculating reserves`,
    }
    offlineFnResults['transactions'] = _transactions
    transactions && transactions.push(_transactions);

    const _longTermOrders = {
      tokenA: longTermOrders.tokenA,
      tokenB: longTermOrders.tokenB,
      lastVirtualOrderBlock: longTermOrders.lastVirtualOrderBlock,
      orderBlockInterval: longTermOrders.orderBlockInterval,
      OrderPoolMap: {
        [longTermOrders.tokenA]: {
          currentSalesRate: longTermOrders.currentSalesRateTokenA,
          salesRateEndingPerBlockFn:
            _state.contracts.twamm.getSalesRateEndingPerBlockTokenA,
        },
        [longTermOrders.tokenB]: {
          currentSalesRate: longTermOrders.currentSalesRateTokenB,
          salesRateEndingPerBlockFn:
            _state.contracts.twamm.getSalesRateEndingPerBlockTokenB,
        },
      },
    };

    const _reserveMap = {
      [longTermOrders.tokenA]: longTermOrders.reserveA,
      [longTermOrders.tokenB]: longTermOrders.reserveB,
    };

    const currentReserves = await calcReserves(
      _longTermOrders,
      _reserveMap,
      _blockNum,
      transactions
    );

    const { reserveA, reserveB } = currentReserves;
    const _reserveA = scaleNumbers ? decimalShiftRight(reserveA) : reserveA;
    const _reserveB = scaleNumbers ? decimalShiftRight(reserveB) : reserveB;

    offlineFnResults['blockNumber'] = _blockNum 
    offlineFnResults['reserveA'] = _reserveA
    offlineFnResults['reserveB'] = _reserveB
  }

  if (useViewFunction && useOfflineFunction) {
    // Compare their results
    let same = true
    for (const key of ['blockNumber', 'reserveA', 'reserveB']) {
      if (viewFnResults[key].toString() !== offlineFnResults[key].toString()) {
        same = false
        break
      }
    }
    let msg = `View function and offline quote ${same ? 'match' : 'mis-match'}:\n` +
              `  view:    (${viewFnResults['blockNumber']}):  ReserveA = ${viewFnResults['reserveA']}, reserveB = ${viewFnResults['reserveB']}\n` +
              `  offline: (${offlineFnResults['blockNumber']}):  ReserveA = ${offlineFnResults['reserveA']}, reserveB = ${offlineFnResults['reserveB']}\n`
    same ? log.info(msg) : log.error(msg)
  }

  if (useOfflineFunction) {
    const { blockNumber, reserveA, reserveB, transactions } = offlineFnResults
    log.info(`offline quote(${blockNumber}):  ReserveA = ${reserveA}, reserveB = ${reserveB}.`);
    return { reserveA, reserveB, transactions };
  } else if (useViewFunction) {
    const { blockNumber, reserveA, reserveB, transactions } = viewFnResults 
    log.info(`view fn quote(${blockNumber}):  ReserveA = ${reserveA}, reserveB = ${reserveB}.`);
    return { reserveA, reserveB, transactions };
  }
};
