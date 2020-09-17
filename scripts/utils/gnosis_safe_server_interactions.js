/**
 * @typedef {import('../typedef.js').Address} Address
 * @typedef {import('../typedef.js').Transaction} Transaction
 * @typedef {import('../typedef.js').SmartContract} SmartContract
 */

module.exports = function (web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const { getSafeCompatibleSignature, estimateGas } = require("./internals")(web3, artifacts)
  const { ZERO_ADDRESS } = require("./constants")
  const CommonBaseGasForGnosisSafeTransaction = 0

  const linkPrefix = {
    rinkeby: "rinkeby.",
    mainnet: "",
  }

  const webInterfaceBaseAddress = function (network) {
    return `https://${linkPrefix[network]}gnosis-safe.io/app/#`
  }

  const transactionApiBaseAddress = function (network) {
    return `https://safe-transaction.${network}.gnosis.io/api/v1`
  }

  /**
   * Signs and sends the transaction to the gnosis-safe UI
   *
   * @param {SmartContract} masterSafe Address of the master safe owning the brackets
   * @param {Transaction} transaction The transaction to be signed and sent
   * @param {string} network either rinkeby or mainnet
   * @param {number} [nonce=null] specified transaction index. Will fetch correct value if not specified.
   */
  const signAndSend = async function (masterSafe, transaction, network, nonce = null) {
    if (nonce === null) {
      nonce = await firstAvailableNonce(masterSafe.address, network)
    }

    const safeTxGas = await estimateGas(masterSafe, transaction)
    const transactionHash = await masterSafe.getTransactionHash(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      safeTxGas,
      CommonBaseGasForGnosisSafeTransaction,
      0,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      nonce
    )

    const signer = (await web3.eth.getAccounts())[0]
    console.log(
      `Signing and posting multi-send transaction ${transactionHash} from proposer account ${signer} with nonce ${nonce}`
    )
    const sigs = await getSafeCompatibleSignature(transactionHash, signer)

    const endpoint = `${transactionApiBaseAddress(network)}/safes/${masterSafe.address}/transactions/`
    const postData = {
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      operation: transaction.operation,
      safeTxGas: safeTxGas,
      baseGas: CommonBaseGasForGnosisSafeTransaction,
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
    const interfaceLink = `${webInterfaceBaseAddress(network)}/safes/${masterSafe.address}/transactions/`
    console.log("Transaction awaiting execution in the interface", interfaceLink)
  }

  /**
   * Checks whether a transaction was already proposed to the gnosis-safe UI
   *
   * @param {SmartContract} masterSafe Address of the master safe owning the brackets
   * @param {Transaction} transaction The transaction whose existence is checked
   * @param {string} network either rinkeby or mainnet
   * @param {number} [nonce=null] Gnosis Safe transaction nonce.
   */
  const transactionExistsOnSafeServer = async function (masterSafe, transaction, network, nonce = null) {
    if (nonce === null) {
      // if no nonce is provided, assume the transaction with the highest nonce is the one to verify
      nonce = -1 + (await firstAvailableNonce(masterSafe.address, network))
    }
    const safeTxGas = await estimateGas(masterSafe, transaction)
    const transactionHash = await masterSafe.getTransactionHash(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      safeTxGas,
      CommonBaseGasForGnosisSafeTransaction,
      0,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      nonce
    )
    const endpoint = `${transactionApiBaseAddress(network)}/transactions/${transactionHash}/`
    const result = await axios.get(endpoint).catch(function (error) {
      if (error.response.data.detail === "Not found.") {
        console.log("Error: This transaction does not match the transaction in the interface!")
      } else {
        throw new Error("Error while talking to the gnosis-interface: " + JSON.stringify(error.response.data))
      }
    })
    if (result !== undefined) {
      const interfaceLink = `${webInterfaceBaseAddress(network)}/safes/${masterSafe.address}/transactions`
      console.log(`This transaction matches one in the interface with nonce ${nonce} that can be signed here: ${interfaceLink}`)
    }
  }

  /**
   * Returns the first unused Safe nonce from the web interface.
   *
   * This function does *not* retrieve the nonce from the blockchain
   * but from the multisig web service. It keeps into account pending
   * transactions that were created in the web interface but never
   * executed onchain. If the blockchain nonce were used, the first
   * pending transaction would be overwritten and only one of the two
   * transactions (the newly created one and the overwritten one) can
   * be executed.
   *
   * @param {Address} multisigAddress Address of the multisig Safe for
   * which to retrieve the nonce.
   * @param {string} network Either rinkeby or mainnet.
   * @returns {number} The first Safe nonce available for a new transaction.
   */
  const firstAvailableNonce = async function (multisigAddress, network) {
    // https://safe-transaction.gnosis.io#operations-safes-safes_transactions_list
    const apiGetTtransactionUrl = `${transactionApiBaseAddress(
      network
    )}/safes/${multisigAddress}/transactions/?ordering=-nonce&limit=1`

    const result = await axios.get(apiGetTtransactionUrl)

    const hasExpectedEntries = result.data && result.data.results && Array.isArray(result.data.results)
    if (!hasExpectedEntries) {
      throw new Error("Failed to decode server response when retrieving nonce from the web interface")
    }
    if (result.data.results.length === 0) {
      // no transactions were ever created with this safe
      return 0
    }

    const nonce = result.data.results[0].nonce
    if (!Number.isInteger(nonce)) {
      throw new Error("Failed to decode server response when retrieving nonce from the web interface")
    }
    return 1 + nonce
  }

  return {
    firstAvailableNonce,
    signAndSend,
    transactionExistsOnSafeServer,
    linkPrefix,
  }
}
