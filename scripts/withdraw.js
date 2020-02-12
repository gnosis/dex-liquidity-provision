const BN = require("bn.js")

const GnosisSafe = artifacts.require("./GnosisSafe.sol")

const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const MultiSend = artifacts.require("./MultiSend.sol")

const { encodeMultiSend, execTransactionData } = require("../test/utils.js")

// TODO: move constants to util file
const MAXUINT = (new BN(2)).pow(new BN(256)).sub(new BN(1))
const CALL = 0

/*
  input:
  1. master Safe
  2. a description of the withdraw operations to perform with the format
    [{traderAddress: "0x0...0", tokenAddresses: ["0x...", "0x...", ...]}, ...] 
  3. the name of the function that is to be executed (can be "requestWithdraw", "withdraw", "deposit")

  output: data of the multisend transaction that has to be sent from the master address to either request
  the withdrawal of or to withdraw the desired funds

  note: no transaction is executed
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
  // Get data to execute all fund/approve/deposit transactions at once
  return await encodeMultiSend(multiSend, masterTransactions)
}

/*
  input:
  1. master Safe
  2. a description of the withdraw operations to perform with the format
    [{traderAddress: "0x0...0", tokenAddresses: ["0x...", "0x...", ...]}, ...] 

  output: data of the multisend transaction that has to be sent from the master address to request
  the withdrawal of, for each trader, the full token balance for all tokens included as input

  note: no transaction is executed
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

/*
  input:
  1. master Safe
  2. a description of the withdraw operations to perform with the format
    [{traderAddress: "0x0...0", tokenAddresses: ["0x...", "0x...", ...]}, ...] 

  output: data of the multisend transaction that has to be sent from the master address to claim the pending
  withdrawal of, for each trader, the full token balance for all tokens included as input

  WARNING: if any bundled transaction fails, then no funds are withdrawn from the exchange.
  Ensure 1. to have executed requestWithdraw for every input before executing
         2. no trader orders have been executed on these tokens (a way to ensure this is to cancel the traders' standing orders)

  note: no transaction is executed
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
