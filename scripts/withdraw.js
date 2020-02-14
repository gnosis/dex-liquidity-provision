const BN = require("bn.js")

const GnosisSafe = artifacts.require("./GnosisSafe.sol")

const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const MultiSend = artifacts.require("./MultiSend.sol")
const ERC20 = artifacts.require("ERC20Detailed")

const { encodeMultiSend, execTransactionData } = require("../test/utils.js")

// TODO: move constants to util file
const MAXUINT = (new BN(2)).pow(new BN(256)).sub(new BN(1))
const CALL = 0
const DELEGATECALL = 1


/**
 * @typedef Withdrawal
 *  * Example:
 * {
 *   traderAddress: "0x0000000000000000000000000000000000000000",
 *   tokenAddress: "0x0000000000000000000000000000000000000000",
 * }
 * @type {object}
 * @property {EthereumAddress} traderAddress Ethereum address of the trader performing the withdrawal
 * @property {EthereumAddress} tokenAddresses List of tokens that the traded wishes to withdraw
 */

/**
 * @typedef Transaction
 *  * Example:
 *  {
 *    operation: CALL,
 *    to: "0x0000..000",
 *    value: "10",
 *    data: "0x00",
 *  }
 * @type {object}
 * @property {int} operation Either CALL or DELEGATECALL
 * @property {EthereumAddress} to Ethereum address receiving the transaction
 * @property {string} value Amount of ETH transferred
 * @property {string} data Data sent along with the transaction
 */

/**
 * Given a collection of transactions, creates a single transaction that bundles all of them
 * @param {Transaction[]} transactions List of {@link Transaction} that are to be bundled together
 * @return {Transaction} Multisend transaction bundling all input transactions
*/
const getBundledTransaction = async function (
  transactions
) {
  BatchExchange.setProvider(web3.currentProvider)
  BatchExchange.setNetwork(web3.network_id)
  const multiSend = await MultiSend.deployed()
  const transactionData = await encodeMultiSend(multiSend, transactions)
  const bundledTransaction = {
    operation: DELEGATECALL,
    to:  multiSend.address,
    value: 0,
    data: transactionData,
  }
  return bundledTransaction
}

/**
 * Batches together a collection of operations (either withdraw or requestWithdraw) on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @param {string} functionName Name of the function that is to be executed (can be "requestWithdraw" or "withdraw")
 * @return {Transaction} Multisend transaction that has to be sent from the master address to either request
withdrawal of or to withdraw the desired funds
*/
const getGenericFundMovementTransaction = async function (
  masterAddress,
  withdrawals,
  functionName
) {
  BatchExchange.setProvider(web3.currentProvider)
  BatchExchange.setNetwork(web3.network_id)
  const exchange = await BatchExchange.deployed()
  const multiSend = await MultiSend.deployed()
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()
  const masterTransactions = []

  // it's not necessary to avoid overlapping withdraws, since the full amount is withdrawn for each entry
  for (const withdrawal of withdrawals) {
    // create transaction for the token
    let transactionData
    switch (functionName) {
    case "requestWithdraw":
      transactionData = await exchange.contract.methods["requestWithdraw"](withdrawal.tokenAddress, MAXUINT.toString()).encodeABI()
      break;
    case "withdraw":
      transactionData = await exchange.contract.methods["withdraw"](withdrawal.traderAddress, withdrawal.tokenAddress).encodeABI()
      break;
    default:
      assert(false, "Function " + functionName + "is not implemented")
    }

    // Get data to execute multisend transaction from fund account via trader
    const execData = await execTransactionData(gnosisSafeMasterCopy, masterAddress, exchange.address, 0, transactionData, CALL)
    masterTransactions.push({
      operation: CALL,
      to: withdrawal.traderAddress,
      value: 0,
      data: execData,
    })
  }
  // Get data to execute all transactions at once
  const transactionData = await encodeMultiSend(multiSend, masterTransactions)
  const transaction = {
    operation: DELEGATECALL,
    to: multiSend.address,
    value: 0,
    data: transactionData
  }
  return transaction
}

/**
 * Batches together a collection of "requestWithdraw" calls on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to request
withdrawal of the desired funds
*/
const getRequestWithdrawTransaction = async function (
  masterAddress,
  withdrawals
) {
  return await getGenericFundMovementTransaction(
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
 * @return {Transaction} Multisend transaction that has to be sent from the master address to withdraw the desired funds
*/
const getWithdrawTransaction = async function (
  masterAddress,
  withdrawals
) {
  return await getGenericFundMovementTransaction(
    masterAddress,
    withdrawals,
    "withdraw"
  )
}


/**
 * Batches together a collection of transfers from each trader safe to the master safer
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to transfer back all funds
*/
const getTransferFundsToMasterTransaction = async function (
  masterAddress,
  withdrawals
) {
  BatchExchange.setProvider(web3.currentProvider)
  BatchExchange.setNetwork(web3.network_id)
  const multiSend = await MultiSend.deployed()
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()
  const masterTransactions = []

  // TODO: enforce that there are no overlapping withdrawals
  for (const withdrawal of withdrawals) {
    const token = await ERC20.at(withdrawal.tokenAddress)
    const amount = await token.balanceOf(withdrawal.traderAddress)
    // create transaction for the token
    const transactionData = await token.contract.methods.transfer(masterAddress, amount.toString()).encodeABI()

    // Get data to execute transaction from fund account via trader
    const execData = await execTransactionData(gnosisSafeMasterCopy, masterAddress, token.address, 0, transactionData, CALL)
    masterTransactions.push({
      operation: CALL,
      to: withdrawal.traderAddress,
      value: 0,
      data: execData,
    })
  }
  // Get data to execute all transactions at once
  return await encodeMultiSend(multiSend, masterTransactions)
}


/**
 * Batches together a collection of transfers from each trader safe to the master safer
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {string} Data describing the multisend transaction that has to be sent from the master address to transfer back all funds
*/
const getWithdrawAndTransferFundsToMasterTransaction = async function (
  masterAddress,
  withdrawals
) {
  const multiSend = await MultiSend.deployed()
  const withdrawalTransaction = await getWithdrawTransaction(masterAddress, withdrawals)
  const transferFundsToMasterTransaction = await getTransferFundsToMasterTransaction(masterAddress, withdrawals)

  const masterTransactions = [withdrawalTransaction, transferFundsToMasterTransaction]

  const transactionData = await encodeMultiSend(multiSend, masterTransactions)
  const transaction = {
    operation: DELEGATECALL,
    to: multiSend.address,
    value: 0,
    transactionData
  }
  return transaction
}

module.exports = {
  getRequestWithdrawTransaction,
  getWithdrawTransaction,
  getTransferFundsToMasterTransaction,
  getWithdrawAndTransferFundsToMasterTransaction
}
