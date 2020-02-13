const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const { decodeOrders } = require("@gnosis.pm/dex-contracts")
const BN = require("bn.js")
const GnosisSafe = artifacts.require("./GnosisSafe.sol")

const ADDRESS_0 = "0x0000000000000000000000000000000000000000"

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

const execTransaction = async function(safe, lightWallet, to, value, data, operation) {
  const nonce = await safe.nonce()
  const transactionHash = await safe.getTransactionHash(to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, nonce)
  const sigs = utils.signTransaction(lightWallet, [lightWallet.accounts[0], lightWallet.accounts[1]], transactionHash)
  await safe.execTransaction(to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, sigs)
}

const execTransactionData = async function(gnosisSafeMasterCopy, owner, to, value, data, operation = 0) {
  const sigs =
    "0x" +
    "000000000000000000000000" +
    owner.replace("0x", "") +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "01"
  return await gnosisSafeMasterCopy.contract.methods
    .execTransaction(to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, sigs)
    .encodeABI()
}

const deploySafe = async function(gnosisSafeMasterCopy, proxyFactory, owners, threshold) {
  const initData = await gnosisSafeMasterCopy.contract.methods
    .setup(owners, threshold, ADDRESS_0, "0x", ADDRESS_0, ADDRESS_0, 0, ADDRESS_0)
    .encodeABI()
  return await getParamFromTxEvent(
    await proxyFactory.createProxy(gnosisSafeMasterCopy.address, initData),
    "ProxyCreation",
    "proxy",
    proxyFactory.address,
    GnosisSafe,
    null
  )
}

const encodeMultiSend = async function(multiSend, txs) {
  return await multiSend.contract.methods
    .multiSend(
      `0x${txs
        .map(tx =>
          [
            web3.eth.abi.encodeParameter("uint8", tx.operation).slice(-2),
            web3.eth.abi.encodeParameter("address", tx.to).slice(-40),
            web3.eth.abi.encodeParameter("uint256", tx.value).slice(-64),
            web3.eth.abi.encodeParameter("uint256", web3.utils.hexToBytes(tx.data).length).slice(-64),
            tx.data.replace(/^0x/, ""),
          ].join("")
        )
        .join("")}`
    )
    .encodeABI()
}

// Need some small adjustments to default implementation for web3js 1.x
async function getParamFromTxEvent(transaction, eventName, paramName, contract, contractFactory, subject) {
  assert.isObject(transaction)
  if (subject != null) {
    utils.logGasUsage(subject, transaction)
  }
  let logs = transaction.logs
  if (eventName != null) {
    logs = logs.filter(l => l.event === eventName && l.address === contract)
  }
  assert.equal(logs.length, 1, "too many logs found!")
  const param = logs[0].args[paramName]
  if (contractFactory != null) {
    // Adjustment: add await
    const contract = await contractFactory.at(param)
    assert.isObject(contract, `getting ${paramName} failed for ${param}`)
    return contract
  } else {
    return param
  }
}

// TODO - move this once dex-contracts updates npm package.
function decodeOrdersBN(bytes) {
  return decodeOrders(bytes).map(e => ({
    user: e.user,
    sellTokenBalance: new BN(e.sellTokenBalance),
    buyToken: parseInt(e.buyToken),
    sellToken: parseInt(e.sellToken),
    validFrom: parseInt(e.validFrom),
    validUntil: parseInt(e.validUntil),
    priceNumerator: new BN(e.priceNumerator),
    priceDenominator: new BN(e.priceDenominator),
    remainingAmount: new BN(e.remainingAmount),
  }))
}

module.exports = {
  waitForNSeconds,
  toETH,
  execTransaction,
  execTransactionData,
  deploySafe,
  encodeMultiSend,
  decodeOrdersBN,
}
