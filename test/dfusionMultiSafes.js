const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const TokenOWL = artifacts.require("TokenOWL")

const GnosisSafe = artifacts.require("GnosisSafe.sol")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("MultiSend.sol")

const TestToken = artifacts.require("DetailedMintableToken")

const {
  deployFleetOfSafes,
  buildOrderTransactionData,
  transferApproveDeposit,
  max128,
  maxU32,
} = require("../scripts/trading_strategy_helpers")
const { waitForNSeconds, toETH, execTransaction, deploySafe, decodeOrdersBN } = require("./utils.js")

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
    // TODO - can we just use accounts provided by ganache?
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    multiSend = await MultiSend.deployed()
    testToken = await TestToken.new(18)

    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
  })

  async function prepareTokenRegistration(account) {
    const owlToken = await TokenOWL.at(await exchange.feeToken())
    await owlToken.setMinter(account)
    await owlToken.mintOWL(account, toETH(10))
    await owlToken.approve(exchange.address, toETH(10))
  }

  it("Adds tokens to the exchange", async () => {
    await prepareTokenRegistration(accounts[0])
    await exchange.addToken(testToken.address, { from: accounts[0] })
    assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
  })

  it("Deploys Fleet of Gnosis Safes", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    const fleet = await deployFleetOfSafes(masterSafe.address, 10)
    assert.equal(fleet.length, 10)
    for (const slaveAddress of fleet) {
      const slaveSafe = await GnosisSafe.at(slaveAddress)
      const slaveOwners = await slaveSafe.getOwners()
      assert.equal(slaveOwners.length, 1, `Slave has unexpected number of owners ${slaveOwners.length}`)
      assert.equal(slaveOwners[0], masterSafe.address, "Expected Slave to have master safe as owner")
    }
  })

  it("transfers tokens from fund account through trader accounts and into exchange", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    const slaveSafes = await deployFleetOfSafes(masterSafe.address, 2)
    const depositAmount = 1000
    await testToken.mint(accounts[0], depositAmount * slaveSafes.length)
    await testToken.transfer(masterSafe.address, depositAmount * slaveSafes.length)
    // Note that we are have NOT registered the tokens on the exchange but can deposit them nontheless.

    const deposits = slaveSafes.map(slaveAddress => ({
      amount: depositAmount,
      tokenAddress: testToken.address,
      userAddress: slaveAddress,
    }))

    const batchedTransactions = await transferApproveDeposit(masterSafe, deposits)
    assert.equal(batchedTransactions.to, multiSend.address)

    await execTransaction(masterSafe, lw, multiSend.address, 0, batchedTransactions.data, 1)
    // Close auction for deposits to be refelcted in exchange balance
    await waitForNSeconds(301)

    for (const slaveAddress of slaveSafes) {
      const slaveExchangeBalance = (await exchange.getBalance(slaveAddress, testToken.address)).toNumber()
      assert.equal(slaveExchangeBalance, depositAmount)
      const slavePersonalTokenBalance = (await testToken.balanceOf(slaveAddress)).toNumber()
      // This should always output 0 as the slaves should never directly hold funds
      assert.equal(slavePersonalTokenBalance, 0)
    }
  })
  it("Places bracket orders on behalf of a fleet of safes", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    // Number of brackets is determined by fleet size
    const slaveSafes = await deployFleetOfSafes(masterSafe.address, 20)
    const targetToken = 0 // ETH
    const stableToken = 1 // DAI
    // const targetPrice = 270.6 // Price of ETH in USD  at 8:37 AM February 13, Berlin Germany
    const targetPrice = 100
    // add "stableToken" to exchange
    await prepareTokenRegistration(accounts[0])
    await exchange.addToken(testToken.address, { from: accounts[0] })

    const transactionData = await buildOrderTransactionData(
      masterSafe.address,
      slaveSafes,
      targetToken,
      stableToken,
      targetPrice
    )
    await execTransaction(masterSafe, lw, transactionData.to, 0, transactionData.data, 1)

    // Correctness assertions
    for (const slaveAddress of slaveSafes) {
      const auctionElements = decodeOrdersBN(await exchange.getEncodedUserOrders(slaveAddress))
      assert.equal(auctionElements.length, 2)
      const [buyOrder, sellOrder] = auctionElements
      assert(buyOrder.priceDenominator.eq(max128))
      assert(sellOrder.priceNumerator.eq(max128))
      // TODO - assert on the ratio of buy-sell prices.
      assert.equal(buyOrder.validUntil, maxU32, `Got ${sellOrder}`)
      assert.equal(sellOrder.validUntil, maxU32, `Got ${sellOrder}`)
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

    const transferFundsToMasterTransaction = await getTransferFundsToMasterTransaction(masterSafe.address, withdrawals)
    await execTransaction(
      masterSafe,
      lw,
      transferFundsToMasterTransaction.to,
      transferFundsToMasterTransaction.value,
      transferFundsToMasterTransaction.data,
      transferFundsToMasterTransaction.operation,
      "transfer funds to master for all slaves"
    )

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
