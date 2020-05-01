module.exports = function (web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const readline = require("readline")

  const { ADDRESS_0 } = require("./trading_strategy_helpers")(web3, artifacts)
  const { signHashWithPrivateKey } = require("../utils/internals")(web3, artifacts)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const linkPrefix = {
    rinkeby: "rinkeby.",
    mainnet: "",
  }

  const promptUser = function (message) {
    return new Promise((resolve) => rl.question(message, (answer) => resolve(answer)))
  }

  /**
   * Signs and sends the transaction to the gnosis-safe UI
   * @param {Address} masterAddress Address of the master safe owning the brackets
   * @param {Transaction} transaction The transaction to be signed and sent
   */
  const signAndSend = async function (masterSafe, transaction, network, nonce = null) {
    if (nonce === null) {
      nonce = (await masterSafe.nonce()).toNumber()
    }
    console.log("Aquiring Transaction Hash")
    const transactionHash = await masterSafe.getTransactionHash(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      0,
      0,
      0,
      ADDRESS_0,
      ADDRESS_0,
      nonce
    )
    const privateKey = process.env.PK
    const account = web3.eth.accounts.privateKeyToAccount("0x" + privateKey)
    console.log(`Signing and posting multi-send transaction request from proposer account ${account.address}`)
    const sigs = signHashWithPrivateKey(transactionHash, privateKey)

    const endpoint = `https://safe-transaction.${network}.gnosis.io/api/v1/safes/${masterSafe.address}/transactions/`
    const postData = {
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      operation: transaction.operation,
      safeTxGas: 0, // TODO: magic later
      baseGas: 0,
      gasPrice: 0, // important that this is zero
      gasToken: ADDRESS_0,
      refundReceiver: ADDRESS_0,
      nonce: nonce,
      contractTransactionHash: transactionHash,
      sender: web3.utils.toChecksumAddress(account.address),
      signature: sigs,
    }
    await axios.post(endpoint, postData).catch(function (error) {
      throw new Error("Error while talking to the gnosis-interface: " + error.response.data)
    })

    const interfaceLink = `https://${linkPrefix[network]}gnosis-safe.io/app/#/safes/${masterSafe.address}/transactions`
    console.log("Transaction awaiting execution in the interface", interfaceLink)
    console.log("Remember to increase the gas limit!")
  }

  return {
    signAndSend,
    promptUser,
  }
}
