module.exports = function (web3 = web3, artifacts = artifacts) {
  const ethUtil = require("ethereumjs-util")

  const IProxy = artifacts.require("IProxy")
  const GnosisSafe = artifacts.require("GnosisSafe.sol")
  const MultiSend = artifacts.require("MultiSend")

  const gnosisSafeMasterCopyPromise = GnosisSafe.deployed()
  const multiSendPromise = MultiSend.deployed()

  const ADDRESS_0 = "0x0000000000000000000000000000000000000000"
  const CALL = 0
  const DELEGATECALL = 1

  /**
   * @typedef Transaction
   *  * Example:
   *  {
   *    operation: CALL,
   *    to: "0x0000..000",
   *    value: "10",
   *    data: "0x00",
   *  }
   * @type {object}
   * @property {int} operation Either CALL or DELEGATECALL
   * @property {EthereumAddress} to Ethereum address receiving the transaction
   * @property {string} value Amount of ETH transferred
   * @property {string} data Data sent along with the transaction
   */

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
   * @param seconds: int
   */
  const waitForNSeconds = async function (seconds) {
    await send("evm_increaseTime", [seconds], web3)
    await send("evm_mine", [], web3)
  }

  const execTransaction = async function (safe, privateKey, transaction) {
    const nonce = await safe.nonce()
    const transactionHash = await safe.getTransactionHash(
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
    const account = await web3.eth.getAccounts()[0]
    const sigs = await web3.eth.sign(transactionHash, account)
    await safe.execTransaction(
      transaction.to,
      transaction.value,
      transaction.data,
      transaction.operation,
      0,
      0,
      0,
      ADDRESS_0,
      ADDRESS_0,
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
   * @param {Transaction[]} transactions List of {@link Transaction} that are to be bundled together
   * @return {Transaction} Multisend transaction bundling all input transactions
   */
  const buildBundledTransaction = async function (transactions) {
    // TODO: do we really need to await the concrete instance of multiSend, since we are only using it to compute the data of a transaction?
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
        ADDRESS_0,
        ADDRESS_0,
        sigs
      )
      .encodeABI()
  }

  /**
   * Creates a transaction that makes a master Safe execute a transaction on behalf of a (single-owner) owned trader using execTransaction
   * @param {EthereumAddress} masterAddress Address of a controlled Safe
   * @param {EthereumAddress} bracketAddress Address of a Safe, owned only by master, target of execTransaction
   * @param {Transaction} transaction The transaction to be executed by execTransaction
   * @return {Transaction} Transaction calling execTransaction; should be executed by master
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
   * @param {Address} transactions Address of a Gnosis Safe
   * @return {Address} Fallback contract of the input Gnosis Safe
   */
  const getFallbackHandler = async function (safeAddress) {
    return web3.utils.padLeft(await web3.eth.getStorageAt(safeAddress, fallbackHandlerStorageSlot), 40)
  }

  return {
    waitForNSeconds,
    getMasterCopy,
    getFallbackHandler,
    execTransaction,
    encodeMultiSend,
    buildBundledTransaction,
    buildExecTransaction,
    CALL,
    ADDRESS_0,
  }
}
