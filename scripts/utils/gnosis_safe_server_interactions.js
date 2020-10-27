/**
 * @typedef {import('../typedef.js').Address} Address
 * @typedef {import('../typedef.js').Transaction} Transaction
 * @typedef {import('../typedef.js').SmartContract} SmartContract
 */

module.exports = function (web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const { signTransaction, signAndExecute, estimateGas } = require("./internals")(web3, artifacts)
  const { promptUser } = require("./user_interface_helpers")
  const { ZERO_ADDRESS } = require("./constants")

  const linkPrefix = {
    rinkeby: "rinkeby.",
    mainnet: "",
    xdai: "xdai",
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
   * @param {string} network either rinkeby, xdai or mainnet
   * @param {number} [nonce=null] specified transaction index. Will fetch correct value if not specified.
   */
  const signAndSend = async function (masterSafe, transaction, network, nonce = null) {
    if (nonce === null) {
      nonce = await firstAvailableNonce(masterSafe.address, network)
    }

    const safeTxGas = await estimateGas(masterSafe, transaction)
    const { signature, signer, transactionHash } = await signTransaction(masterSafe, transaction, safeTxGas, nonce)

    const endpoint = `${transactionApiBaseAddress(network)}/safes/${masterSafe.address}/transactions/`
    const postData = {
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      operation: transaction.operation,
      safeTxGas: safeTxGas,
      baseGas: 0,
      gasPrice: 0, // important that this is zero
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce: nonce,
      contractTransactionHash: transactionHash,
      sender: web3.utils.toChecksumAddress(signer),
      signature: signature,
    }
    await axios.post(endpoint, postData).catch(function (error) {
      throw new Error("Error while talking to the gnosis-interface: " + JSON.stringify(error.response.data))
    })
    const interfaceLink = `${webInterfaceBaseAddress(network)}/safes/${masterSafe.address}/transactions/`
    console.log("Transaction awaiting execution in the interface", interfaceLink)

    return nonce
  }

  /**
   * Checks whether a transaction was already proposed to the gnosis-safe UI
   *
   * @param {SmartContract} masterSafe Instance of the master safe owning the brackets
   * @param {Transaction} transaction The transaction whose existence is checked
   * @param {string} network either rinkeby, xdai or mainnet
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
      0,
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
   * @param {string} network Either rinkeby, xdai or mainnet.
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

  /**
   * Either checks if the transaction exists on the web interface
   * or create a new transaction, depending on the first flag.
   *
   * @param {boolean} verifyOnly Whether to verify if the transaction exists
   * or creating a new one.
   * @param {SmartContract} masterSafe The Safe used to execute the
   * transaction.
   * @param {number} nonce The nonce used by the transaction.
   * @param {Transaction} transaction The transaction to be sent.
   * @param {string} network Either rinkeby, xdai or mainnet.
   * @param {boolean} executeOnchain Whether the transaction should be
   * executed immediately onchain or just created in the web interface.
   * @param {boolean} mustPromptUser Whether to prompt the user with a
   * confirmation dialog.
   */
  const processTransaction = async function (
    verifyOnly,
    masterSafe,
    nonce,
    transaction,
    network,
    executeOnchain,
    mustPromptUser
  ) {
    if (!verifyOnly) {
      let promptSuccessful = true
      if (mustPromptUser) {
        const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
        promptSuccessful = answer === "y" || answer.toLowerCase() === "yes"
      }
      if (promptSuccessful) {
        if (executeOnchain) {
          await signAndExecute(masterSafe, transaction)
        } else {
          const nonce = await signAndSend(masterSafe, transaction, network)
          console.log(`To verify the transaction run the same script with --verify --nonce=${nonce}`)
        }
      }
    } else {
      console.log("Verifying transaction...")
      await transactionExistsOnSafeServer(masterSafe, transaction, network, nonce)
    }
  }

  return {
    firstAvailableNonce,
    signAndSend,
    processTransaction,
    transactionExistsOnSafeServer,
    linkPrefix,
  }
}
