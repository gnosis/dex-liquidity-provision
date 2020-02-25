const axios = require("axios")
const { DELEGATECALL, ADDRESS_0 } = require("./trading_strategy_helpers")
const { signTransaction, createLightwallet } = require("../test/utils")

const readline = require("readline")

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const linkPrefix = {
  "rinkeby": "rinkeby.",
  "mainnet": "",
}

const promptUser = function(message) {
  return new Promise(resolve => rl.question(message, answer => resolve(answer)))
}

/**
 * Deploys specified number singler-owner Gnosis Safes having specified ownership
 * @param {string} fleetOwner {@link EthereumAddress} of Gnosis Safe (Multi-Sig)
 * @param {integer} fleetSize number of sub-Safes to be created with fleetOwner as owner
 * @return {EthereumAddress[]} list of Ethereum Addresses for the subsafes that were deployed
 */
const signAndSend = async function(masterSafe, transactionData, web3, network) {
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

  const endpoint = `https://safe-transaction.${network}.gnosis.io/api/v1/safes/${masterSafe.address}/transactions/`
  const postData = {
    to: transactionData.to,
    value: 0,
    data: transactionData.data,
    operation: DELEGATECALL,
    safeTxGas: 0, // magic later
    baseGas: 0,
    gasPrice: 0, // important that this is zero
    gasToken: ADDRESS_0,
    refundReceiver: ADDRESS_0,
    nonce: nonce.toNumber(),
    contractTransactionHash: transactionHash,
    sender: web3.utils.toChecksumAddress(account),
    signature: sigs,
  }
  // await axios.post(endpoint, postData)
  console.log(
    `Transaction awaiting execution in the interface https://${linkPrefix[network]}gnosis-safe.io/safes/${masterSafe.address}/transactions`
  )
}

module.exports = {
  signAndSend,
  promptUser
}
