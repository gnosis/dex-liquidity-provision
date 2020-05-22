module.exports = function (web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const { ZERO_ADDRESS } = require("./constants")
  const { getSafeCompatibleSignature } = require("./internals")

  const linkPrefix = {
    rinkeby: "rinkeby.",
    mainnet: "",
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
    // https://docs.gnosis.io/safe/docs/contracts_tx_execution/#safe-transaction-gas-limit-estimation
    // The value returned by requiredTxGas is encoded in a revert error message. For retrieving the hex
    // encoded uint value the first 68 bytes of the error message need to be removed.
    const txGasEstimate = parseInt(estimateResponse.substring(138), 16)
    // Multiply with 64/63 due to EIP-150 (https://github.com/ethereum/EIPs/blob/master/EIPS/eip-150.md)
    return Math.ceil((txGasEstimate * 64) / 63)
  }

  /**
   * Signs and sends the transaction to the gnosis-safe UI
   * @param {Address} masterAddress Address of the master safe owning the brackets
   * @param {Transaction} transaction The transaction to be signed and sent
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
    const sigs = getSafeCompatibleSignature(transactionHash, signer)

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
