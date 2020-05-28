/**
 * @typedef {import('../typedef.js').Address} Address
 * @typedef {import('../typedef.js').Transaction} Transaction
 */

module.exports = function (web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const { signHashWithPrivateKey, estimateGas } = require("../utils/internals")(web3, artifacts)
  const { ZERO_ADDRESS } = require("./constants")

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
   * @param {boolean} [dryRun=false] Do all steps of the function except actually sending the transaction.
   */
  const signAndSend = async function (masterSafe, transaction, network, nonce = null, dryRun = false) {
    if (nonce === null) {
      nonce = (await masterSafe.nonce()).toNumber()
    }
    const safeTxGas = await estimateGas(masterSafe, transaction)
    const baseGas = 0
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

    if (dryRun) {
      console.log(`Would send tx with hash ${transactionHash} and nonce ${nonce}`)
      return
    }

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

  return {
    signAndSend,
  }
}
