const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const TokenOWL = artifacts.require("TokenOWL")

const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("./MultiSend.sol")

const ERC20 = artifacts.require("./ERC20Detailed")
const MintableERC20 = artifacts.require("./ERC20Mintable")

const { waitForNSeconds, toETH, encodeMultiSend, execTransaction, execTransactionData, deploySafe } = require("./utils.js")

const { 
  getRequestWithdrawTransaction,
  getWithdrawTransaction,
  getTransferFundsToMasterTransaction,
  getWithdrawAndTransferFundsToMasterTransaction
} = require("../scripts/withdraw.js")

contract("GnosisSafe", function(accounts) {
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let testToken
  let exchange
  let multiSend

  const CALL = 0

  beforeEach(async function() {
    // Create lightwallet
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    console.log(gnosisSafeMasterCopy.address)
    proxyFactory = await ProxyFactory.new()
    multiSend = await MultiSend.new()
    testToken = await MintableERC20.new()

    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
    console.log("BatchExchange Address", exchange.address)
  })

  it("Adds tokens to the exchange", async () => {
    const owlToken = await TokenOWL.at(await exchange.feeToken())
    await owlToken.setMinter(accounts[0])
    await owlToken.mintOWL(accounts[0], toETH(10))
    await owlToken.approve(exchange.address, toETH(10))

    await exchange.addToken(testToken.address, { from: accounts[0] })
    assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
  })
  it("transfers tokens from fund account through trader accounts into exchange", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    console.log("Master Safe", masterSafe.address)
    const amount = 10000
    await testToken.mint(accounts[0], amount)
    await testToken.transfer(masterSafe.address, amount)
    const slaveSafes = []
    for (let i = 0; i < 2; i++) {
      const newSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [masterSafe.address], 1)
      slaveSafes.push(newSafe.address)
    }
    console.log("Slave Safes", slaveSafes)
    const transactions = []
    for (let index = 0; index < slaveSafes.length; index++) {
      const slaveSafe = slaveSafes[index]
      const tokenAmount = index + 2
      // Get data to move funds from master to slave
      const transferData = await testToken.contract.methods.transfer(slaveSafe, tokenAmount).encodeABI()
      transactions.push({
        operation: CALL,
        to: testToken.address,
        value: 0,
        data: transferData,
      })
      // Get data to approve funds from slave to exchange
      const approveData = await testToken.contract.methods.approve(exchange.address, tokenAmount).encodeABI()
      // Get data to deposit funds from slave to exchange
      const depositData = await exchange.contract.methods.deposit(testToken.address, tokenAmount).encodeABI()
      // Get data for approve and deposit multisend on slave
      const multiSendData = await encodeMultiSend(multiSend, [
        { operation: CALL, to: testToken.address, value: 0, data: approveData },
        { operation: CALL, to: exchange.address, value: 0, data: depositData },
      ])
      // Get data to execute approve/deposit multisend via slave
      const execData = await execTransactionData(
        gnosisSafeMasterCopy,
        masterSafe.address,
        multiSend.address,
        0,
        multiSendData,
        1
      )
      transactions.push({
        operation: CALL,
        to: slaveSafe,
        value: 0,
        data: execData,
      })
    }
    // Get data to execute all fund/approve/deposit transactions at once
    const finalData = await encodeMultiSend(multiSend, transactions)
    await execTransaction(masterSafe, lw, multiSend.address, 0, finalData, 1, "deposit for all slaves")
    await waitForNSeconds(301)

    for (let index = 0; index < slaveSafes.length; index++) {
      const slaveSafeAddress = slaveSafes[index]
      console.log(
        "Slave",
        index,
        "(",
        slaveSafeAddress,
        ") deposit:",
        await exchange.getBalance(slaveSafeAddress, testToken.address)
      )
      // This should always output 0 as the slaves should never directly hold funds
      console.log("Slave", index, "(", slaveSafeAddress, ") balance:", await testToken.balanceOf(slaveSafeAddress))
    }
  })

  it.only("Test withdrawals", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    const amount = 100000

    const owlToken = await TokenOWL.at(await exchange.feeToken())
    await owlToken.setMinter(accounts[0])
    await owlToken.mintOWL(accounts[0], toETH(10+amount))
    await owlToken.approve(exchange.address, toETH(10), { from: accounts[0] })
    await owlToken.transfer(masterSafe.address, toETH(amount), { from: accounts[0] })

    await exchange.addToken(testToken.address, { from: accounts[0] })
    assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
    await testToken.mint(accounts[0], toETH(amount))
    await testToken.transfer(masterSafe.address, toETH(amount))

    /* Deploy and deposit fleet of safes. Should be replaced by scripts */
    const slaveSafes = []
    for (let i = 0; i < 2; i++) {
      const newSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [masterSafe.address], 1)
      slaveSafes.push(newSafe.address)
    }
    const transactions = []
    for (let index = 0; index < slaveSafes.length; index++) {
      const slaveSafe = slaveSafes[index]
      const tokenAmount = toETH(10).toString()
      // Get data to move funds from master to slave
      const transferDataTestToken = await testToken.contract.methods.transfer(slaveSafe, tokenAmount).encodeABI()
      const transferDataOwlToken = await owlToken.contract.methods.transfer(slaveSafe, tokenAmount).encodeABI()
      transactions.push({
        operation: CALL,
        to: testToken.address,
        value: 0,
        data: transferDataTestToken,
      },
      {
        operation: CALL,
        to: owlToken.address,
        value: 0,
        data: transferDataOwlToken,
      })
      // Get data to approve funds from slave to exchange
      const approveDataTestToken = await testToken.contract.methods.approve(exchange.address, tokenAmount).encodeABI()
      const approveDataOwlToken = await owlToken.contract.methods.approve(exchange.address, tokenAmount).encodeABI()
      // Get data to deposit funds from slave to exchange
      const depositDataTestToken = await exchange.contract.methods.deposit(testToken.address, tokenAmount).encodeABI()
      const depositDataOwlToken = await exchange.contract.methods.deposit(owlToken.address, tokenAmount).encodeABI()
      // Get data for approve and deposit multisend on slave
      const multiSendData = await encodeMultiSend(multiSend, [
        { operation: CALL, to: testToken.address, value: 0, data: approveDataTestToken },
        { operation: CALL, to: exchange.address, value: 0, data: depositDataTestToken },
        { operation: CALL, to: owlToken.address, value: 0, data: approveDataOwlToken },
        { operation: CALL, to: exchange.address, value: 0, data: depositDataOwlToken },
      ])
      // Get data to execute approve/deposit multisend via slave
      const execData = await execTransactionData(
        gnosisSafeMasterCopy,
        masterSafe.address,
        multiSend.address,
        0,
        multiSendData,
        1
      )
      transactions.push({
        operation: CALL,
        to: slaveSafe,
        value: 0,
        data: execData,
      })
    }
    // Get data to execute all fund/approve/deposit transactions at once
    const finalData = await encodeMultiSend(multiSend, transactions)
    await execTransaction(masterSafe, lw, multiSend.address, 0, finalData, 1, "deposit for all slaves")
    await waitForNSeconds(3001)
    /* end part to be replaced */

    console.log("Balance owlToken master", (await owlToken.balanceOf(masterSafe.address)).toString())
    for (const trader of slaveSafes) {
      console.log("Exchange balance trader owlToken: ", (await exchange.getBalance(trader, owlToken.address)).toString())
    }

    // build withdrawal lists
    const withdrawals = []
    for (const trader of slaveSafes) {
      withdrawals.push({tokenAddress: owlToken.address, traderAddress: trader})
      withdrawals.push({tokenAddress: testToken.address, traderAddress: trader})
    }

    console.log("Before request withdrawal")
    console.log("Balance owlToken master: ", (await owlToken.balanceOf(masterSafe.address)).toString())
    console.log("Balance owlToken exchange: ", (await owlToken.balanceOf(exchange.address)).toString())
    for (const trader of slaveSafes) {
      console.log("Balance owlToken trader: ", (await owlToken.balanceOf(trader)).toString())
    }

    const requestWithdrawalTransaction = await getRequestWithdrawTransaction(masterSafe.address, withdrawals)
    console.log(requestWithdrawalTransaction)
    await execTransaction(
      masterSafe,
      lw,
      requestWithdrawalTransaction.to,
      requestWithdrawalTransaction.value,
      requestWithdrawalTransaction.data,
      requestWithdrawalTransaction.operation,
      "request withdrawal for all slaves"
    )
    await waitForNSeconds(3001)

    console.log("Before withdraw")
    console.log("Balance owlToken master: ", (await owlToken.balanceOf(masterSafe.address)).toString())
    console.log("Balance owlToken exchange: ", (await owlToken.balanceOf(exchange.address)).toString())
    for (const trader of slaveSafes) {
      console.log("Balance owlToken trader: ", (await owlToken.balanceOf(trader)).toString())
    }

    const withdrawalTransaction = await getWithdrawTransaction(masterSafe.address, withdrawals)
    await execTransaction(
      masterSafe,
      lw,
      withdrawalTransaction.to,
      withdrawalTransaction.value,
      withdrawalTransaction.data,
      withdrawalTransaction.operation,
      "withdraw for all slaves"
    )

    console.log("Before transfer back funds")
    console.log("Balance owlToken master: ", (await owlToken.balanceOf(masterSafe.address)).toString())
    console.log("Balance owlToken exchange: ", (await owlToken.balanceOf(exchange.address)).toString())
    for (const trader of slaveSafes) {
      console.log("Balance owlToken trader: ", (await owlToken.balanceOf(trader)).toString())
    }

    const dataTranferBack = await getTransferFundsToMasterTransaction(masterSafe.address, withdrawals)
    await execTransaction(masterSafe, lw, multiSend.address, 0, dataTranferBack, 1, "transfer funds to master")

    /*
    // this is a compact alternative that should merge the two previous transactions together, but it doesn't work.
    const withdrawAndTransferFundsToMasterTransaction = await getWithdrawAndTransferFundsToMasterTransaction(masterSafe.address, withdrawals)
    await execTransaction(
      masterSafe,
      lw,
      withdrawAndTransferFundsToMasterTransaction.to,
      withdrawAndTransferFundsToMasterTransaction.value,
      withdrawAndTransferFundsToMasterTransaction.data,
      withdrawAndTransferFundsToMasterTransaction.operation,
      "withdraw and transfer back for all slaves"
    )
    */

    console.log("Balance owlToken master: ", (await owlToken.balanceOf(masterSafe.address)).toString())
    console.log("Balance owlToken exchange: ", (await owlToken.balanceOf(exchange.address)).toString())
    for (const trader of slaveSafes) {
      console.log("Balance owlToken trader: ", (await owlToken.balanceOf(trader)).toString())
    }

  })
})
