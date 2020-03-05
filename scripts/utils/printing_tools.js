const BN = require("bn.js")
const bnOne = new BN(1)
const bnTwo = new BN(2)
const bnTen = new BN(10)
const bn256 = new BN(256)
const bnMaxUint = bnTwo.pow(bn256).sub(bnOne)

/**
 * A generalized version of "toWei" for tokens with an arbitrary amount of digits.
 * If the decimal representation has more digits than the maximum amount possible, then the extra digits are truncated.
 * @param {string} amount User-friendly representation for the amount of some ERC20 token
 * @param {integer} digits Maximum number of decimal digits of the token
 * @return {string} decimal representation of the number of token units corresponding to the input amount
 */
const fromUserToMachineReadable = function (amount, digits) {
  if (digits < 0 || digits >= 256) throw Error("Invalid number of digits for ERC20 token: " + digits.toString()) // ERC20 digits is stored in a uint8
  const re = /^(\d+)(\.(\d+))?$/ // a sequence of at least one digit (0-9), followed by optionally a dot and another sequence of at least one digit
  const match = re.exec(amount)
  if (match == null) throw Error("Failed to parse decimal representation of " + amount)
  const decimalString = (match[3] || "").padEnd(digits, "0")
  if (decimalString.length != digits) throw Error("Too many decimals for the token in input string")
  const integerPart = new BN(match[1])
  const decimalPart = new BN(decimalString)
  const representation = integerPart.mul(bnTen.pow(new BN(digits))).add(decimalPart)
  if (representation.gt(bnMaxUint)) throw Error("Number larger than ERC20 token maximum amount")
  return representation.toString()
}

/**
 * A generalized version of "fromWei" for tokens with an arbitrary amount of digits.
 * @param {string} amount Decimal representation of the (integer) number of token units 
 * @param {integer} digits Maximum number of decimal digits of the token
 * @return {string} Dot-separated decimal representation of the amount of token corresponding to the input unit amount
 */
const fromMachineToUserReadable = function (amount, digits) {
  if (digits < 0 || digits >= 256) throw Error("Invalid number of digits for ERC20 token: " + digits.toString()) // ERC20 digits is stored in a uint8
  const re = /^\d+$/ // a sequence of at least one digit
  if (re.exec(amount) == null) throw Error("Failed to parse unit amount " + amount + "as integer")
  const bnAmount = new BN(amount)
  if (bnAmount.gt(bnMaxUint)) throw Error("Amount is too large to fit a uint256")
  if (digits == 0) return amount
  const paddedAmount = amount.padStart(digits + 1, "0")
  let decimalPart = paddedAmount.slice(-digits) // rightmost "digits" characters of the string
  const integerPart = paddedAmount.slice(0, -digits) // remaining characters
  decimalPart = decimalPart.replace(/0+$/, "") // remove trailig zeros
  if (decimalPart == "") return integerPart
  return integerPart + "." + decimalPart
}

module.exports = {
  fromUserToMachineReadable,
  fromMachineToUserReadable,
  bnMaxUint
}
