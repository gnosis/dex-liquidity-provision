const axios = require("axios")
const fetch = require("node-fetch")

const { signTransaction, createLightwallet } = require("../test/utils")
const { transferApproveDeposit, DELEGATECALL, ADDRESS_0 } = require("./trading_strategy_helpers")

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning slaveSafes",
  })
  .option("depositFile", {
    type: "string",
    describe: "file name (and path) to the list of deposits.",
  })
  .demand(["masterSafe", "depositFile"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    const deposits = await fetch(argv.depositFile)
      .then(response => {
        return response.json()
      })
    console.log(deposits)
    const transactionData = await transferApproveDeposit(masterSafe, deposits, artifacts)

    const nonce = await masterSafe.nonce()
    console.log("Aquiring Transaction Hash")
    const transactionHash = await masterSafe.getTransactionHash(
      transactionData.to,
      0,
      transactionData.data,
      DELEGATECALL,
      0,
      0,
      0,
      ADDRESS_0,
      ADDRESS_0,
      nonce
    )
    const lightWallet = await createLightwallet()
    const account = lightWallet.accounts[0]
    console.log(`Signing and posting multi-send transaction request from proposer account ${account}`)
    const sigs = signTransaction(lightWallet, [account], transactionHash)
    const endpoint = `https://safe-transaction.rinkeby.gnosis.io/api/v1/safes/${masterSafe.address}/transactions/`
    const postData = {
      to: transactionData.to,
      value: 0,
      data: transactionData.data,
      operation: DELEGATECALL,
      safeTxGas: 0, // magic later
      baseGas: 0,
      gasPrice: 0, // import that it is zero
      gasToken: ADDRESS_0,
      refundReceiver: ADDRESS_0,
      nonce: nonce.toNumber(),
      contractTransactionHash: transactionHash,
      sender: web3.utils.toChecksumAddress(account),
      signature: sigs,
    }
    await axios.post(endpoint, postData)
    console.log(
      `Transaction awaiting execution in the interface https://rinkeby.gnosis-safe.io/safes/${masterSafe.address}/transactions`
    )
    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
