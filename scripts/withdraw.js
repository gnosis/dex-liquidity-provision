const BN = require("bn.js")

const GnosisSafe = artifacts.require("./GnosisSafe.sol")

const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const MultiSend = artifacts.require("./MultiSend.sol")

const { encodeMultiSend, execTransactionData } = require("../test/utils.js")

// TODO: move constants to util file
const MAXUINT = (new BN(2)).pow(new BN(256)).sub(new BN(1))
const CALL = 0


/**
 * @typedef Withdrawal
 *  * Example:
 * {
 *   traderAddress: "0x0000000000000000000000000000000000000000",
 *   tokenAddresses: ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"],
 * }
 * @type {object}
 * @property {EthereumAddress} traderAddress Ethereum address of the trader performing the withdrawal
 * @property {EthereumAddress[]} tokenAddresses List of tokens that the traded wishes to withdraw
 */

/**
 * Batches together a collection of operations (either withdraw or requestWithdraw) on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @param {string} functionName Name of the function that is to be executed (can be "requestWithdraw" or "withdraw")
 * @return {string} Data describing the multisend transaction that has to be sent from the master address to either request
withdrawal of or to withdraw the desired funds
*/
const genericFundMovementData = async function (
  masterAddress,
  withdrawals,
  functionName
) {
  const exchange = await BatchExchange.deployed()
  const multiSend = await MultiSend.new()
  const gnosisSafeMasterCopy = await GnosisSafe.new()
  const masterTransactions = []

  for (const withdraw of withdrawals) {
    const traderTransactions = []

    // create requestWithdraw transactions for each token
    for (const tokenAddress of withdraw.tokenAddresses) {
      const requestWithdrawData = await exchange.contract.methods[functionName](tokenAddress, MAXUINT).encodeABI()
      traderTransactions.push({
        operation: CALL,
        to: exchange.address,
        value: 0,
        data: requestWithdrawData,
      })
    }
    // merge trader transactions into single multisend transaction
    const traderMultisendData = await encodeMultiSend(multiSend,traderTransactions)
    // Get data to execute multisend transaction from fund account via trader
    const execData = await execTransactionData(gnosisSafeMasterCopy, masterAddress, multiSend.address, 0, traderMultisendData, 1)
    masterTransactions.push({
      operation: CALL,
      to: withdraw.traderAddress,
      value: 0,
      data: execData,
    })
  }
  // Get data to execute all transactions at once
  return await encodeMultiSend(multiSend, masterTransactions)
}

/**
 * Batches together a collection of "requestWithdraw" calls on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {string} Data describing the multisend transaction that has to be sent from the master address to request
withdrawal of the desired funds
*/
const requestWithdrawData = async function (
  masterAddress,
  withdrawals
) {
  return await genericFundMovementData(
    masterAddress,
    withdrawals,
    "requestWithdraw"
  )
}


/**
 * Batches together a collection of "withdraw" calls on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * Warning: if any bundled transaction fails, then no funds are withdrawn from the exchange.
 *   Ensure 1. to have executed requestWithdraw for every input before executing
 *          2. no trader orders have been executed on these tokens (a way to ensure this is to cancel the traders' standing orders)
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {string} Data describing the multisend transaction that has to be sent from the master address to withdraw the desired funds
*/
const withdrawData = async function (
  masterAddress,
  withdrawals
) {
  return await genericFundMovementData(
    masterAddress,
    withdrawals,
    "withdraw"
  )
}

module.exports = {
  requestWithdrawData,
  withdrawData
}
