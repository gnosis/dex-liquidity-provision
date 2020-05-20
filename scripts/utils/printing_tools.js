const BN = require("bn.js")

const { ZERO, BN256, MAXUINT256, TEN } = require("./constants")

/**
 * A generalized version of "toWei" for tokens with an arbitrary amount of decimals.
 * If the decimal representation has more decimals than the maximum amount possible, then the extra decimals are truncated.
 * @param {string} amount User-friendly representation for the amount of some ERC20 token
 * @param {(number|string|BN)} decimals Maximum number of decimals of the token
 * @return {BN} number of token units corresponding to the input amount
 */
const toErc20Units = function (amount, decimals) {
  const bnDecimals = new BN(decimals) // three different types are accepted for "decimals": integer, string and BN. The BN library takes care of the conversion
  if (bnDecimals.lt(ZERO) || bnDecimals.gte(BN256))
    throw Error("Invalid number of decimals for ERC20 token: " + decimals.toString()) // ERC20 decimals is stored in a uint8
  decimals = bnDecimals.toNumber() // safe conversion to num, since 0 <= decimals < 256  const re = /^(\d+)(\.(\d+))?$/ // a sequence of at least one digit (0-9), followed by optionally a dot and another sequence of at least one digit
  const re = /^(\d+)(\.(\d+))?$/ // a sequence of at least one digit (0-9), followed by optionally a dot and another sequence of at least one digit
  const match = re.exec(amount)
  if (match == null) throw Error("Failed to parse decimal representation of " + amount)
  const decimalString = (match[3] || "").padEnd(decimals, "0")
  if (decimalString.length != decimals) throw Error("Too many decimals for the token in input string")
  const integerPart = new BN(match[1])
  const decimalPart = new BN(decimalString)
  const representation = integerPart.mul(TEN.pow(new BN(decimals))).add(decimalPart)
  if (representation.gt(MAXUINT256)) throw Error("Number larger than ERC20 token maximum amount (uint256)")
  return representation
}

/**
 * A generalized version of "fromWei" for tokens with an arbitrary amount of decimals.
 * @param {(string|BN)} amount Decimal representation of the (integer) number of token units
 * @param {(number|string|BN)} decimals Maximum number of decimals of the token
 * @return {string} Dot-separated decimal representation of the amount of token corresponding to the input unit amount
 */
const fromErc20Units = function (amount, decimals) {
  amount = new BN(amount) // in case amount were a string, it converts it to BN, otherwise no effects
  const bnDecimals = new BN(decimals) // three different types are accepted for "decimals": integer, string and BN. The BN library takes care of the conversion
  if (bnDecimals.lt(ZERO) || bnDecimals.gte(BN256))
    throw Error("Invalid number of decimals for ERC20 token: " + decimals.toString()) // ERC20 decimals is stored in a uint8
  decimals = bnDecimals.toNumber() // safe conversion to num, since 0 <= decimals < 256
  if (amount.gt(MAXUINT256)) throw Error("Number larger than ERC20 token maximum amount (uint256)")
  if (decimals == 0) return amount.toString()
  const paddedAmount = amount.toString().padStart(decimals + 1, "0")
  let decimalPart = paddedAmount.slice(-decimals) // rightmost "decimals" characters of the string
  const integerPart = paddedAmount.slice(0, -decimals) // remaining characters
  decimalPart = decimalPart.replace(/0+$/, "") // remove trailing zeros
  if (decimalPart == "") return integerPart
  return integerPart + "." + decimalPart
}

/**
 * Prints a shortened version of an address.
 * @param {Address} address Ethereum address to shorten (e.g. 0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1)
 * @return {string} shortened address (e.g. 0x90F8...C1)
 */
const shortenedAddress = function (address) {
  return address.slice(0, 6) + "..." + address.slice(-2)
}

module.exports = {
  toErc20Units,
  fromErc20Units,
  shortenedAddress,
}
