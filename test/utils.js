const BN = require("bn.js")

const jsonrpc = "2.0"
const id = 0
const send = function(method, params, web3Provider) {
  return new Promise(function(resolve, reject) {
    web3Provider.currentProvider.send({ id, jsonrpc, method, params }, (error, result) => {
      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    })
  })
}

/**
 * Wait for n (evm) seconds to pass
 * @param seconds: int
 * @param web3Provider: potentially different in contract tests and system end-to-end testing.
 */
const waitForNSeconds = async function(seconds, web3Provider = web3) {
  await send("evm_increaseTime", [seconds], web3Provider)
  await send("evm_mine", [], web3Provider)
}

function toETH(value) {
  const GWEI = 1000000000
  return new BN(value * GWEI).mul(new BN(GWEI))
}

module.exports = {
  waitForNSeconds,
  toETH
}