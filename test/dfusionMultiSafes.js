const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const exchangeUtils = require("@gnosis.pm/dex-contracts")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const TokenOWL = artifacts.require("TokenOWL")

const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const MultiSend = artifacts.require("MultiSend")
const BN = require("bn.js")

const TestToken = artifacts.require("DetailedMintableToken")

const {
  deployFleetOfSafes,
  buildOrderTransactionData,
  transferApproveDeposit,
  getRequestWithdrawTransaction,
  getWithdrawTransaction,
  getTransferFundsToMasterTransaction,
  buildTransferApproveDepositTransactionData,
  max128,
  maxU32,
  maxUINT,
  DELEGATECALL,
} = require("../scripts/trading_strategy_helpers")
const { waitForNSeconds, toETH, execTransaction, deploySafe } = require("./utils.js")

contract("GnosisSafe", function(accounts) {
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let testToken
  let exchange
  let multiSend

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
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    const fleet = await deployFleetOfSafes(masterSafe.address, 10, artifacts)
    assert.equal(fleet.length, 10)
    for (const slaveAddress of fleet) {
      const slaveSafe = await GnosisSafe.at(slaveAddress)
      const slaveOwners = await slaveSafe.getOwners()
      assert.equal(slaveOwners.length, 1, `Slave has unexpected number of owners ${slaveOwners.length}`)
      assert.equal(slaveOwners[0], masterSafe.address, "Expected Slave to have master safe as owner")
    }
  })

  it("transfers tokens from fund account through trader accounts and into exchange via manual deposit logic", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    const slaveSafes = await deployFleetOfSafes(masterSafe.address, 2, artifacts)
    const depositAmount = 1000
    await testToken.mint(accounts[0], depositAmount * slaveSafes.length)
    await testToken.transfer(masterSafe.address, depositAmount * slaveSafes.length)
    // Note that we are have NOT registered the tokens on the exchange but can deposit them nontheless.

    const deposits = slaveSafes.map(slaveAddress => ({
      amount: depositAmount.toString(),
      tokenAddress: testToken.address,
      userAddress: slaveAddress,
    }))

    const batchedTransactions = await transferApproveDeposit(masterSafe.address, deposits, web3, artifacts)
    assert.equal(batchedTransactions.to, multiSend.address)

    await execTransaction(masterSafe, lw, multiSend.address, 0, batchedTransactions.data, DELEGATECALL)
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

  it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    const fleetSize = 2
    const slaveSafes = await deployFleetOfSafes(masterSafe.address, fleetSize, artifacts)
    const depositAmountStableToken = new BN(1000)
    const stableToken = await TestToken.new(18)
    await stableToken.mint(accounts[0], depositAmountStableToken.mul(new BN(slaveSafes.length)))
    await stableToken.transfer(masterSafe.address, depositAmountStableToken.mul(new BN(slaveSafes.length)))
    const depositAmountTargetToken = new BN(2000)
    const targetToken = await TestToken.new(18)
    await targetToken.mint(accounts[0], depositAmountTargetToken.mul(new BN(slaveSafes.length)))
    await targetToken.transfer(masterSafe.address, depositAmountTargetToken.mul(new BN(slaveSafes.length)))

    const batchedTransactions = await buildTransferApproveDepositTransactionData(
      masterSafe.address,
      slaveSafes,
      stableToken.address,
      depositAmountStableToken,
      targetToken.address,
      depositAmountTargetToken,
      artifacts,
      web3
    )
    assert.equal(batchedTransactions.to, multiSend.address)

    await execTransaction(masterSafe, lw, multiSend.address, 0, batchedTransactions.data, DELEGATECALL)
    // Close auction for deposits to be refelcted in exchange balance
    await waitForNSeconds(301)

    for (const slaveAddress of slaveSafes.slice(0, fleetSize / 2)) {
      let slaveExchangeBalance = (await exchange.getBalance(slaveAddress, stableToken.address)).toNumber()
      assert.equal(slaveExchangeBalance, depositAmountStableToken)
      slaveExchangeBalance = (await exchange.getBalance(slaveAddress, targetToken.address)).toNumber()
      assert.equal(slaveExchangeBalance, 0)
      const slavePersonalTokenBalance = (await testToken.balanceOf(slaveAddress)).toNumber()
      // This should always output 0 as the slaves should never directly hold funds
      assert.equal(slavePersonalTokenBalance, 0)
    }
    for (const slaveAddress of slaveSafes.slice(fleetSize / 2 + 1, fleetSize / 2)) {
      let slaveExchangeBalance = (await exchange.getBalance(slaveAddress, targetToken.address)).toNumber()
      assert.equal(slaveExchangeBalance, depositAmountTargetToken)
      slaveExchangeBalance = (await exchange.getBalance(slaveAddress, stableToken.address)).toNumber()
      assert.equal(slaveExchangeBalance, 0)
      const slavePersonalTokenBalance = (await testToken.balanceOf(slaveAddress)).toNumber()
      // This should always output 0 as the slaves should never directly hold funds
      assert.equal(slavePersonalTokenBalance, 0)
    }
  })

  it("Places bracket orders on behalf of a fleet of safes", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    // Number of brackets is determined by fleet size
    const slaveSafes = await deployFleetOfSafes(masterSafe.address, 20, artifacts)
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
      targetPrice,
      web3,
      artifacts
    )
    await execTransaction(masterSafe, lw, transactionData.to, 0, transactionData.data, DELEGATECALL)

    // Correctness assertions
    for (const slaveAddress of slaveSafes) {
      const auctionElements = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders(slaveAddress))
      assert.equal(auctionElements.length, 2)
      const [buyOrder, sellOrder] = auctionElements
      assert(buyOrder.priceDenominator.eq(max128))
      assert(sellOrder.priceNumerator.eq(max128))
      // TODO - assert on the ratio of buy-sell prices.
      assert.equal(buyOrder.validUntil, maxU32, `Got ${sellOrder}`)
      assert.equal(sellOrder.validUntil, maxU32, `Got ${sellOrder}`)
    }
  })

  it("Test withdrawals", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    const slaveSafes = await deployFleetOfSafes(masterSafe.address, 2, artifacts)
    const depositAmount = toETH(20)
    const fullTokenAmount = depositAmount * slaveSafes.length
    await testToken.mint(accounts[0], fullTokenAmount.toString())
    await testToken.transfer(masterSafe.address, fullTokenAmount.toString())
    // Note that we have NOT registered the tokens on the exchange but can deposit them nontheless.

    const deposits = slaveSafes.map(slaveAddress => ({
      amount: depositAmount,
      tokenAddress: testToken.address,
      userAddress: slaveAddress,
    }))

    const batchedTransactions = await transferApproveDeposit(masterSafe.address, deposits, web3, artifacts)
    assert.equal(batchedTransactions.to, multiSend.address)

    await execTransaction(masterSafe, lw, multiSend.address, 0, batchedTransactions.data, DELEGATECALL)
    // Close auction for deposits to be refelcted in exchange balance
    await waitForNSeconds(301)

    // build withdrawal lists
    const withdrawals = []
    for (const trader of slaveSafes) withdrawals.push({ tokenAddress: testToken.address, traderAddress: trader })

    assert.equal(
      (await testToken.balanceOf(masterSafe.address)).toString(),
      "0",
      "Balance setup failed: master Safe still holds funds"
    )
    assert.equal(
      (await testToken.balanceOf(exchange.address)).toString(),
      fullTokenAmount.toString(),
      "Balance setup failed: the exchange does not hold all tokens"
    )
    for (const trader of slaveSafes)
      assert.equal((await testToken.balanceOf(trader)).toString(), "0", "Balance setup failed: trader Safes still holds funds")

    const requestWithdrawalTransaction = await getRequestWithdrawTransaction(masterSafe.address, withdrawals)
    await execTransaction(
      masterSafe,
      lw,
      requestWithdrawalTransaction.to,
      requestWithdrawalTransaction.value,
      requestWithdrawalTransaction.data,
      requestWithdrawalTransaction.operation, // This is DELEGATECALL
      "request withdrawal for all slaves"
    )
    await waitForNSeconds(301)

    for (const trader of slaveSafes) {
      const pendingWithdrawal = await exchange.getPendingWithdraw(trader, testToken.address)
      assert.equal(pendingWithdrawal[0].toString(), maxUINT.toString(), "Withdrawal was not registered on the exchange")
    }

    assert.equal(
      (await testToken.balanceOf(masterSafe.address)).toString(),
      "0",
      "Unexpected behavior in requestWithdraw: master Safe holds funds"
    )
    assert.equal(
      (await testToken.balanceOf(exchange.address)).toString(),
      fullTokenAmount.toString(),
      "Unexpected behavior in requestWithdraw: the exchange does not hold all tokens"
    )
    for (const trader of slaveSafes)
      assert.equal(
        (await testToken.balanceOf(trader)).toString(),
        "0",
        "Unexpected behavior in requestWithdraw: trader Safes holds funds"
      )

    const withdrawalTransaction = await getWithdrawTransaction(masterSafe.address, withdrawals)
    await execTransaction(
      masterSafe,
      lw,
      withdrawalTransaction.to,
      withdrawalTransaction.value,
      withdrawalTransaction.data,
      withdrawalTransaction.operation, // DELEGATECALL
      "withdraw for all slaves"
    )

    assert.equal(
      (await testToken.balanceOf(masterSafe.address)).toString(),
      "0",
      "Unexpected behavior when withdrawing: master Safe holds funds"
    )
    assert.equal(
      (await testToken.balanceOf(exchange.address)).toString(),
      "0",
      "Withdrawing failed: the exchange still holds all tokens"
    )
    for (const trader of slaveSafes)
      assert.equal(
        (await testToken.balanceOf(trader)).toString(),
        depositAmount.toString(),
        "Withdrawing failed: trader Safes do not hold the correct amount of funds"
      )

    const transferFundsToMasterTransaction = await getTransferFundsToMasterTransaction(
      masterSafe.address,
      withdrawals,
      web3,
      artifacts
    )
    await execTransaction(
      masterSafe,
      lw,
      transferFundsToMasterTransaction.to,
      transferFundsToMasterTransaction.value,
      transferFundsToMasterTransaction.data,
      transferFundsToMasterTransaction.operation, // DELEGATECALL
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

    assert.equal(
      (await testToken.balanceOf(masterSafe.address)).toString(),
      fullTokenAmount.toString(),
      "Fund retrieval failed: master Safe does not hold all funds"
    )
    assert.equal(
      (await testToken.balanceOf(exchange.address)).toString(),
      "0",
      "Unexpected behavior when retrieving funds: the exchange holds funds"
    )
    for (const trader of slaveSafes)
      assert.equal(
        (await testToken.balanceOf(trader)).toString(),
        "0",
        "Fund retrieval failed: trader Safes still hold some funds"
      )
  })
})
