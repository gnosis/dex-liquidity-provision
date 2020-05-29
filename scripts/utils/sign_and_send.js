/**
 * @typedef {import('../typedef.js').Address} Address
 * @typedef {import('../typedef.js').Transaction} Transaction
 */

module.exports = function (web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const { getSafeCompatibleSignature, estimateGas } = require("../utils/internals")(web3, artifacts)
  const { ZERO_ADDRESS } = require("./constants")
  const baseGas = 0

  const linkPrefix = {
    rinkeby: "rinkeby.",
    mainnet: "",
  }

  /**
   * Signs and sends the transaction to the gnosis-safe UI
   *
   * @param {Address} masterSafe Address of the master safe owning the brackets
   * @param {Transaction} transaction The transaction to be signed and sent
   * @param {string} network either rinkeby or mainnet
   * @param {number} [nonce=null] specified transaction index. Will fetch correct value if not specified.
   */
  const signAndSend = async function (masterSafe, transaction, network, nonce = null) {
    if (nonce === null) {
      nonce = (await masterSafe.nonce()).toNumber()
    }
    const safeTxGas = await estimateGas(masterSafe, transaction)
    const transactionHash = await masterSafe.getTransactionHash(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      safeTxGas,
      baseGas,
      0,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      nonce
    )

    const signer = (await web3.eth.getAccounts())[0]
    console.log(`Signing and posting multi-send transaction ${transactionHash} from proposer account ${signer}`)
    const sigs = await getSafeCompatibleSignature(transactionHash, signer)

    const endpoint = `https://safe-transaction.${network}.gnosis.io/api/v1/safes/${masterSafe.address}/transactions/`
    const postData = {
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      operation: transaction.operation,
      safeTxGas: safeTxGas,
      baseGas: baseGas,
      gasPrice: 0, // important that this is zero
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce: nonce,
      contractTransactionHash: transactionHash,
      sender: web3.utils.toChecksumAddress(signer),
      signature: sigs,
    }
    await axios.post(endpoint, postData).catch(function (error) {
      throw new Error("Error while talking to the gnosis-interface: " + JSON.stringify(error.response.data))
    })
    const interfaceLink = `https://${linkPrefix[network]}gnosis-safe.io/app/#/safes/${masterSafe.address}/transactions`
    console.log("Transaction awaiting execution in the interface", interfaceLink)
  }

  /**
   * Checks that a transaction was already proposed to the gnosis-safe UI
   *
   * @param {Address} masterSafe Address of the master safe owning the brackets
   * @param {Transaction} transaction The transaction to be signed and sent
   * @param {string} network either rinkeby or mainnet
   * @param {number} [nonce=null] specified transaction index. Will fetch correct value if not specified.
   */
  const checkTransactionExistenceOnSafeServer = async function (masterSafe, transaction, network, nonce = null) {
    const safeTxGas = await estimateGas(masterSafe, transaction)
    const transactionHash = await masterSafe.getTransactionHash(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      safeTxGas,
      baseGas,
      0,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      nonce
    )
    console.log(`The reproduced transaction has the gnosis-safe hash ${transactionHash} and nonce ${nonce}`)
    const endpoint = `https://safe-transaction.${network}.gnosis.io/api/v1/transactions/${transactionHash}/`
    await axios.get(endpoint).catch(function (error) {
      if (error.response.data.detail === "Not found.") {
        throw new Error("The reproduced transaction was not found. There is something wrong. Contact the proposer.")
      }
      throw new Error("Error while talking to the gnosis-interface: " + JSON.stringify(error.response.data))
    })
    const interfaceLink = `https://${linkPrefix[network]}gnosis-safe.io/app/#/safes/${masterSafe.address}/transactions`
    console.log(
      `The reproduced transaction was is already proposed! You can sign the transaction with nonce ${nonce} here: ${interfaceLink}`
    )
  }

  return {
    signAndSend,
    checkTransactionExistenceOnSafeServer,
  }
}
