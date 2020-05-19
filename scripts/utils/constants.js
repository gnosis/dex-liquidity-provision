const BN = require("bn.js")

const ZERO_ADDRESS = "0x" + "0".repeat(40)

// We chose the maximum admissible value minus one in order to distinguish orders from "non-expiring" orders of the web interface
const DEFAULT_ORDER_EXPIRY = 2 ** 32 - 2

const DEFAULT_NUMBER_OF_SAFES = 20

// numbers identifying which operation is to be executed by a Gnosis Safe when calling execTransaction
const CALL = 0
const DELEGATECALL = 1

const ZERO = new BN(0)
const ONE = new BN(1)
const TWO = new BN(2)
const TEN = new BN(10)
const BN128 = new BN(128)
const BN256 = new BN(256)

const MAXUINT128 = TWO.pow(BN128).sub(ONE)
const MAXUINT256 = TWO.pow(BN256).sub(ONE)

const FLOAT_TOLERANCE = TWO.pow(new BN(52))

module.exports = {
  ZERO_ADDRESS,
  DEFAULT_ORDER_EXPIRY,
  DEFAULT_NUMBER_OF_SAFES,
  CALL,
  DELEGATECALL,
  ZERO,
  ONE,
  TWO,
  TEN,
  BN128,
  BN256,
  MAXUINT128,
  MAXUINT256,
  FLOAT_TOLERANCE,
}
