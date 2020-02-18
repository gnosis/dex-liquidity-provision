const axios = require("axios")

const { signTransaction, createLightwallet} = require("../test/utils")
const { buildOrderTransactionData, DELEGATECALL, ADDRESS_0 } = require("./trading_strategy_helpers")

const argv = require("yargs")
  .option("targetToken", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
  })
  .option("stableToken", {
    describe: "Trusted Stable Token for which to open orders (i.e. DAI)",
  })
  .option("targetPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
  })
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning slaveSafes",
  })
  .option("slaves", {
    type: "string",
    describe: "Trader account addresses to place orders on behalf of.",
    coerce: str => {
      return str.split(",")
    },
  })
  .option("priceRange", {
    type: "float",
    describe: "Percentage above and below the target price for which orders are to be placed",
    default: 20,
  })
  .option("validFrom", {
    type: "int",
    describe: "Number of batches (from current) until order become valid",
    default: 3,
  })
  .option("expiry", {
    type: "int",
    describe: "Maximum auction batch for which these orders are valid",
    default: 2 ** 32 - 1,
  })
  .demand(["targetToken", "stableToken", "targetPrice", "masterSafe", "slaves"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    console.log("Preparing order transaction data")
    const transactionData = await buildOrderTransactionData(
      argv.masterSafe,
      argv.slaves,
      argv.targetToken,
      argv.stableToken,
      argv.targetPrice,
      web3,
      artifacts,
      true,
      argv.priceRange,
      argv.validFrom,
      argv.expiry
    )

    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

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
    const endpoint =
      `https://safe-transaction.rinkeby.gnosis.io/api/v1/safes/${masterSafe.address}/transactions/`
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
    console.log(`Transaction awaiting execution in the interface https://rinkeby.gnosis-safe.io/safes/${masterSafe.address}/transactions`)
    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
