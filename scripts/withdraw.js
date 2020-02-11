const BN = require("bn.js")

const GnosisSafe = artifacts.require("./GnosisSafe.sol")

const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const MultiSend = artifacts.require("./MultiSend.sol")

const { waitForNSeconds, toETH, encodeMultiSend, execTransaction, execTransactionData, deploySafe } = require("../test/utils.js")

// TODO: move constants to util file
const MAXUINT = (new BN(2)).pow(new BN(256)).sub(new BN(1))
const CALL = 0

/*
  input:
  1. master Safe
  2. trader addresses you want to withdraw from
  3. for each trader address, the list of tokens to withdraw

  output: data of the multisend transaction that has to be sent from the master address to request
  the withdrawal of, for each trader, the full token balance for all tokens included as input
*/
const requestWithdrawData = async function (
  masterAddress,
  traderAddresses,
  tokenAddressesList
) {
  const exchange = await BatchExchange.deployed()
  const multiSend = await MultiSend.new()
  const gnosisSafeMasterCopy = await GnosisSafe.new()
  const masterTransactions = []

  for (let index = 0; index < traderAddresses.length; index++) {
    const traderAddress = traderAddresses[index]
    const tokenAddresses = tokenAddressesList[index]
    const traderTransactions = []

    // create requestWithdraw transactions for each token
    for (let tokenIndex = 0; tokenIndex <= tokenAddresses.length; tokenIndex++) {
      const requestWithdrawData = await exchange.contract.methods.requestWithdraw(tokenAddresses[tokenIndex], MAXUINT).encodeABI()
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
      to: traderAddress,
      value: 0,
      data: execData,
    })
  }
  // Get data to execute all fund/approve/deposit transactions at once
  return await encodeMultiSend(multiSend, masterTransactions)
}


/*
  input:
  1. master Safe
  2. trader addresses you want to withdraw from
  3. for each trader address, the list of tokens to withdraw

  output: data of the multisend transaction that has to be sent from the master address to claim the pending
  withdrawal of, for each trader, the full token balance for all tokens included as input

  WARNING: if any bundled transaction fails, then no funds are withdrawn from the exchange.
  Ensure 1. to have executed requestWithdraw for every input before executing
         2. no trader orders have been executed on these tokens (a way to ensure this is to cancel the traders' standing orders)
*/
const withdrawData = async function (
  masterAddress,
  traderAddresses,
  tokenAddressesList
) {
  const exchange = await BatchExchange.deployed()
  const multiSend = await MultiSend.new()
  const gnosisSafeMasterCopy = await GnosisSafe.new()
  const masterTransactions = []

  for (let index = 0; index < traderAddresses.length; index++) {
    const traderAddress = traderAddresses[index]
    const tokenAddresses = tokenAddressesList[index]
    const traderTransactions = []

    // create requestWithdraw transactions for each token
    for (let tokenIndex = 0; tokenIndex <= tokenAddresses.length; tokenIndex++) {
      const requestWithdrawData = await exchange.contract.methods.withdraw(tokenAddresses[tokenIndex], MAXUINT).encodeABI()
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
      to: traderAddress,
      value: 0,
      data: execData,
    })
  }
  // Get data to execute all fund/approve/deposit transactions at once
  return await encodeMultiSend(multiSend, masterTransactions)
}