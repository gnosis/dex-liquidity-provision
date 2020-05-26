/**
 * @typedef {import('../typedef.js').Address} Address
 * @typedef {import('../typedef.js').Transaction} Transaction
 */

module.exports = function (web3 = web3, artifacts = artifacts) {
  const ethUtil = require("ethereumjs-util")

  const { ZERO_ADDRESS, CALL, DELEGATECALL } = require("./constants")

  const IProxy = artifacts.require("IProxy")
  const GnosisSafe = artifacts.require("GnosisSafe.sol")
  const MultiSend = artifacts.require("MultiSend")

  const gnosisSafeMasterCopyPromise = GnosisSafe.deployed()
  const multiSendPromise = MultiSend.deployed()

  const jsonrpc = "2.0"
  const id = 0
  const send = function (method, params, web3Provider) {
    return new Promise(function (resolve, reject) {
      web3Provider.currentProvider.send({ id, jsonrpc, method, params }, (error, result) => {
        if (error) {
          reject(error)
        } else {
          resolve(result)
        }
      })
    })
  }

  /**
   * Wait for n (evm) seconds to pass
   *
   * @param {number} seconds number of seconds to wait
   */
  const waitForNSeconds = async function (seconds) {
    await send("evm_increaseTime", [seconds], web3)
    await send("evm_mine", [], web3)
  }

  const execTransaction = async function (safe, signer, transaction) {
    const nonce = await safe.nonce()
    const transactionHash = await safe.getTransactionHash(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      0,
      0,
      0,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      nonce
    )
    const sigs = await getSafeCompatibleSignature(transactionHash, signer)
    await safe.execTransaction(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      0,
      0,
      0,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      sigs
    )
  }

  const encodeMultiSend = function (multiSend, txs) {
    return multiSend.contract.methods
      .multiSend(
        `0x${txs
          .map((tx) =>
            [
              web3.eth.abi.encodeParameter("uint8", tx.operation).slice(-2),
              web3.eth.abi.encodeParameter("address", tx.to).slice(-40),
              web3.eth.abi.encodeParameter("uint256", tx.value).slice(-64),
              web3.eth.abi.encodeParameter("uint256", web3.utils.hexToBytes(tx.data).length).slice(-64),
              tx.data.replace(/^0x/, ""),
            ].join("")
          )
          .join("")}`
      )
      .encodeABI()
  }

  /**
   * Given a collection of transactions, creates a single transaction that bundles all of them
   *
   * @param {Transaction[]} transactions List of {@link Transaction} that are to be bundled together
   * @returns {Transaction} Multisend transaction bundling all input transactions
   */
  const buildBundledTransaction = async function (transactions) {
    // TODO: do we really need to await the concrete instance of multiSend?
    // since we are only using it to compute the data of a transaction?
    const multiSend = await multiSendPromise
    const transactionData = encodeMultiSend(multiSend, transactions)
    const bundledTransaction = {
      operation: DELEGATECALL,
      to: multiSend.address,
      value: 0,
      data: transactionData,
    }
    return bundledTransaction
  }

  const execTransactionData = function (gnosisSafeMasterCopy, owner, transaction) {
    const sigs =
      "0x" +
      "000000000000000000000000" +
      owner.replace("0x", "") +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "01"
    return gnosisSafeMasterCopy.contract.methods
      .execTransaction(
        transaction.to,
        transaction.value,
        transaction.data,
        transaction.operation,
        0,
        0,
        0,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        sigs
      )
      .encodeABI()
  }

  /**
   * Creates a transaction that makes a master Safe execute a transaction on behalf of a (single-owner) owned trader using execTransaction
   *
   * @param {Address} masterAddress Address of a controlled Safe
   * @param {Address} bracketAddress Address of a Safe, owned only by master, target of execTransaction
   * @param {Transaction} transaction The transaction to be executed by execTransaction
   * @returns {Transaction} Transaction calling execTransaction; should be executed by master
   */
  const buildExecTransaction = async function (masterAddress, bracketAddress, transaction) {
    const gnosisSafeMasterCopy = await gnosisSafeMasterCopyPromise // TODO: do we need the master copy instance?

    const execData = await execTransactionData(gnosisSafeMasterCopy, masterAddress, transaction)
    const execTransaction = {
      operation: CALL,
      to: bracketAddress,
      value: 0,
      data: execData,
    }
    return execTransaction
  }

  const getMasterCopy = async function (safeAddress) {
    const safe = await IProxy.at(safeAddress)
    return safe.masterCopy()
  }

  const fallbackHandlerStorageSlot = "0x" + ethUtil.keccak256("fallback_manager.handler.address").toString("hex")
  /**
   * Users can set up their Gnosis Safe to have a fallback handler: a contract to which all transactions
   * with nonempty data triggering a call to the fallback are forwarded.
   * The fallback contract address is always located at the same storage position for every Safe.
   *
   * @param {Address} safeAddress Address of a Gnosis Safe
   * @returns {Address} Fallback contract of the input Gnosis Safe
   */
  const getFallbackHandler = async function (safeAddress) {
    return web3.utils.padLeft(await web3.eth.getStorageAt(safeAddress, fallbackHandlerStorageSlot), 40)
  }

  const getSafeCompatibleSignature = async function (transactionHash, signer) {
    const sigs = await web3.eth.sign(transactionHash, signer)
    console.log(`Modifying recovery byte (${sigs.slice(-2)}) for compatibility with Gnosis Safe Transaction Services`)
    // The following signature manipulation is according to
    // signature standards for Gnosis Safe execTransaction
    // https://docs.gnosis.io/safe/docs/contracts_signatures/
    const recoveryByteMap = {
      "00": "1f",
      "1b": "1f",
      "01": "20",
      "1c": "20",
    }
    const modifiedSigs = sigs.slice(0, -2) + recoveryByteMap[sigs.slice(-2)]
    return modifiedSigs
  }

  return {
    waitForNSeconds,
    getMasterCopy,
    getFallbackHandler,
    execTransaction,
    encodeMultiSend,
    buildBundledTransaction,
    buildExecTransaction,
    getSafeCompatibleSignature,
    CALL,
  }
}
