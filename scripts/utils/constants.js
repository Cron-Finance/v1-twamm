// HTTP Status Codes
//   TODO: use a real lib w/ more resolution/detail
exports.OK = 200;
exports.BAD_REQUEST = 400;
exports.INTERNAL_SERVER_ERROR = 500;

// Adapted from interface Typescript code for TransactionTable
// (src/types/index.ts):
export const TRANSACTION_TYPES = {
  SWAP: 0,
  MINT: 1,
  BURN: 2,
  LTSWAP: 3,
  WITHDRAW: 4,
  EXEC_VIRTUAL: 5,
  INITIAL_LIQUIDITY: 6,
  DEPLOY: 7,
  APPROVE: 8,
  ARB_SWAP: 9,
  CALCULATE_RES: 10,
};
