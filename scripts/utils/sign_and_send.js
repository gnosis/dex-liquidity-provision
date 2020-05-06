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

  const estimateGas = async function (masterSafe, transaction) {
    const estimateCall = masterSafe.contract.methods
      .requiredTxGas(transaction.to, transaction.value, transaction.data, transaction.operation)
      .encodeABI()
    const estimateResponse = await web3.eth.call({
      to: masterSafe.address,
      from: masterSafe.address,
      data: estimateCall,
      gasPrice: 0,
    })
    console.log(estimateResponse)
    // https://docs.gnosis.io/safe/docs/contracts_tx_execution/#safe-transaction-gas-limit-estimation
    // The value returned by requiredTxGas is encoded in a revert error message. For retrieving the hex
    // encoded uint value the first 68 bytes of the error message need to be removed.
    const txGasEstimate = parseInt(estimateResponse.substring(138), 16)
    console.log(txGasEstimate)
    return txGasEstimate
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
    const safeTxGas = await estimateGas(masterSafe, transaction)
    const baseGas = 0
    console.log("Aquiring Transaction Hash")
    const transactionHash = await masterSafe.getTransactionHash(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      safeTxGas,
      baseGas,
      0,
      ADDRESS_0,
      ADDRESS_0,
      nonce
    )
    const privateKey = "0x" + process.env.PK
    const account = web3.eth.accounts.privateKeyToAccount(privateKey)
    console.log(`Signing and posting multi-send transaction request from proposer account ${account.address}`)
    const sigs = signHashWithPrivateKey(transactionHash, privateKey)

    const endpoint = `https://safe-transaction.${network}.gnosis.io/api/v1/safes/${masterSafe.address}/transactions/`
    const postData = {
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      operation: transaction.operation,
      safeTxGas: safeTxGas,
      baseGas: baseGas,
      gasPrice: 0, // important that this is zero
      gasToken: ADDRESS_0,
      refundReceiver: ADDRESS_0,
      nonce: nonce,
      contractTransactionHash: transactionHash,
      sender: web3.utils.toChecksumAddress(account.address),
      signature: sigs,
    }
    await axios.post(endpoint, postData).catch(function (error) {
      throw new Error("Error while talking to the gnosis-interface: " + JSON.stringify(error.response.data))
    })
    const interfaceLink = `https://${linkPrefix[network]}gnosis-safe.io/app/#/safes/${masterSafe.address}/transactions`
    console.log("Transaction awaiting execution in the interface", interfaceLink)
  }

  return {
    signAndSend,
    promptUser,
  }
}
