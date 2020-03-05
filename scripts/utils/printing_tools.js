const BN = require("bn.js")
const bnOne = new BN(1)
const bnTwo = new BN(2)
const bnTen = new BN(10)
const bn256 = new BN(256)
const bnMaxUint = bnTwo.pow(bn256).sub(bnOne)

/**
 * A generalized version of "toWei" for tokens with an arbitrary amount of decimals.
 * If the decimal representation has more decimals than the maximum amount possible, then the extra decimals are truncated.
 * @param {string} amount User-friendly representation for the amount of some ERC20 token
 * @param {integer} decimals Maximum number of decimals of the token
 * @return {BN} number of token units corresponding to the input amount
 */
const toErc20Units = function (amount, decimals) {
  if (decimals < 0 || decimals >= 256) throw Error("Invalid number of decimals for ERC20 token: " + decimals.toString()) // ERC20 decimals is stored in a uint8
  const re = /^(\d+)(\.(\d+))?$/ // a sequence of at least one digit (0-9), followed by optionally a dot and another sequence of at least one digit
  const match = re.exec(amount)
  if (match == null) throw Error("Failed to parse decimal representation of " + amount)
  const decimalString = (match[3] || "").padEnd(decimals, "0")
  if (decimalString.length != decimals) throw Error("Too many decimals for the token in input string")
  const integerPart = new BN(match[1])
  const decimalPart = new BN(decimalString)
  const representation = integerPart.mul(bnTen.pow(new BN(decimals))).add(decimalPart)
  if (representation.gt(bnMaxUint)) throw Error("Number larger than ERC20 token maximum amount (uint256)")
  return representation
}

/**
 * A generalized version of "fromWei" for tokens with an arbitrary amount of decimals.
 * @param {BN} amount Decimal representation of the (integer) number of token units 
 * @param {integer} decimals Maximum number of decimals of the token
 * @return {string} Dot-separated decimal representation of the amount of token corresponding to the input unit amount
 */
const fromErc20Units = function (amount, decimals) {
  if (decimals < 0 || decimals >= 256) throw Error("Invalid number of decimals for ERC20 token: " + decimals.toString()) // ERC20 decimals is stored in a uint8
  if (amount.gt(bnMaxUint)) throw Error("Number larger than ERC20 token maximum amount (uint256)")
  if (decimals == 0) return amount.toString()
  const paddedAmount = amount.toString().padStart(decimals + 1, "0")
  let decimalPart = paddedAmount.slice(-decimals) // rightmost "decimals" characters of the string
  const integerPart = paddedAmount.slice(0, -decimals) // remaining characters
  decimalPart = decimalPart.replace(/0+$/, "") // remove trailig zeros
  if (decimalPart == "") return integerPart
  return integerPart + "." + decimalPart
}

module.exports = {
  toErc20Units,
  fromErc20Units,
  bnMaxUint,
  bnOne,
}
